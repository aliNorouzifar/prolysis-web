import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import { ArtifactSelect } from "../components/ArtifactSelect";
import { RulesTable } from "../components/RulesTable";
import { ruleLabel, type DeclareRule } from "../lib/artifacts";
import { sessionId } from "../lib/session";

const ACTIVITIES = gql`
  query LogActivities($id: String!) {
    artifact(id: $id) {
      id
      eventLog {
        activities
      }
    }
  }
`;

const SCORE = gql`
  mutation ScoreRules($sessionId: String!, $logArtifact: String!, $rulesJson: String!) {
    scoreRules(sessionId: $sessionId, logArtifact: $logArtifact, rulesJson: $rulesJson)
  }
`;

const SAVE = gql`
  mutation SaveRules($sessionId: String!, $name: String!, $rulesJson: String!) {
    saveRules(sessionId: $sessionId, name: $name, rulesJson: $rulesJson)
  }
`;

/** The full Declare template catalogue supported by the engine (prolysis.declare) —
 *  the same templates IMr can turn into DFAs. Descriptions use thesis vocabulary. */
interface TemplateDef {
  name: string;
  arity: 1 | 2;
  desc: string;
}

const TEMPLATE_GROUPS: { group: string; templates: TemplateDef[] }[] = [
  {
    group: "Existence",
    templates: [
      { name: "AtLeast1", arity: 1, desc: "A occurs at least once in every trace." },
      { name: "AtLeast2", arity: 1, desc: "A occurs at least twice in every trace." },
      { name: "AtLeast3", arity: 1, desc: "A occurs at least three times in every trace." },
      { name: "AtMost1", arity: 1, desc: "A occurs at most once per trace." },
      { name: "AtMost2", arity: 1, desc: "A occurs at most twice per trace." },
      { name: "AtMost3", arity: 1, desc: "A occurs at most three times per trace." },
      { name: "Absence", arity: 1, desc: "A never occurs." },
      { name: "Init", arity: 1, desc: "Every trace starts with A." },
      { name: "End", arity: 1, desc: "Every trace ends with A." },
    ],
  },
  {
    group: "Relation",
    templates: [
      { name: "RespondedExistence", arity: 2, desc: "If A occurs, B also occurs (before or after A)." },
      { name: "Response", arity: 2, desc: "Every A is eventually followed by B." },
      { name: "AlternateResponse", arity: 2, desc: "After each A, B occurs before A can recur." },
      { name: "ChainResponse", arity: 2, desc: "Every A is immediately followed by B." },
      { name: "Precedence", arity: 2, desc: "B occurs only if A occurred before it." },
      { name: "AlternatePrecedence", arity: 2, desc: "Each B is preceded by A, with no other B in between." },
      { name: "ChainPrecedence", arity: 2, desc: "Every B is immediately preceded by A." },
      { name: "CoExistence", arity: 2, desc: "A and B occur together in a trace, or neither does." },
      { name: "Succession", arity: 2, desc: "Response and Precedence combined: A and B occur in order." },
      { name: "AlternateSuccession", arity: 2, desc: "A and B strictly alternate: A, then B, then possibly A again…" },
      { name: "ChainSuccession", arity: 2, desc: "A and B always occur as an immediate pair." },
    ],
  },
  {
    group: "Negative",
    templates: [
      { name: "NotRespondedExistence", arity: 2, desc: "If A occurs, B does not occur in the same trace." },
      { name: "NotResponse", arity: 2, desc: "A is never eventually followed by B." },
      { name: "NotChainResponse", arity: 2, desc: "A is never immediately followed by B." },
      { name: "NotPrecedence", arity: 2, desc: "B never occurs after an A." },
      { name: "NotChainPrecedence", arity: 2, desc: "B is never immediately preceded by A." },
      { name: "NotCoExistence", arity: 2, desc: "A and B never occur in the same trace." },
      { name: "NotSuccession", arity: 2, desc: "A is never followed by B (in any distance)." },
      { name: "NotChainSuccession", arity: 2, desc: "A is never immediately followed by B." },
    ],
  },
];

const TEMPLATES: Record<string, TemplateDef> = Object.fromEntries(
  TEMPLATE_GROUPS.flatMap((g) => g.templates.map((t) => [t.name, t])),
);

