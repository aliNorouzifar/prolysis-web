"""Async task definitions run by the Procrastinate worker.

Every task follows the same lifecycle against the app-facing ``jobs`` row:
queued → running → succeeded (result jsonb) | failed (error text), with an
``activity_log`` entry on start/finish. Heavy compute lives in ``app.compute``;
tasks only orchestrate and persist.

Note: LLM rule extraction is deliberately **not** a task — task params are persisted
to Postgres and the user's API key must never be stored. It runs synchronously in the
API request instead (see routers/rules.py).
"""
from __future__ import annotations

from typing import Callable

from . import repo
from .jobs import app


def _run(job_id: str, kind: str, session_id: str, fn: Callable[[], dict]) -> None:
    repo.update_job(job_id, status="running", progress=0.1,
                    message="Running — this can take a while for large logs.")
    repo.log_activity(f"{kind}:started", session_id=session_id, source="worker",
                      detail={"job_id": job_id})
    try:
        result = fn()
        repo.update_job(job_id, status="succeeded", progress=1.0,
                        message="Done.", result=repo.jsonable(result))
        repo.log_activity(f"{kind}:succeeded", session_id=session_id, source="worker",
                          detail={"job_id": job_id})
    except Exception as exc:  # surface the failure to the UI + activity log
        repo.update_job(job_id, status="failed", error=f"{type(exc).__name__}: {exc}")
        repo.log_activity(f"{kind}:failed", session_id=session_id, source="worker",
                          level="error", detail={"job_id": job_id, "error": str(exc)})
        raise


def _log_name(artifact_id):
    if not artifact_id:
        return None
    a = repo.get_artifact(artifact_id)
    return a["name"] if a else None


def _persist_model(session_id: str, tool: str, name: str, out: dict,
                   params: dict, inputs: dict | None = None) -> dict:
    """Store a discovered model + its evaluation; return the job result payload.

    ``inputs`` records WHICH logs the stored metrics were computed on, so the
    comparison view can label them.
    """
    meta = {"params": params, "metrics": out["metrics"]}
    if inputs:
        meta["inputs"] = inputs
    aid = repo.create_artifact(session_id, "model", name, source=tool, meta=meta)
    mid = repo.create_model(aid, tool=tool, dot=out["dot"], svg=out["svg"],
                            params=params, pnml=out.get("pnml"),
                            bpmn_xml=out.get("bpmn_xml"))
    repo.create_evaluation(mid, out["metrics"])
    return {"artifact_id": aid, "model_id": mid, "metrics": out["metrics"]}


@app.task(name="ping")
def ping(payload: str = "ping") -> str:
    return f"pong:{payload}"


@app.task(name="discover_imbi")
def discover_imbi(job_id: str, session_id: str, lp_artifact: str, lm_artifact: str,
                  sup: float, ratio: float) -> None:
    from .compute.discovery import run_imbi

    def go() -> dict:
        out = run_imbi(session_id, lp_artifact, lm_artifact, sup, ratio)
        params = {"sup": sup, "ratio": ratio}
        inputs = {"L+": _log_name(lp_artifact), "L-": _log_name(lm_artifact)}
        return _persist_model(session_id, "imbi",
                              f"IMbi model (sup={sup}, ratio={ratio})", out, params,
                              inputs)

    _run(job_id, "discover_imbi", session_id, go)


@app.task(name="discover_imr")
def discover_imr(job_id: str, session_id: str, log_artifact: str, sup: float,
                 rules: list, activities: list, dim: str = "",
                 abs_thr: float | str = "") -> None:
    from .compute.discovery import run_imr

    def go() -> dict:
        out = run_imr(session_id, log_artifact, sup, rules, activities, dim, abs_thr)
        params = {"sup": sup, "n_rules": len(rules or [])}
        return _persist_model(session_id, "imr",
                              f"IMr model (sup={sup}, {len(rules or [])} rules)",
                              out, params, {"L": _log_name(log_artifact)})

    _run(job_id, "discover_imr", session_id, go)


