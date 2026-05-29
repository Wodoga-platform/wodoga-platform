"""
Wodoga Platform — Role-Based Access Control
Permission constants and server-side enforcement.
Permissions are checked here — never trusted from the frontend.
"""

from enum import Enum
from typing import Callable
from uuid import UUID

from fastapi import Depends, HTTPException, status

from app.core.exceptions import PermissionDeniedError


# ── Permission Constants ─────────────────────────────────────
class Permission(str, Enum):
    """
    All permission strings used throughout Wodoga.
    These must exactly match the strings stored in the roles.permissions JSONB column.
    """
    # Patient management
    PATIENTS_VIEW       = "patients:view"
    PATIENTS_CREATE     = "patients:create"
    PATIENTS_EDIT       = "patients:edit"
    PATIENTS_DELETE     = "patients:delete"

    # Intake forms
    INTAKE_VIEW         = "intake_forms:view"
    INTAKE_CREATE       = "intake_forms:create"

    # Visits
    VISITS_VIEW         = "visits:view"
    VISITS_CREATE       = "visits:create"
    VISITS_EDIT         = "visits:edit"
    VISITS_CHECKIN      = "visits:checkin"
    VISITS_SOAP         = "visits:soap_note"

    # Care plans
    CARE_PLANS_VIEW     = "care_plans:view"
    CARE_PLANS_CREATE   = "care_plans:create"

    # Vitals
    VITALS_VIEW         = "vitals:view"
    VITALS_CREATE       = "vitals:create"

    # Medications
    MEDS_VIEW           = "medications:view"
    MEDS_PRESCRIBE      = "medications:prescribe"
    MEDS_RECONCILE      = "medications:reconcile"

    # Pharmaceutical orders
    PHARM_VIEW          = "pharm_orders:view"
    PHARM_CREATE        = "pharm_orders:create"
    PHARM_ADVANCE       = "pharm_orders:advance"

    # Referrals
    REFERRALS_VIEW      = "referrals:view"
    REFERRALS_CREATE    = "referrals:create"
    REFERRALS_ADVANCE   = "referrals:advance"

    # Billing
    BILLING_VIEW        = "billing:view"
    BILLING_CREATE      = "billing:create"
    BILLING_UPDATE      = "billing:update"

    # Eligibility
    ELIGIBILITY_CHECK   = "eligibility:check"

    # OASIS
    OASIS_VIEW          = "oasis:view"
    OASIS_CREATE        = "oasis:create"

    # Messaging
    MESSAGES_SEND       = "messages:send"
    MESSAGES_VIEW       = "messages:view"

    # Documents
    DOCUMENTS_VIEW      = "documents:view"
    DOCUMENTS_UPLOAD    = "documents:upload"

    # Staff
    STAFF_VIEW          = "staff:view"
    STAFF_MANAGE        = "staff:manage"

    # Audit
    AUDIT_VIEW          = "audit:view"

    # Notifications
    NOTIFICATIONS_VIEW  = "notifications:view"

    # Reports
    REPORTS_VIEW        = "reports:view"

    # Organization admin
    ORGS_MANAGE         = "organizations:manage"

    # Patient portal
    PORTAL_ACCESS       = "portal:access"


