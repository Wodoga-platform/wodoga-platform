"""
Wodoga Platform — Clinical Safety Tests
=========================================

WHAT THESE PROVE (plain English):
The clinical safety module is what stops a prescription that matches a
patient's documented allergy. These tests pin its behavior so a future
change can't silently weaken the check that prevents a fatal medication
error.

The DB-dependent full check (check_prescription_safety) needs a database
and is covered by integration tests. These cover the pure logic that can
run anywhere: normalization, cross-reactivity mapping, and the
blocking-severity decision.

Run:
    pytest tests/test_clinical_safety.py -v --noconftest
"""
import pytest

from app.core.clinical_safety import (
    _normalize_tokens,
    _CROSS_REACTIVITY,
    SafetyAlert,
    AlertSeverity,
    AlertType,
    has_blocking_alerts,
)


# ── Normalization ────────────────────────────────────────────

def test_normalize_list_lowercases_and_strips():
    assert _normalize_tokens(["Penicillin", "  Sulfa  "]) == ["penicillin", "sulfa"]


def test_normalize_none_is_empty():
    assert _normalize_tokens(None) == []


def test_normalize_empty_list():
    assert _normalize_tokens([]) == []


def test_normalize_string_with_separators():
    # Defensive: a stray string instead of an array
    assert _normalize_tokens("aspirin; codeine, sulfa") == ["aspirin", "codeine", "sulfa"]


def test_normalize_filters_blanks():
    assert _normalize_tokens(["", "  ", "penicillin"]) == ["penicillin"]


# ── Cross-reactivity map integrity ───────────────────────────

def test_penicillin_cross_reactivity_includes_common_drugs():
    related = _CROSS_REACTIVITY["penicillin"]
    for drug in ("amoxicillin", "ampicillin", "augmentin"):
        assert drug in related


def test_cross_reactivity_keys_are_lowercase():
    for key in _CROSS_REACTIVITY:
        assert key == key.lower(), f"cross-reactivity key '{key}' must be lowercase"


# ── Blocking-severity decision ───────────────────────────────

def test_critical_alert_blocks():
    alerts = [SafetyAlert(AlertSeverity.CRITICAL, AlertType.ALLERGY, "allergic!")]
    assert has_blocking_alerts(alerts) is True


def test_non_critical_alerts_do_not_block():
    alerts = [
        SafetyAlert(AlertSeverity.HIGH, AlertType.ALLERGY, "cross-react"),
        SafetyAlert(AlertSeverity.MODERATE, AlertType.DUPLICATE, "dupe"),
    ]
    assert has_blocking_alerts(alerts) is False


def test_empty_alerts_do_not_block():
    assert has_blocking_alerts([]) is False


def test_mixed_alerts_block_if_any_critical():
    alerts = [
        SafetyAlert(AlertSeverity.MODERATE, AlertType.DUPLICATE, "dupe"),
        SafetyAlert(AlertSeverity.CRITICAL, AlertType.ALLERGY, "allergic!"),
    ]
    assert has_blocking_alerts(alerts) is True


# ── SafetyAlert serialization (used in the API 409 payload) ──

def test_alert_to_dict_uses_enum_values():
    a = SafetyAlert(AlertSeverity.CRITICAL, AlertType.ALLERGY, "msg", trigger="penicillin")
    d = a.to_dict()
    assert d["severity"] == "critical"
    assert d["type"] == "allergy"
    assert d["message"] == "msg"
    assert d["trigger"] == "penicillin"
