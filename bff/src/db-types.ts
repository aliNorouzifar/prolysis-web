// PLACEHOLDER — regenerate from the live (goose-migrated) schema with `npm run codegen`
// (kysely-codegen). Hand-maintained to match db/migrations/00001_init.sql until then.
import type { ColumnType, Generated } from "kysely";

type Json = unknown;
type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface SessionsTable {
  id: Generated<string>;
  created_at: Generated<Timestamp>;
  last_seen_at: Generated<Timestamp>;
}

export interface ArtifactsTable {
  id: Generated<string>;
  session_id: string;
  kind: string;
  name: string;
  source: Generated<string>;
  meta: Generated<Json>;
  created_at: Generated<Timestamp>;
}

export interface EventLogsTable {
  id: Generated<string>;
  artifact_id: string;
  filename: string | null;
  content: Buffer;
  num_traces: number | null;
  num_events: number | null;
  num_variants: number | null;
  activities: Json | null;
  variants: Json | null;
  created_at: Generated<Timestamp>;
}

export interface RuleSetsTable {
  id: Generated<string>;
  artifact_id: string;
  notation: Generated<string>;
  rules: Json;
  created_at: Generated<Timestamp>;
}

export interface ModelsTable {
  id: Generated<string>;
  artifact_id: string;
  net_kind: Generated<string>;
  tool: string | null;
  pnml: string | null;
  dot: string | null;
  svg: string | null;
  bpmn_xml: string | null;
  params: Generated<Json>;
  created_at: Generated<Timestamp>;
}

export interface EvaluationsTable {
  id: Generated<string>;
  model_id: string;
  metrics: Json;
  created_at: Generated<Timestamp>;
}

export interface JobsTable {
  id: Generated<string>;
  session_id: string | null;
  kind: string;
  status: Generated<string>;
  progress: Generated<number>;
  message: string | null;
  error: string | null;
  params: Generated<Json>;
  result: Json | null;
  procrastinate_job_id: number | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ActivityLogTable {
  id: Generated<number>;
  session_id: string | null;
  level: Generated<string>;
  source: Generated<string>;
  action: string;
  detail: Generated<Json>;
  created_at: Generated<Timestamp>;
}

export interface DB {
  sessions: SessionsTable;
  artifacts: ArtifactsTable;
  event_logs: EventLogsTable;
  rule_sets: RuleSetsTable;
  models: ModelsTable;
  evaluations: EvaluationsTable;
  jobs: JobsTable;
  activity_log: ActivityLogTable;
}
