import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Grid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useMemo, useState } from "react";
import { ArtifactSelect } from "../components/ArtifactSelect";
import { JobStatus } from "../components/JobStatus";
import { ModelViewer } from "../components/ModelViewer";
import { sessionId } from "../lib/session";
import { useJob } from "../lib/useJob";

const MODELS = gql`
  query Models($sessionId: String!) {
    models(sessionId: $sessionId) {
      artifactId
      name
      tool
      svg
      bpmnXml
      paramsJson
      metricsJson
      metaJson
      createdAt
    }
  }
`;

interface ModelCard {
  artifactId: string;
  name: string;
  tool: string | null;
  svg: string | null;
  bpmnXml: string | null;
  paramsJson: string;
  metricsJson: string;
  metaJson: string;
  createdAt: string;
}

const EVALUATE = gql`
  mutation EvaluateModels($sessionId: String!, $modelArtifacts: [String!]!, $lpArtifact: String!, $lmArtifact: String!) {
    startEvaluateModels(sessionId: $sessionId, modelArtifacts: $modelArtifacts, lpArtifact: $lpArtifact, lmArtifact: $lmArtifact)
  }
`;

interface EvalRow {
  artifact_id: string;
  name: string;
  skipped: boolean;
  reason?: string;
  metrics?: Record<string, number>;
}
interface EvalResult {
  results: EvalRow[];
  inputs: { lp: string; lm: string };
}

function inputsLabel(metaJson: string): string {
  try {
    const inputs = (JSON.parse(metaJson || "{}")?.inputs ?? null) as Record<string, string> | null;
    if (!inputs) return "—";
    return Object.entries(inputs)
      .map(([k, v]) => `${k}: ${v ?? "?"}`)
      .join(" · ");
  } catch {
    return "—";
  }
}

const METRIC_LABELS: Record<string, string> = {
  a_fit_lp: "a-fit L+",
  a_fit_lm: "a-fit L−",
  a_acc: "a-acc",
  a_f1: "a-F1",
  t_acc: "t-acc",
  t_f1: "t-F1",
  fitness: "fitness",
  precision: "precision",
};

