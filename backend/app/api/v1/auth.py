"""
Wodoga Platform — Authentication API
POST /api/v1/auth/login
POST /api/v1/auth/verify-mfa
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
POST /api/v1/auth/change-password
POST /api/v1/auth/enable-mfa
POST /api/v1/auth/disable-mfa
"""

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.audit import AuditAction, AuditLogger
from app.core.exceptions import (
    AccountLockedError,
    AuthenticationError,
    MFAInvalidError,
    MFARequiredError,
)
from app.core.security import (
    create_access_token,
    generate_mfa_secret,
    generate_password_reset_token,
    generate_refresh_token,
    get_mfa_qr_uri,
    hash_password,
    hash_refresh_token,
    password_meets_requirements,
    verify_mfa_code,
    verify_password,
)
from app.database import get_db
from app.dependencies import get_audit_logger, get_client_ip, get_current_user_payload
from app.core.permissions import TokenPayload

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()


# ── Request / Response Schemas ────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class MFAVerifyRequest(BaseModel):
    temp_token: str         # Short-lived token issued after successful password check
    mfa_code: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v):
        valid, msg = password_meets_requirements(v)
        if not valid:
            raise ValueError(msg)
        return v


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v):
        valid, msg = password_meets_requirements(v)
        if not valid:
            raise ValueError(msg)
        return v


class EnableMFARequest(BaseModel):
    mfa_code: str           # Confirm they've scanned the QR code before enabling


class DisableMFARequest(BaseModel):
    mfa_code: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int         # Seconds
    user: dict


class MFASetupResponse(BaseModel):
    secret: str
    qr_uri: str
    backup_codes: list[str]


# ── Login ─────────────────────────────────────────────────────
@router.post("/login", response_model=dict)
async def login(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 1 of authentication: Validates email and password.

    If MFA is not enabled: Returns full access + refresh tokens.
    If MFA is enabled: Returns a temporary token and requires /verify-mfa.

    Login attempts are rate-limited and failed attempts lock the account
    after the configured maximum.
    """
    ip = get_client_ip(request)

    # Fetch user (no org context needed — email is globally unique per org)
    result = await db.execute(
        text("""
            SELECT u.id, u.organization_id, u.first_name, u.last_name,
                   u.email, u.password_hash, u.mfa_enabled, u.mfa_secret,
                   u.is_active, u.failed_login_attempts, u.locked_until,
                   u.is_email_verified,
                   r.name as role_name, r.permissions,
                   o.subscription_status, o.hipaa_baa_signed
            FROM users u
            JOIN roles r ON r.id = u.role_id
            JOIN organizations o ON o.id = u.organization_id
            WHERE u.email = :email
              AND u.deleted_at IS NULL
        """),
        {"email": body.email.lower()},
    )
    user = result.mappings().first()

    # ── Account not found ─────────────────────────────────────
    # We return the same error as wrong password to prevent user enumeration
    if not user:
        await _log_failed_login(db, body.email, ip, "User not found")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid_credentials", "message": "Invalid email or password."},
        )

    # ── Account locked ────────────────────────────────────────
    if user["locked_until"] and user["locked_until"] > datetime.now(timezone.utc):
        remaining = int((user["locked_until"] - datetime.now(timezone.utc)).total_seconds() / 60)
        await _log_failed_login(db, body.email, ip, "Account locked", user_id=user["id"])
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={
                "error": "account_locked",
                "message": f"Account locked. Try again in {remaining} minute(s).",
            },
        )

    # ── Account inactive ──────────────────────────────────────
    if not user["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "account_inactive", "message": "Your account has been deactivated."},
        )

    # ── Organization suspended ────────────────────────────────
    if user["subscription_status"] == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "org_suspended", "message": "Your organization's subscription is suspended."},
        )

    # ── Password verification ─────────────────────────────────
    if not verify_password(body.password, user["password_hash"]):
        attempts = user["failed_login_attempts"] + 1
        locked_until = None
        if attempts >= settings.max_login_attempts:
            locked_until = datetime.now(timezone.utc) + timedelta(
                minutes=settings.account_lockout_minutes
            )
            await db.execute(
                text("UPDATE users SET failed_login_attempts = :a, locked_until = :l WHERE id = :id"),
                {"a": attempts, "l": locked_until, "id": str(user["id"])},
            )
        else:
            await db.execute(
                text("UPDATE users SET failed_login_attempts = :a WHERE id = :id"),
                {"a": attempts, "id": str(user["id"])},
            )
        await db.commit()
        await _log_failed_login(db, body.email, ip, "Wrong password", user_id=user["id"])
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid_credentials", "message": "Invalid email or password."},
        )

    # ── Reset failed attempts on successful password check ────
    await db.execute(
        text("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = :id"),
        {"id": str(user["id"])},
    )

    permissions = user["permissions"] if isinstance(user["permissions"], list) else []

    # ── MFA Required ──────────────────────────────────────────
    if user["mfa_enabled"]:
        # Issue a short-lived temporary token (5 minutes)
        # The frontend must call /verify-mfa to complete login
        temp_token = create_access_token(
            user_id=user["id"],
            organization_id=user["organization_id"],
            role=user["role_name"],
            permissions=[],         # No permissions until MFA is verified
            expires_delta=timedelta(minutes=5),
        )
        await db.commit()
        return {
            "mfa_required": True,
            "temp_token": temp_token,
            "message": "Enter your authenticator app code to complete sign-in.",
        }

    # ── Full login (no MFA) ───────────────────────────────────
    tokens = await _issue_tokens(db, user, permissions, ip, request)
    await db.commit()
    return tokens


# ── MFA Verification ──────────────────────────────────────────
@router.post("/verify-mfa", response_model=TokenResponse)
async def verify_mfa(
    request: Request,
    body: MFAVerifyRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 2 of authentication when MFA is enabled.
    Validates the 6-digit TOTP code and issues full tokens.
    """
    ip = get_client_ip(request)

    # Decode the temporary token
    from app.core.security import decode_access_token
    from jose import JWTError
    try:
        payload = decode_access_token(body.temp_token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid_token", "message": "Invalid or expired session. Please log in again."},
        )

    user_id = payload["sub"]

    # Fetch user and MFA secret
    result = await db.execute(
        text("""
            SELECT u.id, u.organization_id, u.first_name, u.last_name,
                   u.email, u.mfa_secret, u.is_active,
                   r.name as role_name, r.permissions
            FROM users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.id = :id AND u.deleted_at IS NULL
        """),
        {"id": user_id},
    )
    user = result.mappings().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "invalid_token"})

    # Verify the TOTP code
    from app.core.security import decrypt_field
    _secret = decrypt_field(user["mfa_secret"])
    if not verify_mfa_code(_secret, body.mfa_code):
        await _log_failed_login(db, user["email"], ip, "Invalid MFA code", user_id=user["id"])
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "mfa_invalid", "message": "Invalid verification code. Please try again."},
        )

    permissions = user["permissions"] if isinstance(user["permissions"], list) else []
    tokens = await _issue_tokens(db, user, permissions, ip, request)
    await db.commit()
    return tokens


