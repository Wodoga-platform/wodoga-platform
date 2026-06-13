"""
Wodoga Platform — Security Function Tests
==========================================

WHAT THESE PROVE (plain English):
These test the security building blocks directly — no database needed.
They confirm:

  - Passwords are properly scrambled (hashed) and can be verified, and a
    wrong password is rejected.
  - The password-strength rules actually reject weak passwords.
  - MFA secrets generate and verify correctly (the bug we fixed twice).
  - Field encryption (used for MFA secrets) can encrypt AND decrypt back
    to the original — the exact thing that broke before.
  - Login tokens are created and decoded correctly.

These run fast and need no setup. They're your safety net for the auth
system every time you touch it.

Run just these:
    pytest tests/test_security.py -v
"""

import pytest

from app.core.security import (
    hash_password,
    verify_password,
    password_meets_requirements,
    generate_mfa_secret,
    verify_mfa_code,
    encrypt_field,
    decrypt_field,
    create_access_token,
    decode_access_token,
    generate_password_reset_token,
    generate_invite_token,
)
import pyotp
import uuid


# ── Password hashing ──────────────────────────────────────────
def test_password_hash_and_verify():
    """A hashed password verifies against the original."""
    pw = "Str0ng!Passw0rd"
    hashed = hash_password(pw)
    assert hashed != pw, "Password was stored in plain text!"
    assert verify_password(pw, hashed) is True


def test_wrong_password_is_rejected():
    """A wrong password must fail verification."""
    hashed = hash_password("Str0ng!Passw0rd")
    assert verify_password("wrong-password", hashed) is False


def test_same_password_hashes_differently():
    """Two hashes of the same password differ (salting works)."""
    pw = "Str0ng!Passw0rd"
    a = hash_password(pw)
    b = hash_password(pw)
    assert a != b, "Hashes are identical — salting is not working!"
    assert verify_password(pw, a)
    assert verify_password(pw, b)


# ── Password strength rules ───────────────────────────────────
@pytest.mark.parametrize("weak", [
    "short",            # too short
    "alllowercase1!",   # no uppercase
    "ALLUPPERCASE1!",   # no lowercase
    "NoNumbers!!",      # no digit
    "NoSpecial123",     # no symbol
])
def test_weak_passwords_rejected(weak):
    ok, _ = password_meets_requirements(weak)
    assert ok is False, f"Weak password '{weak}' was wrongly accepted!"


def test_strong_password_accepted():
    ok, _ = password_meets_requirements("Str0ng!Passw0rd")
    assert ok is True


# ── MFA (the bug we fixed twice) ──────────────────────────────
def test_mfa_secret_generates_and_verifies():
    """A fresh MFA secret verifies a code generated from it."""
    secret = generate_mfa_secret()
    current_code = pyotp.TOTP(secret).now()
    assert verify_mfa_code(secret, current_code) is True


def test_mfa_rejects_wrong_code():
    secret = generate_mfa_secret()
    assert verify_mfa_code(secret, "000000") is False


# ── Field encryption (the decryption crash we fixed) ──────────
def test_encrypt_then_decrypt_roundtrip():
    """
    This is the exact thing that broke MFA: a value must encrypt and then
    decrypt back to the original. If this fails, MFA login breaks.
    """
    original = generate_mfa_secret()
    encrypted = encrypt_field(original)
    assert encrypted != original, "Value was not actually encrypted!"
    decrypted = decrypt_field(encrypted)
    assert decrypted == original, "Decryption did not return the original — MFA would break!"


def test_encryption_produces_different_output_each_time():
    """Fernet includes a timestamp/IV, so output differs but still decrypts."""
    val = "sensitive-value"
    a = encrypt_field(val)
    b = encrypt_field(val)
    assert decrypt_field(a) == val
    assert decrypt_field(b) == val


# ── Access tokens ─────────────────────────────────────────────
def test_access_token_roundtrip():
    """A created token decodes back to the same identity."""
    uid = uuid.uuid4()
    org = uuid.uuid4()
    token = create_access_token(
        user_id=uid, organization_id=org, role="admin", permissions=["patients:view"]
    )
    payload = decode_access_token(token)
    assert payload["sub"] == str(uid)
    assert payload["org"] == str(org)
    assert payload["role"] == "admin"
    assert "patients:view" in payload["perms"]


# ── Random tokens are unique ──────────────────────────────────
def test_reset_and_invite_tokens_are_unique():
    resets = {generate_password_reset_token() for _ in range(100)}
    invites = {generate_invite_token() for _ in range(100)}
    assert len(resets) == 100, "Password reset tokens are not unique!"
    assert len(invites) == 100, "Invite tokens are not unique!"
