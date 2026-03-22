#!/usr/bin/env python3
"""Reset PostgreSQL sequences after data migration from SQLite.

When migrating data with explicit IDs, PostgreSQL sequences are not
updated automatically. This script resets each sequence to the current
max ID in its table so that new inserts do not collide.
"""
import os
import sys
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("LOOM_DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: LOOM_DATABASE_URL is not set", file=sys.stderr)
    sys.exit(1)
if DATABASE_URL.startswith("sqlite"):
    print("ERROR: This script is only needed for PostgreSQL databases", file=sys.stderr)
    sys.exit(1)

engine = create_engine(DATABASE_URL)

with engine.begin() as conn:
    result = conn.execute(text("""
        SELECT table_name
        FROM information_schema.columns
        WHERE column_name = 'id'
          AND table_schema = 'public'
          AND column_default LIKE 'nextval%%'
        ORDER BY table_name
    """))
    tables = [row[0] for row in result]

    if not tables:
        print("No sequences found to reset.")
        sys.exit(0)

    for table in tables:
        row = conn.execute(text(f"SELECT COALESCE(MAX(id), 1) FROM {table}")).scalar()
        conn.execute(text(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), :max_id)"), {"max_id": row})
        print(f"  {table}: sequence reset to {row}")

print("Done.")
