"""
Wodoga Platform — PHI Encryption Tests
======================================

THE TEST THAT MATTERS IS test_allergy_check_still_fires_when_encrypted.

Every other bug in this system is a data-quality or UX problem. A botched
allergy path is a life-safety failure: it can approve a prescription for a
drug the patient is documented as allergic to, and say nothing.

The specific failure this file exists to prevent:

    `patients.allergies` used to be a Postgres TEXT[], which psycopg handed
    to the application as a Python list. It is now encrypted TEXT — a single
    base64 string like 'enc:v1:gAAAAAB...'.

    The old clinical_safety._normalize_tokens() had a "defensive" branch that
    coerced any non-list value to a string and split it on commas. Handed
    ciphertext, that branch would NOT raise. It would return
    ['enc:v1:gaaaaab...'] as a single allergy token, compare it against the
    drug name, match nothing, and report ZERO ALERTS — for a patient who is
    in fact allergic.

    Silent. Fail-open. On the one path that can kill someone.

These tests run against no database. They use a stub session that returns
exactly what Postgres would return for an encrypted column, which is the
whole point: the stub is what makes the ciphertext shape explicit.
"""
from __future__ import annotations

import pytest

from app.core import phi_crypto as pc
from app.core.clinical_safety import (
    AlertSeverity,
    AlertType,
    check_prescription_safety,
    has_blocking_alerts,
)


# ── A stub DB session ────────────────────────────────────────────────
# check_prescription_safety() runs two queries: the patient's allergies,
# then their active medications. This returns canned results for each, in
# the same shape SQLAlchemy's .mappings() would.

class _Result:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return self._rows


class StubSession:
    """Returns `allergies_value` for the allergy query, [] for duplicates."""

    def __init__(self, allergies_value, patient_exists=True):
        self.allergies_value = allergies_value
        self.patient_exists = patient_exists
        self._call = 0

    async def execute(self, stmt, params=None):
        self._call += 1
        sql = str(stmt)
        if "allergies" in sql:
            if not self.patient_exists:
                return _Result([])
            return _Result([{"allergies": self.allergies_value}])
        return _Result([])  # no duplicate-therapy rows


PATIENT_ID = "11111111-1111-1111-1111-111111111111"


# ═════════════════════════════════════════════════════════════════════
# THE CRITICAL TEST
# ═════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_allergy_check_still_fires_when_encrypted():
    """
    A patient is documented allergic to Penicillin. The allergies column is
    ENCRYPTED. Prescribing Amoxicillin (a penicillin-class drug) must still
    produce a blocking alert.

    If this test ever fails, the system will approve a prescription for a drug
    the chart says the patient is allergic to. Do not ship past a failure here.
    """
    encrypted = pc.enc_list(["Penicillin", "Sulfa"])

    # Sanity: this really is ciphertext, not a list.
    assert isinstance(encrypted, str)
    assert encrypted.startswith("enc:v1:")
    assert "Penicillin" not in encrypted

    db = StubSession(allergies_value=encrypted)
    alerts = await check_prescription_safety(
        db, PATIENT_ID, drug_name="Amoxicillin 500mg",
    )

    assert alerts, "NO ALERTS RAISED FOR AN ALLERGIC PATIENT — FAIL-OPEN"
    assert has_blocking_alerts(alerts) or any(
        a.type == AlertType.ALLERGY for a in alerts
    )
    assert any(a.trigger == "penicillin" for a in alerts)


@pytest.mark.asyncio
async def test_direct_allergy_match_when_encrypted():
    """Exact-name allergy match must be CRITICAL and must block."""
    db = StubSession(pc.enc_list(["Penicillin"]))
    alerts = await check_prescription_safety(db, PATIENT_ID, drug_name="Penicillin V")

    assert has_blocking_alerts(alerts)
    assert any(
        a.severity == AlertSeverity.CRITICAL and a.type == AlertType.ALLERGY
        for a in alerts
    )


# ═════════════════════════════════════════════════════════════════════
# FAIL-CLOSED BEHAVIOUR
# ═════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_unreadable_allergies_block_the_prescription():
    """
    If the allergies column cannot be decrypted — wrong key, rotated key,
    corrupted value — the system must BLOCK the prescription, not wave it
    through as "no concerns found."

    An empty alert list here would tell the prescriber the drug is safe when
    the truth is that we never checked.
    """
    ciphertext = pc.enc_list(["Penicillin"])

    original_key = pc.settings.encryption_key
    pc.settings.encryption_key = "A_DIFFERENT_KEY_THAN_THE_ONE_USED_TO_ENCRYPT"
    try:
        db = StubSession(ciphertext)
        alerts = await check_prescription_safety(db, PATIENT_ID, drug_name="Amoxicillin")

        assert alerts, "UNREADABLE ALLERGIES PRODUCED NO ALERTS — FAIL-OPEN"
        assert has_blocking_alerts(alerts), "Unreadable allergies did not BLOCK"
        assert any(a.type == AlertType.UNVERIFIABLE for a in alerts)
    finally:
        pc.settings.encryption_key = original_key


