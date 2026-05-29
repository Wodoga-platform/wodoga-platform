"""
Wodoga Platform — FastAPI Dependencies
Shared dependencies injected into route handlers.
These are the gatekeepers for every authenticated request.
"""

from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.audit import AuditLogger
from app.core.exceptions import AuthenticationError
from app.core.permissions import TokenPayload
from app.core.security import decode_access_token
from app.database import AsyncSessionLocal

settings = get_settings()
bearer_scheme = HTTPBearer(auto_error=False)


# ── Token Extraction ─────────────────────────────────────────
async def get_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> str:
    """
    Extracts the raw JWT token from the Authorization: Bearer header.
    Raises 401 if no token is present.
    """
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "not_authenticated", "message": "Authentication required."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


# ── Token Decoding & Validation ──────────────────────────────
async def get_current_user_payload(token: str = Depends(get_token)) -> TokenPayload:
    """
    Decodes the JWT and returns the token payload.
    Raises 401 if the token is invalid or expired.
    This is the core authentication dependency.

    Usage:
        current_user: TokenPayload = Depends(get_current_user_payload)
    """
    try:
        raw_payload = decode_access_token(token)
        return TokenPayload(raw_payload)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid_token", "message": "Invalid or expired token."},
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Tenant-Scoped Database Session ───────────────────────────
async def get_db_for_tenant(
    current_user: TokenPayload = Depends(get_current_user_payload),
) -> AsyncSession:
    """
    Provides a database session with the current user's organization
    context set — activating row-level security for all queries.

    This is the primary database dependency for all authenticated routes.
    Never use get_db() directly in authenticated routes — always use this.

    Usage:
        db: AsyncSession = Depends(get_db_for_tenant)
    """
    async with AsyncSessionLocal() as session:
        try:
            # This single line activates all RLS policies
            from sqlalchemy import text
            await session.execute(
                text("SET LOCAL app.organization_id = :org_id"),
                {"org_id": str(current_user.organization_id)},
            )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Audit Logger Dependency ──────────────────────────────────
async def get_audit_logger(
    request: Request,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
) -> AuditLogger:
    """
    Provides an AuditLogger pre-configured with the current user
    and request context (IP, user agent, request ID).

    Usage:
        audit: AuditLogger = Depends(get_audit_logger)
        await audit.log(AuditAction.PATIENT_VIEWED, "Viewed patient record")
    """
    return AuditLogger(
        db=db,
        token=current_user,
    )


# ── Admin-Only Guard ─────────────────────────────────────────
async def require_admin(
    current_user: TokenPayload = Depends(get_current_user_payload),
) -> TokenPayload:
    """
    Restricts a route to admin users only.
    Raises 403 for any non-admin role.

    Usage:
        @router.delete("/staff/{id}", dependencies=[Depends(require_admin)])
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "admin_required", "message": "Administrator access required."},
        )
    return current_user


# ── Patient Portal Guard ─────────────────────────────────────
async def require_portal_access(
    current_user: TokenPayload = Depends(get_current_user_payload),
) -> TokenPayload:
    """
    Restricts portal routes to patient role only.
    Prevents staff from accidentally using patient portal endpoints.
    """
    if current_user.role != "patient":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "portal_only", "message": "This endpoint is for patient portal access only."},
        )
    return current_user


# ── Request Metadata Extractor ───────────────────────────────
def get_client_ip(request: Request) -> str:
    """
    Extracts the real client IP address from the request.
    Handles reverse proxy headers (X-Forwarded-For).
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def get_request_id(request: Request) -> Optional[str]:
    """
    Extracts the request correlation ID from headers.
    Used for tracing requests across logs.
    """
    return request.headers.get("X-Request-ID")
