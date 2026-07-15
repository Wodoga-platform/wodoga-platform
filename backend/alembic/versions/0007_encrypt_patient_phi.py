"""encrypt patient PHI at rest (column type changes + backfill)

Revision ID: 0007_encrypt_patient_phi
Revises: 0006_add_delete_attribution
Created: 2026-07-13

============================================================
!!! THIS MIGRATION IS IRREVERSIBLE. TAKE A DATABASE BACKUP FIRST. !!!
============================================================

WHAT THIS DOES:
Converts the PHI-bearing columns on `patients` to encrypted TEXT, then
encrypts every existing row in place.

WHY IT CANNOT BE UNDONE:
Five columns change TYPE:

    allergies            TEXT[]            -> TEXT
    secondary_diagnoses  TEXT[]            -> TEXT
    emergency_contact    JSONB             -> TEXT
    insurance_primary    JSONB             -> TEXT
    insurance_secondary  JSONB             -> TEXT
    email                CITEXT            -> TEXT
    latitude             DOUBLE PRECISION  -> TEXT
    longitude            DOUBLE PRECISION  -> TEXT

(phone, address_line1, address_line2, medical_history and notes are already
TEXT and need no type change — only a value backfill.)

A downgrade would have to decrypt every row and reconstruct the original
array/JSONB/numeric types. If ENCRYPTION_KEY were unavailable or rotated at
that moment, the downgrade would destroy the data it was trying to restore.
Rather than ship a downgrade that can silently eat a patient's chart, this
migration refuses to downgrade. Restore from backup instead. That is why the
backup is not optional.

============================================================
THE TWO-PHASE DESIGN — AND WHY IT IS SAFE
============================================================

PHASE 1 converts the column types using `USING col::text`. This does NOT
destroy anything: Postgres renders each value into its readable text form.

    allergies   {Penicillin,Sulfa}       -> '{Penicillin,Sulfa}'
    insurance   {"provider": "Aetna"}    -> '{"provider": "Aetna"}'
    latitude    32.7357                  -> '32.7357'

PHASE 2 then reads those values back, encrypts them in Python, and writes the
ciphertext.

The reason this split matters: after Phase 1 but before Phase 2, the data is
plaintext text — and phi_crypto's decrypt helpers are built to pass UNTAGGED
values straight through as legacy plaintext. dec_list() specifically knows how
to parse a Postgres array literal like '{Penicillin,Sulfa}', and dec_json()
parses a raw JSON string.

So if this migration dies halfway through, or the backfill is interrupted, or
some rows encrypt and others do not, THE APPLICATION STILL WORKS AND STILL
READS ALLERGIES CORRECTLY. The system tolerates a mixed encrypted/plaintext
table. The failure mode is "some rows are not yet encrypted," which is a
security gap to finish closing — not "the allergy check broke," which is a
safety incident.

Phase 2 is also re-runnable: it skips any value already carrying the
`enc:v1:` tag, so running it twice will not double-encrypt.

============================================================
BEFORE YOU RUN THIS
============================================================
1. TAKE A BACKUP. `pg_dump` the database and verify the dump is non-empty.
2. Confirm ENCRYPTION_KEY is set in the environment the migration runs in,
   and that it is the SAME value the application uses. If they differ, the
   app will raise PHIDecryptionError on every patient read — loudly, by
   design, rather than silently serving garbage.
3. There is no PHI_BLIND_INDEX_KEY and none is needed. Nothing in the
   codebase looks a patient up by email (portal login authenticates against
   users.email and maps to the patient via patients.portal_user_id), so no
   blind index is required.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.phi_crypto import (
    ENC_PREFIX,
    enc_scalar,
    enc_list,
    enc_json,
    enc_float,
)

revision: str = "0007_encrypt_patient_phi"
down_revision: str = "0006_add_delete_attribution"
branch_labels = None
depends_on = None


# Columns already TEXT — value backfill only, no type change.
SCALAR_COLS = ("phone", "address_line1", "address_line2", "medical_history", "notes")


def upgrade() -> None:
    conn = op.get_bind()

    # ── PHASE 0: make sure latitude/longitude exist ──────────────────
    # On production they were created at app startup as DOUBLE PRECISION.
    # On a database built fresh from schema.sql they do not exist at all
    # (schema.sql never declared them). ADD COLUMN IF NOT EXISTS covers both:
    # it is a no-op when the column is already there in any type.
    op.execute("ALTER TABLE patients ADD COLUMN IF NOT EXISTS latitude TEXT")
    op.execute("ALTER TABLE patients ADD COLUMN IF NOT EXISTS longitude TEXT")

    # ── PHASE 1: type conversions (data-preserving) ──────────────────
    # `USING col::text` renders each value to its readable text form. No data
    # is lost here; the values are simply now plaintext strings, which the
    # application's decrypt helpers treat as legacy plaintext and pass through.
    op.execute("ALTER TABLE patients ALTER COLUMN allergies            TYPE TEXT USING allergies::text")
    op.execute("ALTER TABLE patients ALTER COLUMN secondary_diagnoses  TYPE TEXT USING secondary_diagnoses::text")
    op.execute("ALTER TABLE patients ALTER COLUMN emergency_contact    TYPE TEXT USING emergency_contact::text")
    op.execute("ALTER TABLE patients ALTER COLUMN insurance_primary    TYPE TEXT USING insurance_primary::text")
    op.execute("ALTER TABLE patients ALTER COLUMN insurance_secondary  TYPE TEXT USING insurance_secondary::text")
    op.execute("ALTER TABLE patients ALTER COLUMN email                TYPE TEXT USING email::text")
    op.execute("ALTER TABLE patients ALTER COLUMN latitude             TYPE TEXT USING latitude::text")
    op.execute("ALTER TABLE patients ALTER COLUMN longitude            TYPE TEXT USING longitude::text")

    # ── PHASE 2: backfill — encrypt every existing row ───────────────
    # Soft-deleted rows are included ON PURPOSE. A discharged or deleted
    # patient's chart is still PHI and still sits in the table; skipping it
    # would leave real patient data in the clear.
    rows = conn.execute(sa.text("""
        SELECT id, phone, email, address_line1, address_line2,
               medical_history, notes, allergies, secondary_diagnoses,
               emergency_contact, insurance_primary, insurance_secondary,
               latitude, longitude
        FROM patients
    """)).mappings().all()

    encrypted_rows = 0

    for row in rows:
        updates: dict = {}

        def already_tagged(v) -> bool:
            # Idempotency guard: never double-encrypt. Makes the backfill
            # safe to re-run if it was interrupted partway through.
            return isinstance(v, str) and v.startswith(ENC_PREFIX)

        # Plain text scalars
        for col in SCALAR_COLS + ("email",):
            val = row[col]
            if val is not None and not already_tagged(val):
                updates[col] = enc_scalar(val)

        # Lists. After Phase 1 these arrive as Postgres array literals, e.g.
        # '{Penicillin,Sulfa}' or '{}'. enc_list() needs a real Python list,
        # so parse the literal first.
        for col in ("allergies", "secondary_diagnoses"):
            val = row[col]
            if val is not None and not already_tagged(val):
                updates[col] = enc_list(_parse_pg_array(val))

        # JSON objects. After Phase 1 these arrive as JSON strings, which
        # enc_json() accepts directly (it encrypts the string as-is).
        for col in ("emergency_contact", "insurance_primary", "insurance_secondary"):
            val = row[col]
            if val is not None and not already_tagged(val):
                updates[col] = enc_json(val)

        # Coordinates. After Phase 1 these arrive as numeric strings.
        for col in ("latitude", "longitude"):
            val = row[col]
            if val is not None and not already_tagged(val):
                try:
                    updates[col] = enc_float(float(val))
                except (TypeError, ValueError):
                    # Unparseable coordinate — null it rather than store junk.
                    # A bad coordinate is not clinical data; losing it is safe.
                    updates[col] = None

        if not updates:
            continue

        set_sql = ", ".join(f"{c} = :{c}" for c in updates)
        updates["id"] = row["id"]
        conn.execute(sa.text(f"UPDATE patients SET {set_sql} WHERE id = :id"), updates)
        encrypted_rows += 1

    print(f"[0007] PHI encryption backfill complete: {encrypted_rows} "
          f"of {len(rows)} patient row(s) updated.")


def _parse_pg_array(literal) -> list[str]:
    """
    Turn a Postgres array literal — '{Penicillin,Sulfa}' — into a Python list.

    After Phase 1's `allergies::text` cast, that is the shape the value
    arrives in. This is only ever used inside this migration; the running
    application never sees an array literal, because by the time it reads the
    column the value is encrypted JSON.

    Handles the quoted form Postgres emits when an element contains a comma or
    a space, e.g. '{"Penicillin G","Sulfa drugs"}'.
    """
    if literal is None:
        return []
    if isinstance(literal, (list, tuple)):
        return [str(v) for v in literal]

    s = str(literal).strip()
    if s.startswith("{") and s.endswith("}"):
        s = s[1:-1]
    if not s.strip():
        return []

    out: list[str] = []
    current = ""
    in_quotes = False
    escaped = False
    for ch in s:
        if escaped:
            current += ch
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == '"':
            in_quotes = not in_quotes
        elif ch == "," and not in_quotes:
            out.append(current.strip())
            current = ""
        else:
            current += ch
    if current.strip():
        out.append(current.strip())

    return [v for v in out if v]


def downgrade() -> None:
    raise RuntimeError(
        "Migration 0007 (PHI encryption) cannot be downgraded.\n"
        "\n"
        "Reversing it would require decrypting every patient row and rebuilding "
        "the original TEXT[] / JSONB / DOUBLE PRECISION column types. If "
        "ENCRYPTION_KEY were missing or rotated at that moment, the downgrade "
        "would silently destroy the patient data it was meant to restore.\n"
        "\n"
        "Restore from the backup you took before running this migration."
    )
