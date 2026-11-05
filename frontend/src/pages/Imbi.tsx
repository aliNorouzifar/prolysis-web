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
  mutation StartImbi($sessionId: String!, $lpArtifact: String!, $lmArtifact: String!, $sup: Float!, $ratio: Float!) {
    startImbi(sessionId: $sessionId, lpArtifact: $lpArtifact, lmArtifact: $lmArtifact, sup: $sup, ratio: $ratio)
  }
`;

const MODEL = gql`
  query ImbiModel($id: String!) {
    artifact(id: $id) {
      id
      name
      model { svg bpmnXml }
    }
  }
`;

interface ImbiResult {
  artifact_id: string;
  metrics: Record<string, number>;
}

function jobStatus(job: Job | null, ready: boolean): StepStatus {
  if (job?.status === "succeeded") return "done";
  if (job?.status === "failed") return "failed";
  if (job && (job.status === "running" || job.status === "queued")) return "running";
  return ready ? "ready" : "locked";
}

export function ImbiPage() {
  const sid = sessionId();
  const [lp, setLp] = useState<string | null>(null);
  const [lm, setLm] = useState<string | null>(null);
  const [sup, setSup] = useState(0.2);
  const [ratio, setRatio] = useState(1.0);
  const [jobId, setJobId] = useState<string | null>(null);

  const [start, { loading: starting }] = useMutation<{ startImbi: string }>(START, {
    onCompleted: (d) => setJobId(d.startImbi),
  });
  const { job, result, running } = useJob(jobId);
  const res = result as ImbiResult | null;

  const { data: modelData } = useQuery<{
    artifact: { name: string; model: { svg: string | null; bpmnXml: string | null } | null } | null;
  }>(MODEL, { variables: { id: res?.artifact_id ?? "" }, skip: !res?.artifact_id });
  const model = modelData?.artifact?.model ?? null;

  return (
    <Stack maw={1240}>
      <div>
        <Title order={2}>IMbi — discovery from desirable and undesirable logs</Title>
        <Text c="dimmed" size="sm" maw={880}>
          IMbi (thesis §6.1) discovers a model that supports the behaviour of L+ while
          avoiding the behaviour of L−. Every run is stored in the workspace with its
          parameters and Ch. 4 evaluation, so you can iterate on <b>sup</b> and <b>ratio</b>{" "}
          and compare runs side by side.
        </Text>
      </div>

      <Step
        n={1}
        title="Select the two input logs"
        description="The desirable log L+ (behaviour to support) and the undesirable log L− (behaviour to avoid). Both come from the workspace — upload, sample data, X-PVI segments, or discriminative groups."
        status={lp && lm ? "done" : "ready"}
        controls={
          <Stack gap="sm">
            <ArtifactSelect kind="desirable_log" label="Desirable log (L+)" value={lp} onChange={setLp} />
            <ArtifactSelect kind="undesirable_log" label="Undesirable log (L−)" value={lm} onChange={setLm} />
          </Stack>
        }
        resultHint="Once both logs are selected, this step is complete."
      >
        {lp && lm && (
          <Group gap="xs">
            <Badge color="teal" variant="light">L+ selected</Badge>
            <Badge color="red" variant="light">L− selected</Badge>
            <Text size="sm" c="dimmed">Continue to step 2 to configure the discovery.</Text>
          </Group>
        )}
      </Step>

      <Step
        n={2}
        title="Configure and discover"
        description="sup enforces frequent behaviour; ratio weighs how strongly deviating behaviour of L− is punished during cut selection. The evaluation and the discovered Petri net appear next to the parameters that produced them."
        status={jobStatus(job, !!(lp && lm))}
        controls={
          <Stack gap="sm">
            <div>
              <Group justify="space-between">
                <Text size="sm" fw={500}>sup</Text>
                <Text size="sm" c="dimmed">{sup.toFixed(2)}</Text>
              </Group>
              <Slider value={sup} onChange={setSup} min={0} max={1} step={0.05} label={null} />
            </div>
            <div>
              <Group justify="space-between">
                <Text size="sm" fw={500}>ratio</Text>
                <Text size="sm" c="dimmed">{ratio.toFixed(2)}</Text>
              </Group>
              <Slider value={ratio} onChange={setRatio} min={0} max={1} step={0.05} label={null} />
            </div>
            <Button
              onClick={() => void start({ variables: { sessionId: sid, lpArtifact: lp, lmArtifact: lm, sup, ratio } })}
              disabled={!lp || !lm}
              loading={starting || running}
            >
              Run IMbi discovery
            </Button>
            <JobStatus job={job} />
          </Stack>
        }
        resultHint="The Ch. 4 evaluation table (a-fit on both logs, accuracy, F1) and the discovered process model appear here."
        resultHeight={680}
      >
        {res && (
          <Stack gap="sm">
            <div>
              <Text size="sm" fw={600} mb={4}>Evaluation (thesis Ch. 4)</Text>
              <MetricsTable metrics={res.metrics} />
            </div>
            {model?.svg && <ModelViewer svg={model.svg} bpmnXml={model.bpmnXml} title={modelData?.artifact?.name} height="48vh" />}
          </Stack>
        )}
      </Step>
    </Stack>
  );
}
