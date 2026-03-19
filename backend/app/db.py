"""Database setup and session management for Loom backend."""
import logging
import os
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator

logger = logging.getLogger(__name__)

# Get LOOM_DATABASE_URL from environment, default to SQLite
DATABASE_URL = os.getenv("LOOM_DATABASE_URL", "sqlite:///./loom.db")

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
        ("agents", "source", "VARCHAR"),
        ("agents", "deployment_status", "VARCHAR"),
        ("agents", "execution_role_arn", "VARCHAR"),
        ("agents", "code_uri", "VARCHAR"),
        ("agents", "config_hash", "VARCHAR"),
        ("agents", "deployed_at", "DATETIME"),
        ("agents", "endpoint_name", "VARCHAR"),
        ("agents", "endpoint_arn", "VARCHAR"),
        ("agents", "endpoint_status", "VARCHAR"),
        ("agents", "protocol", "VARCHAR"),
        ("agents", "network_mode", "VARCHAR"),
        ("agents", "tags", "TEXT"),
        ("memories", "tags", "TEXT"),
        ("managed_roles", "tags", "TEXT"),
        ("authorizer_configs", "tags", "TEXT"),
        ("a2a_agents", "agentcore_session_id", "VARCHAR"),
        ("invocations", "input_tokens", "INTEGER"),
        ("invocations", "output_tokens", "INTEGER"),
        ("invocations", "estimated_cost", "REAL"),
        ("invocations", "compute_cost", "REAL"),
        ("invocations", "compute_cpu_cost", "REAL"),
        ("invocations", "compute_memory_cost", "REAL"),
        ("invocations", "idle_timeout_cost", "REAL"),
        ("invocations", "idle_cpu_cost", "REAL"),
        ("invocations", "idle_memory_cost", "REAL"),
        ("invocations", "memory_retrievals", "INTEGER"),
        ("invocations", "memory_events_sent", "INTEGER"),
        ("invocations", "memory_estimated_cost", "REAL"),
        ("invocations", "stm_cost", "REAL"),
        ("invocations", "ltm_cost", "REAL"),
        ("invocations", "cost_source", "VARCHAR"),
        ("invocations", "request_id", "VARCHAR"),
    ]

    for table, column, col_type in migrations:
        if not insp.has_table(table):
            continue
        existing = {c["name"] for c in insp.get_columns(table)}
        if column not in existing:
            logger.info("Migrating: ALTER TABLE %s ADD COLUMN %s %s", table, column, col_type)
            with eng.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))


def _seed_default_tags(eng) -> None:
    """Seed default tag policies if they do not already exist."""
    from app.models.tag_policy import TagPolicy

    session = sessionmaker(bind=eng)()
    try:
        defaults = [
            {"key": "loom:application", "default_value": None, "required": True, "show_on_card": True},
            {"key": "loom:group", "default_value": None, "required": True, "show_on_card": True},
            {"key": "loom:owner", "default_value": None, "required": True, "show_on_card": True},
        ]
        # Remove legacy tags replaced by loom:* prefixed versions
        legacy_keys = ["application", "team", "owner", "deployed-by"]
        session.query(TagPolicy).filter(TagPolicy.key.in_(legacy_keys)).delete(synchronize_session="fetch")

        for tag_def in defaults:
            existing = session.query(TagPolicy).filter(TagPolicy.key == tag_def["key"]).first()
            if not existing:
                session.add(TagPolicy(**tag_def))
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db() -> None:
    """
    Initialize the database by creating all tables.

    Called during application startup.
    """
    Base.metadata.create_all(bind=engine)
    _migrate_add_columns(engine)
    _seed_default_tags(engine)
