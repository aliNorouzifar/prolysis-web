"""Guided-tour sample data (ported from unified_app/services/sample_data.py).

Generates a small **synthetic** loan-application log (no real event data), split into a
desirable log (L+), an undesirable log (L−), and their union (L), and stores all three
as session artifacts. One click on the home page and every tool has valid inputs.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from .. import repo
from ..logs import ingest

# (variant, frequency) — desirable behaviour: clean handling, resolved outcomes.
_DESIRABLE = [
    (("Receive Application", "Check Completeness", "Assess Eligibility",
      "Approve", "Send Offer"), 40),
    (("Receive Application", "Check Completeness", "Request Info", "Check Completeness",
      "Assess Eligibility", "Approve", "Send Offer"), 20),
    (("Receive Application", "Check Completeness", "Assess Eligibility", "Reject"), 15),
]

# (variant, frequency) — undesirable behaviour: excessive rework, late cancellation.
_UNDESIRABLE = [
    (("Receive Application", "Check Completeness", "Request Info", "Check Completeness",
      "Request Info", "Check Completeness", "Assess Eligibility", "Reject"), 25),
    (("Receive Application", "Check Completeness", "Assess Eligibility", "Approve",
      "Send Offer", "Cancel"), 20),
    (("Receive Application", "Cancel"), 15),
]


def _to_dataframe(variants, case_prefix, start_case=0):
    import pandas as pd

    rows = []
    cid = start_case
    base = datetime(2024, 1, 1)
    for variant, freq in variants:
        for _ in range(freq):
            cid += 1
            t = base + timedelta(days=cid % 30, minutes=cid % 7)
            for i, act in enumerate(variant):
                rows.append({
                    "case:concept:name": f"{case_prefix}{cid}",
                    "concept:name": act,
                    "time:timestamp": t + timedelta(minutes=15 * i),
                })
    return pd.DataFrame(rows)


def _xes_bytes(df) -> bytes:
    import os
    import tempfile
    from pathlib import Path

    import pm4py

    with tempfile.NamedTemporaryFile(suffix=".xes", delete=False) as tf:
        tmp = tf.name
    try:
        pm4py.write_xes(df, tmp, case_id_key="case:concept:name")
        return Path(tmp).read_bytes()
    finally:
        os.unlink(tmp)


def generate(session_id: str) -> dict:
    """Generate the sample logs and store L+, L−, and L as session artifacts."""
    import pandas as pd

    df_plus = _to_dataframe(_DESIRABLE, "d")
    df_minus = _to_dataframe(_UNDESIRABLE, "u")
    df_all = pd.concat([df_plus, df_minus], ignore_index=True)

    created = []
    for kind, df, name, fname in (
        ("desirable_log", df_plus, "Sample desirable log (L+)", "sample_desirable.xes"),
        ("undesirable_log", df_minus, "Sample undesirable log (L−)", "sample_undesirable.xes"),
        ("event_log", df_all, "Sample event log (L)", "sample_log.xes"),
    ):
        raw = _xes_bytes(df)
        xes_bytes, stats = ingest(raw, fname)
        aid = repo.create_artifact(session_id, kind, name, source="sample",
                                   meta={"num_traces": stats["num_traces"]})
        repo.create_event_log(aid, fname, xes_bytes, stats)
        created.append({"artifact_id": aid, "kind": kind, "name": name,
                        "num_traces": stats["num_traces"]})

    return {"artifacts": created,
            "activities": sorted(df_all["concept:name"].unique().tolist())}
