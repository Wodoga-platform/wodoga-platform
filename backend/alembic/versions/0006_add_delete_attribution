"""add deleted_by / cancelled_by audit columns to clinical tables

Revision ID: 0006_add_delete_attribution
Revises: 0005_caregiver_revoke_visits_create
Created: 2026-06-28

============================================================
CONTEXT:

The platform already has soft-delete mechanisms in place:
  - patients.deleted_at (column exists, endpoint already soft-deletes)
  - documents.deleted_at + is_active (column exists, endpoint already soft-deletes)
  - visits uses status='cancelled' + cancellation_reason
  - messages uses deleted_by_sender / deleted_by_recipient (per-side model)

What's MISSING from the existing soft-delete flows is the audit
attribution: WHO performed the soft-delete. For an EHR, this matters —
both for HIPAA auditability and operational accountability ("which
admin discharged this patient record?").

This migration adds:
  - patients.deleted_by    UUID NULL REFERENCES users(id)
  - documents.deleted_by   UUID NULL REFERENCES users(id)
  - visits.cancelled_by    UUID NULL REFERENCES users(id)

ON DELETE SET NULL: if a user account is later removed, we don't want
to orphan or break the soft-deleted records — we want the soft-delete
audit info to remain even if the actor's account is gone (their
attribution becomes NULL but the deleted_at / status='cancelled'
stays intact).

WHAT THIS DOES NOT DO (deliberately):
  - Does not add soft-delete columns to vitals, medications, care_plans,
    oasis_assessments, intake_forms. Those tables have NO delete endpoints
    today, so adding columns would be speculative.
  - Does not change any existing delete behavior. The endpoint code
    changes that populate these columns are separate (in patients.py,
    documents.py, visits.py).

IDEMPOTENCY: uses IF NOT EXISTS on column adds.
============================================================
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_add_delete_attribution"
down_revision: Union[str, Sequence[str], None] = "0005_caregiver_revoke_visits_create"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE patients
        ADD COLUMN IF NOT EXISTS deleted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
    """)
    op.execute("""
        ALTER TABLE documents
        ADD COLUMN IF NOT EXISTS deleted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
    """)
    op.execute("""
        ALTER TABLE visits
        ADD COLUMN IF NOT EXISTS cancelled_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
    """)

    # Verify all three columns landed
    connection = op.get_bind()
    checks = [
        ("patients", "deleted_by"),
        ("documents", "deleted_by"),
        ("visits", "cancelled_by"),
    ]
    for table, col in checks:
        exists = connection.execute(sa.text(f"""
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_name = '{table}' AND column_name = '{col}'
        """)).scalar()
        if exists != 1:
            raise RuntimeError(
                f"Migration verification failed: column {table}.{col} "
                f"was not created. Investigate before rerunning."
            )


def downgrade() -> None:
    """
    Drop the attribution columns. Existing soft-deleted records lose
    the 'who deleted this' information — the deletion fact remains
    (deleted_at / status), but the actor attribution is gone.
    """
    op.execute("ALTER TABLE visits    DROP COLUMN IF EXISTS cancelled_by")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS deleted_by")
    op.execute("ALTER TABLE patients  DROP COLUMN IF EXISTS deleted_by")
