"""Declare rule acquisition — the rule sources of thesis §8.4.2.

1. ``discover_rules``   — automatic discovery from an event log (prolysis.declare,
                          the pure-Python MINERful-equivalent engine).
2. ``score_rules``      — manual composition: the analyst picks a template and
                          activities from a log; rules are validated and scored.
3. ``extract_llm_rules``— natural language → Declare via an LLM (ported from the
                          domain-guided tool, §5.2/§6.2.6): prompt → validate → re-prompt
                          on errors, then score rules with support/confidence.
4. Discriminative learning (§5.3) lives in ``compute/discriminative_service.py``.

LLM API keys are supplied per request, held in memory only, never persisted or logged.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .base import materialize_log

RESOURCES = Path(__file__).resolve().parent.parent / "resources"

SINGLE_PAR = {"AtLeast1", "AtMost1"}
TWO_PAR = {"NotCoExistence", "Precedence", "NotSuccession", "Response",
           "RespondedExistence", "CoExistence"}
ALLOWED = SINGLE_PAR | TWO_PAR


# --- Source 1: automatic discovery from the log -----------------------------------

def discover_rules(log_artifact: str, support: float, confidence: float) -> dict:
    """Discover Declare rules (support/confidence thresholds, hierarchy-pruned)."""
    from prolysis.declare.discovery import discover_from_log

    log_path = materialize_log(log_artifact)
    model = discover_from_log(log_path, support=float(support),
                              confidence=float(confidence), prune="hierarchy")
    rules = model["constraints"]
    dims = sorted(set(rules[0].keys()) - {"template", "parameters"}) if rules else []
    return {"rules": rules, "activities": sorted(model["tasks"]), "dimensions": dims}


# --- Source 2: manual rule composition ---------------------------------------------

def score_rules(log_artifact: str, rules: list) -> dict:
    """Validate manually composed Declare rules against the full template catalogue
    (everything IMr's DFA engine accepts) and the log's activities, then score each
    with support/confidence on that log — same assessment as the other rule sources.
    """
    from prolysis.declare.measures import ALL_TEMPLATES, UNARY_TEMPLATES

    from .. import repo

    ev = repo.get_event_log_by_artifact(log_artifact)
    if not ev:
        raise ValueError("selected artifact has no stored event log")
    activities = set(ev["activities"] or [])

    for r in rules:
        tpl = r.get("template")
        if tpl not in ALL_TEMPLATES:
            raise ValueError(f"unsupported template: {tpl}")
        params = r.get("parameters") or []
        n = 1 if tpl in UNARY_TEMPLATES else 2
        if len(params) != n or any(not isinstance(p, list) or len(p) != 1 for p in params):
            raise ValueError(f"{tpl} needs {n} parameter(s), each a one-element list")
        for p in params:
            if p[0] not in activities:
                raise ValueError(f"activity '{p[0]}' is not in the selected log")
        if n == 2 and params[0][0] == params[1][0]:
            raise ValueError(f"{tpl} needs two different activities")

    return {"rules": _rule_stats(rules, materialize_log(log_artifact))}


# --- Source 3: LLM extraction from natural language --------------------------------

def _task_description() -> str:
    return (RESOURCES / "llm" / "task_description.txt").read_text(encoding="utf-8")


def validate_llm_output(text: str, act_list: list):
    """Validate LLM output. Returns (json_flag, error_message, parsed)."""
    cleaned = re.sub(r"^```json\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    if not (cleaned.strip().startswith("{") and cleaned.strip().endswith("}")):
        return False, False, False
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return True, "The JSON output contains syntax errors. Please return valid JSON.", False
    if not isinstance(parsed, dict) or set(parsed.keys()) != {"constraints"}:
        return True, ("The top-level dictionary must contain exactly one key: "
                      "'constraints'."), False
    if not isinstance(parsed["constraints"], list):
        return True, "'constraints' must be a list.", False

    errs = ""
    for r in parsed["constraints"]:
        if not isinstance(r, dict) or set(r.keys()) != {"template", "parameters"}:
            errs += f"Each constraint needs 'template' and 'parameters' keys ({r}). "
            continue
        if r["template"] not in ALLOWED:
            errs += f"Template of {r} is not supported ({sorted(ALLOWED)}). "
            continue
        n = 1 if r["template"] in SINGLE_PAR else 2
        if len(r["parameters"]) != n:
            errs += f"{r['template']} needs {n} parameter(s). "
            continue
        for p in r["parameters"]:
            if not isinstance(p, list) or len(p) != 1:
                errs += f"Each parameter in {r} must be a one-element list. "
            elif p[0] not in act_list:
                errs += f"Activity {p} in {r} is not in the log's activities. "
    if errs:
        return True, errs, False
    return True, False, parsed


def _make_client(provider: str, api_key: str, model_name: str):
    if provider == "OpenAI":
        from openai import OpenAI
        return OpenAI(api_key=api_key)
    if provider == "Google":
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        return genai.GenerativeModel(model_name)
    if provider == "deepseek":
        return {"url": "https://api.deepseek.com", "headers":
                {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}}
    raise ValueError(f"Unknown provider: {provider}")


def _com_message(user_text, system_text, history, model, provider, model_name):
    """Send one message to the provider; return (response_text, new_history)."""
    new = []
    if provider in ("OpenAI", "deepseek"):
        if system_text:
            new.append({"role": "system", "content": system_text})
        if user_text:
            new.append({"role": "user", "content": user_text})
        messages = history + new
        if provider == "OpenAI":
            resp = model.chat.completions.create(model=model_name, messages=messages)
            txt = resp.choices[0].message.content
        else:  # DeepSeek is OpenAI-compatible over REST
            import requests
            r = requests.post(model["url"] + "/chat/completions", headers=model["headers"],
                              json={"model": model_name, "messages": messages}, timeout=120)
            txt = r.json()["choices"][0]["message"]["content"]
        history = history + new + [{"role": "assistant", "content": txt}]
    elif provider == "Google":
        combined = f"{system_text}\n\n{user_text}" if system_text else user_text
        new.append({"role": "user", "parts": [combined]})
        resp = model.generate_content(history + new)
        txt = resp.text
        history = history + new + [{"role": "model", "parts": [txt]}]
    else:
        return "error", history
    return txt, history


def _rule_stats(rules: list, log_path: str) -> list:
    """Score each rule with MINERful-style support/confidence over the log (§8.3:
    'their quality is assessed using evaluation metrics such as support and confidence')."""
    import pm4py
    from prolysis.declare.discovery import variants_from_log
    from prolysis.declare.measures import measure

    log = pm4py.read_xes(str(log_path), variant="rustxes")
    variants, _ = variants_from_log(log)
    n_traces = sum(f for _, f in variants)
    n_events = sum(len(t) * f for t, f in variants)
    scored = []
    for r in rules:
        params = [p[0] for p in r["parameters"]]
        try:
            m = measure(r["template"], params, variants, n_traces, n_events)
            # sat_traces: share of traces where the rule holds — tr_support counts
            # traces that activate AND fully satisfy it; traces that never activate
            # it satisfy it vacuously (1 - tr_coverage).
            scored.append({**r, "support": round(m["support"], 3),
                           "confidence": round(m["confidence"], 3),
                           "sat_traces": round(
                               m["tr_support"] + 1 - m["tr_coverage"], 3)})
        except Exception:
            scored.append({**r, "support": None, "confidence": None,
                           "sat_traces": None})
    return scored


def extract_llm_rules(log_artifact: str, description: str, provider: str,
                      api_key: str, model_name: str, max_fixes: int = 8,
                      history: list | None = None) -> dict:
    """One conversation turn of the extraction chat: prompt → validate → re-prompt on
    errors → score. ``history`` is the provider-format message history of previous
    turns — it lives in the browser and travels with each request, so the whole
    conversation (like the API key) stays request-scoped and is never persisted.

    Returns {"rules": [...(scored)...], "activities", "text", "fixes", "history"}.
    """
    from .. import repo

    ev = repo.get_event_log_by_artifact(log_artifact)
    if not ev:
        raise ValueError("selected artifact has no stored event log")
    activities = list(ev["activities"] or [])

    client = _make_client(provider, api_key, model_name)
    history = list(history or [])
    # The task description + activity list only opens the conversation; follow-up
    # turns continue it (refine, add, or drop rules in plain language).
    system = ("" if history else
              _task_description() + "\n\nOnly use these activities:\n" + str(activities))
    txt, history = _com_message(description, system, history, client, provider, model_name)
    ok, err, parsed = validate_llm_output(txt, activities)
    fixes = 0
    while ok and err and fixes < max_fixes:
        txt, history = _com_message(str(err), "", history, client, provider, model_name)
        ok, err, parsed = validate_llm_output(txt, activities)
        fixes += 1

    rules = parsed["constraints"] if parsed else []
    if rules:
        rules = _rule_stats(rules, materialize_log(log_artifact))
    return {"rules": rules, "activities": activities, "text": txt, "fixes": fixes,
            "history": history}
