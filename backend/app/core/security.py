"""
Wodoga Platform — Security Core
JWT authentication, bcrypt password hashing,
TOTP-based MFA, and refresh token rotation.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import pyotp
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()

# ── Password Hashing ─────────────────────────────────────────
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,          # High work factor — slower to brute-force
)


def hash_password(plain_password: str) -> str:
    """
    Hash a plaintext password using bcrypt.
    The resulting hash is safe to store in the database.
    """
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a plaintext password against a stored bcrypt hash.
    Returns True if they match, False otherwise.
    Timing-safe — takes the same time regardless of match.
    """
    return pwd_context.verify(plain_password, hashed_password)


def password_meets_requirements(password: str) -> tuple[bool, str]:
    """
    Validates password strength against Wodoga's security policy.
    Returns (is_valid, error_message).
    """
    if len(password) < settings.password_min_length:
        return False, f"Password must be at least {settings.password_min_length} characters."
    if not any(c.isupper() for c in password):
        return False, "Password must contain at least one uppercase letter."
    if not any(c.islower() for c in password):
        return False, "Password must contain at least one lowercase letter."
    if not any(c.isdigit() for c in password):
        return False, "Password must contain at least one number."
    if not any(c in "!@#$%^&*()_+-=[]{}|;':\",./<>?" for c in password):
        return False, "Password must contain at least one special character."
    return True, ""


# ── JWT Access Tokens ────────────────────────────────────────
def create_access_token(
    user_id: UUID,
    organization_id: UUID,
    role: str,
    permissions: list[str],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    Creates a short-lived JWT access token.
    Embeds user identity, organization, role, and permissions.
    Default expiry: 30 minutes.
    """
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload = {
        "sub": str(user_id),           # Subject — user ID
        "org": str(organization_id),   # Organization — for tenant context
        "role": role,                  # Role name
        "perms": permissions,          # Permission array
        "exp": expire,                 # Expiry timestamp
        "iat": datetime.now(timezone.utc),  # Issued at
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """
    Decodes and validates a JWT access token.
    Raises JWTError if the token is invalid, expired, or tampered with.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        if payload.get("type") != "access":
            raise JWTError("Invalid token type.")
        return payload
    except JWTError:
        raise


# ── Refresh Tokens ───────────────────────────────────────────
def generate_refresh_token() -> str:
    """
    Generates a cryptographically secure refresh token.
    This is a random 64-byte hex string — not a JWT.
    The raw token is sent to the client; only its hash is stored.
    """
    return secrets.token_hex(64)


def hash_refresh_token(token: str) -> str:
    """
    SHA-256 hash of a refresh token for safe database storage.
    We store only the hash — never the raw token.
    """
    return hashlib.sha256(token.encode()).hexdigest()


# ── MFA (Time-Based One-Time Passwords) ─────────────────────
def generate_mfa_secret() -> str:
    """
    Generates a new TOTP secret for a user enabling MFA.
    This secret is stored encrypted in the database.
    The user scans a QR code with their authenticator app.
    """
    return pyotp.random_base32()


def get_mfa_qr_uri(secret: str, user_email: str) -> str:
    """
    Generates the otpauth:// URI for QR code display.
    The user scans this with Google Authenticator, Authy, etc.
    """
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(
        name=user_email,
        issuer_name=settings.mfa_issuer,
    )


def verify_mfa_code(secret: str, code: str) -> bool:
    """
    Verifies a 6-digit TOTP code against the user's MFA secret.
    Allows a 30-second window on either side to account for clock drift.
    Returns True if valid, False otherwise.
    """
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


# ── Invitation Tokens ────────────────────────────────────────
def generate_invite_token() -> str:
    """
    Generates a secure token for staff invitation emails.
    Expires after 48 hours (enforced at application layer).
    """
    return secrets.token_urlsafe(32)


def generate_password_reset_token() -> str:
    """
    Generates a secure token for password reset emails.
    Expires after 1 hour (enforced at application layer).
    """
    return secrets.token_urlsafe(32)


# ── Field-Level Encryption ───────────────────────────────────
from cryptography.fernet import Fernet
import base64


def _get_cipher() -> Fernet:
    """
    Returns a Fernet cipher instance using the app encryption key.
    Used for encrypting sensitive fields like MFA secrets and tax IDs.
    """
    key = settings.encryption_key
    # Ensure key is proper Fernet format (32 bytes, base64 URL-safe)
    if len(key) != 44:
        # Derive a proper Fernet key from the config value
        key_bytes = hashlib.sha256(key.encode()).digest()
        key = base64.urlsafe_b64encode(key_bytes).decode()
    return Fernet(key.encode())


def encrypt_field(value: str) -> str:
    """Encrypts a sensitive string field for database storage."""
    cipher = _get_cipher()
    return cipher.encrypt(value.encode()).decode()


def decrypt_field(encrypted_value: str) -> str:
    """Decrypts an encrypted field retrieved from the database."""
    cipher = _get_cipher()
    return cipher.decrypt(encrypted_value.encode()).decode()
