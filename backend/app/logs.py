"""Event-log ingest — normalize uploaded XES or CSV to a stored event log.

Everything downstream (prolysis discovery, EMD segmentation, discriminative learning)
reads XES from a file path, so on ingest we normalize any upload to a pm4py DataFrame,
compute summary stats, and re-serialize to XES bytes for storage in Postgres.
"""
from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path
from typing import Optional

CASE = "case:concept:name"
ACT = "concept:name"
TS = "time:timestamp"

# Column-name guesses for CSV uploads without an explicit mapping.
_CASE_GUESS = [CASE, "case", "case_id", "caseid", "CaseID", "Case ID", "trace"]
_ACT_GUESS = [ACT, "activity", "Activity", "event", "Event", "action", "task"]
_TS_GUESS = [TS, "timestamp", "Timestamp", "time", "Time", "start", "end_time"]


def _guess(columns: list[str], candidates: list[str]) -> Optional[str]:
    lower = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand in columns:
            return cand
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


def ingest(raw: bytes, filename: str, csv_mapping: Optional[dict] = None) -> tuple[bytes, dict]:
    """Return (xes_bytes, stats) for an uploaded XES/CSV file.

    csv_mapping (optional): {"case_id","activity","timestamp"} column names for CSV.
    """
    import pandas as pd
    import pm4py

    name = filename.lower()
    is_csv = name.endswith(".csv") or csv_mapping is not None

    if is_csv:
        df = pd.read_csv(io.BytesIO(raw))
        m = csv_mapping or {}
        cols = list(df.columns)
        case = m.get("case_id") or _guess(cols, _CASE_GUESS)
        act = m.get("activity") or _guess(cols, _ACT_GUESS)
        ts = m.get("timestamp") or _guess(cols, _TS_GUESS)
        if not case or not act:
            raise ValueError(
                "CSV needs at least a case-id and an activity column. "
                f"Columns found: {cols}"
            )
        df = pm4py.format_dataframe(
            df, case_id=case, activity_key=act, timestamp_key=ts or None
        )
    else:
        suffix = "".join(Path(filename).suffixes) or ".xes"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
            tf.write(raw)
            tmp = tf.name
        try:
            df = pm4py.read_xes(tmp, variant="rustxes")
        finally:
            os.unlink(tmp)

    stats = _stats(df)
    xes_bytes = _to_xes_bytes(df)
    return xes_bytes, stats


def _stats(df) -> dict:
    activities = sorted(df[ACT].astype(str).unique().tolist())
    grouped = df.groupby(CASE, sort=False)[ACT].agg(list)
    variant_counts: dict[tuple, int] = {}
    for seq in grouped:
        key = tuple(str(a) for a in seq)
        variant_counts[key] = variant_counts.get(key, 0) + 1
    top = sorted(variant_counts.items(), key=lambda kv: kv[1], reverse=True)[:200]
    variants = [{"trace": list(k), "count": v} for k, v in top]
    return {
        "num_traces": int(df[CASE].nunique()),
        "num_events": int(len(df)),
        "num_variants": int(len(variant_counts)),
        "activities": activities,
        "variants": variants,
    }


def _to_xes_bytes(df) -> bytes:
    import pm4py

    with tempfile.NamedTemporaryFile(suffix=".xes", delete=False) as tf:
        tmp = tf.name
    try:
        pm4py.write_xes(df, tmp)
        return Path(tmp).read_bytes()
    finally:
        os.unlink(tmp)
