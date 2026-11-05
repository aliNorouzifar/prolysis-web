// Typed client for the Python backend's REST API (mutations/compute only — reads go
// straight to Postgres via Kysely). Later replaceable by an OpenAPI-generated client.
import { env } from "./env";

export interface BackendHealth {
  status: string;
  service: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${env.backendUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* keep status code */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export const backend = {
  health: async (): Promise<BackendHealth> => {
    const res = await fetch(`${env.backendUrl}/health`);
    if (!res.ok) throw new Error(`backend /health -> ${res.status}`);
    return (await res.json()) as BackendHealth;
  },

  createSession: () => post<{ id: string }>("/sessions", {}),

  loadSampleData: (sessionId: string) =>
    post<{ session_id: string; artifacts: unknown[]; activities: string[] }>(
      `/sessions/${sessionId}/sample-data`,
      {},
    ),

  deleteArtifact: async (artifactId: string) => {
    const res = await fetch(`${env.backendUrl}/artifacts/${artifactId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`delete -> ${res.status}`);
    return (await res.json()) as { deleted: string };
  },

  setArtifactKind: async (artifactId: string, kind: string) => {
    const res = await fetch(`${env.backendUrl}/artifacts/${artifactId}/kind`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    if (!res.ok) throw new Error(`set kind -> ${res.status}`);
    return (await res.json()) as { artifact_id: string; kind: string };
  },

  // --- job starters -----------------------------------------------------------
  startImbi: (p: {
    session_id: string;
    lp_artifact: string;
    lm_artifact: string;
    sup: number;
    ratio: number;
  }) => post<{ job_id: string }>("/jobs/discover-imbi", p),

  startImr: (p: {
    session_id: string;
    log_artifact: string;
    sup: number;
    rules: unknown[];
    activities: string[];
  }) => post<{ job_id: string }>("/jobs/discover-imr", p),

  startImf: (p: {
    session_id: string;
    log_artifact: string;
    noise_threshold: number;
  }) => post<{ job_id: string }>("/jobs/discover-imf", p),

  startEvaluateModels: (p: {
    session_id: string;
    model_artifacts: string[];
    lp_artifact: string;
    lm_artifact: string;
  }) => post<{ job_id: string }>("/jobs/evaluate-models", p),

  startXpviEmd: (p: {
    session_id: string;
    log_artifact: string;
    n_bin: number;
    w: number;
    kpi: string;
  }) => post<{ job_id: string }>("/jobs/xpvi-emd", p),

  startXpviSegment: (p: {
    session_id: string;
    n_bin: number;
    w: number;
    kpi: string;
    signal_threshold: number;
    log_artifact: string | null;
  }) => post<{ job_id: string }>("/jobs/xpvi-segment", p),

  startXpviExport: (p: { session_id: string }) =>
    post<{ job_id: string }>("/jobs/xpvi-export", p),

  startXpviExplain: (p: {
    session_id: string;
    n_bin: number;
    w: number;
    kpi: string;
    theta_cvg: number;
    n_clusters: number;
    signal_threshold: number;
    log_artifact: string | null;
  }) => post<{ job_id: string }>("/jobs/xpvi-explain", p),

  xpviExplainNl: (p: { session_id: string; cluster: number; segment: number }) =>
    post<{ more: unknown[]; less: unknown[] }>("/xpvi/explain-nl", p),

  startDiscriminate: (p: {
    session_id: string;
    lp_artifact: string;
    lm_artifact: string;
  }) => post<{ job_id: string }>("/jobs/discriminate", p),

  startCluster: (p: { session_id: string; n_clusters: number; Z: unknown[] }) =>
    post<{ job_id: string }>("/jobs/cluster-rules", p),

  startDiscoverRules: (p: {
    session_id: string;
    log_artifact: string;
    support: number;
    confidence: number;
  }) => post<{ job_id: string }>("/jobs/discover-rules", p),

  // --- synchronous (request-scoped API key — never persisted) ------------------
  extractLlmRules: (p: {
    session_id: string;
    log_artifact: string;
    description: string;
    provider: string;
    model_name: string;
    api_key: string;
    history: unknown[];
  }) =>
    post<{
      rules: unknown[];
      text: string;
      fixes: number;
      history: unknown[];
    }>("/rules/extract-llm", p),

  saveRules: (p: { session_id: string; name: string; rules: unknown[] }) =>
    post<{ artifact_id: string; n_rules: number }>("/rules", p),

  scoreRules: (p: { session_id: string; log_artifact: string; rules: unknown[] }) =>
    post<{ rules: unknown[] }>("/rules/score", p),

  xpviInspect: (p: { session_id: string; log_artifact: string }) =>
    post<{ n_cases: number; columns: string[] }>("/xpvi/inspect", p),

  edgeTimes: (artifactId: string) =>
    post<{ edges: unknown[] }>(`/artifacts/${artifactId}/edge-times`, {}),

};
