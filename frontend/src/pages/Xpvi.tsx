import { roundNumbers } from "../lib/figure";
import { gql, useMutation } from "@apollo/client";
import {
  Badge,
  Button,
  Card,
  Group,
  List,
  NumberInput,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import { JobStatus } from "../components/JobStatus";
import { Chart } from "../components/Chart";
import { ArtifactSelect } from "../components/ArtifactSelect";
import { Step, type StepStatus } from "../components/Step";
import { sessionId } from "../lib/session";
import { useJob, type Job } from "../lib/useJob";

const INSPECT = gql`
  mutation XpviInspect($sessionId: String!, $logArtifact: String!) {
    xpviInspect(sessionId: $sessionId, logArtifact: $logArtifact)
  }
`;
const START_EMD = gql`
  mutation StartXpviEmd($sessionId: String!, $logArtifact: String!, $nBin: Int!, $w: Int!, $kpi: String!) {
    startXpviEmd(sessionId: $sessionId, logArtifact: $logArtifact, nBin: $nBin, w: $w, kpi: $kpi)
  }
`;
const START_SEG = gql`
  mutation StartXpviSegment($sessionId: String!, $nBin: Int!, $w: Int!, $kpi: String!, $signalThreshold: Float!, $logArtifact: String) {
    startXpviSegment(sessionId: $sessionId, nBin: $nBin, w: $w, kpi: $kpi, signalThreshold: $signalThreshold, logArtifact: $logArtifact)
  }
`;
const START_EXPORT = gql`
  mutation StartXpviExport($sessionId: String!) {
    startXpviExport(sessionId: $sessionId)
  }
`;
const START_EXPLAIN = gql`
  mutation StartXpviExplain($sessionId: String!, $nBin: Int!, $w: Int!, $kpi: String!, $thetaCvg: Float!, $nClusters: Int!, $signalThreshold: Float!, $logArtifact: String) {
    startXpviExplain(sessionId: $sessionId, nBin: $nBin, w: $w, kpi: $kpi, thetaCvg: $thetaCvg, nClusters: $nClusters, signalThreshold: $signalThreshold, logArtifact: $logArtifact)
  }
`;
const EXPLAIN_NL = gql`
  mutation XpviExplainNl($sessionId: String!, $cluster: Int!, $segment: Int!) {
    xpviExplainNl(sessionId: $sessionId, cluster: $cluster, segment: $segment)
  }
`;
const SET_KIND = gql`
  mutation MarkSegment($id: String!, $kind: String!) {
    setArtifactKind(id: $id, kind: $kind)
  }
`;

interface EmdResult { figure: unknown; max_dist: number; n_cases: number }
interface SegResult {
  figure: unknown;
  peaks: string[];
  n_segments: number;
}
interface ExportResult {
  segments: { artifact_id: string; name: string; num_traces: number }[];
}
interface ExplainResult {
  signals_figure: unknown;
  correlation_figure: unknown;
  n_segments: number;
  n_clusters: number;
}
interface NlResult { highest: string[]; lowest: string[] }

function jobStatus(job: Job | null, ready: boolean): StepStatus {
  if (job?.status === "succeeded") return "done";
  if (job?.status === "failed") return "failed";
  if (job && (job.status === "running" || job.status === "queued")) return "running";
  return ready ? "ready" : "locked";
}

export function XpviPage() {
  const sid = sessionId();

  // Step 1 — data
  const [log, setLog] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [nCases, setNCases] = useState<number | null>(null);
  // Step 2 — indicator + EMD
  const [kpi, setKpi] = useState<string | null>(null);
  const [nBin, setNBin] = useState(100);
  const [w, setW] = useState(10);
  // Step 3 — segmentation
  const [threshold, setThreshold] = useState(0.05);
  // Step 4 — explainability
  const [thetaCvg, setThetaCvg] = useState(0.3);
  const [nClusters, setNClusters] = useState(6);
  // Step 5 — natural language
  const [nlCluster, setNlCluster] = useState(1);
  const [nlSegment, setNlSegment] = useState(1);
  const [nl, setNl] = useState<NlResult | null>(null);

  const [inspect, { loading: inspecting }] = useMutation<{ xpviInspect: string }>(INSPECT, {
    onCompleted: (d) => {
      const out = JSON.parse(d.xpviInspect) as { n_cases: number; columns: string[] };
      setColumns(out.columns);
      setNCases(out.n_cases);
      if (out.columns.length && !kpi) setKpi(out.columns[0]);
    },
    onError: (e) => notifications.show({ title: "Inspect failed", message: e.message, color: "red" }),
  });

  const [emdJobId, setEmdJobId] = useState<string | null>(null);
  const [startEmd, { loading: sEmd }] = useMutation<{ startXpviEmd: string }>(START_EMD, {
    onCompleted: (d) => setEmdJobId(d.startXpviEmd),
    onError: (e) => notifications.show({ title: "Could not start EMD analysis", message: e.message, color: "red" }),
  });
  const emd = useJob(emdJobId);
  const emdRes = emd.result as EmdResult | null;

  const [segJobId, setSegJobId] = useState<string | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [startSeg, { loading: sSeg }] = useMutation<{ startXpviSegment: string }>(START_SEG, {
    onCompleted: (d) => {
      setSegJobId(d.startXpviSegment);
      setExportJobId(null); // a new segmentation invalidates a previous export
    },
    onError: (e) => notifications.show({ title: "Could not start segmentation", message: e.message, color: "red" }),
  });
  const seg = useJob(segJobId);
  const segRes = seg.result as SegResult | null;

  const [startExport, { loading: sExp }] = useMutation<{ startXpviExport: string }>(START_EXPORT, {
    onCompleted: (d) => setExportJobId(d.startXpviExport),
    onError: (e) => notifications.show({ title: "Could not start export", message: e.message, color: "red" }),
  });
  const exp = useJob(exportJobId);
  const expRes = exp.result as ExportResult | null;

  const [exJobId, setExJobId] = useState<string | null>(null);
  const [startExplain, { loading: sEx }] = useMutation<{ startXpviExplain: string }>(START_EXPLAIN, {
    onCompleted: (d) => setExJobId(d.startXpviExplain),
    onError: (e) => notifications.show({ title: "Could not start explainability", message: e.message, color: "red" }),
  });
  const ex = useJob(exJobId);
  const exRes = ex.result as ExplainResult | null;

  const [explainNl, { loading: nlLoading }] = useMutation<{ xpviExplainNl: string }>(EXPLAIN_NL, {
    onCompleted: (d) => setNl(JSON.parse(d.xpviExplainNl) as NlResult),
    onError: (e) => notifications.show({ title: "Explanation failed", message: e.message, color: "red" }),
  });

  const [mark] = useMutation(SET_KIND, {
    onCompleted: () =>
      notifications.show({ title: "Segment re-labelled", message: "Find it in the workspace.", color: "teal" }),
  });

  return (
    <Stack maw={1240}>
      <div>
        <Title order={2}>X-PVI — explainable process variant identification</Title>
        <Text c="dimmed" size="sm" maw={900}>
          The §5.1 pipeline, step by step: order the cases along a performance indicator,
          detect control-flow change points (EMD), extract and cluster declarative
          behavioural signals, correlate them with the segments — then read the explanation
          in plain language and export segments as L+/L−.
        </Text>
      </div>

      {/* ---------------------------------------------------------------- step 1 */}
      <Step
        n={1}
        title="Choose the event log"
        description="Cases must carry the performance indicator of interest (e.g. duration, a risk score)."
        status={columns.length ? "done" : log ? "ready" : "ready"}
        controls={
          <Stack gap="sm">
            <ArtifactSelect kind="event_log" label="Event log (L)" value={log}
              onChange={(v) => { setLog(v); setColumns([]); setNCases(null); }} />
            <Button variant="light" disabled={!log} loading={inspecting}
              onClick={() => void inspect({ variables: { sessionId: sid, logArtifact: log } })}>
              Inspect log
            </Button>
          </Stack>
        }
        resultHint="The case count and the numeric indicators found in the log appear here."
      >
        {columns.length > 0 && (
          <Group gap="xs">
            <Badge variant="light">{nCases} cases</Badge>
            {columns.map((c) => (
              <Badge key={c} variant="outline" color={c === kpi ? "indigo" : "gray"}>
                {c}
              </Badge>
            ))}
          </Group>
        )}
      </Step>

      {/* ---------------------------------------------------------------- step 2 */}
      <Step
        n={2}
        title="Compute the change signal (EMD)"
        description="Cases are binned along the indicator; a sliding window measures how much the control flow changes between neighbouring regions."
        status={jobStatus(emd.job, columns.length > 0)}
        controls={
          <Stack gap="sm">
            <Select label="Performance indicator" data={columns} value={kpi} onChange={setKpi} searchable
              disabled={!columns.length} />
            <Group grow>
              <NumberInput label="Bins" value={nBin} onChange={(v) => setNBin(Number(v) || 2)} min={2} />
              <NumberInput label="Window" value={w} onChange={(v) => setW(Number(v) || 2)} min={2} />
            </Group>
            <Button disabled={!kpi} loading={sEmd || emd.running}
              onClick={() => void startEmd({ variables: { sessionId: sid, logArtifact: log, nBin, w, kpi } })}>
              Run EMD analysis
            </Button>
            <JobStatus job={emd.job} />
          </Stack>
        }
        resultHint="The EMD change signal along the indicator range appears here — its peaks are candidate segment boundaries."
        resultHeight={430}
      >
        {emdRes && (
          <div>
            <Text size="sm" fw={600} mb={2}>
              EMD signal along {kpi}
            </Text>
            <Chart fig={emdRes.figure} height={360} />
          </div>
        )}
      </Step>

      {/* ---------------------------------------------------------------- step 3 */}
      <Step
        n={3}
        title="Segment and export"
        description="Signal peaks above the threshold become segment boundaries. Segmenting shows the result first; exporting then publishes each segment as an event log you can re-label as L+ or L−."
        status={jobStatus(seg.job, !!emdRes)}
        controls={
          <Stack gap="sm">
            <div>
              <Group justify="space-between">
                <Text size="sm" fw={500}>Signal threshold</Text>
                <Text size="sm" c="dimmed">{threshold.toFixed(3)}</Text>
              </Group>
              <Slider value={threshold} onChange={setThreshold} min={0}
                max={Math.max(emdRes?.max_dist ?? 1, 0.001)}
                step={Math.max((emdRes?.max_dist ?? 1) / 100, 0.001)} label={null}
                disabled={!emdRes} />
            </div>
            <Button disabled={!emdRes} loading={sSeg || seg.running}
              onClick={() => void startSeg({ variables: { sessionId: sid, nBin, w, kpi, signalThreshold: threshold, logArtifact: log } })}>
              Segment
            </Button>
            <JobStatus job={seg.job} />
            <Button variant="light" disabled={!segRes} loading={sExp || exp.running}
              onClick={() => void startExport({ variables: { sessionId: sid } })}>
              Export segments to workspace
            </Button>
            <JobStatus job={exp.job} />
          </Stack>
        }
        resultHint="The detected segmentation, the segment ranges, and the exported segment logs appear here."
        resultHeight={640}
      >
        {segRes && (
          <Stack gap="sm">
            <Group gap="xs">
              <Badge variant="light">{segRes.n_segments} segments detected</Badge>
            </Group>
            <Chart fig={segRes.figure} height={320} />
            <List size="sm">
              {segRes.peaks.map((p, i) => (
                <List.Item key={i}>{roundNumbers(p)}</List.Item>
              ))}
            </List>
            {!expRes && (
              <Text size="sm" c="dimmed">
                Happy with the segmentation? Adjust the threshold and segment again, or press
                “Export segments to workspace” — the exported segments then appear right here
                with buttons to label each one as desirable (L+) or undesirable (L−).
              </Text>
            )}
            {expRes && (
            <>
            <Text size="sm" fw={600}>
              Exported segments — label each as desirable (L+) or undesirable (L−):
            </Text>
            <Table withTableBorder>
              <Table.Tbody>
                {expRes.segments.map((s) => (
                  <Table.Tr key={s.artifact_id}>
                    <Table.Td><Badge variant="light">{s.name}</Badge></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{s.num_traces} traces</Text></Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end">
                        <Button size="compact-xs" color="teal" variant="light"
                          onClick={() => void mark({ variables: { id: s.artifact_id, kind: "desirable_log" } })}>
                          mark as L+
                        </Button>
                        <Button size="compact-xs" color="red" variant="light"
                          onClick={() => void mark({ variables: { id: s.artifact_id, kind: "undesirable_log" } })}>
                          mark as L−
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            </>
            )}
          </Stack>
        )}
      </Step>

      {/* ---------------------------------------------------------------- step 4 */}
      <Step
        n={4}
        title="Explain the segments — behavioural signal clusters"
        description="Declarative behavioural signals are extracted along the indicator, pruned by coverage, clustered, and correlated with the segments (the explainability layer of §5.1)."
        status={jobStatus(ex.job, !!segRes)}
        controls={
          <Stack gap="sm">
            <div>
              <Group justify="space-between">
                <Text size="sm" fw={500}>Coverage threshold θ</Text>
                <Text size="sm" c="dimmed">{thetaCvg.toFixed(2)}</Text>
              </Group>
              <Slider value={thetaCvg} onChange={setThetaCvg} min={0} max={1} step={0.05} label={null} />
              <Text size="xs" c="dimmed">Signals covering fewer cases are pruned.</Text>
            </div>
            <NumberInput label="Signal clusters" value={nClusters}
              onChange={(v) => setNClusters(Number(v) || 1)} min={1} max={40} />
            <Button disabled={!segRes} loading={sEx || ex.running}
              onClick={() => void startExplain({
                variables: { sessionId: sid, nBin, w, kpi, thetaCvg, nClusters, signalThreshold: threshold, logArtifact: log },
              })}>
              Extract &amp; cluster signals
            </Button>
            <JobStatus job={ex.job} />
          </Stack>
        }
        resultHint="Two figures appear here: the clustered behavioural signals across the indicator range, and the segment × cluster correlation heatmap."
        resultHeight={1000}
      >
        {exRes && (
          <Stack gap="sm">
            <div>
              <Text size="sm" fw={600} mb={2}>Clustered behavioural signals</Text>
              <Chart fig={exRes.signals_figure} height={430} />
            </div>
            <div>
              <Text size="sm" fw={600} mb={2}>
                Segment × cluster correlation ({exRes.n_segments} segments, {exRes.n_clusters} clusters)
              </Text>
              <Chart fig={exRes.correlation_figure} height={430} />
            </div>
          </Stack>
        )}
      </Step>

      {/* ---------------------------------------------------------------- step 5 */}
      <Step
        n={5}
        title="Read it in plain language"
        description="For a chosen signal cluster and segment: which behavioural constraints hold more — and which less — inside the segment than elsewhere."
        status={nl ? "done" : exRes ? "ready" : "locked"}
        controls={
          <Stack gap="sm">
            <Group grow>
              <NumberInput label="Cluster" value={nlCluster}
                onChange={(v) => setNlCluster(Number(v) || 1)} min={1} max={exRes?.n_clusters ?? 40} />
              <NumberInput label="Segment" value={nlSegment}
                onChange={(v) => setNlSegment(Number(v) || 1)} min={1} max={exRes?.n_segments ?? 40} />
            </Group>
            <Button disabled={!exRes} loading={nlLoading}
              onClick={() => void explainNl({
                variables: { sessionId: sid, cluster: nlCluster, segment: nlSegment },
              })}>
              Explain segment
            </Button>
          </Stack>
        }
        resultHint="A ranked, human-readable comparison of the segment against the rest of the log appears here."
        resultHeight={400}
      >
        {nl && (
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <Card withBorder padding="sm">
              <Text fw={600} size="sm" c="teal" mb={4}>
                Highest scores — behaviour most characteristic of segment {nlSegment}
              </Text>
              <List size="sm" spacing={4}>
                {nl.highest.length === 0 && <Text size="sm" c="dimmed">Nothing stands out.</Text>}
                {nl.highest.map((s, i) => (
                  <List.Item key={i}>{s}</List.Item>
                ))}
              </List>
            </Card>
            <Card withBorder padding="sm">
              <Text fw={600} size="sm" c="red" mb={4}>
                Lowest scores — behaviour least characteristic of segment {nlSegment}
              </Text>
              <List size="sm" spacing={4}>
                {nl.lowest.length === 0 && <Text size="sm" c="dimmed">Nothing stands out.</Text>}
                {nl.lowest.map((s, i) => (
                  <List.Item key={i}>{s}</List.Item>
                ))}
              </List>
            </Card>
          </SimpleGrid>
        )}
      </Step>
    </Stack>
  );
}
