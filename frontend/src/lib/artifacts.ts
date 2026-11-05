import { gql } from "@apollo/client";

export const KIND_LABELS: Record<string, string> = {
  event_log: "Event log (L)",
  desirable_log: "Desirable log (L+)",
  undesirable_log: "Undesirable log (L−)",
  rule_set: "Rule set (R)",
  model: "Model",
};

export const KIND_COLORS: Record<string, string> = {
  event_log: "blue",
  desirable_log: "teal",
  undesirable_log: "red",
  rule_set: "violet",
  model: "orange",
};

export interface Artifact {
  id: string;
  kind: string;
  name: string;
  source: string;
  metaJson: string;
  createdAt: string;
}

export const ARTIFACTS = gql`
  query Artifacts($sessionId: String!, $kind: String) {
    artifacts(sessionId: $sessionId, kind: $kind) {
      id
      kind
      name
      source
      metaJson
      createdAt
    }
  }
`;

export interface DeclareRule {
  template: string;
  parameters: string[][];
  support?: number | null;
  confidence?: number | null;
  /** Share of traces satisfying the rule (vacuous satisfaction included). */
  sat_traces?: number | null;
  [dim: string]: unknown;
}

/** "Response(a, b)" — the Declare notation used across the thesis. */
export function ruleLabel(r: DeclareRule): string {
  const params = r.parameters.map((p) => p[0]).join(", ");
  return `${r.template}(${params})`;
}
