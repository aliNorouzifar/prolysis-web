-- +goose Up
-- +goose StatementBegin

-- X-PVI intermediate tables. prolysis' import step produces a KPI-sorted case table and
-- an event table (formerly CSVs re-read at export time); persisting them here lets the
-- segment export run as a SQL join and makes the tables queryable/debuggable.
CREATE TABLE xpvi_cases (
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    row_idx    integer NOT NULL,          -- positional label in prolysis' case table;
                                          -- segment id sets reference these positions
    case_id    text NOT NULL,
    attrs      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- KPIs + case attributes
    PRIMARY KEY (session_id, row_idx)
);
CREATE INDEX xpvi_cases_case_idx ON xpvi_cases (session_id, case_id);

CREATE TABLE xpvi_events (
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq        integer NOT NULL,          -- original event order in the log
    case_id    text NOT NULL,
    activity   text NOT NULL,
    ts         text,                      -- timestamp as recorded (parsed on export)
    PRIMARY KEY (session_id, seq)
);
CREATE INDEX xpvi_events_case_idx ON xpvi_events (session_id, case_id, seq);

-- Discriminative learning phase-1 output / phase-2 input (formerly X.csv + y.csv on the
-- worker's local disk, which coupled both phases to one container's filesystem).
-- Note: the same trace variant may occur in BOTH logs (desirable and undesirable),
-- so the variant string cannot be a key on its own.
CREATE TABLE discriminative_features (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id    uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    trace_variant text NOT NULL,          -- "<A,B,...>" variant key
    label         boolean NOT NULL,       -- true = desirable (L+)
    features      jsonb NOT NULL          -- {declare feature -> 0/1}
);
CREATE INDEX discriminative_features_session_idx
    ON discriminative_features (session_id, label);

-- Small per-session binary/JSON state: fitted models (pickle), feature column order, ...
CREATE TABLE session_blobs (
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    key        text NOT NULL,
    content    bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, key)
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS session_blobs;
DROP TABLE IF EXISTS discriminative_features;
DROP TABLE IF EXISTS xpvi_events;
DROP TABLE IF EXISTS xpvi_cases;
-- +goose StatementEnd
