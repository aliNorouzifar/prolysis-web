import { gql, useMutation } from "@apollo/client";
import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  PasswordInput,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useRef, useState } from "react";
import { ArtifactSelect } from "../components/ArtifactSelect";
import { RulesTable } from "../components/RulesTable";
import { ruleLabel, type DeclareRule } from "../lib/artifacts";
import { sessionId } from "../lib/session";

const EXTRACT = gql`
  mutation ExtractLlmRules(
    $sessionId: String!
    $logArtifact: String!
    $description: String!
    $provider: String!
    $modelName: String!
    $apiKey: String!
    $historyJson: String
  ) {
    extractLlmRules(
      sessionId: $sessionId
      logArtifact: $logArtifact
      description: $description
      provider: $provider
      modelName: $modelName
      apiKey: $apiKey
      historyJson: $historyJson
    )
  }
`;

const SAVE = gql`
  mutation SaveRules($sessionId: String!, $name: String!, $rulesJson: String!) {
    saveRules(sessionId: $sessionId, name: $name, rulesJson: $rulesJson)
  }
`;

const MODELS: Record<string, string[]> = {
  OpenAI: ["gpt-4o", "gpt-4o-mini"],
  Google: ["gemini-1.5-pro", "gemini-1.5-flash"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
};

interface ExtractOut {
  rules: DeclareRule[];
  text: string;
  fixes: number;
  history: unknown[];
}

interface ChatMsg {
  role: "user" | "assistant";
  text?: string;
  rules?: DeclareRule[];
  fixes?: number;
}

function AssistantBubble({ msg }: { msg: ChatMsg }) {
  return (
    <div className="chat-bubble chat-assistant">
      {msg.rules && msg.rules.length ? (
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Proposed {msg.rules.length} rule{msg.rules.length === 1 ? "" : "s"}
            {msg.fixes ? (
              <Text span size="xs" c="dimmed"> · self-corrected {msg.fixes}×</Text>
            ) : null}
          </Text>
          <div>
            {msg.rules.map((r, i) => (
              <Badge key={i} variant="light" color="violet" radius="sm" mr={4} mb={4}
                style={{ textTransform: "none", fontFamily: "var(--mantine-font-family-monospace)" }}>
                {ruleLabel(r)}
              </Badge>
            ))}
          </div>
        </Stack>
      ) : (
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {msg.text || "The LLM returned no valid rules — rephrase and try again."}
        </Text>
      )}
    </div>
  );
}

export function LlmPage() {
  const sid = sessionId();
  const [log, setLog] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>("OpenAI");
  const [model, setModel] = useState<string>(MODELS.OpenAI[0]);
  const [apiKey, setApiKey] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [wireHistory, setWireHistory] = useState<unknown[]>([]);
  const [rules, setRules] = useState<DeclareRule[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const [extract, { loading }] = useMutation<{ extractLlmRules: string }>(EXTRACT, {
    onCompleted: (d) => {
      const out = JSON.parse(d.extractLlmRules) as ExtractOut;
      setWireHistory(out.history ?? []);
      setMessages((ms) => [...ms, {
        role: "assistant",
        text: out.text,
        rules: out.rules,
        fixes: out.fixes,
      }]);
      if (out.rules.length) {
        setRules(out.rules);
        setSelected(new Set(out.rules.map((_, i) => i)));
      }
    },
    onError: (e) => {
      setMessages((ms) => ms.slice(0, -1)); // roll back the pending user bubble
      notifications.show({ title: "Extraction failed", message: e.message, color: "red" });
    },
  });

  const started = messages.length > 0;
  const canSend = !!log && !!apiKey && !!draft.trim() && !loading;

  const send = () => {
    if (!canSend) return;
    const text = draft.trim();
    setMessages((ms) => [...ms, { role: "user", text }]);
    setDraft("");
    void extract({
      variables: {
        sessionId: sid,
        logArtifact: log,
        description: text,
        provider,
        modelName: model,
        apiKey,
        historyJson: JSON.stringify(wireHistory),
      },
    });
  };

  const reset = () => {
    setMessages([]);
    setWireHistory([]);
    setRules([]);
    setSelected(new Set());
  };

  const [save, { loading: saving }] = useMutation<{ saveRules: string }>(SAVE, {
    onCompleted: () =>
      notifications.show({
        title: "Rule set saved",
        message: "Available in the workspace — use it in IMr.",
        color: "teal",
      }),
    onError: (e) =>
      notifications.show({ title: "Could not save", message: e.message, color: "red" }),
  });

  const chosen = rules.filter((_, i) => selected.has(i));

  return (
    <Stack maw={1240}>
      <div>
        <Title order={2}>LLM rule extraction — domain knowledge to Declare rules</Title>
        <Text c="dimmed" size="sm" maw={900}>
          Describe the process in natural language and refine the rules in conversation:
          the LLM proposes Declare constraints over the log's activities, a validation
          service checks every answer (and autonomously asks the LLM to fix errors), and
          each valid rule is scored on the log (thesis §5.2 / §8.3). Ask follow-ups to
          add, drop, or change rules — then save the selection and run IMr with it. The
          key and the conversation stay in this browser tab; nothing is stored.
        </Text>
      </div>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder>
            <Group justify="space-between" mb="xs">
              <Title order={5}>Configuration</Title>
              {started && (
                <Button size="compact-xs" variant="light" color="gray" onClick={reset}>
                  Start over
                </Button>
              )}
            </Group>
            <Stack gap="sm">
              <Select
                label="Provider"
                data={Object.keys(MODELS)}
                value={provider}
                disabled={started}
                onChange={(v) => {
                  const p = v ?? "OpenAI";
                  setProvider(p);
                  setModel(MODELS[p][0]);
                }}
              />
              <Select label="Model" data={MODELS[provider]} value={model} disabled={started}
                onChange={(v) => setModel(v ?? MODELS[provider][0])} />
              <PasswordInput
                label="API key"
                description="Sent with each request only — never stored, never logged."
                value={apiKey}
                onChange={(e) => setApiKey(e.currentTarget.value)}
                placeholder="sk-…"
              />
              <ArtifactSelect
                kind="event_log"
                label="Event log (L)"
                value={log}
                onChange={started ? () => undefined : setLog}
                description="The rules may only use this log's activities"
              />
              {started && (
                <Text size="xs" c="dimmed">
                  Provider, model, and log are fixed for the running conversation —
                  use “Start over” to change them.
                </Text>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack>
            <Card withBorder padding="sm">
              <ScrollArea h={340} type="auto" offsetScrollbars>
                <Stack gap="xs" p="xs">
                  {messages.length === 0 && (
                    <Text size="sm" c="dimmed" p="md">
                      Start by describing the process in your own words — e.g. “Every
                      application must be checked for completeness before eligibility is
                      assessed; cancelled cases must never receive an offer.” Then refine
                      in follow-ups: “drop the second rule”, “also forbid X after Y”…
                    </Text>
                  )}
                  {messages.map((m, i) =>
                    m.role === "user" ? (
                      <div key={i} className="chat-bubble chat-user">
                        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{m.text}</Text>
                      </div>
                    ) : (
                      <AssistantBubble key={i} msg={m} />
                    ),
                  )}
                  {loading && (
                    <div className="chat-bubble chat-assistant">
                      <Group gap="xs">
                        <Loader size="xs" />
                        <Text size="sm" c="dimmed">
                          Proposing rules — invalid answers are corrected automatically…
                        </Text>
                      </Group>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </Stack>
              </ScrollArea>
              <Group mt="xs" gap="xs" align="flex-end">
                <Textarea
                  style={{ flexGrow: 1 }}
                  placeholder={started ? "Refine the rules…" : "Describe the process…"}
                  autosize
                  minRows={2}
                  maxRows={6}
                  value={draft}
                  onChange={(e) => setDraft(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
                  }}
                />
                <Button onClick={send} disabled={!canSend} loading={loading}>
                  Send
                </Button>
              </Group>
              {!log || !apiKey ? (
                <Text size="xs" c="dimmed" mt={4}>
                  Select an event log and enter an API key to start the conversation.
                </Text>
              ) : (
                <Text size="xs" c="dimmed" mt={4}>
                  Ctrl+Enter to send.
                </Text>
              )}
            </Card>

            {rules.length > 0 && (
              <Card withBorder>
                <Group justify="space-between" mb="xs">
                  <Title order={5}>
                    Current rules ({selected.size} of {rules.length} selected)
                  </Title>
                  <Button
                    size="xs"
                    disabled={!chosen.length}
                    loading={saving}
                    onClick={() =>
                      void save({
                        variables: {
                          sessionId: sid,
                          name: `LLM rules (${provider}, ${chosen.length} selected)`,
                          rulesJson: JSON.stringify(chosen),
                        },
                      })
                    }
                  >
                    Save selection as R
                  </Button>
                </Group>
                <Alert color="gray" variant="light" p="xs" mb="xs">
                  <Text size="xs">
                    This is the rule set after the last answer — follow-up messages replace
                    it. Hover the column headers for what each measure means.
                  </Text>
                </Alert>
                <RulesTable
                  rules={rules}
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
              </Card>
            )}
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
