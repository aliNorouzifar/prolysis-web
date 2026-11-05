"""Declare discovery for the discriminative tool.

Formerly shelled out to MINERful.jar and Janus.jar; both are now replaced by the
pure-Python engine in ``prolysis.declare`` (measures + hierarchy pruning are bit-exact
with MINERful; per-trace verdicts are bit-exact with Janus). No Java is required.
"""
from __future__ import annotations

from prolysis.declare.discovery import discover_from_log


def discover_declare(input_log_path, output_log_path, s, c):
    """Discover Declare constraints (support>=s, confidence>=c) with hierarchy pruning."""
    discover_from_log(input_log_path, output_log_path,
                      support=float(s), confidence=float(c), prune="hierarchy")


def discover_declare_no_prune(input_log_path, output_log_path):
    """Discover Declare constraints at a near-zero support floor, hierarchy-pruned.

    Mirrors the legacy call (named ``_no_prune`` but historically run with
    ``-prune hierarchy``); kept identical for exact feature-set parity.
    """
    discover_from_log(input_log_path, output_log_path,
                      support=1e-8, confidence=0.0, prune="hierarchy")