# ── Default Role Permission Sets ─────────────────────────────
# These match the seed.sql definitions exactly.
# Used for reference and testing — the source of truth is the database.

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": [p.value for p in Permission],  # Admin has all permissions

    "provider": [
        Permission.PATIENTS_VIEW, Permission.PATIENTS_CREATE, Permission.PATIENTS_EDIT,
        Permission.INTAKE_VIEW, Permission.INTAKE_CREATE,
        Permission.VISITS_VIEW, Permission.VISITS_CREATE, Permission.VISITS_EDIT, Permission.VISITS_SOAP,
        Permission.CARE_PLANS_VIEW, Permission.CARE_PLANS_CREATE,
        Permission.VITALS_VIEW, Permission.VITALS_CREATE,
        Permission.MEDS_VIEW, Permission.MEDS_PRESCRIBE, Permission.MEDS_RECONCILE,
        Permission.PHARM_VIEW,
        Permission.REFERRALS_VIEW, Permission.REFERRALS_CREATE, Permission.REFERRALS_ADVANCE,
        Permission.ELIGIBILITY_CHECK,
        Permission.OASIS_VIEW, Permission.OASIS_CREATE,
        Permission.MESSAGES_SEND, Permission.MESSAGES_VIEW,
        Permission.DOCUMENTS_VIEW, Permission.DOCUMENTS_UPLOAD,
        Permission.NOTIFICATIONS_VIEW, Permission.REPORTS_VIEW,
    ],

    "pharmacy_staff": [
        Permission.PATIENTS_VIEW,
        Permission.MEDS_VIEW, Permission.MEDS_RECONCILE,
        Permission.PHARM_VIEW, Permission.PHARM_CREATE, Permission.PHARM_ADVANCE,
        Permission.MESSAGES_SEND, Permission.MESSAGES_VIEW,
        Permission.DOCUMENTS_VIEW, Permission.DOCUMENTS_UPLOAD,
        Permission.NOTIFICATIONS_VIEW,
    ],

    "biller": [
        Permission.PATIENTS_VIEW,
        Permission.BILLING_VIEW, Permission.BILLING_CREATE, Permission.BILLING_UPDATE,
        Permission.ELIGIBILITY_CHECK,
        Permission.DOCUMENTS_VIEW,
        Permission.MESSAGES_SEND, Permission.MESSAGES_VIEW,
        Permission.NOTIFICATIONS_VIEW, Permission.REPORTS_VIEW,
    ],

    "viewer": [
        Permission.PATIENTS_VIEW,
        Permission.VISITS_VIEW,
        Permission.CARE_PLANS_VIEW,
        Permission.VITALS_VIEW,
        Permission.MEDS_VIEW,
        Permission.BILLING_VIEW,
        Permission.MESSAGES_VIEW,
        Permission.DOCUMENTS_VIEW,
        Permission.NOTIFICATIONS_VIEW,
    ],

    "caregiver": [
        Permission.PATIENTS_VIEW, Permission.PATIENTS_EDIT,
        Permission.INTAKE_VIEW, Permission.INTAKE_CREATE,
        Permission.VISITS_VIEW, Permission.VISITS_CREATE,
        Permission.VISITS_CHECKIN, Permission.VISITS_SOAP,
        Permission.VITALS_VIEW, Permission.VITALS_CREATE,
        Permission.MEDS_VIEW,
        Permission.MESSAGES_SEND, Permission.MESSAGES_VIEW,
        Permission.DOCUMENTS_VIEW, Permission.DOCUMENTS_UPLOAD,
        Permission.NOTIFICATIONS_VIEW,
    ],

    "patient": [
        Permission.PORTAL_ACCESS,
        Permission.MESSAGES_SEND, Permission.MESSAGES_VIEW,
        Permission.NOTIFICATIONS_VIEW,
    ],
}


# ── Token Payload Model ──────────────────────────────────────
class TokenPayload:
    """Represents the decoded JWT access token payload."""
    def __init__(self, payload: dict):
        self.user_id: UUID = UUID(payload["sub"])
        self.organization_id: UUID = UUID(payload["org"])
        self.role: str = payload["role"]
        self.permissions: list[str] = payload.get("perms", [])

    def has_permission(self, permission: Permission) -> bool:
        return permission.value in self.permissions

    def has_any_permission(self, *permissions: Permission) -> bool:
        return any(p.value in self.permissions for p in permissions)

    def has_all_permissions(self, *permissions: Permission) -> bool:
        return all(p.value in self.permissions for p in permissions)


# ── Permission Checker Dependency Factory ────────────────────
def require_permissions(*required: Permission) -> Callable:
    """
    FastAPI dependency factory.
    Returns a dependency that checks the current user has ALL listed permissions.

    Usage:
        @router.get("/patients", dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))])

    Raises HTTP 403 if the user lacks any required permission.
    Permissions are validated from the JWT — never from client input.
    """
    def _check(token_payload: TokenPayload = Depends(get_current_user_payload)):
        missing = [p for p in required if not token_payload.has_permission(p)]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "permission_denied",
                    "message": "You do not have permission to perform this action.",
                    "required": [p.value for p in missing],
                },
            )
        return token_payload
    return _check


def require_any_permission(*required: Permission) -> Callable:
    """
    Like require_permissions, but the user only needs ONE of the listed permissions.
    """
    def _check(token_payload: TokenPayload = Depends(get_current_user_payload)):
        if not token_payload.has_any_permission(*required):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "permission_denied",
                    "message": "You do not have permission to perform this action.",
                },
            )
        return token_payload
    return _check


# ── Import here to avoid circular imports ────────────────────
from app.dependencies import get_current_user_payload  # noqa: E402