@pytest.mark.asyncio
async def test_missing_patient_blocks_the_prescription():
    """No patient row -> we cannot check allergies -> block, don't stay silent."""
    db = StubSession(None, patient_exists=False)
    alerts = await check_prescription_safety(db, PATIENT_ID, drug_name="Amoxicillin")

    assert has_blocking_alerts(alerts)
    assert any(a.type == AlertType.UNVERIFIABLE for a in alerts)


# ═════════════════════════════════════════════════════════════════════
# TRUE NEGATIVES — the check must not cry wolf
# ═════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_no_allergies_means_no_allergy_alert():
    """A patient with an empty (but readable) allergy list gets no alert."""
    db = StubSession(pc.enc_list([]))
    alerts = await check_prescription_safety(db, PATIENT_ID, drug_name="Amoxicillin")
    assert not [a for a in alerts if a.type in (AlertType.ALLERGY, AlertType.UNVERIFIABLE)]


@pytest.mark.asyncio
async def test_unrelated_drug_does_not_alert():
    """Penicillin allergy must not fire on an unrelated drug."""
    db = StubSession(pc.enc_list(["Penicillin"]))
    alerts = await check_prescription_safety(db, PATIENT_ID, drug_name="Metformin")
    assert not [a for a in alerts if a.type == AlertType.ALLERGY]


# ═════════════════════════════════════════════════════════════════════
# LEGACY / MIXED-STATE — the migration can be interrupted safely
# ═════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_legacy_plaintext_array_still_checked():
    """
    A row that has NOT yet been encrypted by the 0007 backfill still arrives
    as a plain Python list (legacy TEXT[]). The allergy check must still work,
    because the migration can be interrupted and the table can sit in a mixed
    encrypted/plaintext state.
    """
    db = StubSession(["Penicillin", "Sulfa"])   # untagged legacy list
    alerts = await check_prescription_safety(db, PATIENT_ID, drug_name="Amoxicillin")
    assert any(a.type == AlertType.ALLERGY for a in alerts)


@pytest.mark.asyncio
async def test_postgres_array_literal_still_checked():
    """
    Mid-migration, after Phase 1's `allergies::text` cast but before the Phase 2
    backfill, the value is a Postgres array literal: '{Penicillin,Sulfa}'.
    The allergy check must still work in that window.
    """
    db = StubSession("{Penicillin,Sulfa}")
    alerts = await check_prescription_safety(db, PATIENT_ID, drug_name="Amoxicillin")
    assert any(a.type == AlertType.ALLERGY for a in alerts)


# ═════════════════════════════════════════════════════════════════════
# REGRESSION GUARD — the exact bug this whole file exists to prevent
# ═════════════════════════════════════════════════════════════════════

def test_normalize_tokens_refuses_raw_ciphertext():
    """
    _normalize_tokens must REFUSE ciphertext rather than mangle it into a
    token. This is the guard against someone later "simplifying"
    clinical_safety by pointing it straight at the raw column again.
    """
    from app.core.clinical_safety import _normalize_tokens

    ciphertext = pc.enc_list(["Penicillin"])
    with pytest.raises(pc.PHIDecryptionError):
        _normalize_tokens(ciphertext)


def test_allergies_round_trip_exactly():
    """Encryption must not reorder, drop, or mutate allergy names."""
    original = ["Penicillin", "Sulfa", "Latex", "Peanut (severe)"]
    assert pc.decrypt_allergies_strict(pc.enc_list(original)) == original


def test_decrypt_allergies_strict_never_returns_a_string():
    """
    Contract: this function returns list[str] or raises. It must never hand
    back a bare string, because the caller iterates the result — and iterating
    a string yields CHARACTERS, which would silently produce nonsense tokens.
    """
    for value in (None, pc.enc_list([]), pc.enc_list(["Penicillin"]), ["Sulfa"]):
        result = pc.decrypt_allergies_strict(value)
        assert isinstance(result, list)
        assert all(isinstance(v, str) for v in result)
