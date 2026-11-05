import { gql, useQuery } from "@apollo/client";
import {
  Badge,
  Card,
  Code,
  Group,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useState } from "react";
import { sessionId } from "../lib/session";

const ACTIVITY = gql`
  query Activity($sessionId: String, $limit: Int) {
    activity(sessionId: $sessionId, limit: $limit) {
      id
      level
      source
      action
      detailJson
      createdAt
    }
  }
`;

interface Entry {
  id: number;
  level: string;
  source: string;
  action: string;
  detailJson: string;
  createdAt: string;
}

const LEVEL_COLORS: Record<string, string> = {
  debug: "gray",
  info: "blue",
  warn: "yellow",
  error: "red",
};

export function ActivityPage() {
  const [scope, setScope] = useState<"session" | "all">("session");
  const { data } = useQuery<{ activity: Entry[] }>(ACTIVITY, {
    variables: { sessionId: scope === "session" ? sessionId() : null, limit: 200 },
    pollInterval: 5000,
  });
  const entries = data?.activity ?? [];

  return (
    <Stack maw={1080}>
      <Group justify="space-between">
        <div>
          <Title order={2}>Activity log</Title>
          <Text c="dimmed" size="sm">
            Every action in the app — uploads, job starts, results, failures — recorded for
            debugging and monitoring.
          </Text>
        </div>
        <SegmentedControl
          value={scope}
          onChange={(v) => setScope(v as "session" | "all")}
          data={[
            { value: "session", label: "This session" },
            { value: "all", label: "All sessions" },
          ]}
        />
      </Group>

      <Card withBorder padding="xs">
        {entries.length === 0 ? (
          <Text c="dimmed" size="sm" p="sm">
            Nothing logged yet.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={90}>Level</Table.Th>
                <Table.Th w={90}>Source</Table.Th>
                <Table.Th>Action</Table.Th>
                <Table.Th>Detail</Table.Th>
                <Table.Th w={170}>Time</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>
                    <Badge color={LEVEL_COLORS[e.level] ?? "gray"} variant="light">
                      {e.level}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {e.source}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {e.action}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ maxWidth: 420 }}>
                    <Code block style={{ fontSize: 11, maxHeight: 60, overflow: "auto" }}>
                      {e.detailJson}
                    </Code>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {new Date(e.createdAt).toLocaleString()}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
