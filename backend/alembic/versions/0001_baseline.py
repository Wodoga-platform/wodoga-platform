"""baseline: mark existing schema as version 1

Revision ID: 0001_baseline
Revises:
Created: 2026-06-25 (the day Alembic was introduced to Wodoga)

============================================================
THIS IS THE BASELINE MIGRATION

What it does: NOTHING. Intentionally.

Why it exists: When Alembic is introduced to an existing database, it needs
a "version zero" to anchor the migration chain. This file is that anchor.

How it's used:
  - On a database that ALREADY has the Wodoga schema (i.e. production, where
    schema.sql has been applied), run:
        alembic stamp head
    This inserts a row into alembic_version saying "we are at 0001_baseline"
    WITHOUT running upgrade(). No schema changes occur.

  - On a database that does NOT have the schema yet (i.e. a fresh dev
    database), do NOT use this migration to create the schema. Instead,
    apply database/schema.sql first, then `alembic stamp head`. The
    baseline assumes schema.sql is the source of truth for the initial
    state.

What this is NOT: a way to recreate the schema from scratch. That's
schema.sql's job. Alembic's job starts AFTER this baseline.

After this migration, EVERY schema change is a new Alembic migration. The
hand-running-ALTER-statements era ends here.
============================================================
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0001_baseline"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Intentionally empty. The schema already exists (created via schema.sql).
    Running this migration with `alembic upgrade` against a fresh DB will
    do nothing — which is correct, because the fresh DB should be set up
    via schema.sql first.

    The intended use is `alembic stamp head` against an existing DB, which
    marks this as applied WITHOUT calling upgrade().
    """
    pass


def downgrade() -> None:
    """
    No downgrade. You cannot 'undo' the existence of the baseline schema
    through Alembic — that would be schema.sql in reverse, and we don't
    support dropping the entire schema as a migration.
    """
    raise NotImplementedError(
        "The baseline migration cannot be downgraded. To reset the database, "
        "use schema management tools outside Alembic."
    )
