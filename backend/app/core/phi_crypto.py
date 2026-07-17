"""
Wodoga Platform — PHI Field Encryption
======================================

WHAT THIS MODULE IS (plain English):
Certain columns on the `patients` table hold information that would cause
real harm to a real person if a database backup ever leaked: their home
address, phone number, allergies, medical history, insurance details,
emergency contact, and the GPS coordinates of their home. This module
encrypts those values before they are written to the database and decrypts
them when they are read back.

THE THREAT MODEL — BE PRECISE ABOUT THIS:
This protects against ONE specific thing: **an attacker who obtains the
database contents but not the application's encryption key.** That covers
a leaked backup, a stolen disk snapshot, a misconfigured DB port, a
compromised read-replica, or a rogue DBA.

It does NOT protect against an attacker who compromises the application
server, because the app must hold the key in order to function. Anyone with
the running app has the key and can read everything. Row-level security and
authentication remain the defence there — encryption is a second layer, not
a replacement for the first.

DESIGN DECISION — THE VERSION TAG:
Every encrypted value is stored with a literal prefix: "enc:v1:".

This is not decoration. It makes the state of a value UNAMBIGUOUS:

  - Value starts with the tag  → it IS encrypted. We must be able to
                                 decrypt it. If we cannot, we RAISE.
  - Value has no tag           → it is genuine legacy plaintext, written
                                 before this module existed. Pass it through.

The naive alternative — "try to decrypt, and if it fails assume plaintext"
— is actively dangerous. It cannot tell "this is plaintext" apart from
"this is ciphertext and my key is wrong." Under a rotated or misconfigured
ENCRYPTION_KEY, that design would silently hand ciphertext back to the
application as though it were real data. For a field like `allergies`, that
means the allergy check would compare a drug name against a base64 blob,
find no match, and report "no allergy conflicts" for a patient who is in
fact allergic. That is a mechanism for a fatal prescribing error.

So: a decrypt failure on a tagged value is LOUD. It raises. The request
500s. A 500 is recoverable; a silently-missed allergy is not.

WHAT IS ENCRYPTED, AND WHAT DELIBERATELY IS NOT:
Encrypted columns cannot be searched with ILIKE, sorted with ORDER BY, or
filtered with an index, because the database only ever sees ciphertext. So
this is a deliberate, documented trade:

  ENCRYPTED  — phone, email, address_line1, address_line2, latitude,
               longitude, medical_history, notes, secondary_diagnoses,
               allergies, emergency_contact, insurance_primary,
               insurance_secondary

  PLAINTEXT  — first_name, last_name, mrn, date_of_birth, city, state, zip,
               primary_diagnosis, gender, blood_type, status, fall_risk

The plaintext set is exactly the set the application must search, sort, or
filter on (patient list search, name ordering, status filters). Those remain
protected by row-level security, authentication, and disk-level encryption.
This is a real residual risk and it is accepted knowingly, not overlooked.

NOTE ON latitude/longitude: these are encrypted even though address_line1
could be considered "the address," because a lat/lon pins a patient's home
more precisely than a street line does. Leaving them in the clear would have
undone most of the value of encrypting the address. Nothing in the codebase
does numeric comparison or ORDER BY on them — only IS NOT NULL checks, which
work identically on a text column — so encrypting them costs nothing.
"""
from __future__ import annotations

import base64
import hashlib
import json
from typing import Any, Iterable, Optional

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

settings = get_settings()

# ── The version tag ──────────────────────────────────────────────────
# Present  → the value is ciphertext produced by this module.
# Absent   → the value is legacy plaintext from before encryption existed.
ENC_PREFIX = "enc:v1:"


class PHIDecryptionError(RuntimeError):
    """
    Raised when a value is TAGGED as encrypted but cannot be decrypted.

    This is deliberately fatal. It means the encryption key is wrong,
    rotated, or missing. The only safe response is to fail the request
    loudly rather than hand undecryptable bytes back to the application
    as if they were patient data.
    """


def _get_cipher() -> Fernet:
    """
    Build the Fernet cipher from settings.encryption_key.

    Mirrors the key-derivation behaviour already used in core/security.py
    (which encrypts MFA secrets) so that both modules accept the same
    ENCRYPTION_KEY value and neither is more permissive than the other.
    """
    key = settings.encryption_key
    if len(key) != 44:  # not already a valid urlsafe-b64 Fernet key
        key_bytes = hashlib.sha256(key.encode()).digest()
        key = base64.urlsafe_b64encode(key_bytes).decode()
    return Fernet(key.encode())


def is_encrypted(value: Any) -> bool:
    """True if this value carries the encryption tag."""
    return isinstance(value, str) and value.startswith(ENC_PREFIX)


# ── Core primitives ──────────────────────────────────────────────────

def _encrypt_str(plaintext: str) -> str:
    """Encrypt a string and tag it. Never called with None."""
    token = _get_cipher().encrypt(plaintext.encode()).decode()
    return ENC_PREFIX + token


