"""Database access via SQLAlchemy Core.

goose owns the schema (see ``db/migrations``); we never define or migrate tables here.
Tables are *reflected* from the live database at startup, so this module stays a thin,
typed query surface over whatever goose has applied.
"""
from __future__ import annotations

from sqlalchemy import MetaData, Table, create_engine, text
from sqlalchemy.engine import Engine

from .config import settings

engine: Engine = create_engine(settings.sqlalchemy_url, pool_pre_ping=True, future=True)
metadata = MetaData()


def reflect() -> None:
    """Load table definitions from the database (call once schema is migrated)."""
    metadata.reflect(bind=engine)


def table(name: str) -> Table:
    """Return a reflected table, reflecting lazily if needed."""
    if name not in metadata.tables:
        Table(name, metadata, autoload_with=engine)
    return metadata.tables[name]


def healthy() -> bool:
    """True if a trivial query round-trips."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
