import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useMemo, useState } from "react";
import { ArtifactSelect } from "../components/ArtifactSelect";
import { DfgView, type DfgMetric, type EdgeTime } from "../components/DfgView";
import { activityColors, type ActivityStyle } from "../lib/activityColors";
import { type Variant } from "../lib/dfg";
import { sessionId } from "../lib/session";

const LOG_KINDS = ["event_log", "desirable_log", "undesirable_log"];

const LOG_DETAILS = gql`
  query CompareLogDetails($id: String!) {
    artifact(id: $id) {
      id
      name
      kind
      eventLog {
        numTraces
        numEvents
        numVariants
        activities
        variantsJson
      }
    }
  }
`;

const EDGE_TIMES = gql`
  mutation EdgeTimes($artifactId: String!) {
    edgeTimes(artifactId: $artifactId)
  }
`;

interface LogInfo {
  name: string;
  kind: string;
  numTraces: number;
  numEvents: number;
  numVariants: number;
  activities: string[];
  variants: Variant[];
}

function useLogInfo(id: string | null): LogInfo | null {
  const { data } = useQuery(LOG_DETAILS, { variables: { id: id ?? "" }, skip: !id });
  return useMemo(() => {
    const a = data?.artifact;
    if (!a?.eventLog) return null;
    return {
      name: a.name,
      kind: a.kind,
      numTraces: a.eventLog.numTraces ?? 0,
      numEvents: a.eventLog.numEvents ?? 0,
      numVariants: a.eventLog.numVariants ?? 0,
      activities: a.eventLog.activities ?? [],
      variants: (JSON.parse(a.eventLog.variantsJson || "[]") as Variant[]) ?? [],
    };
  }, [data]);
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <Card withBorder padding="xs" radius="md">
      <Text size="xl" fw={700} style={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Card>
  );
}

/** One activity as a chevron segment (labels always shown — identity is never color-alone). */
function Chevron({ label, style, first }: { label: string; style: ActivityStyle; first: boolean }) {
  return (
    <Tooltip label={label} openDelay={300}>
      <div
        style={{
          background: style.bg,
          color: style.ink,
          padding: "4px 14px 4px 18px",
          marginLeft: first ? 0 : -8,
          clipPath: first
            ? "polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%)"
            : "polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)",
          fontSize: 11.5,
          fontWeight: 600,
          whiteSpace: "nowrap",
          maxWidth: 170,
          overflow: "hidden",
          textOverflow: "ellipsis",
          flexShrink: 0,
        }}
      >
        {label}
      </div>
    </Tooltip>
  );
}

function VariantExplorer({
  info,
  colors,
  selected,
  onToggle,
}: {
  info: LogInfo;
  colors: Map<string, ActivityStyle>;
  selected: Set<number>;
  onToggle: (i: number) => void;
}) {
  const shown = info.variants.slice(0, 50);
  return (
    <Stack gap={6}>
      {shown.map((v, i) => {
        const share = info.numTraces ? (v.count / info.numTraces) * 100 : 0;
        return (
          <Group key={i} gap="xs" wrap="nowrap">
            <Checkbox
              size="xs"
              checked={selected.has(i)}
              onChange={() => onToggle(i)}
              aria-label={`include variant ${i + 1} in the DFG`}
            />
            <Box w={92} style={{ flexShrink: 0 }}>
              <Text size="xs" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
                {v.count} · {share.toFixed(1)}%
              </Text>
              <Box h={4} bg="var(--mantine-color-default-hover)" style={{ borderRadius: 2 }}>
                <Box h={4} w={`${Math.max(share, 2)}%`} bg="var(--mantine-color-indigo-5)" style={{ borderRadius: 2 }} />
              </Box>
            </Box>
            <ScrollArea type="hover" scrollbarSize={6} style={{ flex: 1 }}>
              <Group gap={0} wrap="nowrap" py={2}>
                {v.trace.map((act, j) => (
                  <Chevron
                    key={j}
                    label={act}
                    first={j === 0}
                    style={colors.get(act) ?? { bg: "#adb5bd", ink: "#212529" }}
                  />
                ))}
              </Group>
            </ScrollArea>
          </Group>
        );
      })}
      {info.numVariants > shown.length && (
        <Text size="xs" c="dimmed">
          Showing the {shown.length} most frequent of {info.numVariants} variants.
        </Text>
      )}
    </Stack>
  );
}