export function RuleEditorPage() {
  const sid = sessionId();
  const [log, setLog] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [actA, setActA] = useState<string | null>(null);
  const [actB, setActB] = useState<string | null>(null);
  const [rules, setRules] = useState<DeclareRule[]>([]);
  const [name, setName] = useState("");

  const { data: actData } = useQuery<{
    artifact: { id: string; eventLog: { activities: string[] } | null } | null;
  }>(ACTIVITIES, { variables: { id: log }, skip: !log });
  const activities = actData?.artifact?.eventLog?.activities ?? [];

  const tpl = template ? TEMPLATES[template] : null;
  const binary = tpl?.arity === 2;

  const [score, { loading: scoring }] = useMutation<{ scoreRules: string }>(SCORE, {
    onError: (e) =>
      notifications.show({ title: "Rule rejected", message: e.message, color: "red" }),
  });
  const [save, { loading: saving }] = useMutation<{ saveRules: string }>(SAVE, {
    onCompleted: () => {
      notifications.show({
        title: "Rule set saved",
        message: "Available in the workspace — use it in IMr.",
        color: "teal",
      });
      setRules([]);
      setName("");
    },
    onError: (e) =>
      notifications.show({ title: "Could not save", message: e.message, color: "red" }),
  });

  const candidate: DeclareRule | null =
    tpl && actA && (!binary || actB)
      ? {
          template: tpl.name,
          parameters: binary ? [[actA], [actB as string]] : [[actA]],
        }
      : null;

  const addRule = async () => {
    if (!candidate || !log) return;
    if (rules.some((r) => ruleLabel(r) === ruleLabel(candidate))) {
      notifications.show({
        title: "Already added",
        message: `${ruleLabel(candidate)} is already in the rule set.`,
        color: "yellow",
      });
      return;
    }
    const res = await score({
      variables: { sessionId: sid, logArtifact: log, rulesJson: JSON.stringify([candidate]) },
    });
    if (res.data) {
      const scored = JSON.parse(res.data.scoreRules) as DeclareRule[];
      setRules((rs) => [...rs, ...scored]);
    }
  };

  return (
    <Stack maw={1160}>
      <div>
        <Title order={2}>Rule editor — compose Declare rules manually</Title>
        <Text c="dimmed" size="sm" maw={880}>
          Build a rule set R by hand: pick a Declare template, instantiate it with
          activities of the selected event log, and every added rule is immediately
          scored with support and confidence on that log (thesis §8.4.2). Save the set
          to the workspace and use it in IMr — alongside rules from discovery, the LLM,
          or discriminative learning.
        </Text>
      </div>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder>
            <Title order={5} mb="xs">
              Compose a rule
            </Title>
            <Stack gap="sm">
              <ArtifactSelect
                kinds={["event_log", "desirable_log", "undesirable_log"]}
                label="Event log (L)"
                value={log}
                onChange={(v) => {
                  setLog(v);
                  setActA(null);
                  setActB(null);
                }}
                description="Provides the activities, and the log the rules are scored on"
              />
              <Select
                label="Declare template"
                placeholder="Pick a template"
                searchable
                value={template}
                onChange={(v) => {
                  setTemplate(v);
                  if (v && TEMPLATES[v].arity === 1) setActB(null);
                }}
                data={TEMPLATE_GROUPS.map((g) => ({
                  group: g.group,
                  items: g.templates.map((t) => t.name),
                }))}
              />
              {tpl && (
                <Text size="xs" c="dimmed" mt={-8}>
                  {tpl.name}({binary ? "A, B" : "A"}): {tpl.desc}
                </Text>
              )}
              <Select
                label="Activity A"
                placeholder={log ? "Pick an activity" : "Select a log first"}
                searchable
                disabled={!activities.length}
                data={activities}
                value={actA}
                onChange={setActA}
              />
              {binary && (
                <Select
                  label="Activity B"
                  placeholder={log ? "Pick an activity" : "Select a log first"}
                  searchable
                  disabled={!activities.length}
                  data={activities.filter((a) => a !== actA)}
                  value={actB}
                  onChange={setActB}
                />
              )}
              <Button disabled={!candidate || !log} loading={scoring} onClick={() => void addRule()}>
                {candidate ? `Add ${ruleLabel(candidate)}` : "Add rule"}
              </Button>
              {scoring && (
                <Text size="xs" c="dimmed">
                  Scoring the rule with support and confidence on the selected log…
                </Text>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder>
            <Group justify="space-between" mb="xs">
              <Group gap="xs">
                <Title order={5}>Rule set</Title>
                <Badge variant="light" color="violet">
                  {rules.length} rule{rules.length === 1 ? "" : "s"}
                </Badge>
              </Group>
            </Group>
            {rules.length ? (
              <Stack gap="sm">
                <RulesTable
                  rules={rules}
                  onRemove={(i) => setRules((rs) => rs.filter((_, k) => k !== i))}
                />
                <Group align="flex-end" gap="sm">
                  <TextInput
                    label="Rule set name"
                    placeholder={`Manual rules (${rules.length})`}
                    value={name}
                    onChange={(e) => setName(e.currentTarget.value)}
                    style={{ flexGrow: 1 }}
                  />
                  <Button
                    loading={saving}
                    onClick={() =>
                      void save({
                        variables: {
                          sessionId: sid,
                          name: name.trim() || `Manual rules (${rules.length})`,
                          rulesJson: JSON.stringify(rules),
                        },
                      })
                    }
                  >
                    Save rule set as R
                  </Button>
                </Group>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                Added rules appear here with their support and confidence on the selected
                log. A rule with low support contradicts the recorded behaviour — worth a
                second look before guiding discovery with it.
              </Text>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
