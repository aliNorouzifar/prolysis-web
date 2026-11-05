import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Link } from "react-router-dom";
import { ARTIFACTS, KIND_COLORS, KIND_LABELS, type Artifact } from "../lib/artifacts";
import { sessionId } from "../lib/session";

const LOAD_SAMPLE = gql`
  mutation LoadSample($sessionId: String!) {
    loadSampleData(sessionId: $sessionId)
  }
`;

interface Tool {
  name: string;
  to: string;
  io: string;
  desc: string;
}

const STAGES: { title: string; hint: string; tools: Tool[] }[] = [
  {
    title: "1 · Prepare inputs",
    hint: "Derive the desirable log L+, undesirable log L−, and Declare rules R",
    tools: [
      {
        name: "X-PVI",
        to: "/variants",
        io: "L → L+ / L−",
        desc: "Segment an event log along a performance indicator (EMD change points) and export case groups.",
      },
      {
        name: "Rule editor",
        to: "/rules",
        io: "manual → R",
        desc: "Compose Declare rules by hand from the full template catalogue, scored on a selected log.",
      },
      {
        name: "LLM rule extraction",
        to: "/llm",
        io: "text → R",
        desc: "Turn natural-language domain knowledge into validated Declare rules via an LLM chat.",
      },
      {
        name: "Discriminative rules",
        to: "/discriminative",
        io: "L+ / L− → R",
        desc: "Learn rules that separate desirable from undesirable behaviour (RuleFit over Declare features).",
      },
    ],
  },
  {
    title: "2 · Discover",
    hint: "Discover process models that favour L+ and avoid L− or comply with R",
    tools: [
      {
        name: "IMbi",
        to: "/discovery/imbi",
        io: "L+ + L− → model",
        desc: "Desirability-aware discovery with sup and ratio; evaluated with the Ch. 4 metrics.",
      },
      {
        name: "IMr",
        to: "/discovery/imr",
        io: "L + R → model",
        desc: "Rule-guided discovery: Declare rules steer the cut selection at every recursion step.",
      },
      {
        name: "IMf (baseline)",
        to: "/discovery/imf",
        io: "L → model",
        desc: "Inductive miner infrequent on a single log — the baseline to compare IMbi and IMr against.",
      },
    ],
  },
  {
    title: "3 · Evaluate",
    hint: "Compare the discovered models",
    tools: [
      {
        name: "Compare models",
        to: "/compare",
        io: "models → insight",
        desc: "Side-by-side model graphs and metric deltas (a-fit, t-fit, acc, F1) across all runs.",
      },
    ],
  },
];

export function HomePage() {
  const sid = sessionId();
  const { data, refetch } = useQuery<{ artifacts: Artifact[] }>(ARTIFACTS, {
    variables: { sessionId: sid },
    pollInterval: 5000,
  });
  const [loadSample, { loading }] = useMutation(LOAD_SAMPLE, {
    variables: { sessionId: sid },
    onCompleted: () => {
      notifications.show({
        title: "Sample data loaded",
        message: "Synthetic loan-application logs (L, L+, L−) are in your workspace.",
        color: "teal",
      });
      void refetch();
    },
    onError: (e) =>
      notifications.show({ title: "Could not load sample data", message: e.message, color: "red" }),
  });

  const counts: Record<string, number> = {};
  for (const a of data?.artifacts ?? []) counts[a.kind] = (counts[a.kind] ?? 0) + 1;

  return (
    <Stack maw={1080}>
      <div className="hero">
        <Stack gap="md" style={{ position: "relative", zIndex: 1 }} maw={720}>
          <div>
            <div className="hero-title">
              Desirability-aware
              <br />
              process discovery
            </div>
            <Text c="dimmed" mt="sm" size="md">
              One application for the full research framework (thesis §4.6): derive desirable
              and undesirable event logs and declarative rules, discover process models from
              them, and evaluate the results — with a shared workspace so every output feeds
              the next tool.
            </Text>
          </div>
          <Group gap="sm">
            <Button size="md" onClick={() => void loadSample()} loading={loading}>
              Load sample data
            </Button>
            <Button size="md" variant="default" component={Link} to="/workspace">
              Open workspace
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            The sample is a synthetic loan-application log split into L, L+, and L− — enough
            to exercise every tool without uploading anything.
          </Text>
        </Stack>
      </div>

      {STAGES.map((stage, si) => (
        <div key={stage.title}>
          {si > 0 && <div className="stage-arrow">▼</div>}
          <Group gap="xs" mb={6}>
            <Title order={4}>{stage.title}</Title>
            <Text size="sm" c="dimmed">
              — {stage.hint}
            </Text>
          </Group>
          <SimpleGrid cols={{ base: 1, sm: Math.min(stage.tools.length, 3) }}>
            {stage.tools.map((tool) => (
              <Card
                key={tool.name}
                withBorder
                component={Link}
                to={tool.to}
                className="tool-card"
                padding="md"
              >
                <Group justify="space-between" mb={4}>
                  <Text fw={700}>{tool.name}</Text>
                  <Badge variant="light" color="indigo">
                    {tool.io}
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed">
                  {tool.desc}
                </Text>
              </Card>
            ))}
          </SimpleGrid>
        </div>
      ))}

      <Card withBorder padding="md">
        <Group justify="space-between">
          <Title order={5}>Workspace</Title>
          <Button component={Link} to="/workspace" variant="subtle" size="xs">
            Open workspace →
          </Button>
        </Group>
        <Group mt="xs" gap="xs">
          {Object.keys(KIND_LABELS).map((k) => (
            <Badge key={k} color={KIND_COLORS[k]} variant={counts[k] ? "filled" : "outline"}>
              {KIND_LABELS[k]}: {counts[k] ?? 0}
            </Badge>
          ))}
        </Group>
      </Card>
    </Stack>
  );
}
