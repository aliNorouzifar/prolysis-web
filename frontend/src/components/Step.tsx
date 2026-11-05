import { Badge, Card, Grid, Group, Text, ThemeIcon, Title } from "@mantine/core";
import type { ReactNode } from "react";

export type StepStatus = "locked" | "ready" | "running" | "done" | "failed";

const STATUS: Record<StepStatus, { label: string; color: string }> = {
  locked: { label: "waiting for previous step", color: "gray" },
  ready: { label: "ready", color: "indigo" },
  running: { label: "running…", color: "yellow" },
  done: { label: "done", color: "teal" },
  failed: { label: "failed", color: "red" },
};

/**
 * One numbered stage of a tool's storyline. The stage's controls and the result they
 * produce live in the SAME card — configuration on the left, its outcome on the right —
 * so there is never any doubt which settings produced which visualization.
 */
export function Step({
  n,
  title,
  description,
  status = "ready",
  controls,
  children,
  resultHint,
  resultHeight,
}: {
  n: number;
  title: string;
  description?: string;
  status?: StepStatus;
  /** Left column: the parameters/buttons of this stage. Omit for result-only stages. */
  controls?: ReactNode;
  /** Right column: the stage's own result. */
  children?: ReactNode;
  /** What will appear here once the stage runs (shown while empty). */
  resultHint?: string;
  /** Maximum height of the result region; shorter results shrink the card, longer ones scroll. */
  resultHeight?: number | string;
}) {
  const s = STATUS[status];
  const dimmed = status === "locked";
  return (
    <Card withBorder padding="md" opacity={dimmed ? 0.55 : 1}>
      <Group justify="space-between" mb={description ? 2 : "sm"} wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon
            radius="xl"
            size={30}
            variant={status === "done" ? "filled" : "light"}
            color={status === "done" ? "teal" : "indigo"}
          >
            {status === "done" ? "✓" : n}
          </ThemeIcon>
          <Title order={5}>{title}</Title>
        </Group>
        <Badge variant="light" color={s.color}>
          {s.label}
        </Badge>
      </Group>
      {description && (
        <Text size="sm" c="dimmed" mb="sm" ml={42}>
          {description}
        </Text>
      )}
      {controls ? (
        <Grid gutter="md">
          <Grid.Col span={{ base: 12, md: 4 }}>{controls}</Grid.Col>
          <Grid.Col span={{ base: 12, md: 8 }}>
            {children ? (
              resultHeight ? (
                <div style={{ maxHeight: resultHeight, overflowY: "auto" }}>{children}</div>
              ) : (
                children
              )
            ) : (
              <Card
                padding="md"
                radius="md"
                style={{
                  background: "var(--mantine-color-default-hover)",
                  height: 120,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Text size="sm" c="dimmed">
                  {resultHint ?? "The result of this step appears here."}
                </Text>
              </Card>
            )}
          </Grid.Col>
        </Grid>
      ) : (
        children
      )}
    </Card>
  );
}
