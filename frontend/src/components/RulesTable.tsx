import { ActionIcon, Checkbox, ScrollArea, Table, Text, Tooltip } from "@mantine/core";
import { ruleLabel, type DeclareRule } from "../lib/artifacts";

function Th({ label, hint, w }: { label: string; hint: string; w?: number }) {
  return (
    <Table.Th w={w}>
      <Tooltip label={hint} multiline maw={280} withArrow>
        <span style={{ cursor: "help", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
          {label}
        </span>
      </Tooltip>
    </Table.Th>
  );
}

/** Share of traces satisfying the rule, colored by how strongly the log obeys it. */
function SatCell({ v }: { v: number | null | undefined }) {
  if (v == null) return <Table.Td>—</Table.Td>;
  const color = v >= 0.8 ? "teal" : v >= 0.5 ? "orange" : "red";
  return (
    <Table.Td>
      <Text size="sm" c={color} fw={600}>
        {(v * 100).toFixed(1)}%
      </Text>
    </Table.Td>
  );
}

/** Declare rules with optional per-rule selection (thesis §8.3: the analyst reviews
 *  support/confidence and selects the rules that match their domain knowledge) and
 *  optional removal (the manual rule editor). */
export function RulesTable({
  rules,
  selected,
  onToggle,
  onRemove,
  maxHeight = 360,
}: {
  rules: DeclareRule[];
  selected?: Set<number>;
  onToggle?: (index: number) => void;
  onRemove?: (index: number) => void;
  maxHeight?: number;
}) {
  if (!rules.length)
    return (
      <Text size="sm" c="dimmed">
        No rules.
      </Text>
    );
  const selectable = !!onToggle;
  const hasSupport = rules.some((r) => r.support != null);
  const hasSat = rules.some((r) => r.sat_traces != null);
  return (
    <ScrollArea.Autosize mah={maxHeight}>
      <Table withTableBorder striped stickyHeader>
        <Table.Thead>
          <Table.Tr>
            {selectable && <Table.Th w={36} />}
            <Table.Th>Declare rule</Table.Th>
            {hasSupport && (
              <Th w={90} label="support"
                hint="MINERful support: the rule's fulfilled activations over all events of the log — small by construction unless the involved activities are frequent." />
            )}
            {hasSupport && (
              <Th w={90} label="confidence"
                hint="Share of the rule's activations that are fulfilled — how reliably the rule holds whenever it applies." />
            )}
            {hasSat && (
              <Th w={110} label="satisfied traces"
                hint="Share of traces in which the rule holds (traces that never activate the rule satisfy it vacuously). Low values mean the rule contradicts the recorded behaviour." />
            )}
            {onRemove && <Table.Th w={40} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rules.map((r, i) => (
            <Table.Tr key={i}>
              {selectable && (
                <Table.Td>
                  <Checkbox
                    checked={selected?.has(i) ?? false}
                    onChange={() => onToggle?.(i)}
                    aria-label={`select rule ${i + 1}`}
                  />
                </Table.Td>
              )}
              <Table.Td style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
                {ruleLabel(r)}
              </Table.Td>
              {hasSupport && (
                <Table.Td>{r.support != null ? Number(r.support).toFixed(3) : "—"}</Table.Td>
              )}
              {hasSupport && (
                <Table.Td>
                  {r.confidence != null ? Number(r.confidence).toFixed(3) : "—"}
                </Table.Td>
              )}
              {hasSat && <SatCell v={r.sat_traces} />}
              {onRemove && (
                <Table.Td>
                  <ActionIcon variant="subtle" color="red" size="sm"
                    aria-label={`remove rule ${i + 1}`} onClick={() => onRemove(i)}>
                    ✕
                  </ActionIcon>
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}
