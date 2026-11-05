import { Table, Text, Tooltip } from "@mantine/core";

// Thesis Ch. 4 metric labels (Tables 4.1/4.2) + IMr conformance metrics.
const LABELS: Record<string, { label: string; hint: string }> = {
  a_fit_lp: { label: "a-fit L+", hint: "Alignment-based fitness w.r.t. the desirable log" },
  a_fit_lm: { label: "a-fit L−", hint: "Alignment-based fitness w.r.t. the undesirable log" },
  a_acc: { label: "a-acc", hint: "Alignment-based accuracy (Ch. 4)" },
  a_f1: { label: "a-F1", hint: "Alignment-based F1 score (Ch. 4)" },
  t_acc: { label: "t-acc", hint: "Trace-based accuracy (Ch. 4)" },
  t_f1: { label: "t-F1", hint: "Trace-based F1 score (Ch. 4)" },
  fitness: { label: "fitness", hint: "Alignment-based fitness w.r.t. the event log" },
  precision: { label: "precision", hint: "Escaping-edges precision" },
};

export function MetricsTable({ metrics }: { metrics: Record<string, number | null> }) {
  const entries = Object.entries(metrics).filter(([, v]) => v != null);
  if (!entries.length)
    return (
      <Text size="sm" c="dimmed">
        No metrics reported.
      </Text>
    );
  return (
    <Table withTableBorder striped>
      <Table.Thead>
        <Table.Tr>
          {entries.map(([k]) => (
            <Table.Th key={k} style={{ textAlign: "center" }}>
              <Tooltip label={LABELS[k]?.hint ?? k}>
                <span>{LABELS[k]?.label ?? k}</span>
              </Tooltip>
            </Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        <Table.Tr>
          {entries.map(([k, v]) => (
            <Table.Td key={k} style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
              {typeof v === "number" ? v.toFixed(3) : String(v)}
            </Table.Td>
          ))}
        </Table.Tr>
      </Table.Tbody>
    </Table>
  );
}
