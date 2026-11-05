import { Group, Text, useComputedColorScheme } from "@mantine/core";
import { useRef, useState } from "react";

/** Structured clustermap payload from the discriminative backend: the Jaccard
 *  distance matrix between rules (already in dendrogram leaf order), per-rule
 *  RuleFit coefficient + support, and the scipy dendrogram geometry. */
export interface ClustermapData {
  labels: string[];
  descriptions: string[];
  matrix: number[][];
  importance: number[];
  support: number[];
  dendrogram: { icoord: number[][]; dcoord: number[][] };
}

const FONT =
  "'Inter Variable', Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const MONO = "var(--mantine-font-family-monospace)";

// Same sequential palettes as the thesis figures (matplotlib Blues / Oranges).
const BLUES = ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"];
const ORANGES = ["#fff4e6", "#ffd8a8", "#ffa94d", "#e8590c"];

function hex2rgb(h: string): [number, number, number] {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

/** Interpolate a multi-stop ramp at t ∈ [0, 1]. */
function rampColor(colors: string[], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i = Math.min(Math.floor(x), colors.length - 2);
  const f = x - i;
  const a = hex2rgb(colors[i]);
  const b = hex2rgb(colors[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** "('Response', 'A', 'B')-satisfied <= 0.5" -> "Response(A, B)-satisfied <= 0.5" */
function prettyRule(s: string): string {
  return s.replace(
    /\('([^']*)'\s*,\s*'([^']*)'(?:\s*,\s*'([^']*)')?\s*\)/g,
    (_m, tpl: string, a: string, b?: string) =>
      b !== undefined ? `${tpl}(${a.trim()}, ${b.trim()})` : `${tpl}(${a.trim()})`,
  );
}

interface Tip {
  x: number;
  y: number;
  title: string;
  desc?: string;
  value?: string;
}

/**
 * Native rendering of the discriminative clustered-rule map (thesis §5.3 figure):
 * a row dendrogram (linkage over Jaccard distance between the trace sets each rule
 * covers), two annotation strips (RuleFit coefficient and rule support), and the
 * Jaccard distance heatmap — with hover tooltips carrying the full rule text.
 */
export function RuleClusterMap({ data }: { data: ClustermapData }) {
  const scheme = useComputedColorScheme("light");
  const dark = scheme === "dark";
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);

  const n = data.labels.length;
  if (!n || !data.matrix.length) return null;

  const text = dark ? "#c1c2c5" : "#495057";
  const muted = dark ? "#8d8f96" : "#868e96";
  const guide = dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)";
  const diverging = dark
    ? ["#e03131", "#2a2c33", "#22b8cf"]
    : ["#c92a2a", "#f1f3f5", "#0c8599"];

  // Geometry (viewBox units; the svg scales to the container width). The cell size
  // targets a ~440px heatmap: a handful of rules renders large, dozens stay compact.
  const cell = Math.max(9, Math.min(44, Math.round(440 / n)));
  const gap = cell >= 14 ? 2 : 1;
  const dendroW = 100;
  const stripW = Math.max(12, Math.round(cell * 0.45));
  const top = 4;
  const sx1 = dendroW + 8; // importance strip
  const sx2 = sx1 + stripW + 3; // support strip
  const heatL = sx2 + stripW + 8;
  const heat = n * cell;
  const labelChars = Math.max(...data.labels.map((l) => l.length));
  const labelFs = Math.max(7, Math.min(10, cell - 3));
  const labelW = 10 + labelChars * labelFs * 0.62;
  const bottomH = 16 + labelChars * labelFs * 0.62;
  const W = heatL + heat + labelW;
  const H = top + heat + bottomH;
  const labelEvery = n > 40 ? 2 : 1;

  // Value domains.
  const maxJ = Math.max(1e-9, ...data.matrix.flat());
  const absImp = Math.max(1e-9, ...data.importance.map(Math.abs));
  const minSup = Math.min(...data.support);
  const maxSup = Math.max(...data.support);
  const supT = (v: number) => (maxSup > minSup ? (v - minSup) / (maxSup - minSup) : 0.5);

  // Dendrogram: icoord runs along the leaf axis (leaf k centred at 5 + 10k in leaf
  // order — the order of `matrix` rows), dcoord is the linkage distance.
  const maxD = Math.max(1e-9, ...data.dendrogram.dcoord.flat());
  const leafY = (ic: number) => top + ((ic - 5) / 10) * cell + cell / 2;
  const distX = (dc: number) => dendroW - (dc / maxD) * (dendroW - 4);

  const show = (e: React.MouseEvent, t: Omit<Tip, "x" | "y">) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, ...t });
  };
  const hide = () => {
    setTip(null);
    setHover(null);
  };
  const flip = tip && wrapRef.current
    ? tip.x > wrapRef.current.clientWidth * 0.55
    : false;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", maxWidth: W, height: "auto", display: "block" }}
        onMouseLeave={hide}
      >
        {/* Row dendrogram */}
        {data.dendrogram.icoord.map((ic, k) => {
          const dc = data.dendrogram.dcoord[k];
          const pts = ic.map((v, i) => `${distX(dc[i])},${leafY(v)}`).join(" ");
          return (
            <polyline key={k} points={pts} fill="none" stroke={muted}
              strokeWidth={1.2} strokeLinejoin="round" />
          );
        })}

        {/* Importance + support strips */}
        {data.importance.map((v, r) => (
          <rect key={`i${r}`} x={sx1} y={top + r * cell + gap / 2}
            width={stripW} height={cell - gap} rx={2}
            fill={rampColor(diverging, (v + absImp) / (2 * absImp))}
            onMouseMove={(e) => {
              setHover({ r, c: -1 });
              show(e, {
                title: data.labels[r],
                desc: prettyRule(data.descriptions[r]),
                value: `coefficient ${v >= 0 ? "+" : ""}${v} — pushes towards ${v >= 0 ? "L+" : "L−"}`,
              });
            }}
          />
        ))}
        {data.support.map((v, r) => (
          <rect key={`s${r}`} x={sx2} y={top + r * cell + gap / 2}
            width={stripW} height={cell - gap} rx={2}
            fill={rampColor(ORANGES, supT(v))}
            onMouseMove={(e) => {
              setHover({ r, c: -1 });
              show(e, {
                title: data.labels[r],
                desc: prettyRule(data.descriptions[r]),
                value: `support ${v}`,
              });
            }}
          />
        ))}

        {/* Jaccard heatmap */}
        {data.matrix.map((row, r) =>
          row.map((v, c) => (
            <rect key={`${r}-${c}`} x={heatL + c * cell + gap / 2}
              y={top + r * cell + gap / 2} width={cell - gap} height={cell - gap}
              rx={cell >= 14 ? 3 : 1} fill={rampColor(BLUES, v / maxJ)}
              onMouseMove={(e) => {
                setHover({ r, c });
                show(e, {
                  title: r === c ? data.labels[r] : `${data.labels[r]} ↔ ${data.labels[c]}`,
                  value: `Jaccard distance ${v.toFixed(3)}`,
                });
              }}
            />
          )),
        )}

        {/* Hover crosshair (row + column guides) */}
        {hover && (
          <g pointerEvents="none">
            <rect x={sx1} y={top + hover.r * cell} width={heatL + heat - sx1}
              height={cell} fill={guide} />
            {hover.c >= 0 && (
              <rect x={heatL + hover.c * cell} y={top} width={cell} height={heat}
                fill={guide} />
            )}
          </g>
        )}

        {/* Row labels (right) */}
        {data.labels.map((l, r) =>
          r % labelEvery === 0 ? (
            <text key={`yl${r}`} x={heatL + heat + 6} y={top + r * cell + cell / 2}
              fontSize={labelFs} fontFamily={FONT} fill={muted}
              dominantBaseline="central"
              onMouseMove={(e) => {
                setHover({ r, c: -1 });
                show(e, { title: l, desc: prettyRule(data.descriptions[r]) });
              }}
              onMouseLeave={hide}
            >
              {l}
            </text>
          ) : null,
        )}

        {/* Column labels (bottom, rotated) + strip captions */}
        {data.labels.map((l, c) =>
          c % labelEvery === 0 ? (
            <text key={`xl${c}`}
              transform={`translate(${heatL + c * cell + cell / 2}, ${top + heat + 6}) rotate(-90)`}
              fontSize={labelFs} fontFamily={FONT} fill={muted} textAnchor="end"
              dominantBaseline="central"
            >
              {l}
            </text>
          ) : null,
        )}
        <text transform={`translate(${sx1 + stripW / 2}, ${top + heat + 6}) rotate(-90)`}
          fontSize={labelFs} fontFamily={FONT} fill={muted} textAnchor="end"
          dominantBaseline="central">coef</text>
        <text transform={`translate(${sx2 + stripW / 2}, ${top + heat + 6}) rotate(-90)`}
          fontSize={labelFs} fontFamily={FONT} fill={muted} textAnchor="end"
          dominantBaseline="central">support</text>
      </svg>

      {/* Legends */}
      <Group gap="xl" mt="xs" wrap="wrap">
        <Legend title="Jaccard distance" colors={BLUES} left="0" right={maxJ.toFixed(2)} />
        <Legend title="Rule coefficient" colors={diverging}
          left={`−${absImp.toFixed(2)} → L−`} mid="0" right={`+${absImp.toFixed(2)} → L+`} />
        {maxSup > minSup ? (
          <Legend title="Rule support" colors={ORANGES}
            left={minSup.toFixed(2)} right={maxSup.toFixed(2)} />
        ) : (
          <Legend title="Rule support" colors={ORANGES}
            left="" mid={minSup.toFixed(2)} right="" />
        )}
      </Group>

      {/* Tooltip */}
      {tip && (
        <div
          style={{
            position: "absolute",
            left: tip.x + 12,
            top: tip.y + 12,
            transform: flip ? "translateX(calc(-100% - 24px))" : undefined,
            pointerEvents: "none",
            zIndex: 5,
            maxWidth: 380,
            background: dark ? "#25262b" : "#ffffff",
            border: `1px solid ${dark ? "#373a40" : "#dee2e6"}`,
            borderRadius: 8,
            padding: "8px 12px",
            boxShadow: "0 4px 16px rgba(0,0,0,.12)",
            fontFamily: FONT,
            fontSize: 12,
            color: text,
          }}
        >
          <div style={{ fontWeight: 600 }}>{tip.title}</div>
          {tip.desc && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: muted, margin: "4px 0" }}>
              {tip.desc}
            </div>
          )}
          {tip.value && <div>{tip.value}</div>}
        </div>
      )}
    </div>
  );
}

function Legend({ title, colors, left, mid, right }: {
  title: string;
  colors: string[];
  left: string;
  mid?: string;
  right: string;
}) {
  return (
    <div style={{ minWidth: 170 }}>
      <Text size="xs" c="dimmed" mb={2}>{title}</Text>
      <div
        style={{
          height: 10,
          borderRadius: 5,
          background: `linear-gradient(to right, ${colors.join(",")})`,
        }}
      />
      <Group justify="space-between" gap={4}>
        <Text size="xs" c="dimmed">{left}</Text>
        {mid && <Text size="xs" c="dimmed">{mid}</Text>}
        <Text size="xs" c="dimmed">{right}</Text>
      </Group>
    </div>
  );
}
