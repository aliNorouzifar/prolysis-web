import { gql, useQuery } from "@apollo/client";
import { useEffect } from "react";

export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  message: string | null;
  error: string | null;
  resultJson: string | null;
}

const JOB = gql`
  query Job($id: String!) {
    job(id: $id) {
      id
      kind
      status
      progress
      message
      error
      resultJson
    }
  }
`;

/** Poll a job until it reaches a terminal state. */
export function useJob(jobId: string | null): {
  job: Job | null;
  result: unknown;
  running: boolean;
} {
  const { data, stopPolling, startPolling } = useQuery<{ job: Job | null }>(JOB, {
    variables: { id: jobId ?? "" },
    skip: !jobId,
    pollInterval: 1500,
    fetchPolicy: "network-only",
  });

  const job = data?.job ?? null;
  const terminal = job?.status === "succeeded" || job?.status === "failed";

  useEffect(() => {
    if (!jobId) return;
    if (terminal) stopPolling();
    else startPolling(1500);
  }, [jobId, terminal, startPolling, stopPolling]);

  const result =
    job?.status === "succeeded" && job.resultJson ? JSON.parse(job.resultJson) : null;
  return { job, result, running: !!jobId && !terminal };
}
