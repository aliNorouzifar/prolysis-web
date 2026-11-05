"""IMbi and IMr discovery — ported from unified_app/services/discovery.py.

prolysis is treated read-only; these are the same call patterns the Dash app used, with
results returned as (dot, svg, metrics) for persistence.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import dot_to_svg, materialize_log, petri_to_bpmn_xml, workdir


def run_imbi(session_id: str, lp_artifact: str, lm_artifact: str,
             sup: float, ratio: float) -> dict:
    """IMbi on L+/L−. Returns dot, svg, and discriminative metrics (thesis Ch. 4)."""
    import pm4py
    from pm4py.visualization.petri_net import visualizer as pn_visualizer
    from prolysis.analysis import Optimzation_Goals
    from prolysis.discovery.discovery import apply_bi

    lp_path = materialize_log(lp_artifact)
    lm_path = materialize_log(lm_artifact)
    with workdir(session_id):
        log_p = pm4py.read_xes(lp_path, variant="rustxes")
        log_m = pm4py.read_xes(lm_path, variant="rustxes")
        size_par = (len(log_p) / len(log_m)) if len(log_m) else 1
        net, im, fm = apply_bi(Lp=log_p, Lm=log_m, sup=sup, ratio=ratio, size_par=size_par)
        gviz = pn_visualizer.apply(net, im, fm)
        dot = str(gviz)
        measures = Optimzation_Goals.apply_petri(log_p, log_m, net, im, fm)
        bpmn_xml = petri_to_bpmn_xml(net, im, fm)
        pnml = _pnml_str(net, im, fm)
    return {"dot": dot, "svg": dot_to_svg(dot), "bpmn_xml": bpmn_xml, "pnml": pnml,
            "metrics": _imbi_metrics(measures)}


def run_imr(session_id: str, log_artifact: str, sup: float, rules: list,
            activities: list, dim: str = "", abs_thr: Any = "") -> dict:
    """IMr rule-guided discovery. Returns dot, svg, and fitness/precision.

    ``dim`` is the rule dimension used to weight rules in the cut search; the search
    reads ``r[dim]`` for every rule, so it must exist. Rules without it (LLM-extracted
    or user-curated selections) get full weight 1.0.
    """
    import pm4py
    from prolysis.analysis.evaluation import conformance_checking
    from prolysis.discovery.discovery import run_IMr

    dim = dim or "confidence"
    rules = [{**r, dim: float(r.get(dim) if r.get(dim) is not None else 1.0)}
             for r in (rules or [])]

    log_path = materialize_log(log_artifact)
    with workdir(session_id):
        gviz = run_IMr(log_path, sup, rules, set(activities or []),
                       dim, abs_thr if abs_thr not in (None, "") else "skip")
        dot = str(gviz)
        model_path = Path("output_files") / "model.pnml"
        metrics: dict = {}
        bpmn_xml = None
        pnml = None
        if model_path.exists():
            fitness, precision = conformance_checking(log_path, str(model_path))
            metrics = {"fitness": round(float(fitness), 3),
                       "precision": round(float(precision), 3)}
            net, im, fm = pm4py.read_pnml(str(model_path))
            bpmn_xml = petri_to_bpmn_xml(net, im, fm)
            pnml = model_path.read_text(encoding="utf-8")
    return {"dot": dot, "svg": dot_to_svg(dot), "bpmn_xml": bpmn_xml,
            "pnml": pnml, "metrics": metrics}


def run_imf(session_id: str, log_artifact: str, noise_threshold: float) -> dict:
    """IMf baseline: inductive miner infrequent on a single event log (e.g. only L+).

    Metrics are computed with the same conformance checking as IMr, so IMf models are
    directly comparable to the rule-guided and desirability-aware runs.
    """
    import pm4py
    from pm4py.visualization.petri_net import visualizer as pn_visualizer
    from prolysis.analysis.evaluation import conformance_checking

    log_path = materialize_log(log_artifact)
    with workdir(session_id):
        log = pm4py.read_xes(log_path, variant="rustxes")
        net, im, fm = pm4py.discover_petri_net_inductive(
            log, noise_threshold=float(noise_threshold))
        gviz = pn_visualizer.apply(net, im, fm)
        dot = str(gviz)
        model_path = Path("output_files") / "model.pnml"
        pm4py.write_pnml(net, im, fm, str(model_path))
        fitness, precision = conformance_checking(log_path, str(model_path))
        metrics = {"fitness": round(float(fitness), 3),
                   "precision": round(float(precision), 3)}
        bpmn_xml = petri_to_bpmn_xml(net, im, fm)
        pnml = model_path.read_text(encoding="utf-8")
    return {"dot": dot, "svg": dot_to_svg(dot), "bpmn_xml": bpmn_xml,
            "pnml": pnml, "metrics": metrics}


def _pnml_str(net, im, fm) -> str:
    """Serialize a Petri net to a PNML string (for storage + later re-evaluation)."""
    import os
    import tempfile
    from pathlib import Path as _P

    import pm4py

    with tempfile.NamedTemporaryFile(suffix=".pnml", delete=False) as tf:
        tmp = tf.name
    try:
        pm4py.write_pnml(net, im, fm, tmp)
        return _P(tmp).read_text(encoding="utf-8")
    finally:
        os.unlink(tmp)


def evaluate_models(session_id: str, model_artifacts: list, lp_artifact: str,
                    lm_artifact: str) -> dict:
    """Fair comparison: evaluate several stored models against the SAME desirable and
    undesirable logs with the Ch. 4 metrics. Models without a stored Petri net (from
    before PNML persistence) are reported as skipped."""
    import os
    import tempfile

    import pm4py
    from prolysis.analysis import Optimzation_Goals

    from .. import repo

    lp_path = materialize_log(lp_artifact)
    lm_path = materialize_log(lm_artifact)
    with workdir(session_id):
        log_p = pm4py.read_xes(lp_path, variant="rustxes")
        log_m = pm4py.read_xes(lm_path, variant="rustxes")
        results = []
        for aid in model_artifacts:
            a = repo.get_artifact(aid)
            m = repo.get_model_by_artifact(aid)
            name = a["name"] if a else aid
            net = im = fm = None
            if m and m.get("pnml"):
                with tempfile.NamedTemporaryFile(suffix=".pnml", delete=False,
                                                 mode="w", encoding="utf-8") as tf:
                    tf.write(m["pnml"])
                    tmp = tf.name
                try:
                    net, im, fm = pm4py.read_pnml(tmp)
                finally:
                    os.unlink(tmp)
            elif m and m.get("bpmn_xml"):
                # Older models stored no PNML — reconstruct a language-equivalent
                # Petri net from the stored BPMN.
                with tempfile.NamedTemporaryFile(suffix=".bpmn", delete=False,
                                                 mode="w", encoding="utf-8") as tf:
                    tf.write(m["bpmn_xml"])
                    tmp = tf.name
                try:
                    bpmn = pm4py.read_bpmn(tmp)
                    net, im, fm = pm4py.convert_to_petri_net(bpmn)
                finally:
                    os.unlink(tmp)
            if net is None:
                results.append({"artifact_id": aid, "name": name, "skipped": True,
                                "reason": "no stored model structure "
                                          "(re-run the discovery)"})
                continue
            measures = Optimzation_Goals.apply_petri(log_p, log_m, net, im, fm)
            results.append({"artifact_id": aid, "name": name, "skipped": False,
                            "metrics": _imbi_metrics(measures)})
    lp_name = (repo.get_artifact(lp_artifact) or {}).get("name", "L+")
    lm_name = (repo.get_artifact(lm_artifact) or {}).get("name", "L-")
    return {"results": results, "inputs": {"lp": lp_name, "lm": lm_name}}


def _imbi_metrics(m: dict) -> dict:
    def g(*keys):
        for k in keys:
            if k in m and m[k] is not None:
                return round(float(m[k]), 3)
        return None

    out = {
        "a_fit_lp": g("fitP"),
        "a_fit_lm": g("fitM"),
        "a_acc": g("acc"),
        "a_f1": g("F1"),
        "t_acc": g("acc_perf"),
        "t_f1": g("F1_perf"),
    }
    return {k: v for k, v in out.items() if v is not None}
