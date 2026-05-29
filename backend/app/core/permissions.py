"""
Wodoga Platform — Role-Based Access Control
"""

from enum import Enum
from typing import Callable
from uuid import UUID

from fastapi import Depends, HTTPException, status


class Permission(str, Enum):
    PATIENTS_VIEW       = "patients:view"
    PATIENTS_CREATE     = "patients:create"
    PATIENTS_EDIT       = "patients:edit"
    PATIENTS_DELETE     = "patients:delete"
    INTAKE_VIEW         = "intake_forms:view"
    INTAKE_CREATE       = "intake_forms:create"
    VISITS_VIEW         = "visits:view"
    VISITS_CREATE       = "visits:create"
    VISITS_EDIT         = "visits:edit"
    VISITS_CHECKIN      = "visits:checkin"
    VISITS_SOAP         = "visits:soap_note"
    CARE_PLANS_VIEW     = "care_plans:view"
    CARE_PLANS_CREATE   = "care_plans:create"
    VITALS_VIEW         = "vitals:view"
    VITALS_CREATE       = "vitals:create"
    MEDS_VIEW           = "medications:view"
    MEDS_PRESCRIBE      = "medications:prescribe"
    MEDS_RECONCILE      = "medications:reconcile"
    PHARM_VIEW          = "pharm_orders:view"
    PHARM_CREATE        = "pharm_orders:create"
    PHARM_ADVANCE       = "pharm_orders:advance"
    REFERRALS_VIEW      = "referrals:view"
    REFERRALS_CREATE    = "referrals:create"
    REFERRALS_ADVANCE   = "referrals:advance"
    BILLING_VIEW        = "billing:view"
    BILLING_CREATE      = "billing:create"
    BILLING_UPDATE      = "billing:update"
    ELIGIBILITY_CHECK   = "eligibility:check"
    OASIS_VIEW          = "oasis:view"
    OASIS_CREATE        = "oasis:create"
    MESSAGES_SEND       = "messages:send"
    MESSAGES_VIEW       = "messages:view"
    DOCUMENTS_VIEW      = "documents:view"
    DOCUMENTS_UPLOAD    = "documents:upload"
    STAFF_VIEW          = "staff:view"
    STAFF_MANAGE        = "staff:manage"
    AUDIT_VIEW          = "audit:view"
    NOTIFICATIONS_VIEW  = "notifications:view"
    REPORTS_VIEW        = "reports:view"
    ORGS_MANAGE         = "organizations:manage"
    PORTAL_ACCESS       = "portal:access"


class TokenPayload:
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


def require_permissions(*required: Permission) -> Callable:
    def checker(token_payload: "TokenPayload" = None):
        from app.dependencies import get_current_user_payload
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

    from fastapi import Depends
    from app.dependencies import get_current_user_payload

    def final_checker(token_payload: TokenPayload = Depends(get_current_user_payload)):
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
    return final_checker


def require_any_permission(*required: Permission) -> Callable:
    from fastapi import Depends
    from app.dependencies import get_current_user_payload

    def checker(token_payload: TokenPayload = Depends(get_current_user_payload)):
        if not token_payload.has_any_permission(*required):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "permission_denied",
                    "message": "You do not have permission to perform this action.",
                },
            )
        return token_payload
    return checker