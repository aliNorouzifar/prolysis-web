-- +goose Up
-- +goose StatementBegin

-- Generic updated_at trigger helper.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A browser session. Artifacts and jobs belong to a session (no user accounts yet).
CREATE TABLE sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- The pipeline artifact index (mirrors the old in-memory Artifact store). One row per
-- named artifact; the heavy payload lives in the kind-specific tables below.
CREATE TABLE artifacts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN
                   ('event_log','desirable_log','undesirable_log','rule_set','model')),
    name       text NOT NULL,
    source     text NOT NULL DEFAULT 'upload',   -- which tool/page produced it
    meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_session_kind_idx ON artifacts (session_id, kind);

-- Event-log payload (kind = event_log | desirable_log | undesirable_log).
CREATE TABLE event_logs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_id  uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    filename     text,
    content      bytea NOT NULL,          -- raw XES/CSV bytes
    num_traces   integer,
    num_events   integer,
    num_variants integer,
    activities   jsonb,                   -- distinct activity names
    variants     jsonb,                   -- [{ "trace": [...], "count": n }, ...]
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_logs_artifact_idx ON event_logs (artifact_id);

-- Declare rule-set payload (kind = rule_set).
CREATE TABLE rule_sets (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    notation    text NOT NULL DEFAULT 'declare',
    rules       jsonb NOT NULL,           -- list of Declare constraints
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rule_sets_artifact_idx ON rule_sets (artifact_id);

-- Discovered process-model payload (kind = model).
CREATE TABLE models (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    net_kind    text NOT NULL DEFAULT 'petri_net',
    tool        text,                     -- 'imbi' | 'imr' | ...
    pnml        text,
    dot         text,
    svg         text,
    params      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- discovery params (sup, ratio, ...)
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX models_artifact_idx ON models (artifact_id);

-- Discriminative evaluation metrics for a model (thesis Ch. 4: a-fit, t-fit, acc, F1).
CREATE TABLE evaluations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id   uuid NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    metrics    jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evaluations_model_idx ON evaluations (model_id);

-- Async-job status surface queried by the BFF/frontend. Distinct from Procrastinate's
-- internal queue tables (Procrastinate applies its own schema separately); this table is
-- the app-facing view the API updates as a job progresses.
CREATE TABLE jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid REFERENCES sessions(id) ON DELETE CASCADE,
    kind                text NOT NULL,    -- 'discover_imbi' | 'derive_desirability' | ...
    status              text NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued','running','succeeded','failed')),
    progress            real NOT NULL DEFAULT 0,
    message             text,
    error               text,
    params              jsonb NOT NULL DEFAULT '{}'::jsonb,
    result              jsonb,            -- e.g. { "artifact_id": "...", "model_id": "..." }
    procrastinate_job_id bigint,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_session_status_idx ON jobs (session_id, status);
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Activity log — an append-only record of actions across the app, for debugging and
-- monitoring. High-volume, so a bigint identity key rather than a uuid.
CREATE TABLE activity_log (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
    level      text NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error')),
    source     text NOT NULL DEFAULT 'backend',   -- 'backend' | 'bff' | 'worker'
    action     text NOT NULL,                     -- e.g. 'upload_event_log', 'discover_imbi'
    detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_session_idx ON activity_log (session_id, created_at DESC);
CREATE INDEX activity_log_action_idx ON activity_log (action, created_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS activity_log;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS evaluations;
DROP TABLE IF EXISTS models;
DROP TABLE IF EXISTS rule_sets;
DROP TABLE IF EXISTS event_logs;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS sessions;
DROP FUNCTION IF EXISTS set_updated_at();
-- +goose StatementEnd
