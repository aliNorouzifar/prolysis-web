"""Artifact endpoints — list/detail/delete/re-kind, with kind-specific payloads."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import repo

router = APIRouter(prefix="/artifacts", tags=["artifacts"])

_LOG_KINDS = {"event_log", "desirable_log", "undesirable_log"}


@router.get("")
def list_artifacts(session_id: str, kind: Optional[str] = None) -> list[dict]:
    items = repo.list_artifacts(session_id, kind)
    return [{k: v for k, v in a.items()} for a in items]


@router.get("/{artifact_id}")
def get_artifact(artifact_id: str) -> dict:
    a = repo.get_artifact(artifact_id)
    if not a:
        raise HTTPException(404, "artifact not found")
    out = dict(a)
    if a["kind"] in _LOG_KINDS:
        ev = repo.get_event_log_by_artifact(artifact_id)
        if ev:
            out["event_log"] = {k: ev[k] for k in
                                ("filename", "num_traces", "num_events",
                                 "num_variants", "activities", "variants")}
    elif a["kind"] == "rule_set":
        rs = repo.get_rule_set_by_artifact(artifact_id)
        if rs:
            out["rule_set"] = {"notation": rs["notation"], "rules": rs["rules"]}
    elif a["kind"] == "model":
        m = repo.get_model_by_artifact(artifact_id)
        if m:
            out["model"] = {k: m[k] for k in ("tool", "dot", "svg", "params")}
    return out


@router.delete("/{artifact_id}")
def delete_artifact(artifact_id: str) -> dict:
    a = repo.get_artifact(artifact_id)
    if not a:
        raise HTTPException(404, "artifact not found")
    repo.delete_artifact(artifact_id)
    repo.log_activity("artifact:deleted", session_id=str(a["session_id"]),
                      detail={"artifact_id": artifact_id, "name": a["name"]})
    return {"deleted": artifact_id}


@router.post("/{artifact_id}/edge-times")
def edge_times(artifact_id: str) -> dict:
    """Per directly-follows edge: mean and median transition time (seconds), computed
    over all traces of the stored log. Cached per artifact in the database."""
    import json

    a = repo.get_artifact(artifact_id)
    if not a or a["kind"] not in _LOG_KINDS:
        raise HTTPException(404, "log artifact not found")
    session_id = str(a["session_id"])
    cache_key = f"edge_times_{artifact_id}"
    cached = repo.load_blob(session_id, cache_key)
    if cached is not None:
        return {"edges": json.loads(cached.decode("utf-8"))}

    import pandas as pd
    import pm4py

    from ..compute.base import materialize_log

    df = pm4py.read_xes(materialize_log(artifact_id), variant="rustxes")
    df = df.sort_values(["case:concept:name", "time:timestamp"])
    durations: dict[tuple, list[float]] = {}
    for _, case in df.groupby("case:concept:name", sort=False):
        acts = case["concept:name"].tolist()
        ts = case["time:timestamp"].tolist()
        for i in range(len(acts) - 1):
            dt = (ts[i + 1] - ts[i]).total_seconds()
            durations.setdefault((str(acts[i]), str(acts[i + 1])), []).append(dt)
    edges = [
        {"from": k[0], "to": k[1],
         "mean": float(pd.Series(v).mean()),
         "median": float(pd.Series(v).median()),
         "count": len(v)}
        for k, v in durations.items()
    ]
    repo.save_blob(session_id, cache_key, json.dumps(edges).encode("utf-8"))
    return {"edges": edges}


class KindPatch(BaseModel):
    kind: str


@router.patch("/{artifact_id}/kind")
def set_kind(artifact_id: str, body: KindPatch) -> dict:
    """Re-label a log artifact — e.g. mark an X-PVI segment as L+ or L− (thesis §8.2:
    'export groups of cases to define the desirable and undesirable event logs')."""
    a = repo.get_artifact(artifact_id)
    if not a:
        raise HTTPException(404, "artifact not found")
    if body.kind not in _LOG_KINDS or a["kind"] not in _LOG_KINDS:
        raise HTTPException(400, f"only log artifacts can be re-labelled to {sorted(_LOG_KINDS)}")
    repo.update_artifact_kind(artifact_id, body.kind)
    repo.log_activity("artifact:rekinded", session_id=str(a["session_id"]),
                      detail={"artifact_id": artifact_id, "from": a["kind"],
                              "to": body.kind})
    return {"artifact_id": artifact_id, "kind": body.kind}
