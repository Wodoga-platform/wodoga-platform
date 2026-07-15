"""revoke visits:create from caregiver role

Revision ID: 0005_caregiver_revoke_visits_create
Revises: 0004_pharmacy_revoke_med_reconcile
Created: 2026-06-28

============================================================
CONTEXT (from PERMISSION_AUDIT_V2.md, DISCUSS item resolved):

In real home-health workflow, office staff (admin / scheduling coordinator)
schedule visits; caregivers receive their assignments and execute the
visit (check in, document, record vitals, write SOAP notes). A caregiver
scheduling their own visit is a workflow anomaly, not a real clinical
pattern.

This migration removes 'visits:create' from the caregiver role. They
retain visits:view, visits:checkin, visits:soap_note — everything needed
to receive and complete an assignment.

IDEMPOTENCY: jsonb - text is no-op if absent.
============================================================
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_caregiver_revoke_visits_create"
down_revision: Union[str, Sequence[str], None] = "0004_pharmacy_revoke_med_reconcile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE roles
        SET permissions = permissions - 'visits:create'
        WHERE name = 'caregiver'
    """)
    connection = op.get_bind()
    remaining = connection.execute(sa.text("""
        SELECT COUNT(*) FROM roles
        WHERE name = 'caregiver'
        AND permissions @> '["visits:create"]'::jsonb
    """)).scalar()
    if remaining and remaining > 0:
        raise RuntimeError(
            f"Verification failed: {remaining} caregiver role(s) still have "
            f"'visits:create'. Investigate before rerunning."
        )


def downgrade() -> None:
    op.execute("""
        UPDATE roles
        SET permissions = permissions || '["visits:create"]'::jsonb
        WHERE name = 'caregiver'
        AND NOT (permissions @> '["visits:create"]'::jsonb)
    """)
