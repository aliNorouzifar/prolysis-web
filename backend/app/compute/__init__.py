"""Compute layer — thin wrappers over prolysis (no algorithm logic lives here).

Mirrors the old ``unified_app/services`` boundary: functions take file paths / simple
values and return JSON-friendly results (a Graphviz dot string, an SVG, a metrics dict).
prolysis is imported lazily inside functions so the API process starts fast and the worker
owns the heavy imports.
"""
