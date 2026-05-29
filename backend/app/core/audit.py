"""
Wodoga Platform — Audit Logging Service
"""

from typing import Optional, Any
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class AuditAction:
    LOGIN_SUCCESS           = "LOGIN_SUCCESS"
    LOGIN_FAILED            = "LOGIN_FAILED"
    LOGIN_MFA_SUCCESS       = "LOGIN_MFA_SUCCESS"
    LOGIN_MFA_FAILED        = "LOGIN_MFA_FAILED"
    LOGOUT                  = "LOGOUT"
    PASSWORD_CHANGED        = "PASSWORD_CHANGED"
    PASSWORD_RESET_REQUEST  = "PASSWORD_RESET_REQUEST"
    ACCOUNT_LOCKED          = "ACCOUNT_LOCKED"
    MFA_ENABLED             = "MFA_ENABLED"
    MFA_DISABLED            = "MFA_DISABLED"
    PATIENT_VIEWED          = "PATIENT_VIEWED"
    PATIENT_CREATED         = "PATIENT_CREATED"
    PATIENT_UPDATED         = "PATIENT_UPDATED"
    PATIENT_DELETED         = "PATIENT_DELETED"
    PATIENT_EXPORTED        = "PATIENT_EXPORTED"
    INTAKE_FORM_CREATED     = "INTAKE_FORM_CREATED"
    INTAKE_FORM_VIEWED      = "INTAKE_FORM_VIEWED"
    CARE_PLAN_CREATED       = "CARE_PLAN_CREATED"
    CARE_PLAN_VIEWED        = "CARE_PLAN_VIEWED"
    CARE_PLAN_UPDATED       = "CARE_PLAN_UPDATED"
    VISIT_CREATED           = "VISIT_CREATED"
    VISIT_UPDATED           = "VISIT_UPDATED"
    VISIT_CHECKIN           = "VISIT_GPS_CHECKIN"
    SOAP_NOTE_CREATED       = "SOAP_NOTE_CREATED"
    VITALS_RECORDED         = "VITALS_RECORDED"
    VITALS_VIEWED           = "VITALS_VIEWED"
    MEDICATION_PRESCRIBED   = "MEDICATION_PRESCRIBED"
    MEDICATION_DISCONTINUED = "MEDICATION_DISCONTINUED"
    MEDICATION_VIEWED       = "MEDICATION_VIEWED"
    RECONCILIATION_RUN      = "RECONCILIATION_RUN"
    PHARM_ORDER_CREATED     = "PHARM_ORDER_CREATED"
    PHARM_ORDER_ADVANCED    = "PHARM_ORDER_ADVANCED"
    REFERRAL_CREATED        = "REFERRAL_CREATED"
    REFERRAL_ADVANCED       = "REFERRAL_STAGE_ADVANCED"
    REFERRAL_ADMITTED       = "REFERRAL_ADMITTED_AS_PATIENT"
    CLAIM_SUBMITTED         = "CLAIM_SUBMITTED"
    CLAIM_UPDATED           = "CLAIM_UPDATED"
    ELIGIBILITY_CHECKED     = "ELIGIBILITY_CHECKED"
    DOCUMENT_UPLOADED       = "DOCUMENT_UPLOADED"
    DOCUMENT_VIEWED         = "DOCUMENT_VIEWED"
    DOCUMENT_DOWNLOADED     = "DOCUMENT_DOWNLOADED"
    DOCUMENT_DELETED        = "DOCUMENT_DELETED"
    OASIS_CREATED           = "OASIS_CREATED"
    OASIS_SUBMITTED         = "OASIS_SUBMITTED"
    MESSAGE_SENT            = "MESSAGE_SENT"
    MESSAGE_READ            = "MESSAGE_READ"
    STAFF_CREATED           = "STAFF_CREATED"
    STAFF_UPDATED           = "STAFF_UPDATED"
    STAFF_DELETED           = "STAFF_DELETED"
    ROLE_CHANGED            = "ROLE_CHANGED"
    EXPORT_PERFORMED        = "EXPORT_PERFORMED"
    AUDIT_LOG_VIEWED        = "AUDIT_LOG_VIEWED"


class AuditLogger:
    def __init__(self, db: AsyncSession, token: Any = None):
        self.db = db
        self.token = token

    async def log(
        self,
        action: str,
        description: str,
        *,
        patient_id: Optional[UUID] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[UUID] = None,
        previous_state: Optional[dict] = None,
        new_state: Optional[dict] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
        success: bool = True,
        error_message: Optional[str] = None,
        override_user_id: Optional[UUID] = None,
        override_org_id: Optional[UUID] = None,
        override_user_name: Optional[str] = None,
        override_user_email: Optional[str] = None,
        override_user_role: Optional[str] = None,
    ) -> None:
        try:
            user_id = override_user_id or (self.token.user_id if self.token else None)
            org_id  = override_org_id  or (self.token.organization_id if self.token else None)

            await self.db.execute(
                text("""
                    INSERT INTO audit_logs (
                        organization_id, user_id, patient_id,
                        user_name, user_role, user_email,
                        action, resource_type, resource_id,
                        description, ip_address, user_agent, request_id,
                        previous_state, new_state,
                        success, error_message
                    ) VALUES (
                        :org_id, :user_id, :patient_id,
                        :user_name, :user_role, :user_email,
                        :action, :resource_type, :resource_id,
                        :description, :ip_address, :user_agent, :request_id,
                        :previous_state, :new_state,
                        :success, :error_message
                    )
                """),
                {
                    "org_id":         str(org_id) if org_id else None,
                    "user_id":        str(user_id) if user_id else None,
                    "patient_id":     str(patient_id) if patient_id else None,
                    "user_name":      override_user_name or (
                                          str(self.token.role) if self.token else "system"
                                      ),
                    "user_role":      override_user_role or (self.token.role if self.token else "system"),
                    "user_email":     override_user_email,
                    "action":         action,
                    "resource_type":  resource_type,
                    "resource_id":    str(resource_id) if resource_id else None,
                    "description":    description,
                    "ip_address":     ip_address,
                    "user_agent":     user_agent,
                    "request_id":     request_id,
                    "previous_state": str(previous_state) if previous_state else None,
                    "new_state":      str(new_state) if new_state else None,
                    "success":        success,
                    "error_message":  error_message,
                },
            )
        except Exception as e:
            import sys
            print(f"[AUDIT ERROR] Failed to write audit log: {e}", file=sys.stderr)