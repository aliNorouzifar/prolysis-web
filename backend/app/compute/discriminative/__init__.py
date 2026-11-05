"""Discriminative rule-learning (app-side, copied from unified_app/services/discriminative).

STATUS: copied verbatim, NOT yet adapted. Before wiring, fix the Windows-only path joins
(`path + r"\\file"`) to `os.path.join(...)` for Linux/Docker, and add a service wrapper
analogous to the old services/discriminative/service.py. See docs/REBUILD_STATUS.md.
"""
