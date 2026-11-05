"""Liveness/readiness endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from .. import db

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "backend"}


@router.get("/health/db")
def health_db() -> dict:
    ok = db.healthy()
    return {"status": "ok" if ok else "unavailable", "database": ok}
