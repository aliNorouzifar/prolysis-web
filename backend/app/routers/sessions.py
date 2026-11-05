"""Session + sample-data endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from .. import repo

router = APIRouter(tags=["sessions"])


@router.post("/sessions")
def create_session() -> dict:
    sid = repo.create_session()
    repo.log_activity("session:created", session_id=sid)
    return {"id": sid}


@router.post("/sessions/{session_id}/sample-data")
def load_sample_data(session_id: str) -> dict:
    """Generate the synthetic guided-tour logs (L+, L−, L) into this session."""
    from ..compute.sample import generate

    sid = repo.ensure_session(session_id)
    out = generate(sid)
    repo.log_activity("sample_data:loaded", session_id=sid,
                      detail={"artifacts": [a["artifact_id"] for a in out["artifacts"]]})
    return {"session_id": sid, **out}
