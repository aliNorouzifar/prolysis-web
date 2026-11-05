"""Persistence layer — thin typed helpers over the goose-owned schema (SQLAlchemy Core).

No ORM models mirror the schema (goose is the single source of truth); tables are reflected
at runtime via ``db.table``. Every function is small and returns plain dicts/values so it is
safe to use from both FastAPI request handlers and the Procrastinate worker.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from sqlalchemy import insert, select, update

from . import db


# --- sessions --------------------------------------------------------------------

def create_session() -> str:
    t = db.table("sessions")
    with db.engine.begin() as conn:
        row = conn.execute(insert(t).returning(t.c.id)).one()
    return str(row.id)


def session_exists(session_id: str) -> bool:
    t = db.table("sessions")
    with db.engine.connect() as conn:
        return conn.execute(select(t.c.id).where(t.c.id == session_id)).first() is not None


def ensure_session(session_id: Optional[str]) -> str:
    """Return a valid session id.

    Session ids are client-generated (held in the browser's localStorage). If the id is
    a well-formed UUID we **upsert** it, so a returning browser keeps its workspace even
    against a freshly migrated database; otherwise a new session is created.
    """
    if session_id:
        try:
            uuid.UUID(session_id)
        except ValueError:
            return create_session()
        if session_exists(session_id):
            return session_id
        t = db.table("sessions")
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        with db.engine.begin() as conn:
            conn.execute(pg_insert(t).values(id=session_id)
                         .on_conflict_do_nothing(index_elements=["id"]))
        return session_id
    return create_session()


# --- artifacts -------------------------------------------------------------------

def create_artifact(session_id: str, kind: str, name: str, source: str,
                    meta: Optional[dict] = None) -> str:
    t = db.table("artifacts")
    with db.engine.begin() as conn:
        row = conn.execute(
            insert(t).values(
                session_id=session_id, kind=kind, name=name, source=source,
                meta=meta or {},
            ).returning(t.c.id)
        ).one()
    return str(row.id)


def list_artifacts(session_id: str, kind: Optional[str] = None) -> list[dict]:
    t = db.table("artifacts")
    q = select(t).where(t.c.session_id == session_id)
    if kind:
        q = q.where(t.c.kind == kind)
    q = q.order_by(t.c.created_at.desc())
    with db.engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(q)]


def get_artifact(artifact_id: str) -> Optional[dict]:
    t = db.table("artifacts")
    with db.engine.connect() as conn:
        r = conn.execute(select(t).where(t.c.id == artifact_id)).first()
    return dict(r._mapping) if r else None


def delete_artifact(artifact_id: str) -> None:
    from sqlalchemy import delete
    t = db.table("artifacts")
    with db.engine.begin() as conn:
        conn.execute(delete(t).where(t.c.id == artifact_id))


def update_artifact_kind(artifact_id: str, kind: str) -> None:
    """Re-label a log artifact (e.g. mark an X-PVI segment as L+ or L−)."""
    t = db.table("artifacts")
    with db.engine.begin() as conn:
        conn.execute(update(t).where(t.c.id == artifact_id).values(kind=kind))


# --- event logs ------------------------------------------------------------------

def create_event_log(artifact_id: str, filename: str, content: bytes,
                     stats: dict) -> str:
    t = db.table("event_logs")
    with db.engine.begin() as conn:
        row = conn.execute(
            insert(t).values(
                artifact_id=artifact_id, filename=filename, content=content,
                num_traces=stats.get("num_traces"),
                num_events=stats.get("num_events"),
                num_variants=stats.get("num_variants"),
                activities=stats.get("activities"),
                variants=stats.get("variants"),
            ).returning(t.c.id)
        ).one()
    return str(row.id)


def get_event_log_by_artifact(artifact_id: str) -> Optional[dict]:
    t = db.table("event_logs")
    with db.engine.connect() as conn:
        r = conn.execute(select(t).where(t.c.artifact_id == artifact_id)).first()
    return dict(r._mapping) if r else None


# --- rule sets -------------------------------------------------------------------

def create_rule_set(artifact_id: str, rules: list, notation: str = "declare") -> str:
    t = db.table("rule_sets")
    with db.engine.begin() as conn:
        row = conn.execute(
            insert(t).values(artifact_id=artifact_id, rules=rules, notation=notation)
            .returning(t.c.id)
        ).one()
    return str(row.id)


def get_rule_set_by_artifact(artifact_id: str) -> Optional[dict]:
    t = db.table("rule_sets")
    with db.engine.connect() as conn:
        r = conn.execute(select(t).where(t.c.artifact_id == artifact_id)).first()
    return dict(r._mapping) if r else None


# --- models + evaluations --------------------------------------------------------

def create_model(artifact_id: str, tool: str, dot: str, svg: str,
                 params: dict, pnml: Optional[str] = None,
                 bpmn_xml: Optional[str] = None) -> str:
    t = db.table("models")
    with db.engine.begin() as conn:
        row = conn.execute(
            insert(t).values(
                artifact_id=artifact_id, tool=tool, dot=dot, svg=svg,
                params=params, pnml=pnml, bpmn_xml=bpmn_xml,
            ).returning(t.c.id)
        ).one()
    return str(row.id)


def get_model_by_artifact(artifact_id: str) -> Optional[dict]:
    t = db.table("models")
    with db.engine.connect() as conn:
        r = conn.execute(select(t).where(t.c.artifact_id == artifact_id)).first()
    return dict(r._mapping) if r else None


def create_evaluation(model_id: str, metrics: dict) -> str:
    t = db.table("evaluations")
    with db.engine.begin() as conn:
        row = conn.execute(
            insert(t).values(model_id=model_id, metrics=metrics).returning(t.c.id)
        ).one()
    return str(row.id)


# --- jobs ------------------------------------------------------------------------

def create_job(session_id: str, kind: str, params: Optional[dict] = None) -> str:
    t = db.table("jobs")
    with db.engine.begin() as conn:
        row = conn.execute(
            insert(t).values(session_id=session_id, kind=kind, status="queued",
                             params=params or {}).returning(t.c.id)
        ).one()
    return str(row.id)


def update_job(job_id: str, **fields: Any) -> None:
    t = db.table("jobs")
    with db.engine.begin() as conn:
        conn.execute(update(t).where(t.c.id == job_id).values(**fields))


def get_job(job_id: str) -> Optional[dict]:
    t = db.table("jobs")
    with db.engine.connect() as conn:
        r = conn.execute(select(t).where(t.c.id == job_id)).first()
    return dict(r._mapping) if r else None


# --- X-PVI intermediate tables (SQL-backed case/event tables) ---------------------

def replace_xpvi_tables(session_id: str, cases: list[dict], events: list[dict]) -> None:
    """Persist prolysis' case/event tables for a session (replacing earlier runs).

    ``cases``: [{row_idx, case_id, attrs}], ``events``: [{seq, case_id, activity, ts}].
    Inserted in chunks — research-scale logs, no COPY machinery needed.
    """
    from sqlalchemy import delete

    tc, te = db.table("xpvi_cases"), db.table("xpvi_events")
    with db.engine.begin() as conn:
        conn.execute(delete(tc).where(tc.c.session_id == session_id))
        conn.execute(delete(te).where(te.c.session_id == session_id))
        for chunk_start in range(0, len(cases), 1000):
            conn.execute(insert(tc), [
                {"session_id": session_id, **row}
                for row in cases[chunk_start:chunk_start + 1000]
            ])
        for chunk_start in range(0, len(events), 5000):
            conn.execute(insert(te), [
                {"session_id": session_id, **row}
                for row in events[chunk_start:chunk_start + 5000]
            ])


def xpvi_all_cases(session_id: str) -> list[dict]:
    t = db.table("xpvi_cases")
    with db.engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(
            select(t.c.row_idx, t.c.case_id, t.c.attrs)
            .where(t.c.session_id == session_id).order_by(t.c.row_idx)
        )]


def xpvi_all_events(session_id: str) -> list[dict]:
    t = db.table("xpvi_events")
    with db.engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(
            select(t.c.case_id, t.c.activity, t.c.ts)
            .where(t.c.session_id == session_id).order_by(t.c.seq)
        )]


def xpvi_segment_events(session_id: str, row_ids: list[int]) -> list[dict]:
    """The SQL that replaces the CSV-based segment export: select the segment's cases by
    positional label, join their events, in original event order."""
    tc, te = db.table("xpvi_cases"), db.table("xpvi_events")
    q = (
        select(te.c.case_id, te.c.activity, te.c.ts)
        .where(te.c.session_id == session_id)
        .where(te.c.case_id.in_(
            select(tc.c.case_id)
            .where(tc.c.session_id == session_id)
            .where(tc.c.row_idx.in_([int(i) for i in row_ids]))
        ))
        .order_by(te.c.seq)
    )
    with db.engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(q)]


# --- discriminative feature matrix + session blobs ---------------------------------

def replace_disc_features(session_id: str, rows: list[dict]) -> None:
    """rows: [{trace_variant, label, features}] — phase-1 output, phase-2 input."""
    from sqlalchemy import delete

    t = db.table("discriminative_features")
    with db.engine.begin() as conn:
        conn.execute(delete(t).where(t.c.session_id == session_id))
        for chunk_start in range(0, len(rows), 1000):
            conn.execute(insert(t), [
                {"session_id": session_id, **row}
                for row in rows[chunk_start:chunk_start + 1000]
            ])


def load_disc_features(session_id: str) -> list[dict]:
    t = db.table("discriminative_features")
    with db.engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(
            select(t.c.trace_variant, t.c.label, t.c.features)
            .where(t.c.session_id == session_id)
        )]


def save_blob(session_id: str, key: str, content: bytes) -> None:
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    t = db.table("session_blobs")
    with db.engine.begin() as conn:
        stmt = pg_insert(t).values(session_id=session_id, key=key, content=content)
        conn.execute(stmt.on_conflict_do_update(
            index_elements=["session_id", "key"],
            set_={"content": stmt.excluded.content},
        ))


def load_blob(session_id: str, key: str) -> Optional[bytes]:
    t = db.table("session_blobs")
    with db.engine.connect() as conn:
        r = conn.execute(
            select(t.c.content).where(t.c.session_id == session_id, t.c.key == key)
        ).first()
    return bytes(r.content) if r else None


# --- activity log ----------------------------------------------------------------

def log_activity(action: str, *, session_id: Optional[str] = None, level: str = "info",
                 source: str = "backend", detail: Optional[dict] = None) -> None:
    t = db.table("activity_log")
    try:
        with db.engine.begin() as conn:
            conn.execute(insert(t).values(
                session_id=session_id, level=level, source=source, action=action,
                detail=_jsonable(detail or {}),
            ))
    except Exception:
        # Logging must never break the caller.
        pass


def list_activity(session_id: Optional[str] = None, limit: int = 200) -> list[dict]:
    t = db.table("activity_log")
    q = select(t)
    if session_id:
        q = q.where(t.c.session_id == session_id)
    q = q.order_by(t.c.created_at.desc()).limit(limit)
    with db.engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(q)]


def _jsonable(d: dict) -> dict:
    """Best-effort coercion so detail payloads always serialize to jsonb."""
    return json.loads(json.dumps(d, default=str))


jsonable = _jsonable  # public alias (used by tasks to sanitize job results)
