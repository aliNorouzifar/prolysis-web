"""X-PVI — explainable process variant identification (thesis §5.1, tool §8.2).

Data pipeline: prolysis' import step produces a case table and an event table; we
persist both into Postgres (``xpvi_cases`` / ``xpvi_events``) and treat the database as
the source of truth. prolysis itself reads those tables as CSVs from the working
directory, so every step **rematerializes them from Postgres** when the worker's local
files are gone (container restart/rebuild), and rebuilds the in-process EMD state from
the stored parameters when needed — no step depends on a previous job having run on the
same container.
"""
from __future__ import annotations

import json
import os

from .. import repo
from .base import fig_to_json, materialize_log, workdir


def _persist_tables(session_id: str) -> None:
    """Load prolysis' freshly written case/event CSVs and store them in Postgres."""
    import pandas as pd

    case_df = pd.read_csv("output_files/out.csv", keep_default_na=False, na_values=[""])
    event_df = pd.read_csv("output_files/out_event.csv", keep_default_na=False, na_values=[""])

    cases = [
        {"row_idx": int(idx), "case_id": str(row["case_id"]),
         "attrs": {k: (None if pd.isna(v) else str(v))
                   for k, v in row.items() if k != "case_id"}}
        for idx, row in case_df.iterrows()
    ]
    events = [
        {"seq": int(i), "case_id": str(r["case_id"]),
         "activity": str(r["activity_name"]),
         "ts": None if pd.isna(r.get("timestamp")) else str(r["timestamp"])}
        for i, r in event_df.iterrows()
    ]
    repo.replace_xpvi_tables(session_id, cases, events)


def _rematerialize_tables(session_id: str) -> bool:
    """Write ``output_files/out.csv`` / ``out_event.csv`` from Postgres (CWD = session
    work dir). Returns False when the database has no tables for this session yet."""
    import pandas as pd

    rows = repo.xpvi_all_cases(session_id)
    if not rows:
        return False
    case_df = pd.DataFrame(
        [{"case_id": r["case_id"], **(r["attrs"] or {})} for r in rows],
        index=[r["row_idx"] for r in rows],
    ).sort_index()
    # attrs were stored as strings for jsonb safety — restore numeric dtypes.
    for col in case_df.columns:
        if col != "case_id":
            case_df[col] = pd.to_numeric(case_df[col], errors="ignore")
    case_df.to_csv("output_files/out.csv", index=False)

    ev = repo.xpvi_all_events(session_id)
    pd.DataFrame(
        [{"case_id": e["case_id"], "activity_name": e["activity"],
          "timestamp": e["ts"]} for e in ev]
    ).to_csv("output_files/out_event.csv", index=False)
    return True


def _ensure_tables(session_id: str, log_artifact: str | None) -> None:
    """Guarantee the case/event CSVs exist in the CWD: prefer Postgres; fall back to a
    fresh prolysis import of the log artifact (which also refreshes Postgres)."""
    from prolysis.util.utils import import_log

    if os.path.exists("output_files/out.csv") and os.path.exists("output_files/out_event.csv"):
        return
    if _rematerialize_tables(session_id):
        return
    if not log_artifact:
        raise ValueError("No X-PVI tables for this session — run the EMD step first.")
    import_log(materialize_log(log_artifact))
    _persist_tables(session_id)


def _ensure_emd_state(session_id: str, log_artifact: str | None, n_bin: int, w: int,
                      kpi: str) -> None:
    """Rebuild prolysis' in-process EMD state (df/bins/map_range) if this worker
    doesn't have it — it lives in memory and dies with the container."""
    from prolysis.analysis.EMD_based_framework import apply_EMD
    from prolysis.util.redis_connection import redis_client

    _ensure_tables(session_id, log_artifact)
    if redis_client.get("df") is None or redis_client.get("bins") is None:
        apply_EMD(int(n_bin), int(w), kpi)


def inspect_log(session_id: str, log_artifact: str) -> dict:
    """Import the log; persist its tables; return case count + KPI columns."""
    from prolysis.util.utils import import_log

    log_path = materialize_log(log_artifact)
    with workdir(session_id):
        n_cases, columns = import_log(log_path)
        _persist_tables(session_id)
    return {"n_cases": int(n_cases), "columns": [str(c) for c in columns]}


def run_emd(session_id: str, log_artifact: str, n_bin: int, w: int, kpi: str) -> dict:
    """Phase 2: EMD sliding-window analysis. Returns the figure + max distance."""
    from prolysis.analysis.EMD_based_framework import apply_EMD
    from prolysis.util.redis_connection import redis_client
    from prolysis.util.utils import import_log

    log_path = materialize_log(log_artifact)
    with workdir(session_id):
        # Fresh import so the tables match this log/session even after restarts.
        n_cases, _ = import_log(log_path)
        _persist_tables(session_id)
        fig = apply_EMD(int(n_bin), int(w), kpi)
        max_dist = redis_client.get("max_dist")
    return {
        "figure": fig_to_json(fig),
        "max_dist": float(max_dist) if max_dist is not None else 1.0,
        "n_cases": int(n_cases),
    }


