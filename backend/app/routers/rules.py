"""Synchronous endpoints: LLM rule extraction, rule-set storage, X-PVI inspect.

LLM extraction is synchronous **by design**: async task params are persisted to
Postgres, and the user's API key must never be stored or logged. Here the key lives
only in the request scope.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import repo

router = APIRouter(tags=["rules"])

PROVIDERS = {
    "OpenAI": ["gpt-4o", "gpt-4o-mini"],
    "Google": ["gemini-1.5-pro", "gemini-1.5-flash"],
    "deepseek": ["deepseek-chat", "deepseek-reasoner"],
}


@router.get("/llm/providers")
def providers() -> dict:
    return PROVIDERS


class ExtractParams(BaseModel):
    session_id: str
    log_artifact: str
    description: str
    provider: str
    model_name: str
    api_key: str    # request-scoped only — never persisted, never logged
    history: list = []  # provider-format chat history — request-scoped, like the key


@router.post("/rules/extract-llm")
def extract_llm(p: ExtractParams) -> dict:
    """One turn of the extraction conversation. The chat history lives in the browser
    and is echoed back here per request — nothing about the conversation (or the key)
    is persisted; saving the final rule selection is an explicit action (POST /rules)."""
    from ..compute.rules import extract_llm_rules

    if p.provider not in PROVIDERS:
        raise HTTPException(400, f"provider must be one of {list(PROVIDERS)}")
    sid = repo.ensure_session(p.session_id)
    repo.log_activity("llm_extract:started", session_id=sid,
                      detail={"provider": p.provider, "model": p.model_name,
                              "turn": len(p.history) // 2 + 1})
    try:
        out = extract_llm_rules(p.log_artifact, p.description, p.provider,
                                p.api_key, p.model_name, history=p.history)
    except Exception as exc:
        repo.log_activity("llm_extract:failed", session_id=sid, level="error",
                          detail={"provider": p.provider, "error": str(exc)})
        raise HTTPException(502, f"LLM extraction failed: {exc}") from exc

    repo.log_activity("llm_extract:succeeded", session_id=sid,
                      detail={"n_rules": len(out["rules"]), "fixes": out["fixes"]})
    return {"rules": out["rules"], "text": out["text"], "fixes": out["fixes"],
            "history": out["history"]}


class ScoreRulesParams(BaseModel):
    session_id: str
    log_artifact: str
    rules: list


@router.post("/rules/score")
def score_rules(p: ScoreRulesParams) -> dict:
    """Validate + score manually composed rules with support/confidence on a log
    (synchronous — scoring takes seconds even on real-life logs)."""
    from ..compute.rules import score_rules as _score

    sid = repo.ensure_session(p.session_id)
    try:
        out = _score(p.log_artifact, p.rules)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    repo.log_activity("rules:scored", session_id=sid,
                      detail={"artifact_id": p.log_artifact, "n_rules": len(p.rules)})
    return out


class SaveRulesParams(BaseModel):
    session_id: str
    name: str
    rules: list


@router.post("/rules")
def save_rules(p: SaveRulesParams) -> dict:
    """Store a (possibly user-curated) rule selection as a rule-set artifact."""
    sid = repo.ensure_session(p.session_id)
    aid = repo.create_artifact(sid, "rule_set", p.name, source="user",
                               meta={"n_rules": len(p.rules)})
    repo.create_rule_set(aid, p.rules)
    repo.log_activity("rules:saved", session_id=sid,
                      detail={"artifact_id": aid, "n_rules": len(p.rules)})
    return {"artifact_id": aid, "n_rules": len(p.rules)}


class InspectParams(BaseModel):
    session_id: str
    log_artifact: str


@router.post("/xpvi/inspect")
def xpvi_inspect(p: InspectParams) -> dict:
    """Import a log for X-PVI; return case count + numeric indicator columns."""
    from ..compute.xpvi import inspect_log

    sid = repo.ensure_session(p.session_id)
    try:
        out = inspect_log(sid, p.log_artifact)
    except Exception as exc:
        raise HTTPException(422, f"Could not inspect log: {exc}") from exc
    repo.log_activity("xpvi:inspected", session_id=sid,
                      detail={"artifact_id": p.log_artifact, **out})
    return out


class ExplainNlParams(BaseModel):
    session_id: str
    cluster: int
    segment: int


@router.post("/xpvi/explain-nl")
def xpvi_explain_nl(p: ExplainNlParams) -> dict:
    """Natural-language segment explanation (fast; reads this session's exported
    constraint statistics)."""
    from ..compute.xpvi import explain_nl

    try:
        out = explain_nl(p.session_id, p.cluster, p.segment)
    except Exception as exc:
        raise HTTPException(
            422, f"Explanation unavailable — run the explainability step first ({exc})",
        ) from exc
    repo.log_activity("xpvi:explained_nl", session_id=p.session_id,
                      detail={"cluster": p.cluster, "segment": p.segment})
    return out


@router.get("/activity")
def activity(session_id: Optional[str] = None, limit: int = 200) -> list[dict]:
    return repo.list_activity(session_id, min(limit, 500))
