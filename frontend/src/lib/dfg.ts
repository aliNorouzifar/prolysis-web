// Client-side directly-follows graph, computed from the (selected) trace variants.
// The DFG is a projection of exactly the variants the analyst has ticked, so the
// graph and the variant explorer always tell the same story.

export interface Variant {
  trace: string[];
  count: number;
}

export interface DfgEdge {
  from: string;
  to: string;
  count: number;
}

export interface DfgData {
  /** activity -> total occurrences (weighted by variant counts) */
  nodes: Map<string, number>;
  edges: DfgEdge[];
  /** activity -> number of traces starting/ending with it */
  starts: Map<string, number>;
  ends: Map<string, number>;
  maxEdge: number;
}

// Separator for edge keys — activity names may contain any printable character.
const SEP = "\u0000";

export function buildDfg(variants: Variant[], selected: Set<number>): DfgData {
  const nodes = new Map<string, number>();
  const edgeMap = new Map<string, number>();
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();

  variants.forEach((v, i) => {
    if (!selected.has(i) || v.trace.length === 0) return;
    const n = v.count;
    starts.set(v.trace[0], (starts.get(v.trace[0]) ?? 0) + n);
    ends.set(v.trace[v.trace.length - 1], (ends.get(v.trace[v.trace.length - 1]) ?? 0) + n);
    for (let j = 0; j < v.trace.length; j++) {
      const a = v.trace[j];
      nodes.set(a, (nodes.get(a) ?? 0) + n);
      if (j + 1 < v.trace.length) {
        edgeMap.set(`${a}${SEP}${v.trace[j + 1]}`,
          (edgeMap.get(`${a}${SEP}${v.trace[j + 1]}`) ?? 0) + n);
      }
    }
  });

  const edges: DfgEdge[] = [...edgeMap.entries()].map(([key, count]) => {
    const [from, to] = key.split(SEP);
    return { from, to, count };
  });
  const maxEdge = edges.reduce((m, e) => Math.max(m, e.count), 1);
  return { nodes, edges, starts, ends, maxEdge };
}
