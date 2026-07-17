"""change audit_logs state columns to TEXT for at-rest encryption

Revision ID: 0008_audit_state_text
Revises: 0007_encrypt_patient_phi
Created: 2026-07-17

WHY THIS EXISTS:
The audit log encrypts its `previous_state` / `new_state` snapshots at rest
(they contain patient PHI — a patient update logs the whole changed row). The
encrypted form is a tagged string, "enc:v1:...". But these two columns were
declared JSONB, and Postgres rejects a non-JSON string in a JSONB column:

    invalid input syntax for type json — Token "enc" is invalid.

That INSERT failure rolled back the surrounding transaction, which silently
discarded the patient UPDATE that triggered the audit write — so patient edits
appeared to save and then reverted. This migration fixes the root cause by
converting both columns to TEXT, exactly as migration 0007 did for the
encrypted columns on the patients table.

DATA NOTE:
`USING column::text` renders any existing value to its text form without loss:
  - legacy JSON snapshots  {"status":"active"}  ->  '{"status":"active"}'
The audit viewer's decrypt-on-read passes untagged legacy text straight
through as plaintext, so old rows remain readable. No backfill is required.
"""
from __future__ import annotations

from alembic import op

revision: str = "0008_audit_state_text"
down_revision: str = "0007_encrypt_patient_phi"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE audit_logs ALTER COLUMN previous_state TYPE TEXT USING previous_state::text")
    op.execute("ALTER TABLE audit_logs ALTER COLUMN new_state     TYPE TEXT USING new_state::text")


def downgrade() -> None:
    # Reversible only if every value is valid JSON. Encrypted rows are NOT
    # valid JSON, so a blind cast back to JSONB would fail on them. Refuse
    # rather than corrupt; restore from backup if a reversal is ever needed.
    raise RuntimeError(
        "Migration 0008 cannot be safely downgraded: encrypted audit state "
        "values are not valid JSON and cannot be cast back to JSONB."
    )