def _export_segments_sql(session_id: str, segments_ids: list) -> list[dict]:
    """Per-segment export as SQL: cases by positional label → join events → XES bytes."""
    import pandas as pd
    import pm4py

    from ..logs import ingest

    published = []
    for k, id_set in enumerate(segments_ids, start=1):
        rows = repo.xpvi_segment_events(session_id, list(id_set))
        if not rows:
            continue
        df = pd.DataFrame(rows)
        df = pm4py.format_dataframe(df, case_id="case_id", activity_key="activity",
                                    timestamp_key="ts")
        xes_df = df[["case:concept:name", "concept:name", "time:timestamp"]]
        import tempfile
        from pathlib import Path
        with tempfile.NamedTemporaryFile(suffix=".xes", delete=False) as tf:
            tmp = tf.name
        try:
            pm4py.write_xes(xes_df, tmp)
            raw = Path(tmp).read_bytes()
        finally:
            os.unlink(tmp)
        xes_bytes, stats = ingest(raw, f"segment_{k}.xes")
        name = f"segment {k}"
        aid = repo.create_artifact(session_id, "event_log", name, source="x-pvi",
                                   meta={"num_traces": stats["num_traces"]})
        repo.create_event_log(aid, f"segment_{k}.xes", xes_bytes, stats)
        published.append({"artifact_id": aid, "name": name,
                          "num_traces": stats["num_traces"]})
    return published


def run_segmentation(session_id: str, log_artifact: str | None, n_bin: int, w: int,
                     kpi: str, signal_threshold: float) -> dict:
    """Phase 3a: segment at the threshold. The resulting segment id sets are persisted
    to Postgres so the export step (phase 3b) runs independently, on any worker.

    Self-healing: missing tables/EMD state are rebuilt from Postgres + parameters."""
    from prolysis.analysis.EMD_based_framework import apply_segmentation
    from prolysis.util.redis_connection import redis_client

    with workdir(session_id):
        _ensure_emd_state(session_id, log_artifact, n_bin, w, kpi)
        fig, peak_explanations = apply_segmentation(int(n_bin), int(w),
                                                    float(signal_threshold))
        segments_ids = json.loads(redis_client.get("segments_ids") or "[]")

    repo.save_blob(session_id, "xpvi_segments_ids",
                   json.dumps(segments_ids).encode("utf-8"))
    return {
        "figure": fig_to_json(fig),
        "peaks": [str(p) for p in peak_explanations],
        "n_segments": len(segments_ids),
    }


def run_export(session_id: str) -> dict:
    """Phase 3b: export the detected segments as workspace event logs (SQL join over
    the Postgres tables, using the segment ids stored by the segmentation step)."""
    blob = repo.load_blob(session_id, "xpvi_segments_ids")
    if blob is None:
        raise ValueError("No segmentation found for this session — run the "
                         "segmentation step first.")
    segments_ids = json.loads(blob.decode("utf-8"))
    segment_artifacts = _export_segments_sql(session_id, segments_ids)
    return {"segments": segment_artifacts}


def run_explainability(session_id: str, log_artifact: str | None, n_bin: int, w: int,
                       kpi: str, signal_threshold: float, theta_cvg: float,
                       n_clusters: int) -> dict:
    """Phase 4 — the *explainable* part of X-PVI (thesis §5.1/§8.2).

    Self-healing: the case/event tables come from Postgres and any missing EMD /
    segmentation state is rebuilt in-process from the stored parameters.
    """
    import glob
    from pathlib import Path

    from prolysis.analysis.EMD_based_framework import apply_segmentation
    from prolysis.analysis.explainability_extraction import (
        apply_X, apply_feature_extraction, generate_features)
    from prolysis.util.redis_connection import redis_client

    with workdir(session_id):
        _ensure_emd_state(session_id, log_artifact, n_bin, w, kpi)
        if redis_client.get("peaks") is None:
            apply_segmentation(int(n_bin), int(w), float(signal_threshold))

        generate_features(int(w), kpi, int(n_bin))
        apply_feature_extraction(float(theta_cvg))
        fig3, fig4 = apply_X(int(n_bin), int(w), int(n_clusters))
        n_segments = int(redis_client.get("segments_count") or 0)
        n_found = int(redis_client.get("clusters_count") or 0)

        # Persist the exported constraint statistics to Postgres: the natural-language
        # endpoint runs in the API container (different filesystem than this worker).
        for p in ["output_files/data1.json",
                  *glob.glob("output_files/constraints_*.json")]:
            if os.path.exists(p):
                repo.save_blob(session_id, f"xpvi_{os.path.basename(p)}",
                               Path(p).read_bytes())

    return {
        "signals_figure": fig_to_json(fig3),
        "correlation_figure": fig_to_json(fig4),
        "n_segments": n_segments,
        "n_clusters": n_found,
    }


def explain_nl(session_id: str, cluster: int, segment: int) -> dict:
    """Natural-language explanation: which behavioural constraints of ``cluster`` are
    more/less satisfied inside ``segment`` than elsewhere.

    Runs in the API process — the statistics are loaded from Postgres (stored by the
    explainability job on the worker) and materialized into this session's work dir.
    """
    from pathlib import Path

    from prolysis.analysis.explainability_extraction import decl2NL

    with workdir(session_id):
        for fname in ("data1.json", f"constraints_{cluster}.json"):
            blob = repo.load_blob(session_id, f"xpvi_{fname}")
            if blob is None:
                raise ValueError("run the explainability step first")
            Path("output_files", fname).write_bytes(blob)
        list_sorted, list_sorted_reverse = decl2NL(int(cluster), int(segment))
    # decl2NL returns ranked, pre-formatted sentences ("rank i: …, with score s") —
    # ascending by score and descending by score (legacy: Lowest/Highest Scores).
    return {
        "highest": [str(x) for x in list_sorted_reverse[:20]],
        "lowest": [str(x) for x in list_sorted[:20]],
    }
