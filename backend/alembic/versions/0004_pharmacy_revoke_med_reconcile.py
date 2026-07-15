"""revoke medications:reconcile from pharmacy_staff role

Revision ID: 0004_pharmacy_revoke_med_reconcile
Revises: 0003_caregiver_revoke_intake_create
Created: 2026-06-26

============================================================
CONTEXT (from PERMISSION_AUDIT_V2.md):

The pharmacy_staff role currently grants 'medications:reconcile'. Reviewing
the reconciliation endpoint shows that this action marks a reconciliation
as 'reviewed' (discrepancies addressed) or 'escalated' (needs prescriber/
pharmacist attention) — both of which are CLINICAL JUDGMENT calls that
belong to the provider, not the pharmacy staff who fulfilled the order.

Pharmacy staff *surface* discrepancies (they see them when filling); the
clinical *resolution* belongs to the prescriber. This matches how real
pharmacy/clinical workflows operate.

This migration removes 'medications:reconcile' from pharmacy_staff. They
retain 'medications:view' (must see the list to fulfill orders).

IDEMPOTENCY: jsonb - text is no-op if absent.
============================================================
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_pharmacy_revoke_med_reconcile"
down_revision: Union[str, Sequence[str], None] = "0003_caregiver_revoke_intake_create"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE roles
        SET permissions = permissions - 'medications:reconcile'
        WHERE name = 'pharmacy_staff'
    """)
    connection = op.get_bind()
    remaining = connection.execute(sa.text("""
        SELECT COUNT(*) FROM roles
        WHERE name = 'pharmacy_staff'
        AND permissions @> '["medications:reconcile"]'::jsonb
    """)).scalar()
    if remaining and remaining > 0:
        raise RuntimeError(
            f"Verification failed: {remaining} pharmacy_staff role(s) still "
            f"have 'medications:reconcile'. Investigate before rerunning."
        )


def downgrade() -> None:
    op.execute("""
        UPDATE roles
        SET permissions = permissions || '["medications:reconcile"]'::jsonb
        WHERE name = 'pharmacy_staff'
        AND NOT (permissions @> '["medications:reconcile"]'::jsonb)
    """)
