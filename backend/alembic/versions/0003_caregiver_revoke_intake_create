"""revoke intake_forms:create from caregiver role

Revision ID: 0003_caregiver_revoke_intake_create
Revises: 0002_caregiver_revoke_patients_edit
Created: 2026-06-26

============================================================
CONTEXT (from PERMISSION_AUDIT_V2.md):

The caregiver role currently grants 'intake_forms:create'. In real clinical
workflow, CNAs and home health aides do NOT perform formal patient intake —
that's a clinical or administrative responsibility. Caregivers deliver care;
they don't onboard patients.

This migration removes 'intake_forms:create' from the caregiver role.
Caregivers retain 'intake_forms:view' so they can read prior intake for
context during a visit.

IDEMPOTENCY: Uses the jsonb - text operator (no-op if absent).
============================================================
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_caregiver_revoke_intake_create"
down_revision: Union[str, Sequence[str], None] = "0002_caregiver_revoke_patients_edit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE roles
        SET permissions = permissions - 'intake_forms:create'
        WHERE name = 'caregiver'
    """)
    connection = op.get_bind()
    remaining = connection.execute(sa.text("""
        SELECT COUNT(*) FROM roles
        WHERE name = 'caregiver'
        AND permissions @> '["intake_forms:create"]'::jsonb
    """)).scalar()
    if remaining and remaining > 0:
        raise RuntimeError(
            f"Verification failed: {remaining} caregiver role(s) still have "
            f"'intake_forms:create'. Investigate before rerunning."
        )


def downgrade() -> None:
    op.execute("""
        UPDATE roles
        SET permissions = permissions || '["intake_forms:create"]'::jsonb
        WHERE name = 'caregiver'
        AND NOT (permissions @> '["intake_forms:create"]'::jsonb)
    """)
