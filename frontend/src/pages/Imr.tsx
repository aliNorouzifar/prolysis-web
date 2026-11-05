import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Badge,
  Button,
  Group,
  NumberInput,
  Slider,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { ArtifactSelect } from "../components/ArtifactSelect";
import { JobStatus } from "../components/JobStatus";
import { MetricsTable } from "../components/MetricsTable";
import { ModelViewer } from "../components/ModelViewer";
import { RulesTable } from "../components/RulesTable";
import { Step, type StepStatus } from "../components/Step";
import { type DeclareRule } from "../lib/artifacts";
import { sessionId } from "../lib/session";
import { useJob, type Job } from "../lib/useJob";

const START_IMR = gql`
  mutation StartImr($sessionId: String!, $logArtifact: String!, $sup: Float!, $rulesJson: String!, $activities: [String!]!) {
    startImr(sessionId: $sessionId, logArtifact: $logArtifact, sup: $sup, rulesJson: $rulesJson, activities: $activities)
  }
`;
const START_DISCOVER_RULES = gql`
  mutation StartDiscoverRules($sessionId: String!, $logArtifact: String!, $support: Float!, $confidence: Float!) {
    startDiscoverRules(sessionId: $sessionId, logArtifact: $logArtifact, support: $support, confidence: $confidence)
  }
`;
const RULESET = gql`
  query RuleSet($id: String!) {
    artifact(id: $id) { id rulesJson }
  }
`;
const LOG_DETAILS = gql`
  query LogDetails($id: String!) {
    artifact(id: $id) { id eventLog { activities numTraces } }
  }
`;
const MODEL = gql`
  query ImrModel($id: String!) {
    artifact(id: $id) { id name model { svg bpmnXml } }
  }
`;

interface ImrResult {
  artifact_id: string;
  metrics: Record<string, number>;
}

function jobStatus(job: Job | null, ready: boolean): StepStatus {
  if (job?.status === "succeeded") return "done";
  if (job?.status === "failed") return "failed";
  if (job && (job.status === "running" || job.status === "queued")) return "running";
  return ready ? "ready" : "locked";
}

