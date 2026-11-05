"""FastAPI application — the Python compute service.

Thin HTTP surface over ``prolysis``. Long-running work is deferred to the Procrastinate
worker (see ``app.jobs`` / ``app.tasks``); results are persisted to Postgres. The BFF calls
these endpoints over REST (OpenAPI); the frontend never talks to this service directly.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import settings
from .jobs import app as job_app
from .routers import artifacts, health, jobs, rules, sessions, uploads


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Open the Procrastinate connection pool so endpoints can defer jobs.
    async with job_app.open_async():
        try:
            db.reflect()  # load table metadata if the schema is already migrated
        except Exception:
            pass  # reflected lazily by db.table() otherwise
        yield


app = FastAPI(title="Prolysis Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(sessions.router)
app.include_router(uploads.router)
app.include_router(artifacts.router)
app.include_router(jobs.router)
app.include_router(rules.router)
