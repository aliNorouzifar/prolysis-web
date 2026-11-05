"""Procrastinate application — the Postgres-backed async job queue.

Procrastinate uses Postgres itself as the broker (no Redis), which keeps the whole system
on a single datastore. Tasks are defined in ``app.tasks`` and auto-imported here so both
the FastAPI process (which *defers* jobs) and the worker process (which *runs* them) share
the same registry.
"""
from __future__ import annotations

from procrastinate import App, PsycopgConnector

from .config import settings

app = App(
    connector=PsycopgConnector(conninfo=settings.database_url),
    import_paths=["app.tasks"],
)