def _decrypt_str(value: str) -> str:
    """
    Decrypt a tagged string.

    Raises PHIDecryptionError if the value is tagged but undecryptable.
    Untagged values are returned as-is (legacy plaintext).
    """
    if not is_encrypted(value):
        return value  # legacy plaintext, written before encryption existed
    token = value[len(ENC_PREFIX):]
    try:
        return _get_cipher().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError, TypeError) as exc:
        raise PHIDecryptionError(
            "A patient field is tagged as encrypted but could not be "
            "decrypted. This almost always means ENCRYPTION_KEY is wrong, "
            "missing, or was rotated without re-encrypting existing rows. "
            "Refusing to return undecryptable data as if it were patient "
            "information."
        ) from exc


# ── Typed helpers: scalar (TEXT columns) ─────────────────────────────

def enc_scalar(value: Optional[str]) -> Optional[str]:
    """Encrypt a plain text field (phone, address_line1, notes, ...)."""
    if value is None:
        return None
    return _encrypt_str(str(value))


def dec_scalar(value: Optional[str]) -> Optional[str]:
    """Decrypt a plain text field."""
    if value is None:
        return None
    return _decrypt_str(value)


# ── Typed helpers: list (was TEXT[], now TEXT) ───────────────────────
# allergies, secondary_diagnoses

def enc_list(value: Optional[Iterable[str]]) -> Optional[str]:
    """
    Encrypt a list of strings into a single tagged text value.

    An empty list encrypts to an encrypted "[]" rather than NULL, so that
    "the clinician recorded no known allergies" stays distinguishable from
    "nobody has asked about allergies yet" (NULL).
    """
    if value is None:
        return None
    items = [str(v) for v in value]
    return _encrypt_str(json.dumps(items))


def dec_list(value: Optional[str]) -> Optional[list[str]]:
    """
    Decrypt a text value back into a list of strings.

    Handles three input shapes:
      - tagged ciphertext              → decrypt, parse JSON, return list
      - a real Python list             → legacy TEXT[] row not yet migrated
      - untagged string                → legacy plaintext; best-effort split

    GUARANTEE: the return value is None or a genuine list[str]. It is never
    a raw string. Callers that iterate the result (the allergy check does)
    can rely on that.
    """
    if value is None:
        return None

    # Legacy: psycopg already turned a TEXT[] column into a Python list.
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value]

    plain = _decrypt_str(value)  # raises loudly if tagged-but-broken

    try:
        parsed = json.loads(plain)
    except (json.JSONDecodeError, TypeError):
        # Legacy untagged plaintext that isn't JSON — e.g. "Penicillin, Sulfa"
        # or Postgres's own array literal "{Penicillin,Sulfa}".
        s = plain.strip().strip("{}")
        if not s:
            return []
        return [p.strip().strip('"') for p in s.split(",") if p.strip()]

    if isinstance(parsed, list):
        return [str(v) for v in parsed]
    # Decrypted to something that isn't a list — treat as a single item.
    return [str(parsed)]


# ── Typed helpers: JSON object (was JSONB, now TEXT) ─────────────────
# emergency_contact, insurance_primary, insurance_secondary

def enc_json(value: Optional[dict | str]) -> Optional[str]:
    """
    Encrypt a JSON object into a single tagged text value.

    Accepts either a dict or an already-serialised JSON string, because the
    existing call sites json.dumps() before binding the parameter.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return _encrypt_str(value)
    return _encrypt_str(json.dumps(value))


def dec_json(value: Optional[str]) -> Optional[dict]:
    """
    Decrypt a text value back into a dict.

    Legacy rows may already be dicts (psycopg decodes JSONB automatically),
    in which case they pass straight through.
    """
    if value is None:
        return None
    if isinstance(value, dict):
        return value  # legacy JSONB row, not yet migrated
    plain = _decrypt_str(value)
    try:
        parsed = json.loads(plain)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


# ── Typed helpers: float (was DOUBLE PRECISION, now TEXT) ────────────
# latitude, longitude

def enc_float(value: Optional[float]) -> Optional[str]:
    """Encrypt a coordinate."""
    if value is None:
        return None
    return _encrypt_str(repr(float(value)))


def dec_float(value: Optional[str]) -> Optional[float]:
    """
    Decrypt a coordinate back to a float.

    The frontend map expects numbers, not strings, so this casts back.
    Legacy rows may still be real floats and pass straight through.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)  # legacy DOUBLE PRECISION row
    plain = _decrypt_str(value)
    try:
        return float(plain)
    except (TypeError, ValueError):
        return None


# ── The column map — SINGLE SOURCE OF TRUTH ──────────────────────────
# Every read and write path imports these sets. If a column is added to
# the encrypted set here, the row-level helpers below pick it up
# automatically. Do not hardcode column names at call sites.

PATIENT_ENC_SCALARS: tuple[str, ...] = (
    "phone",
    "email",
    "address_line1",
    "address_line2",
    "medical_history",
    "notes",
)

PATIENT_ENC_LISTS: tuple[str, ...] = (
    "allergies",
    "secondary_diagnoses",
)

PATIENT_ENC_JSON: tuple[str, ...] = (
    "emergency_contact",
    "insurance_primary",
    "insurance_secondary",
)

PATIENT_ENC_FLOATS: tuple[str, ...] = (
    "latitude",
    "longitude",
)

