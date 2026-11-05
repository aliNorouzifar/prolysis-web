"""Job endpoints — one starter per async compute task + status polling.

Each starter creates an app-facing ``jobs`` row, defers the Procrastinate task with the
job id, and returns the id immediately; the worker updates the row as it runs. The BFF
polls status via its own DB read (and ``GET /jobs/{id}`` exists for debugging).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import repo, tasks

router = APIRouter(prefix="/jobs", tags=["jobs"])


async def _start(session_id: str, kind: str, task, params: dict) -> dict:
    sid = repo.ensure_session(session_id)
    job_id = repo.create_job(sid, kind, params)
    await task.defer_async(job_id=job_id, session_id=sid, **params)
    repo.log_activity(f"{kind}:queued", session_id=sid,
                      detail={"job_id": job_id, **{k: v for k, v in params.items()
                                                   if not isinstance(v, list)}})
    return {"job_id": job_id, "kind": kind, "status": "queued"}


class ImbiParams(BaseModel):
    session_id: str
    lp_artifact: str
    lm_artifact: str
    sup: float = Field(0.2, ge=0, le=1)
    ratio: float = Field(1.0, ge=0)


@router.post("/discover-imbi")
async def start_imbi(p: ImbiParams) -> dict:
    return await _start(p.session_id, "discover_imbi", tasks.discover_imbi,
                        {"lp_artifact": p.lp_artifact, "lm_artifact": p.lm_artifact,
                         "sup": p.sup, "ratio": p.ratio})


class ImrParams(BaseModel):
    session_id: str
    log_artifact: str
    sup: float = Field(0.2, ge=0, le=1)
    rules: list = []
    activities: list = []
    dim: str = ""
    abs_thr: float | str = ""


@router.post("/discover-imr")
async def start_imr(p: ImrParams) -> dict:
    return await _start(p.session_id, "discover_imr", tasks.discover_imr,
                        {"log_artifact": p.log_artifact, "sup": p.sup,
                         "rules": p.rules, "activities": p.activities,
                         "dim": p.dim, "abs_thr": p.abs_thr})


class ImfParams(BaseModel):
    session_id: str
    log_artifact: str
    noise_threshold: float = Field(0.2, ge=0, le=1)


@router.post("/discover-imf")
async def start_imf(p: ImfParams) -> dict:
    return await _start(p.session_id, "discover_imf", tasks.discover_imf,
                        {"log_artifact": p.log_artifact,
                         "noise_threshold": p.noise_threshold})


class EvaluateModelsParams(BaseModel):
    session_id: str
    model_artifacts: list
    lp_artifact: str
    lm_artifact: str


@router.post("/evaluate-models")
async def start_evaluate_models(p: EvaluateModelsParams) -> dict:
    return await _start(p.session_id, "evaluate_models", tasks.evaluate_models,
                        {"model_artifacts": p.model_artifacts,
                         "lp_artifact": p.lp_artifact, "lm_artifact": p.lm_artifact})


class XpviEmdParams(BaseModel):
    session_id: str
    log_artifact: str
    n_bin: int = Field(100, ge=2)
    w: int = Field(10, ge=2)
    kpi: str


@router.post("/xpvi-emd")
async def start_xpvi_emd(p: XpviEmdParams) -> dict:
    return await _start(p.session_id, "xpvi_emd", tasks.xpvi_emd,
                        {"log_artifact": p.log_artifact, "n_bin": p.n_bin,
                         "w": p.w, "kpi": p.kpi})


class XpviSegmentParams(BaseModel):
    session_id: str
    n_bin: int = Field(100, ge=2)
    w: int = Field(10, ge=2)
    kpi: str = ""
    signal_threshold: float = Field(0.05, ge=0)
    log_artifact: str | None = None  # enables state self-healing after restarts


@router.post("/xpvi-segment")
async def start_xpvi_segment(p: XpviSegmentParams) -> dict:
    return await _start(p.session_id, "xpvi_segment", tasks.xpvi_segment,
                        {"n_bin": p.n_bin, "w": p.w, "kpi": p.kpi,
                         "signal_threshold": p.signal_threshold,
                         "log_artifact": p.log_artifact})


class XpviExportParams(BaseModel):
    session_id: str


@router.post("/xpvi-export")
async def start_xpvi_export(p: XpviExportParams) -> dict:
    return await _start(p.session_id, "xpvi_export", tasks.xpvi_export, {})


class XpviExplainParams(BaseModel):
    session_id: str
    n_bin: int = Field(100, ge=2)
    w: int = Field(10, ge=2)
    kpi: str
    theta_cvg: float = Field(0.3, ge=0, le=1)
    n_clusters: int = Field(6, ge=1, le=40)
    signal_threshold: float = Field(0.05, ge=0)
    log_artifact: str | None = None  # enables state self-healing after restarts


@router.post("/xpvi-explain")
async def start_xpvi_explain(p: XpviExplainParams) -> dict:
    return await _start(p.session_id, "xpvi_explain", tasks.xpvi_explain,
                        {"n_bin": p.n_bin, "w": p.w, "kpi": p.kpi,
                         "theta_cvg": p.theta_cvg, "n_clusters": p.n_clusters,
                         "signal_threshold": p.signal_threshold,
                         "log_artifact": p.log_artifact})


class DiscriminateParams(BaseModel):
    session_id: str
    lp_artifact: str
    lm_artifact: str


@router.post("/discriminate")
async def start_discriminate(p: DiscriminateParams) -> dict:
    return await _start(p.session_id, "discriminate", tasks.discriminate,
                        {"lp_artifact": p.lp_artifact, "lm_artifact": p.lm_artifact})


class ClusterParams(BaseModel):
    session_id: str
    n_clusters: int = Field(3, ge=1, le=50)
    Z: list


@router.post("/cluster-rules")
async def start_cluster(p: ClusterParams) -> dict:
    return await _start(p.session_id, "cluster_rules", tasks.cluster_rules,
                        {"n_clusters": p.n_clusters, "Z": p.Z})


class DiscoverRulesParams(BaseModel):
    session_id: str
    log_artifact: str
    support: float = Field(0.9, ge=0, le=1)
    confidence: float = Field(0.9, ge=0, le=1)


@router.post("/discover-rules")
async def start_discover_rules(p: DiscoverRulesParams) -> dict:
    return await _start(p.session_id, "discover_declare_rules",
                        tasks.discover_declare_rules,
                        {"log_artifact": p.log_artifact, "support": p.support,
                         "confidence": p.confidence})


@router.get("/{job_id}")
def job_status(job_id: str) -> dict:
    j = repo.get_job(job_id)
    if not j:
        raise HTTPException(404, "job not found")
    return j
