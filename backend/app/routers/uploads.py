"""Event-log upload (XES or CSV) → stored artifact + event_log row."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .. import repo
from ..logs import ingest

router = APIRouter(tags=["uploads"])

_LOG_KINDS = {"event_log", "desirable_log", "undesirable_log"}


@router.post("/uploads")
async def upload_log(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    kind: str = Form("event_log"),
    name: Optional[str] = Form(None),
    # CSV column mapping (optional; auto-guessed when omitted)
    case_column: Optional[str] = Form(None),
    activity_column: Optional[str] = Form(None),
    timestamp_column: Optional[str] = Form(None),
) -> dict:
    if kind not in _LOG_KINDS:
        raise HTTPException(400, f"kind must be one of {sorted(_LOG_KINDS)}")
    sid = repo.ensure_session(session_id)
    raw = await file.read()
    filename = file.filename or "upload.xes"

    csv_mapping = None
    if case_column or activity_column or timestamp_column:
        csv_mapping = {"case_id": case_column, "activity": activity_column,
                       "timestamp": timestamp_column}
        csv_mapping = {k: v for k, v in csv_mapping.items() if v}

    try:
        xes_bytes, stats = ingest(raw, filename, csv_mapping)
    except Exception as exc:
        repo.log_activity("upload:failed", session_id=sid, level="error",
                          detail={"filename": filename, "error": str(exc)})
        raise HTTPException(422, f"Could not parse '{filename}': {exc}") from exc

    aid = repo.create_artifact(sid, kind, name or filename, source="upload",
                               meta={"filename": filename,
                                     "num_traces": stats["num_traces"],
                                     "num_events": stats["num_events"]})
    repo.create_event_log(aid, filename, xes_bytes, stats)
    repo.log_activity("upload:stored", session_id=sid,
                      detail={"artifact_id": aid, "kind": kind, "filename": filename,
                              "num_traces": stats["num_traces"]})
    return {"session_id": sid, "artifact_id": aid, "kind": kind,
            "num_traces": stats["num_traces"], "num_events": stats["num_events"],
            "num_variants": stats["num_variants"], "activities": stats["activities"]}
