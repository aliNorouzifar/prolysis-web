// Adapter: backend (Plotly-serialized) figures -> renderer-agnostic chart specs.
//
// prolysis emits Plotly JSON; Plotly 6 encodes numeric arrays as
// {bdata: base64, dtype: "f8", shape: "3, 19"}. We decode those and classify each
// figure by the data's job: a 1-row matrix is really a SIGNAL (line/area), a small
// matrix is a labeled MATRIX, a large one a dense HEATMAP.

export interface SignalSpec {
  kind: "signal";
  values: (number | null)[];
  labels: string[];
  /** Original colorscale of the figure (thesis-consistent), light -> dark. */
  ramp?: string[];
  rowLabel?: string; // e.g. the window size of the 1-row heatmap
  min: number;
  max: number;
  xTitle?: string;
  yTitle?: string;
}

export interface MatrixSpec {
  kind: "matrix";
  values: (number | null)[][]; // [row][col]
  xLabels: string[];
  yLabels: string[];
  min: number;
  max: number;
  diverging: boolean;
  dense: boolean;
  hLines: number[]; // horizontal separators (row coordinates)
  vLines: number[]; // vertical change points (column coordinates)
  xTicks?: number[]; // columns that carry an x label; all columns when absent
  /** Original colorscale of the figure (thesis-consistent). */
  ramp?: string[];
  xTitle?: string;
  yTitle?: string;
}

export type ChartSpec = SignalSpec | MatrixSpec | { kind: "unsupported" };

type Bdata = { bdata: string; dtype: string; shape?: string };

function isBdata(v: unknown): v is Bdata {
  return !!v && typeof v === "object" && "bdata" in (v as object);
}

function decodeBdata(b: Bdata): number[][] {
  const raw = atob(b.bdata);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  let flat: ArrayLike<number>;
  switch (b.dtype) {
    case "f8": flat = new Float64Array(bytes.buffer); break;
    case "f4": flat = new Float32Array(bytes.buffer); break;
    case "i4": flat = new Int32Array(bytes.buffer); break;
    case "i2": flat = new Int16Array(bytes.buffer); break;
    case "u1": case "i1": flat = bytes; break;
    default: flat = new Float64Array(bytes.buffer);
  }
  const dims = (b.shape ?? String(flat.length)).split(",").map((s) => parseInt(s, 10));
  const [rows, cols] = dims.length === 2 ? dims : [1, dims[0]];
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) row.push(flat[r * cols + c]);
    out.push(row);
  }
  return out;
}

function toMatrix(z: unknown): (number | null)[][] {
  const m = isBdata(z) ? decodeBdata(z) : (z as (number | null)[][]);
  return (m ?? []).map((row) =>
    (row ?? []).map((v) => (v == null || Number.isNaN(v) ? null : (v as number))),
  );
}

function toLabels(v: unknown, n: number, prefix: string): string[] {
  if (Array.isArray(v) && v.length) return v.map((s) => roundNumbers(prettyLabel(String(s))));
  if (isBdata(v)) return decodeBdata(v)[0].map((x) => String(x));
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
}

/** Shortens long decimals in display text: "1% (0.11005716745)" -> "1% (0.11)". */
export function roundNumbers(s: string): string {
  return s.replace(/-?\d+\.\d{3,}/g, (m) => {
    const x = Number(m);
    return String(Number(Math.abs(x) >= 0.01 ? x.toFixed(2) : x.toPrecision(2)));
  });
}

/** "('AlternateSuccession', 'Check Completeness', ' Approve')" -> "AlternateSuccession(Check Completeness, Approve)" */
export function prettyLabel(s: string): string {
  const m = /^\('([^']*)'\s*,\s*'([^']*)'(?:\s*,\s*'([^']*)')?\s*\)$/.exec(s.trim());
  if (!m) return s;
  const [, tpl, a, b] = m;
  return b !== undefined
    ? `${tpl}(${a.trim()}, ${b.trim()})`
    : `${tpl}(${a.trim()})`;
}

interface PlotlyFig {
  data?: Record<string, unknown>[];
  layout?: Record<string, unknown>;
}

/** Parse a Plotly colorscale ([[t, "rgb(...)"|"#hex"|"white"], …]) into an ordered
 *  color list — this keeps the app's charts on the SAME palettes as the thesis figures. */