export function ImrPage() {
  const sid = sessionId();
  const [log, setLog] = useState<string | null>(null);
  const [sup, setSup] = useState(0.2);

  // Rules: workspace rule set or discover-from-log.
  const [ruleSet, setRuleSet] = useState<string | null>(null);
  const { data: rsData } = useQuery<{ artifact: { rulesJson: string | null } | null }>(RULESET, {
    variables: { id: ruleSet ?? "" },
    skip: !ruleSet,
  });
  const wsRules = useMemo<DeclareRule[]>(
    () => (rsData?.artifact?.rulesJson ? (JSON.parse(rsData.artifact.rulesJson) as DeclareRule[]) : []),
    [rsData],
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => setSelected(new Set(wsRules.map((_, i) => i))), [wsRules]);

  const [support, setSupport] = useState(0.9);
  const [confidence, setConfidence] = useState(0.9);
  const [rulesJobId, setRulesJobId] = useState<string | null>(null);
  const [startRules, { loading: sRules }] = useMutation<{ startDiscoverRules: string }>(
    START_DISCOVER_RULES,
    { onCompleted: (d) => setRulesJobId(d.startDiscoverRules) },
  );
  const rulesJob = useJob(rulesJobId);
  useEffect(() => {
    const r = rulesJob.result as { artifact_id?: string } | null;
    if (r?.artifact_id) setRuleSet(r.artifact_id);
  }, [rulesJob.result]);

  const { data: logData } = useQuery<{
    artifact: { eventLog: { activities: string[]; numTraces: number | null } | null } | null;
  }>(LOG_DETAILS, { variables: { id: log ?? "" }, skip: !log });
  const activities = logData?.artifact?.eventLog?.activities ?? [];

  const [jobId, setJobId] = useState<string | null>(null);
  const [start, { loading: starting }] = useMutation<{ startImr: string }>(START_IMR, {
    onCompleted: (d) => setJobId(d.startImr),
  });
  const { job, result, running } = useJob(jobId);
  const res = result as ImrResult | null;

  const { data: modelData } = useQuery<{
    artifact: { name: string; model: { svg: string | null; bpmnXml: string | null } | null } | null;
  }>(MODEL, { variables: { id: res?.artifact_id ?? "" }, skip: !res?.artifact_id });
  const model = modelData?.artifact?.model ?? null;

  const chosenRules = wsRules.filter((_, i) => selected.has(i));

  return (
    <Stack maw={1240}>
      <div>
        <Title order={2}>IMr — rule-guided discovery</Title>
        <Text c="dimmed" size="sm" maw={900}>
          IMr (thesis §6.2) discovers a model from an event log L and Declare rules R that
          steer the cut selection. Rules can come from any thesis source — discovered from
          the log, extracted by the LLM tool, learned discriminatively — and you curate the
          selection before discovery.
        </Text>
      </div>

      <Step
        n={1}
        title="Choose the event log"
        status={log ? "done" : "ready"}
        controls={<ArtifactSelect kind="event_log" label="Event log (L)" value={log} onChange={setLog} />}
        resultHint="The log's activities appear here — the rules may only use these."
      >
        {log && activities.length > 0 && (
          <Group gap={6}>
            <Badge variant="light">{logData?.artifact?.eventLog?.numTraces ?? "?"} traces</Badge>
            {activities.map((a) => (
              <Badge key={a} variant="outline" color="gray">{a}</Badge>
            ))}
          </Group>
        )}
      </Step>

      <Step
        n={2}
        title="Provide the rules R"
        description="Pick a rule set from the workspace (LLM-extracted, discriminative, or saved) or discover rules directly from the log — then tick exactly the rules the discovery must respect."
        status={wsRules.length ? "done" : jobStatus(rulesJob.job, !!log)}
        controls={
          <Tabs defaultValue="workspace" keepMounted={false}>
            <Tabs.List grow>
              <Tabs.Tab value="workspace">From workspace</Tabs.Tab>
              <Tabs.Tab value="discover">Discover from log</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="workspace" pt="xs">
              <ArtifactSelect kind="rule_set" label="Rule set (R)" value={ruleSet} onChange={setRuleSet} />
            </Tabs.Panel>
            <Tabs.Panel value="discover" pt="xs">
              <Stack gap="xs">
                <NumberInput label="Min support" value={support} onChange={(v) => setSupport(Number(v) || 0)}
                  min={0} max={1} step={0.05} decimalScale={2} />
                <NumberInput label="Min confidence" value={confidence} onChange={(v) => setConfidence(Number(v) || 0)}
                  min={0} max={1} step={0.05} decimalScale={2} />
                <Button variant="light" disabled={!log} loading={sRules || rulesJob.running}
                  onClick={() => void startRules({ variables: { sessionId: sid, logArtifact: log, support, confidence } })}>
                  Discover Declare rules
                </Button>
                <JobStatus job={rulesJob.job} />
              </Stack>
            </Tabs.Panel>
          </Tabs>
        }
        resultHint="The rule set appears here for review — tick the rules to enforce. IMr also runs with an empty selection."
        resultHeight={400}
      >
        {wsRules.length > 0 && (
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={600}>
                {selected.size} of {wsRules.length} rules selected
              </Text>
              <Group gap="xs">
                <Button size="compact-xs" variant="subtle" onClick={() => setSelected(new Set(wsRules.map((_, i) => i)))}>
                  all
                </Button>
                <Button size="compact-xs" variant="subtle" onClick={() => setSelected(new Set())}>
                  none
                </Button>
              </Group>
            </Group>
            <RulesTable rules={wsRules} selected={selected}
              onToggle={(i) => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
              maxHeight={300} />
          </Stack>
        )}
      </Step>

      <Step
        n={3}
        title="Discover the model"
        description="sup enforces frequent behaviour; the selected rules constrain which cuts are allowed at every recursion step."
        status={jobStatus(job, !!log)}
        controls={
          <Stack gap="sm">
            <div>
              <Group justify="space-between">
                <Text size="sm" fw={500}>sup</Text>
                <Text size="sm" c="dimmed">{sup.toFixed(2)}</Text>
              </Group>
              <Slider value={sup} onChange={setSup} min={0} max={1} step={0.05} label={null} />
            </div>
            <Button disabled={!log} loading={starting || running}
              onClick={() => void start({
                variables: {
                  sessionId: sid, logArtifact: log, sup,
                  rulesJson: JSON.stringify(chosenRules), activities,
                },
              })}>
              Run IMr ({chosenRules.length} rules)
            </Button>
            <JobStatus job={job} />
          </Stack>
        }
        resultHint="Fitness/precision and the discovered process model appear here, next to the parameters that produced them."
        resultHeight={680}
      >
        {res && (
          <Stack gap="sm">
            <div>
              <Text size="sm" fw={600} mb={4}>Conformance</Text>
              <MetricsTable metrics={res.metrics} />
            </div>
            {model?.svg && <ModelViewer svg={model.svg} bpmnXml={model.bpmnXml} title={modelData?.artifact?.name} height="48vh" />}
          </Stack>
        )}
      </Step>
    </Stack>
  );
}
