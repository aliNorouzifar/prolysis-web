import { gql, useQuery } from "@apollo/client";
import { Badge, Card, Group, Loader, Stack, Text, Title } from "@mantine/core";

const HEALTH = gql`
  query Health {
    health {
      bff
      dbOk
      backend {
        status
        service
      }
    }
  }
`;

interface HealthData {
  health: {
    bff: string;
    dbOk: boolean;
    backend: { status: string; service: string };
  };
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Group justify="space-between">
      <Text>{label}</Text>
      <Badge color={ok ? "teal" : "red"} variant="light">
        {ok ? "ok" : "unavailable"}
      </Badge>
    </Group>
  );
}

export function HealthPage() {
  const { data, loading, error } = useQuery<HealthData>(HEALTH, {
    pollInterval: 5000,
  });

  return (
    <Stack maw={520}>
      <Title order={2}>System health</Title>
      <Text c="dimmed">Live check across all tiers (polls every 5s).</Text>
      <Card withBorder>
        {loading && !data ? (
          <Group>
            <Loader size="sm" />
            <Text>Checking…</Text>
          </Group>
        ) : error ? (
          <Text c="red">BFF unreachable: {error.message}</Text>
        ) : data ? (
          <Stack gap="xs">
            <StatusBadge ok={data.health.bff === "ok"} label="Frontend → BFF" />
            <StatusBadge
              ok={data.health.backend.status === "ok"}
              label="BFF → Backend (REST)"
            />
            <StatusBadge ok={data.health.dbOk} label="BFF → Postgres" />
          </Stack>
        ) : null}
      </Card>
    </Stack>
  );
}