@app.task(name="discover_imf")
def discover_imf(job_id: str, session_id: str, log_artifact: str,
                 noise_threshold: float) -> None:
    from .compute.discovery import run_imf

    def go() -> dict:
        out = run_imf(session_id, log_artifact, noise_threshold)
        params = {"noise_threshold": noise_threshold}
        return _persist_model(session_id, "imf",
                              f"IMf model (f={noise_threshold})", out, params,
                              {"L": _log_name(log_artifact)})

    _run(job_id, "discover_imf", session_id, go)


@app.task(name="evaluate_models")
def evaluate_models(job_id: str, session_id: str, model_artifacts: list,
                    lp_artifact: str, lm_artifact: str) -> None:
    from .compute.discovery import evaluate_models as run

    _run(job_id, "evaluate_models", session_id,
         lambda: run(session_id, model_artifacts, lp_artifact, lm_artifact))


@app.task(name="xpvi_emd")
def xpvi_emd(job_id: str, session_id: str, log_artifact: str, n_bin: int, w: int,
             kpi: str) -> None:
    from .compute.xpvi import run_emd

    _run(job_id, "xpvi_emd", session_id,
         lambda: run_emd(session_id, log_artifact, n_bin, w, kpi))


@app.task(name="xpvi_segment")
def xpvi_segment(job_id: str, session_id: str, n_bin: int, w: int, kpi: str = "",
                 signal_threshold: float = 0.05, log_artifact: str | None = None) -> None:
    from .compute.xpvi import run_segmentation

    _run(job_id, "xpvi_segment", session_id,
         lambda: run_segmentation(session_id, log_artifact, n_bin, w, kpi,
                                  signal_threshold))


@app.task(name="xpvi_export")
def xpvi_export(job_id: str, session_id: str) -> None:
    from .compute.xpvi import run_export

    _run(job_id, "xpvi_export", session_id, lambda: run_export(session_id))


@app.task(name="xpvi_explain")
def xpvi_explain(job_id: str, session_id: str, n_bin: int, w: int, kpi: str,
                 theta_cvg: float, n_clusters: int,
                 signal_threshold: float = 0.05,
                 log_artifact: str | None = None) -> None:
    from .compute.xpvi import run_explainability

    _run(job_id, "xpvi_explain", session_id,
         lambda: run_explainability(session_id, log_artifact, n_bin, w, kpi,
                                    signal_threshold, theta_cvg, n_clusters))


@app.task(name="discriminate")
def discriminate(job_id: str, session_id: str, lp_artifact: str,
                 lm_artifact: str) -> None:
    from .compute.discriminative_service import discriminate as run

    _run(job_id, "discriminate", session_id,
         lambda: run(session_id, lp_artifact, lm_artifact))


@app.task(name="cluster_rules")
def cluster_rules(job_id: str, session_id: str, n_clusters: int, Z: list) -> None:
    from .compute.discriminative_service import cluster as run

    _run(job_id, "cluster_rules", session_id,
         lambda: run(session_id, n_clusters, Z))


@app.task(name="discover_declare_rules")
def discover_declare_rules(job_id: str, session_id: str, log_artifact: str,
                           support: float, confidence: float) -> None:
    from .compute.rules import discover_rules

    def go() -> dict:
        out = discover_rules(log_artifact, support, confidence)
        aid = repo.create_artifact(
            session_id, "rule_set",
            f"Discovered rules (s≥{support}, c≥{confidence})",
            source="declare-discovery",
            meta={"n_rules": len(out["rules"]), "dimensions": out["dimensions"]})
        repo.create_rule_set(aid, out["rules"])
        return {"artifact_id": aid, "n_rules": len(out["rules"]),
                "activities": out["activities"], "dimensions": out["dimensions"]}

    _run(job_id, "discover_declare_rules", session_id, go)
