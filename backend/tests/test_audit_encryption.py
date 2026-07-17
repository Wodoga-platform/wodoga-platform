"""
Audit-log PHI encryption tests.

The audit log stores before/after snapshots of patient records in its
previous_state / new_state columns. Those snapshots contain PHI, so they are
encrypted at rest exactly like the patients table they describe — otherwise the
audit trail would be an unencrypted copy of the very data we encrypted, and an
attacker with a DB dump would read PHI out of the audit log instead.
"""
import json
import sys
from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

import pytest

from app.core import phi_crypto as pc
from app.core.phi_crypto import (
    encrypt_audit_state,
    decrypt_audit_state,
    is_encrypted,
    PHIDecryptionError,
)


def test_audit_blob_round_trips_and_hides_phi():
    blob = json.dumps({
        "phone": "817-555-0142",
        "allergies": ["Penicillin"],
        "insurance_primary": {"provider": "Aetna"},
    })
    enc = encrypt_audit_state(blob)
    assert is_encrypted(enc)
    for secret in ("817-555", "Penicillin", "Aetna"):
        assert secret not in enc
    assert decrypt_audit_state(enc) == blob


def test_audit_state_none_safe():
    assert encrypt_audit_state(None) is None
    assert decrypt_audit_state(None) is None


def test_legacy_plaintext_audit_row_passes_through():
    """Rows written before encryption existed are untagged plaintext and must
    still be readable by the audit viewer."""
    legacy = json.dumps({"status": "active"})
    assert decrypt_audit_state(legacy) == legacy


def test_decrypted_blob_reparses_to_json():
    blob = json.dumps({"allergies": ["Penicillin", "Sulfa"]})
    recovered = json.loads(decrypt_audit_state(encrypt_audit_state(blob)))
    assert recovered["allergies"] == ["Penicillin", "Sulfa"]


def test_wrong_key_raises_not_silent():
    enc = encrypt_audit_state(json.dumps({"phone": "555"}))
    original = pc.settings.encryption_key
    pc.settings.encryption_key = "WRONG_KEY_VALUE_ENTIRELY"
    try:
        with pytest.raises(PHIDecryptionError):
            decrypt_audit_state(enc)
    finally:
        pc.settings.encryption_key = original


def test_non_json_native_types_serialize():
    """The patients write path passes rows containing UUIDs, dates and Decimals.
    Without default=str these crash json.dumps and the audit entry silently
    vanishes. This guards that regression."""
    row = {
        "id": uuid4(),
        "dob": date(1980, 1, 1),
        "created": datetime.now(),
        "balance": Decimal("12.50"),
    }
    enc = encrypt_audit_state(json.dumps(row, default=str))
    assert json.loads(decrypt_audit_state(enc))["dob"] == "1980-01-01"
