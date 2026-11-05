import { gql, useMutation } from "@apollo/client";
import {
  Badge,
  Button,
  Group,
  NumberInput,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useState } from "react";
import { ArtifactSelect } from "../components/ArtifactSelect";
import { JobStatus } from "../components/JobStatus";
import { RuleClusterMap, type ClustermapData } from "../components/RuleClusterMap";
import { Step, type StepStatus } from "../components/Step";
import { sessionId } from "../lib/session";
import { useJob, type Job } from "../lib/useJob";

const START = gql`
  mutation StartDiscriminate($sessionId: String!, $lpArtifact: String!, $lmArtifact: String!) {
    startDiscriminate(sessionId: $sessionId, lpArtifact: $lpArtifact, lmArtifact: $lmArtifact)
  }
`;
const CLUSTER = gql`
  mutation StartCluster($sessionId: String!, $nClusters: Int!, $zJson: String!) {
    startCluster(sessionId: $sessionId, nClusters: $nClusters, zJson: $zJson)
  }
`;

interface DiscResult { clustermap: ClustermapData; Z: number[][] }
interface ClusterRule {
  rule: string;
  support?: number;
  support_P?: number;
  support_M?: number;
  coef?: number;
  importance?: number;
}
interface ClusterResult {
  clusters: { cluster: string; top_rule?: string; coef?: number; num_traces?: number; rules?: ClusterRule[] }[];
  exported: { artifact_id: string; name: string; num_traces: number }[];
}

function jobStatus(job: Job | null, ready: boolean): StepStatus {
  if (job?.status === "succeeded") return "done";
  if (job?.status === "failed") return "failed";
  if (job && (job.status === "running" || job.status === "queued")) return "running";
  return ready ? "ready" : "locked";
}

export function DiscriminativePage() {
  const sid = sessionId();
  const [lp, setLp] = useState<string | null>(null);
  const [lm, setLm] = useState<string | null>(null);
  const [nClusters, setNClusters] = useState(3);

  const [jobId, setJobId] = useState<string | null>(null);
  const [start, { loading: starting }] = useMutation<{ startDiscriminate: string }>(START, {
    onCompleted: (d) => setJobId(d.startDiscriminate),
  });
  const disc = useJob(jobId);
  const discRes = disc.result as DiscResult | null;

  const [clusterJobId, setClusterJobId] = useState<string | null>(null);
  const [startCluster, { loading: clustering }] = useMutation<{ startCluster: string }>(CLUSTER, {
    onCompleted: (d) => setClusterJobId(d.startCluster),
  });
  const clus = useJob(clusterJobId);
  const clusRes = clus.result as ClusterResult | null;

  return (
    <Stack maw={1240}>
      <div>
        <Title order={2}>Discriminative rule learning</Title>
        <Text c="dimmed" size="sm" maw={900}>
          Learn interpretable rules that separate the desirable from the undesirable log
          (thesis §5.3 / §8.5): per-trace Declare verdicts become features, RuleFit learns
          weighted rules, and the rules are clustered by which traces they cover. Cutting
          the dendrogram exports each cluster's trace group as a new event log.
        </Text>
      </div>

      <Step
        n={1}
        title="Select the labelled logs"
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
          </Group>
        )}
      </Step>

      <Step
        n={2}
        title="Learn the discriminative rules"
        description="Declare rules are discovered over both logs, every trace is scored against them, and RuleFit (with a grid search) learns the rules that best separate L+ from L−. Expect a few minutes on larger logs."
        status={jobStatus(disc.job, !!(lp && lm))}
        controls={
          <Stack gap="sm">
            <Button disabled={!lp || !lm} loading={starting || disc.running}
              onClick={() => void start({ variables: { sessionId: sid, lpArtifact: lp, lmArtifact: lm } })}>
              Learn discriminative rules
            </Button>
            <JobStatus job={disc.job} />
          </Stack>
        }
        resultHint="The clustered-rule map appears here: teal rules push towards L+, red towards L−; the dendrogram groups rules that cover the same traces (hover any mark for the full rule)."
        resultHeight={600}
      >
        {discRes?.clustermap && <RuleClusterMap data={discRes.clustermap} />}
      </Step>

      <Step
        n={3}
        title="Cut the dendrogram and export trace groups"
        description="Choose how many rule clusters to keep; each cluster reports its rules with support on both logs, and its trace group is exported to the workspace (re-label as L+/L− to feed IMbi)."
        status={jobStatus(clus.job, !!discRes)}
        controls={
          <Stack gap="sm">
            <NumberInput label="Number of clusters" value={nClusters}
              onChange={(v) => setNClusters(Number(v) || 1)} min={1} max={20} />
            <Button variant="light" disabled={!discRes} loading={clustering || clus.running}
              onClick={() => void startCluster({
                variables: { sessionId: sid, nClusters, zJson: JSON.stringify(discRes?.Z ?? []) },
              })}>
              Cut &amp; export
            </Button>
            <JobStatus job={clus.job} />
          </Stack>
        }
        resultHint="Per-cluster rule statistics and the exported trace groups appear here."
        resultHeight={600}
      >
        {clusRes && (
          <Stack gap="sm">
            {clusRes.clusters.map((c) => (
              <div key={c.cluster}>
                <Group justify="space-between" mb={4}>
                  <Text fw={600} size="sm">Cluster {c.cluster}</Text>
                  <Group gap="xs">
                    {c.num_traces != null && <Badge variant="light">{c.num_traces} traces</Badge>}
                    {c.coef != null && (
                      <Badge variant="light" color={c.coef >= 0 ? "teal" : "red"}>
                        {c.coef >= 0 ? "→ L+" : "→ L−"} (coef {c.coef})
                      </Badge>
                    )}
                  </Group>
                </Group>
                {c.rules && c.rules.length > 0 && (
                  <Table striped withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>rule</Table.Th>
                        <Table.Th>support</Table.Th>
                        <Table.Th>support(L+)</Table.Th>
                        <Table.Th>support(L−)</Table.Th>
                        <Table.Th>coef</Table.Th>
                        <Table.Th>importance</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {c.rules.map((r, i) => (
                        <Table.Tr key={i}>
                          <Table.Td style={{ fontFamily: "var(--mantine-font-family-monospace)", maxWidth: 420 }}>
                            {r.rule}
                          </Table.Td>
                          <Table.Td>{r.support ?? "—"}</Table.Td>
                          <Table.Td>{r.support_P ?? "—"}</Table.Td>
                          <Table.Td>{r.support_M ?? "—"}</Table.Td>
                          <Table.Td>{r.coef ?? "—"}</Table.Td>
                          <Table.Td>{r.importance ?? "—"}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </div>
            ))}
            {clusRes.exported.length > 0 && (
              <Group gap="xs">
                {clusRes.exported.map((e) => (
                  <Badge key={e.artifact_id} variant="light">
                    {e.name} · {e.num_traces} traces → workspace
                  </Badge>
                ))}
              </Group>
            )}
          </Stack>
        )}
      </Step>
    </Stack>
  );
}
