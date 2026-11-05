import { gql, useMutation, useQuery } from "@apollo/client";
import { Badge, Button, Group, Slider, Stack, Text, Title } from "@mantine/core";
import { useState } from "react";
import { ArtifactSelect } from "../components/ArtifactSelect";
import { JobStatus } from "../components/JobStatus";
import { MetricsTable } from "../components/MetricsTable";
import { ModelViewer } from "../components/ModelViewer";
import { Step, type StepStatus } from "../components/Step";
import { sessionId } from "../lib/session";
import { useJob, type Job } from "../lib/useJob";

const START = gql`
  mutation StartImf($sessionId: String!, $logArtifact: String!, $noiseThreshold: Float!) {
    startImf(sessionId: $sessionId, logArtifact: $logArtifact, noiseThreshold: $noiseThreshold)
  }
`;

const MODEL = gql`
  query ImfModel($id: String!) {
    artifact(id: $id) {
      id
      name
      model { svg bpmnXml }
    }
  }
`;

interface ImfResult {
  artifact_id: string;
  metrics: Record<string, number>;
}

function jobStatus(job: Job | null, ready: boolean): StepStatus {
  if (job?.status === "succeeded") return "done";
  if (job?.status === "failed") return "failed";
  if (job && (job.status === "running" || job.status === "queued")) return "running";
  return ready ? "ready" : "locked";
}

export function ImfPage() {
  const sid = sessionId();
  const [log, setLog] = useState<string | null>(null);
  const [noise, setNoise] = useState(0.2);
  const [jobId, setJobId] = useState<string | null>(null);

  const [start, { loading: starting }] = useMutation<{ startImf: string }>(START, {
    onCompleted: (d) => setJobId(d.startImf),
  });
  const { job, result, running } = useJob(jobId);
  const res = result as ImfResult | null;

  const { data: modelData } = useQuery<{
    artifact: { name: string; model: { svg: string | null; bpmnXml: string | null } | null } | null;
  }>(MODEL, { variables: { id: res?.artifact_id ?? "" }, skip: !res?.artifact_id });
  const model = modelData?.artifact?.model ?? null;

  return (
    <Stack maw={1240}>
      <div>
        <Title order={2}>IMf — baseline discovery from a single log</Title>
        <Text c="dimmed" size="sm" maw={900}>
          The inductive miner infrequent discovers a model from one event log — e.g. only
          the desirable log L+ — filtering infrequent behaviour with the noise threshold.
          It is the natural baseline: discover from L+ alone here, then place the result
          next to an IMbi or IMr run in the comparison view to see what desirability
          awareness and rules add.
        </Text>
      </div>

      <Step
        n={1}
        title="Choose the event log"
        description="Any log from the workspace qualifies — typically the desirable log L+, so the baseline uses exactly the behaviour IMbi is asked to support."
        status={log ? "done" : "ready"}
        controls={
          <ArtifactSelect
            kinds={["event_log", "desirable_log", "undesirable_log"]}
            label="Event log"
            value={log}
            onChange={setLog}
          />
        }
        resultHint="Once a log is selected, this step is complete."
      >
        {log && (
          <Group gap="xs">
            <Badge color="indigo" variant="light">log selected</Badge>
            <Text size="sm" c="dimmed">Continue to step 2 to configure the discovery.</Text>
          </Group>
        )}
      </Step>

      <Step
        n={2}
        title="Configure and discover"
        description="The noise threshold f filters infrequent directly-follows relations before discovery; f = 0 keeps all behaviour."
        status={jobStatus(job, !!log)}
        resultHint="Fitness/precision and the discovered model appear here — comparable one-to-one with the IMr metrics."
        resultHeight={680}
        controls={
          <Stack gap="sm">
            <div>
              <Group justify="space-between">
                <Text size="sm" fw={500}>noise threshold f</Text>
                <Text size="sm" c="dimmed">{noise.toFixed(2)}</Text>
              </Group>
              <Slider value={noise} onChange={setNoise} min={0} max={1} step={0.05} label={null} />
            </div>
            <Button
              onClick={() => void start({ variables: { sessionId: sid, logArtifact: log, noiseThreshold: noise } })}
              disabled={!log}
              loading={starting || running}
            >
              Run IMf discovery
            </Button>
            <JobStatus job={job} />
          </Stack>
        }
      >
        {res && (
          <Stack gap="sm">
            <div>
              <Text size="sm" fw={600} mb={4}>Conformance</Text>
              <MetricsTable metrics={res.metrics} />
            </div>
            {model?.svg && (
              <ModelViewer svg={model.svg} bpmnXml={model.bpmnXml} title={modelData?.artifact?.name} height="48vh" />
            )}
          </Stack>
        )}
      </Step>
    </Stack>
  );
}