PATIENT_ENCRYPTED_COLUMNS: tuple[str, ...] = (
    PATIENT_ENC_SCALARS + PATIENT_ENC_LISTS + PATIENT_ENC_JSON + PATIENT_ENC_FLOATS
)


# ── Row-level helpers ────────────────────────────────────────────────

def encrypt_patient_fields(data: dict) -> dict:
    """
    Encrypt every PHI field present in a dict of patient values, ready to be
    bound as SQL parameters. Fields not present are left absent — this is
    safe for partial updates (PATCH), which only send changed fields.

    Returns a NEW dict; the input is not mutated.
    """
    out = dict(data)
    for col in PATIENT_ENC_SCALARS:
        if col in out:
            out[col] = enc_scalar(out[col])
    for col in PATIENT_ENC_LISTS:
        if col in out:
            out[col] = enc_list(out[col])
    for col in PATIENT_ENC_JSON:
        if col in out:
            out[col] = enc_json(out[col])
    for col in PATIENT_ENC_FLOATS:
        if col in out:
            out[col] = enc_float(out[col])
    return out


def decrypt_patient_row(row: Any) -> Optional[dict]:
    """
    Decrypt every PHI field present in a patient row read from the database.

    Accepts a SQLAlchemy RowMapping or a plain dict. Returns a plain dict, or
    None if the row is None (so callers can pass a .first() result straight
    in). Columns absent from the row — because the SELECT didn't ask for
    them, or because a biller had them stripped — are simply skipped.

    Raises PHIDecryptionError if any tagged field cannot be decrypted.
    """
    if row is None:
        return None
    out = dict(row)
    for col in PATIENT_ENC_SCALARS:
        if col in out:
            out[col] = dec_scalar(out[col])
    for col in PATIENT_ENC_LISTS:
        if col in out:
            out[col] = dec_list(out[col])
    for col in PATIENT_ENC_JSON:
        if col in out:
            out[col] = dec_json(out[col])
    for col in PATIENT_ENC_FLOATS:
        if col in out:
            out[col] = dec_float(out[col])
    return out


def decrypt_patient_rows(rows: Iterable[Any]) -> list[dict]:
    """Decrypt a list of patient rows. See decrypt_patient_row."""
    return [decrypt_patient_row(r) for r in rows]


# ── Audit-log state blobs ────────────────────────────────────────────
# The audit log stores before/after snapshots of records in its
# `previous_state` / `new_state` columns as JSON strings. Those snapshots
# contain patient PHI (a patient update logs the whole changed row), so the
# audit trail must be encrypted at rest exactly like the patients table it
# describes — otherwise an attacker who gets a DB dump simply reads the PHI
# out of the audit log instead of the (now encrypted) patients table.
#
# These are named separately from enc_scalar/dec_scalar purely so the audit
# path is greppable and self-explanatory. The audit logger already
# json.dumps() the blob before it gets here, so we treat it as a scalar
# string: encrypt the whole serialised blob as one tagged value.

def encrypt_audit_state(json_blob: Optional[str]) -> Optional[str]:
    """Encrypt a serialised audit state blob (a JSON string) for storage."""
    if json_blob is None:
        return None
    return _encrypt_str(json_blob)


def decrypt_audit_state(value: Optional[str]) -> Optional[str]:
    """
    Decrypt an audit state blob back to its JSON string.

    Untagged legacy rows — audit entries written before this encryption
    existed — pass straight through as plaintext, so the audit viewer keeps
    working across the mixed-state boundary. Unlike the allergy path, a
    decrypt failure here is NOT life-safety critical, but we still let it
    raise rather than silently return ciphertext, so a key problem surfaces
    loudly instead of showing an admin an unreadable blob as if it were data.
    """
    if value is None:
        return None
    return _decrypt_str(value)


# ── The life-safety accessor ─────────────────────────────────────────

def decrypt_allergies_strict(value: Any) -> list[str]:
    """
    Decrypt the `allergies` column for the CLINICAL SAFETY check.

    This exists as a separate, named function — rather than letting
    clinical_safety.py reach for dec_list() — because it is the one path in
    this system where a silent failure could contribute to a patient's death,
    and it should be greppable, testable, and impossible to confuse with an
    ordinary field read.

    CONTRACT: returns a genuine list[str], or RAISES. It never returns a
    string, never returns None, and never quietly returns [] to paper over a
    decryption problem. An empty list from this function means, and only
    means, "this patient has no recorded allergies."

    The caller (check_prescription_safety) must treat any exception from this
    function as "I cannot verify allergies" and FAIL CLOSED — block the
    prescription — rather than proceeding as though the patient had none.
    """
    if value is None:
        return []
    result = dec_list(value)  # raises PHIDecryptionError on a broken tag
    if result is None:
        return []
    if not isinstance(result, list):
        # Should be unreachable given dec_list's guarantee, but this is the
        # allergy path: assert the contract rather than trust it.
        raise PHIDecryptionError(
            "Allergy data did not decrypt to a list. Refusing to run an "
            "allergy check against a value of unknown shape."
        )
    return [str(v) for v in result]
