"""revoke patients:edit from caregiver role

Revision ID: 0002_caregiver_revoke_patients_edit
Revises: 0001_baseline
Created: 2026-06-26

============================================================
CONTEXT (from ACCESS_CONTROL_AUDIT.md, finding Critical #2):

The caregiver role currently grants 'patients:edit', which allows caregivers
(CNAs, home health aides) to modify core patient demographics, addresses,
and insurance information. This exceeds the HIPAA minimum-necessary principle:
a caregiver's job is to provide care and document it, not to modify patient
records of administrative nature. If a caregiver needs to flag a demographic
issue, they should request the change through staff with patients:edit, not
make it themselves.

This migration removes 'patients:edit' from the caregiver role's permissions
array across all organizations.

IDEMPOTENCY: The Postgres `jsonb - text` operator removes the element if
present and returns the array unchanged if absent. Running this migration
twice is a no-op the second time.

VERIFICATION: After applying, run the SELECT in the verification block at
the end of upgrade() to confirm 'patients:edit' is no longer in any
caregiver's permissions. The migration logs the result of this check.
============================================================
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0002_caregiver_revoke_patients_edit"
down_revision: Union[str, Sequence[str], None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Remove 'patients:edit' from every caregiver role across all organizations.

    Uses Postgres's jsonb - text operator, which removes the element if
    present and is a no-op if absent. Idempotent.
    """
    # Step 1: Remove the permission from all caregiver roles
    op.execute("""
        UPDATE roles
        SET permissions = permissions - 'patients:edit'
        WHERE name = 'caregiver'
    """)

    # Step 2: Verify — count any remaining caregiver rows that still have
    # 'patients:edit'. Should be zero. If not, raise an error so the
    # migration fails loudly rather than silently leaving the gap open.
    connection = op.get_bind()
    result = connection.execute(sa.text("""
        SELECT COUNT(*) FROM roles
        WHERE name = 'caregiver'
        AND permissions @> '["patients:edit"]'::jsonb
    """)).scalar()

    if result and result > 0:
        raise RuntimeError(
            f"Migration verification failed: {result} caregiver role(s) "
            f"still have 'patients:edit' after the update. Investigate before "
            f"rerunning."
        )


def downgrade() -> None:
    """
    Restore 'patients:edit' to all caregiver roles.

    This is the inverse of upgrade(). Note: if an organization intentionally
    removed patients:edit from caregiver after this migration applied, this
    downgrade would re-add it for them too. Given that the policy reason
    for this revoke is HIPAA-driven, the assumption is that re-adding is
    the correct semantic for "undo this migration."

    Uses jsonb concatenation. Idempotent: if 'patients:edit' is already in
    the array, the second occurrence is harmless because we filter dupes
    with the WHERE clause guard before concatenating.
    """
    op.execute("""
        UPDATE roles
        SET permissions = permissions || '["patients:edit"]'::jsonb
        WHERE name = 'caregiver'
        AND NOT (permissions @> '["patients:edit"]'::jsonb)
    """)