# ── Token Refresh ─────────────────────────────────────────────
@router.post("/refresh", response_model=TokenResponse)
async def refresh_tokens(
    request: Request,
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Exchanges a valid refresh token for a new access + refresh token pair.
    The old refresh token is immediately invalidated (rotation).
    """
    token_hash = hash_refresh_token(body.refresh_token)

    result = await db.execute(
        text("""
            SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked,
                   u.organization_id, u.first_name, u.last_name,
                   u.email, u.is_active,
                   r.name as role_name, r.permissions
            FROM refresh_tokens rt
            JOIN users u ON u.id = rt.user_id
            JOIN roles r ON r.id = u.role_id
            WHERE rt.token_hash = :hash
        """),
        {"hash": token_hash},
    )
    token_record = result.mappings().first()

    if not token_record or token_record["revoked"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid_token", "message": "Invalid or revoked refresh token."},
        )

    if token_record["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "token_expired", "message": "Session expired. Please log in again."},
        )

    # Revoke the old token immediately
    await db.execute(
        text("UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW() WHERE id = :id"),
        {"id": str(token_record["id"])},
    )

    permissions = token_record["permissions"] if isinstance(token_record["permissions"], list) else []
    ip = get_client_ip(request)
    tokens = await _issue_tokens(db, token_record, permissions, ip, request)
    await db.commit()
    return tokens


# ── Logout ────────────────────────────────────────────────────
@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: RefreshRequest,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db),
):
    """
    Revokes the provided refresh token, ending the session.
    The access token naturally expires per its TTL.
    """
    token_hash = hash_refresh_token(body.refresh_token)
    await db.execute(
        text("UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW() WHERE token_hash = :hash"),
        {"hash": token_hash},
    )
    await db.execute(
        text("""
            INSERT INTO audit_logs (organization_id, user_id, action, description)
            VALUES (:org, :uid, 'LOGOUT', 'User signed out')
        """),
        {"org": str(current_user.organization_id), "uid": str(current_user.user_id)},
    )
    await db.commit()


# ── Change Password ───────────────────────────────────────────
@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db),
):
    """Allows a logged-in user to change their own password."""
    result = await db.execute(
        text("SELECT password_hash FROM users WHERE id = :id"),
        {"id": str(current_user.user_id)},
    )
    user = result.mappings().first()

    if not user or not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "wrong_password", "message": "Current password is incorrect."},
        )

    new_hash = hash_password(body.new_password)
    await db.execute(
        text("UPDATE users SET password_hash = :hash, password_changed_at = NOW() WHERE id = :id"),
        {"hash": new_hash, "id": str(current_user.user_id)},
    )
    await db.execute(
        text("""
            INSERT INTO audit_logs (organization_id, user_id, action, description)
            VALUES (:org, :uid, 'PASSWORD_CHANGED', 'User changed their password')
        """),
        {"org": str(current_user.organization_id), "uid": str(current_user.user_id)},
    )
    await db.commit()


# ── MFA Setup ─────────────────────────────────────────────────
@router.post("/enable-mfa", response_model=MFASetupResponse)
async def enable_mfa_setup(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db),
):
    """
    Generates a new MFA secret and QR code URI.
    The user must scan this and confirm with /confirm-mfa before MFA is activated.
    """
    from app.core.security import encrypt_field
    import secrets

    secret = generate_mfa_secret()
    encrypted_secret = encrypt_field(secret)

    # Store temporarily — not activated until confirmed
    result = await db.execute(
        text("SELECT email FROM users WHERE id = :id"),
        {"id": str(current_user.user_id)},
    )
    user = result.mappings().first()

    await db.execute(
        text("UPDATE users SET mfa_secret = :secret WHERE id = :id"),
        {"secret": encrypted_secret, "id": str(current_user.user_id)},
    )
    await db.commit()

    qr_uri = get_mfa_qr_uri(secret, user["email"])
    backup_codes = [secrets.token_hex(4).upper() for _ in range(8)]

    return MFASetupResponse(secret=secret, qr_uri=qr_uri, backup_codes=backup_codes)


@router.post("/confirm-mfa", status_code=status.HTTP_204_NO_CONTENT)
async def confirm_mfa(
    body: EnableMFARequest,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db),
):
    """Confirms MFA setup by verifying the user's first code."""
    from app.core.security import decrypt_field

    result = await db.execute(
        text("SELECT mfa_secret FROM users WHERE id = :id"),
        {"id": str(current_user.user_id)},
    )
    user = result.mappings().first()
    if not user or not user["mfa_secret"]:
        raise HTTPException(status_code=400, detail={"error": "mfa_not_setup"})

    secret = decrypt_field(user["mfa_secret"])
    if not verify_mfa_code(secret, body.mfa_code):
        raise HTTPException(
            status_code=400,
            detail={"error": "mfa_invalid", "message": "Code is incorrect. Please try again."},
        )

    await db.execute(
        text("UPDATE users SET mfa_enabled = TRUE WHERE id = :id"),
        {"id": str(current_user.user_id)},
    )
    await db.execute(
        text("""
            INSERT INTO audit_logs (organization_id, user_id, action, description)
            VALUES (:org, :uid, 'MFA_ENABLED', 'User enabled multi-factor authentication')
        """),
        {"org": str(current_user.organization_id), "uid": str(current_user.user_id)},
    )
    await db.commit()


# ── Internal Helpers ──────────────────────────────────────────
async def _issue_tokens(
    db: AsyncSession,
    user: dict,
    permissions: list[str],
    ip: str,
    request: Request,
) -> dict:
    """Creates and stores access + refresh token pair. Returns the token response."""
    access_token = create_access_token(
        user_id=user["id"],
        organization_id=user["organization_id"],
        role=user["role_name"],
        permissions=permissions,
    )
    raw_refresh = generate_refresh_token()
    refresh_hash = hash_refresh_token(raw_refresh)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)

    await db.execute(
        text("""
            INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
            VALUES (:uid, :hash, :exp, :ip, :ua)
        """),
        {
            "uid": str(user["id"]),
            "hash": refresh_hash,
            "exp": expires_at,
            "ip": ip,
            "ua": request.headers.get("User-Agent", "")[:500],
        },
    )
    await db.execute(
        text("UPDATE users SET last_login_at = NOW(), last_login_ip = :ip WHERE id = :id"),
        {"ip": ip, "id": str(user["id"])},
    )
    await db.execute(
        text("""
            INSERT INTO audit_logs (organization_id, user_id, action, description, ip_address)
            VALUES (:org, :uid, 'LOGIN_SUCCESS', 'Successful authentication', :ip)
        """),
        {
            "org": str(user["organization_id"]),
            "uid": str(user["id"]),
            "ip": ip,
        },
    )

    return {
        "access_token": access_token,
        "refresh_token": raw_refresh,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user": {
            "id": str(user["id"]),
            "first_name": user["first_name"],
            "last_name": user["last_name"],
            "email": user["email"],
            "role": user["role_name"],
            "organization_id": str(user["organization_id"]),
            "permissions": permissions,
            "mfa_enabled": dict(user).get("mfa_enabled", False),
        },
    }


async def _log_failed_login(
    db: AsyncSession,
    email: str,
    ip: str,
    reason: str,
    user_id: Optional[UUID] = None,
) -> None:
    """Records a failed login attempt in the audit log."""
    await db.execute(
        text("""
            INSERT INTO audit_logs (user_id, action, description, ip_address, success, error_message, user_email)
            VALUES (:uid, 'LOGIN_FAILED', :desc, :ip, FALSE, :reason, :email)
        """),
        {
            "uid": str(user_id) if user_id else None,
            "desc": f"Failed login attempt for {email}",
            "ip": ip,
            "reason": reason,
            "email": email,
        },
    )
    await db.commit()
