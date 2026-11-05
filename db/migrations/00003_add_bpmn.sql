-- +goose Up
-- +goose StatementBegin
-- BPMN XML (with diagram-interchange layout) per discovered model, rendered client-side
-- by bpmn-js. The Petri net (dot/svg) remains the formal artifact.
ALTER TABLE models ADD COLUMN bpmn_xml text;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE models DROP COLUMN IF EXISTS bpmn_xml;
-- +goose StatementEnd
