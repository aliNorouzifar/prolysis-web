import { Text } from "@mantine/core";
import dagre from "dagre";
import { useMemo } from "react";
import { type ActivityStyle } from "../lib/activityColors";
import { buildDfg, type Variant } from "../lib/dfg";

const FONT =
  "'Inter Variable', Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

const START = "\u0000start";
const END = "\u0000end";

interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  count?: number;
}

interface LaidOutEdge {
  from: string;
  to: string;
  count: number;
  points: { x: number; y: number }[];
}

function nodeSize(label: string): { width: number; height: number } {
  return { width: Math.min(178, 26 + label.length * 7.2), height: 40 };
}

/** Smooth an edge polyline into a bezier path. */
function edgePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * Directly-follows graph of the SELECTED variants, laid out top-to-bottom with dagre
 * and rendered as SVG. Nodes reuse the activity colors of the variant explorer;
 * edge thickness and labels carry the directly-follows frequencies.
 */
export type DfgMetric = "freq" | "mean" | "median";

export interface EdgeTime {
  from: string;
  to: string;
  mean: number;
  median: number;
}

function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 90) return `${seconds.toFixed(0)}s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(0)}m`;
  if (seconds < 129600) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

export function DfgView({
  variants,
  selected,
  colors,
  metric = "freq",
  times,
  height = 480,
}: {
  variants: Variant[];
  selected: Set<number>;
  colors: Map<string, ActivityStyle>;
  /** Edge annotation/width: directly-follows frequency, or mean/median transition time. */
  metric?: DfgMetric;
  /** Per-edge times (log-level statistics), keyed "from\u0000to". */
  times?: Map<string, EdgeTime>;
  height?: number;
}) {
  const layout = useMemo(() => {
    const dfg = buildDfg(variants, selected);
    if (dfg.nodes.size === 0) return null;

    const g = new dagre.graphlib.Graph({ multigraph: false });
    g.setGraph({ rankdir: "TB", nodesep: 26, ranksep: 42, marginx: 12, marginy: 12 });
    g.setDefaultEdgeLabel(() => ({}));

    g.setNode(START, { width: 26, height: 26 });
    g.setNode(END, { width: 26, height: 26 });
    for (const [act] of dfg.nodes) g.setNode(act, nodeSize(act));

    const allEdges: { from: string; to: string; count: number }[] = [
      ...[...dfg.starts.entries()].map(([a, c]) => ({ from: START, to: a, count: c })),
      ...dfg.edges,
      ...[...dfg.ends.entries()].map(([a, c]) => ({ from: a, to: END, count: c })),
    ];
    for (const e of allEdges) if (e.from !== e.to) g.setEdge(e.from, e.to);

    dagre.layout(g);

    const nodes: LaidOutNode[] = g.nodes().map((id) => {
      const n = g.node(id);
      return { id, x: n.x, y: n.y, width: n.width, height: n.height,
               count: dfg.nodes.get(id) };
    });
    const edges: LaidOutEdge[] = allEdges.map((e) => {
      // (points filled below)
      if (e.from === e.to) {
        // Self-loop: a small arc on the right side of the node.
        const n = g.node(e.from);
        const x = n.x + n.width / 2;
        return { ...e, points: [
          { x, y: n.y - 8 }, { x: x + 30, y: n.y - 12 },
          { x: x + 30, y: n.y + 12 }, { x, y: n.y + 8 }] };
      }
      const ge = g.edge(e.from, e.to);
      return { ...e, points: ge?.points ?? [] };
    });
    const gr = g.graph();
    return { nodes, edges, width: gr.width ?? 400, height: gr.height ?? 300,
             maxEdge: dfg.maxEdge };
  }, [variants, selected, colors]);

  if (!layout)
    return (
      <Text size="sm" c="dimmed" p="md">
        No variants selected — tick variants above to project their directly-follows graph.
      </Text>
    );

  const ink = "var(--mantine-color-dimmed)";
  const edgeColor = "var(--mantine-color-gray-6)";

  return (
    <div style={{ overflow: "auto", height, borderRadius: 8 }}>
      <svg
        width={Math.max(layout.width, 200)}
        height={layout.height}
        style={{ display: "block", margin: "0 auto", fontFamily: FONT }}
      >
        <defs>
          <marker id="dfg-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={edgeColor} />
          </marker>
        </defs>

        {(() => {
          // Scale widths by the ACTIVE metric so thickness always mirrors the labels.
          const timeOf = (e: LaidOutEdge): number | null => {
            const t = times?.get(`${e.from}\u0000${e.to}`);
            if (!t) return null;
            return metric === "mean" ? t.mean : t.median;
          };
          const maxTime = Math.max(
            1e-9,
            ...layout.edges.map((e) => (metric === "freq" ? 0 : timeOf(e) ?? 0)),
          );
          return layout.edges.map((e, i) => {
            const artificial = e.from === START || e.to === END;
            const value = metric === "freq" ? e.count : timeOf(e);
            const norm = metric === "freq" ? e.count / layout.maxEdge
              : value != null ? value / maxTime : 0;
            const w = 1 + 3 * norm;
            const mid = e.points[Math.floor(e.points.length / 2)] ?? e.points[0];
            const label = metric === "freq"
              ? String(e.count)
              : artificial || value == null ? "" : fmtDuration(value);
            return (
              <g key={i}>
                <path d={edgePath(e.points)} fill="none" stroke={edgeColor}
                  strokeWidth={artificial ? 1.5 : w} strokeLinejoin="round" opacity={0.75}
                  strokeDasharray={artificial ? "6 4" : undefined}
                  markerEnd="url(#dfg-arrow)" />
                {mid && label && (
                  <text x={mid.x + 5} y={mid.y - 3} fontSize={10} fill={ink}
                    style={{ fontVariantNumeric: "tabular-nums" }}>
                    {label}
                  </text>
                )}
              </g>
            );
          });
        })()}

        {layout.nodes.map((n) => {
          if (n.id === START || n.id === END) {
            const end = n.id === END;
            return (
              <g key={n.id}>
                <circle cx={n.x} cy={n.y} r={12}
                  fill={end ? "var(--mantine-color-red-1)" : "var(--mantine-color-teal-1)"}
                  stroke={end ? "var(--mantine-color-red-6)" : "var(--mantine-color-teal-6)"}
                  strokeWidth={2} />
                <text x={n.x} y={n.y + 3.5} textAnchor="middle" fontSize={9} fontWeight={700}
                  fill={end ? "var(--mantine-color-red-8)" : "var(--mantine-color-teal-8)"}>
                  {end ? "■" : "▶"}
                </text>
              </g>
            );
          }
          const st = colors.get(n.id) ?? { bg: "#adb5bd", ink: "#212529" };
          const label = n.id.length > 22 ? n.id.slice(0, 21) + "…" : n.id;
          return (
            <g key={n.id}>
              <title>{n.id}</title>
              <rect x={n.x - n.width / 2} y={n.y - n.height / 2}
                width={n.width} height={n.height} rx={9}
                fill={st.bg} />
              <text x={n.x} y={n.y - 1} textAnchor="middle" fontSize={11.5}
                fontWeight={650} fill={st.ink}>
                {label}
              </text>
              <text x={n.x} y={n.y + 12} textAnchor="middle" fontSize={9.5}
                fill={st.ink} opacity={0.85}
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {n.count}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
