import { gql, useMutation, useQuery } from "@apollo/client";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ARTIFACTS, KIND_COLORS, KIND_LABELS, type Artifact } from "../lib/artifacts";
import { sessionId } from "../lib/session";
import { UploadCard } from "../components/UploadCard";

const DELETE = gql`
  mutation DeleteArtifact($id: String!) {
    deleteArtifact(id: $id)
  }
`;

const SET_KIND = gql`
  mutation SetKind($id: String!, $kind: String!) {
    setArtifactKind(id: $id, kind: $kind)
  }
`;

const LOG_KINDS = ["event_log", "desirable_log", "undesirable_log"];

export function WorkspacePage() {
  const sid = sessionId();
  const { data, refetch } = useQuery<{ artifacts: Artifact[] }>(ARTIFACTS, {
    variables: { sessionId: sid },
    pollInterval: 4000,
  });
  const [del] = useMutation(DELETE, { onCompleted: () => void refetch() });
  const [setKind] = useMutation(SET_KIND, {
    onCompleted: () => void refetch(),
    onError: (e) => notifications.show({ title: "Could not re-label", message: e.message, color: "red" }),
  });

  const items = data?.artifacts ?? [];

  return (
    <Stack maw={1080}>
      <div>
        <Title order={2}>Session workspace</Title>
        <Text c="dimmed" size="sm">
          Every tool publishes its outputs here and consumes the others' — the pipeline of the
          thesis framework made concrete. Logs can be re-labelled (e.g. mark an X-PVI segment
          as L+ or L−).
        </Text>
      </div>

      <UploadCard onUploaded={() => void refetch()} />

      <Card withBorder padding="xs">
        {items.length === 0 ? (
          <Text c="dimmed" size="sm" p="sm">
            Nothing here yet — upload a log above or load the sample data from the home page.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Kind</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Source</Table.Th>
                <Table.Th>Info</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th w={110} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((a) => {
                const meta = JSON.parse(a.metaJson || "{}") as Record<string, unknown>;
                const info = [
                  meta.num_traces != null ? `${meta.num_traces} traces` : null,
                  meta.n_rules != null ? `${meta.n_rules} rules` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <Table.Tr key={a.id}>
                    <Table.Td>
                      <Badge color={KIND_COLORS[a.kind]} variant="light">
                        {KIND_LABELS[a.kind] ?? a.kind}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{a.name}</Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {a.source}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {info || "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {new Date(a.createdAt).toLocaleString()}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end">
                        {LOG_KINDS.includes(a.kind) && (
                          <Menu withinPortal position="bottom-end">
                            <Menu.Target>
                              <Button size="compact-xs" variant="subtle">
                                mark as…
                              </Button>
                            </Menu.Target>
                            <Menu.Dropdown>
                              {LOG_KINDS.filter((k) => k !== a.kind).map((k) => (
                                <Menu.Item
                                  key={k}
                                  onClick={() => void setKind({ variables: { id: a.id, kind: k } })}
                                >
                                  {KIND_LABELS[k]}
                                </Menu.Item>
                              ))}
                            </Menu.Dropdown>
                          </Menu>
                        )}
                        <Tooltip label="Delete">
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() => void del({ variables: { id: a.id } })}
                            aria-label="delete artifact"
                          >
                            ✕
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