function parseColorscale(cs: unknown): string[] | undefined {
  if (!Array.isArray(cs) || !cs.length) return undefined;
  const named: Record<string, string> = { white: "#ffffff", black: "#000000" };
  const out: string[] = [];
  for (const stop of cs) {
    if (!Array.isArray(stop) || stop.length < 2) return undefined;
    const c = String(stop[1]).trim().toLowerCase();
    const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c);
    if (m) {
      out.push(
        "#" +
          [m[1], m[2], m[3]]
            .map((v) => parseInt(v, 10).toString(16).padStart(2, "0"))
            .join(""),
      );
    } else if (c.startsWith("#")) {
      out.push(c);
    } else if (named[c]) {
      out.push(named[c]);
    } else {
      return undefined;
    }
  }
  return out;
}

/** The axis ticks a figure declares, e.g. one "segment i" label per segment. */
function axisTicks(
  layout: Record<string, unknown> | undefined,
  axis: string,
): { vals: number[]; text: string[] } | undefined {
  const ax = layout?.[axis] as Record<string, unknown> | undefined;
  const v = ax?.tickvals;
  const vals = Array.isArray(v) ? v.map(Number) : isBdata(v) ? decodeBdata(v)[0].map(Number) : undefined;
  const text = ax?.ticktext;
  if (!vals?.length || !Array.isArray(text) || text.length !== vals.length) return undefined;
  return { vals, text: text.map(String) };
}

function axisTitle(layout: Record<string, unknown> | undefined, axis: string): string | undefined {
  const ax = layout?.[axis] as Record<string, unknown> | undefined;
  const t = ax?.title as Record<string, unknown> | string | undefined;
  const text = typeof t === "string" ? t : (t?.text as string | undefined);
  return text?.trim() || undefined;
}

export function parseFigure(fig: unknown): ChartSpec {
  const f = fig as PlotlyFig;
  const trace = f.data?.[0];
  if (!trace) return { kind: "unsupported" };

  if (trace.type === "heatmap") {
    const values = toMatrix(trace.z);
    if (!values.length) return { kind: "unsupported" };
    const rows = values.length;
    const cols = values[0].length;
    const flat = values.flat().filter((v): v is number => v != null);
    const min = Math.min(...flat);
    const max = Math.max(...flat);

    const ramp = parseColorscale(trace.colorscale);

    // A single-row "heatmap" is a signal over the x axis. Rendered as a heatmap strip
    // by default (matching the thesis figures) with a line view available.
    if (rows === 1) {
      const yl = toLabels(trace.y, 1, "w");
      return {
        kind: "signal",
        values: values[0],
        labels: toLabels(trace.x, cols, "bin"),
        ramp,
        rowLabel: yl[0],
        min: typeof trace.zmin === "number" ? trace.zmin : min,
        max: typeof trace.zmax === "number" ? trace.zmax : max,
        xTitle: axisTitle(f.layout, "xaxis"),
        yTitle: axisTitle(f.layout, "yaxis"),
      };
    }

    // Horizontal separator lines (e.g. cluster boundaries) from layout shapes.
    const shapes = (f.layout?.shapes as Record<string, unknown>[] | undefined) ?? [];
    const hLines = shapes
      .filter((s) => s.type === "line" && s.y0 === s.y1)
      .map((s) => Number(s.y0));
    const vLines = shapes
      .filter((s) => s.type === "line" && s.x0 === s.x1)
      .map((s) => Number(s.x0))
      .sort((a, b) => a - b);

    // With segment labels and change points, name each column after its segment and
    // label only the segment centers, so the axis shows the segments of the PVI step.
    let xLabels = toLabels(trace.x, cols, "segment");
    let xTicks: number[] | undefined;
    const ticks = axisTicks(f.layout, "xaxis");
    if (ticks && vLines.length && ticks.text.length === vLines.length + 1) {
      xLabels = Array.from({ length: cols }, (_, c) => ticks.text[vLines.filter((p) => p <= c).length]);
      xTicks = ticks.vals.map((v) => Math.min(Math.max(Math.round(v), 0), cols - 1));
    }

    return {
      kind: "matrix",
      values,
      xLabels,
      xTicks,
      yLabels: toLabels(trace.y, rows, "cluster"),
      min: Math.min(min, typeof trace.zmin === "number" ? trace.zmin : min),
      max: Math.max(max, typeof trace.zmax === "number" ? trace.zmax : max),
      diverging: (typeof trace.zmin === "number" ? trace.zmin : min) < 0,
      dense: rows > 14 || cols > 20,
      hLines,
      vLines,
      ramp,
      xTitle: axisTitle(f.layout, "xaxis"),
      yTitle: axisTitle(f.layout, "yaxis"),
    };
  }

  return { kind: "unsupported" };
}
