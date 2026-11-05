"""Discriminative rule learning service (thesis §5.3 / §6.3, tool §8.5).

Wraps the ported discriminator: learn rules that separate L+ from L− (RuleFit over
per-trace Declare verdicts), cluster them by Jaccard distance, report per-cluster
statistics, and publish the per-cluster trace groups as workspace artifacts.

Phase 2 (``cluster``) reads files phase 1 left in the session work dir (X.csv, y.csv,
rulefit_model.pkl) — both phases run on the same worker container.
"""
from __future__ import annotations

import glob
import os
from pathlib import Path

import numpy as np

from .. import repo
from .base import materialize_log, workdir


def discriminate(session_id: str, lp_artifact: str, lm_artifact: str) -> dict:
    """Learn discriminative rules from L+/L−. Returns the clustered-rule map as
    structured data (Jaccard matrix in dendrogram leaf order, per-rule coefficient
    and support, dendrogram geometry) plus the linkage matrix Z (JSON-safe); the
    SPA renders it natively.

    Phase-1 state moves into Postgres: the per-trace Declare feature matrix goes to the
    ``discriminative_features`` table (queryable), and the exact phase-2 inputs (X/y
    CSVs + fitted RuleFit model) are stored as session blobs — so the clustering phase
    is independent of this worker's filesystem.
    """
    import matplotlib
    matplotlib.use("Agg")  # headless worker
    import pandas as pd
    from .discriminative.discriminator import run_discriminator

    lp_path = materialize_log(lp_artifact)
    lm_path = materialize_log(lm_artifact)
    with workdir(session_id):
        clustermap, Z = run_discriminator(lp_path, lm_path, "output_files")

        # Persist phase-1 state to Postgres.
        x_bytes = Path("output_files/X.csv").read_bytes()
        y_bytes = Path("output_files/y.csv").read_bytes()
        model_bytes = Path("output_files/rulefit_model.pkl").read_bytes()
        repo.save_blob(session_id, "disc_X.csv", x_bytes)
        repo.save_blob(session_id, "disc_y.csv", y_bytes)
        repo.save_blob(session_id, "disc_model.pkl", model_bytes)

        X = pd.read_csv("output_files/X.csv")
        y = pd.read_csv("output_files/y.csv")
        variant_col = "index" if "index" in X.columns else X.columns[0]
        labels = y["label"].astype(bool).tolist()
        feature_cols = [c for c in X.columns if c != variant_col]
        rows = [
            {"trace_variant": str(X.iloc[i][variant_col]),
             "label": bool(labels[i]) if i < len(labels) else False,
             "features": {c: int(X.iloc[i][c]) for c in feature_cols}}
            for i in range(len(X))
        ]
        repo.replace_disc_features(session_id, rows)

    return {"clustermap": clustermap, "Z": np.asarray(Z).tolist()}


def cluster(session_id: str, n_clusters: int, Z: list) -> dict:
    """Cut the dendrogram into ``n_clusters``; report stats and publish each cluster's
    trace group as an event-log artifact (usable downstream as L+/L−).

    Phase-1 state (X, y, fitted model) is loaded from Postgres, so this runs on any
    worker regardless of where the learning phase executed.
    """
    import io

    import joblib
    import matplotlib
    matplotlib.use("Agg")
    import pandas as pd
    from .discriminative.discriminator import clustering_apply

    from ..logs import ingest

    x_bytes = repo.load_blob(session_id, "disc_X.csv")
    y_bytes = repo.load_blob(session_id, "disc_y.csv")
    model_bytes = repo.load_blob(session_id, "disc_model.pkl")
    if not (x_bytes and y_bytes and model_bytes):
        raise ValueError("No learned rules found for this session — run the "
                         "'Learn discriminative rules' step first.")
    X = pd.read_csv(io.BytesIO(x_bytes))
    y = pd.read_csv(io.BytesIO(y_bytes))
    rf_model = joblib.load(io.BytesIO(model_bytes))

    with workdir(session_id):
        for old in glob.glob(os.path.join("output_files", "cluster_*")):
            os.unlink(old)
        report = clustering_apply(int(n_clusters), np.asarray(Z), "output_files",
                                  X=X, y=y, rf_model=rf_model)

        clusters = []
        for cid in sorted((report or {}).keys(), key=str):
            info = report[cid]
            entry: dict = {"cluster": str(cid)}
            if isinstance(info, dict):
                if "max_importance_rule" in info:
                    r = info["max_importance_rule"]
                    entry["top_rule"] = str(r.get("rule", r))[:400]
                    try:
                        entry["coef"] = round(float(r.get("coef")), 3)
                    except Exception:
                        pass
                if "stats" in info and isinstance(info["stats"], dict):
                    entry["rules"] = [
                        {"rule": str(s.get("description", k))[:400],
                         "support": s.get("support"),
                         "support_P": s.get("$support(L^+,r)$", s.get("support_P")),
                         "support_M": s.get("$support(L^-,r)$", s.get("support_M")),
                         "coef": s.get("coef"), "importance": s.get("importance")}
                        for k, s in info["stats"].items() if isinstance(s, dict)
                    ]
                n_ids = len(info.get("satisfied_original_indices", []) or [])
                entry["num_traces"] = n_ids
            clusters.append(entry)

        # Publish exported per-cluster logs as artifacts.
        published = []
        for p in sorted(glob.glob(os.path.join("output_files", "cluster_*"))):
            raw = Path(p).read_bytes()
            base = os.path.basename(p)
            try:
                xes_bytes, stats = ingest(raw, base if base.endswith(".xes")
                                          else base + ".xes")
            except Exception:
                continue
            name = f"Discriminative {os.path.splitext(base)[0].replace('_', ' ')}"
            aid = repo.create_artifact(session_id, "event_log", name,
                                       source="discriminative",
                                       meta={"num_traces": stats["num_traces"]})
            repo.create_event_log(aid, base, xes_bytes, stats)
            published.append({"artifact_id": aid, "name": name,
                              "num_traces": stats["num_traces"]})

    return {"clusters": clusters, "exported": published}