function LogSide({
  label,
  color,
  value,
  onChange,
  info,
  colors,
}: {
  label: string;
  color: string;
  value: string | null;
  onChange: (v: string | null) => void;
  info: LogInfo | null;
  colors: Map<string, ActivityStyle>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [metric, setMetric] = useState<DfgMetric>("freq");
  const [times, setTimes] = useState<Map<string, EdgeTime> | undefined>(undefined);

  const [fetchTimes] = useMutation<{ edgeTimes: string }>(EDGE_TIMES, {
    onCompleted: (d) => {
      const entries = JSON.parse(d.edgeTimes) as EdgeTime[];
      setTimes(new Map(entries.map((e) => [`${e.from}\u0000${e.to}`, e])));
    },
    onError: (e) =>
      notifications.show({ title: "Could not compute edge times", message: e.message, color: "red" }),
  });

  // A newly selected log starts with all (shown) variants in the DFG.
  useEffect(() => {
    setSelected(new Set((info?.variants ?? []).slice(0, 50).map((_, i) => i)));
    setMetric("freq");
    setTimes(undefined);
  }, [info]);

  const nShown = Math.min(info?.variants.length ?? 0, 50);

  return (
    <Stack gap="sm">
      <ArtifactSelect kinds={LOG_KINDS} label={label} value={value} onChange={onChange} />
      {info && (
        <>
          <Group gap="xs" justify="space-between">
            <Badge color={color} variant="light">
              {info.name}
            </Badge>
          </Group>
          <SimpleGrid cols={4} spacing="xs">
            <StatTile label="traces" value={info.numTraces} />
            <StatTile label="events" value={info.numEvents} />
            <StatTile label="variants" value={info.numVariants} />
            <StatTile label="activities" value={info.activities.length} />
          </SimpleGrid>

          <Card withBorder padding="sm">
            <Group justify="space-between" mb={6}>
              <Text size="sm" fw={600}>
                Trace variants ({selected.size} of {nShown} in the DFG)
              </Text>
              <Group gap="xs">
                <Button size="compact-xs" variant="subtle"
                  onClick={() => setSelected(new Set(Array.from({ length: nShown }, (_, i) => i)))}>
                  all
                </Button>
                <Button size="compact-xs" variant="subtle" onClick={() => setSelected(new Set())}>
                  none
                </Button>
              </Group>
            </Group>
            <ScrollArea.Autosize mah={340}>
              <VariantExplorer
                info={info}
                colors={colors}
                selected={selected}
                onToggle={(i) =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (n.has(i)) n.delete(i);
                    else n.add(i);
                    return n;
                  })
                }
              />
            </ScrollArea.Autosize>
          </Card>

          <Card withBorder padding="xs">
            <Group justify="space-between" px={6} pt={4} mb={2}>
              <Text size="sm" fw={600}>
                Directly-follows graph of the selected variants
              </Text>
              <SegmentedControl
                size="xs"
                value={metric}
                onChange={(m) => {
                  setMetric(m as DfgMetric);
                  if (m !== "freq" && !times && value) {
                    void fetchTimes({ variables: { artifactId: value } });
                  }
                }}
                data={[
                  { value: "freq", label: "Frequency" },
                  { value: "mean", label: "Mean time" },
                  { value: "median", label: "Median time" },
                ]}
              />
            </Group>
            {metric !== "freq" && (
              <Text size="xs" c="dimmed" px={6}>
                Transition times are statistics over all traces of the log.
              </Text>
            )}
            <DfgView variants={info.variants.slice(0, 50)} selected={selected} colors={colors}
              metric={metric} times={times} />
          </Card>
        </>
      )}
    </Stack>
  );
}

export function LogComparePage() {
  void sessionId();
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const leftInfo = useLogInfo(left);
  const rightInfo = useLogInfo(right);

  // One color assignment over the union — the same activity looks the same everywhere.
  const colors = useMemo(
    () => activityColors([...(leftInfo?.activities ?? []), ...(rightInfo?.activities ?? [])]),
    [leftInfo, rightInfo],
  );
  const legend = useMemo(() => [...colors.entries()], [colors]);

  return (
    <Stack maw={1500}>
      <div>
        <Title order={2}>Log comparison</Title>
        <Text c="dimmed" size="sm" maw={920}>
          Place two event logs side by side — typically the desirable log L+ and the
          undesirable log L−. Each side shows the log statistics, the trace variants, and
          the directly-follows graph of exactly the variants you tick; the same activity
          carries the same color everywhere.
        </Text>
      </div>

      {legend.length > 0 && (
        <Card withBorder padding="xs">
          <Group gap={6}>
            {legend.map(([act, st]) => (
              <Badge
                key={act}
                variant="filled"
                styles={{ root: { background: st.bg, color: st.ink, textTransform: "none" } }}
              >
                {act}
              </Badge>
            ))}
          </Group>
        </Card>
      )}

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Card withBorder>
            <LogSide label="Left log (e.g. L+)" color="teal" value={left} onChange={setLeft}
              info={leftInfo} colors={colors} />
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Card withBorder>
            <LogSide label="Right log (e.g. L−)" color="red" value={right} onChange={setRight}
              info={rightInfo} colors={colors} />
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
