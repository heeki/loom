"""Database setup and session management for Loom backend."""
import logging
import os
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator

logger = logging.getLogger(__name__)

# Get DATABASE_URL from environment, default to SQLite
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./loom.db")

# Create SQLAlchemy engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    echo=False,
)

# Enable foreign key constraints for SQLite
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for ORM models
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    Dependency function for FastAPI routes.

    Yields a database session and ensures it's closed after use.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_add_columns(eng) -> None:
    """Add missing columns to existing tables.

    SQLAlchemy's create_all() does not alter existing tables, so this
    helper inspects the live schema and issues ALTER TABLE statements
    for any columns that are defined in the ORM but absent from the DB.
    """
    insp = inspect(eng)
    migrations: list[tuple[str, str, str]] = [
        ("invocations", "prompt_text", "TEXT"),
        ("invocations", "thinking_text", "TEXT"),
        ("invocations", "response_text", "TEXT"),
    ]

    for table, column, col_type in migrations:
        if not insp.has_table(table):
            continue
        existing = {c["name"] for c in insp.get_columns(table)}
        if column not in existing:
            logger.info("Migrating: ALTER TABLE %s ADD COLUMN %s %s", table, column, col_type)
            with eng.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))


def init_db() -> None:
    """
    Initialize the database by creating all tables.

    Called during application startup.
    """
    Base.metadata.create_all(bind=engine)
    _migrate_add_columns(engine)
