import { Alert, Badge, Group, Progress, Text } from "@mantine/core";
import type { Job } from "../lib/useJob";

const COLORS: Record<string, string> = {
  queued: "gray",
  running: "indigo",
  succeeded: "teal",
  failed: "red",
};

/** Live status strip for an async compute job. */
export function JobStatus({ job }: { job: Job | null }) {
  if (!job) return null;
  return (
    <div>
      <Group gap="xs" mb={4}>
        <Badge color={COLORS[job.status]} variant="light">
          {job.status}
        </Badge>
        {job.message && job.status !== "failed" && (
          <Text size="sm" c="dimmed">
            {job.message}
          </Text>
        )}
      </Group>
      {(job.status === "queued" || job.status === "running") && (
        <Progress value={Math.max(job.progress * 100, 8)} animated size="sm" />
      )}
      {job.status === "failed" && (
        <Alert color="red" title="Job failed" mt={4}>
          {job.error ?? "Unknown error"}
        </Alert>
      )}
    </div>
  );
}