export function ComparePage() {
  const sid = sessionId();
  const { data } = useQuery<{ models: ModelCard[] }>(MODELS, {
    variables: { sessionId: sid },
    pollInterval: 5000,
  });
  const models = useMemo(() => data?.models ?? [], [data]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [lp, setLp] = useState<string | null>(null);
  const [lm, setLm] = useState<string | null>(null);
  const [evalJobId, setEvalJobId] = useState<string | null>(null);
  const [startEval, { loading: evaluating }] = useMutation<{ startEvaluateModels: string }>(
    EVALUATE,
    { onCompleted: (d) => setEvalJobId(d.startEvaluateModels) },
  );
  const evalJob = useJob(evalJobId);
  const evalRes = evalJob.result as EvalResult | null;
  const EVAL_KEYS = ["a_fit_lp", "a_fit_lm", "a_acc", "a_f1", "t_acc", "t_f1"];

  const selected = models.filter((m) => chosen.has(m.artifactId));
  const shown = selected.length ? selected : models.slice(0, 2);

  return (
    <Stack maw={1240}>
      <div>
        <Title order={2}>Compare models</Title>
        <Text c="dimmed" size="sm" maw={840}>
          Select discovery runs to place their models side by side, then evaluate all of
          them on one common pair of logs — metrics are only shown where they are
          comparable.
        </Text>
      </div>

      {models.length === 0 ? (
        <Card withBorder>
          <Text c="dimmed" size="sm">
            No models yet — run IMbi or IMr first.
          </Text>
        </Card>
      ) : (
        <>
          <Card withBorder padding="xs">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={36} />
                  <Table.Th>Model</Table.Th>
                  <Table.Th>Tool</Table.Th>
                  <Table.Th>Parameters</Table.Th>
                  <Table.Th>Discovered from</Table.Th>
                  <Table.Th>Created</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {models.map((m) => {
                  const params = (JSON.parse(m.paramsJson || "{}") ?? {}) as Record<string, unknown>;
                  return (
                    <Table.Tr key={m.artifactId}>
                      <Table.Td>
                        <Checkbox
                          checked={chosen.has(m.artifactId)}
                          onChange={() =>
                            setChosen((s) => {
                              const n = new Set(s);
                              if (n.has(m.artifactId)) n.delete(m.artifactId);
                              else n.add(m.artifactId);
                              return n;
                            })
                          }
                          aria-label={`compare ${m.name}`}
                        />
                      </Table.Td>
                      <Table.Td>{m.name}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" color={{ imbi: "indigo", imr: "cyan", imf: "grape" }[m.tool ?? ""] ?? "gray"}>
                          {m.tool ?? "?"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {Object.entries(params)
                            .map(([k, v]) => `${k}=${String(v)}`)
                            .join(", ") || "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {inputsLabel(m.metaJson)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {new Date(m.createdAt).toLocaleString()}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Card>

          <Card withBorder padding="md">
            <Title order={5}>Fair comparison — evaluate on common logs</Title>
            <Text size="sm" c="dimmed" mb="sm" maw={860}>
              The stored metrics above were computed on each run's own input logs. For an
              apples-to-apples comparison, pick one desirable and one undesirable log —
              the selected models are all re-evaluated against this same pair with the
              Chapter 4 metrics.
            </Text>
            <Grid gutter="md" align="end">
              <Grid.Col span={{ base: 12, md: 4 }}>
                <ArtifactSelect kind="desirable_log" label="Desirable log (L+)" value={lp} onChange={setLp} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <ArtifactSelect kind="undesirable_log" label="Undesirable log (L−)" value={lm} onChange={setLm} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Button
                  fullWidth
                  disabled={!lp || !lm || chosen.size === 0}
                  loading={evaluating || evalJob.running}
                  onClick={() =>
                    void startEval({
                      variables: {
                        sessionId: sid,
                        modelArtifacts: [...chosen],
                        lpArtifact: lp,
                        lmArtifact: lm,
                      },
                    })
                  }
                >
                  Evaluate {chosen.size} selected model{chosen.size === 1 ? "" : "s"}
                </Button>
              </Grid.Col>
            </Grid>
            <JobStatus job={evalJob.job} />
            {evalRes && (
              <>
                <Text size="sm" fw={600} mt="sm">
                  All models evaluated on L+ = {evalRes.inputs.lp} and L− = {evalRes.inputs.lm}:
                </Text>
                <Table striped withTableBorder mt={6}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Model</Table.Th>
                      {EVAL_KEYS.map((k) => (
                        <Table.Th key={k} style={{ textAlign: "center" }}>
                          {METRIC_LABELS[k]}
                        </Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {evalRes.results.map((r) => (
                      <Table.Tr key={r.artifact_id}>
                        <Table.Td>{r.name}</Table.Td>
                        {r.skipped ? (
                          <Table.Td colSpan={EVAL_KEYS.length}>
                            <Text size="xs" c="dimmed">
                              skipped — {r.reason}
                            </Text>
                          </Table.Td>
                        ) : (
                          EVAL_KEYS.map((k) => (
                            <Table.Td key={k} style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                              {r.metrics?.[k] != null ? r.metrics[k].toFixed(3) : "—"}
                            </Table.Td>
                          ))
                        )}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </>
            )}
          </Card>

          <Grid gutter="md">
            {shown.map((m) => (
              <Grid.Col key={m.artifactId} span={{ base: 12, lg: shown.length > 1 ? 6 : 12 }}>
                {m.svg ? (
                  <ModelViewer svg={m.svg} bpmnXml={m.bpmnXml} title={m.name} height="46vh" />
                ) : (
                  <Card withBorder>
                    <Text c="dimmed" size="sm">
                      No rendered graph stored for {m.name}.
                    </Text>
                  </Card>
                )}
              </Grid.Col>
            ))}
          </Grid>
        </>
      )}
    </Stack>
  );
}
