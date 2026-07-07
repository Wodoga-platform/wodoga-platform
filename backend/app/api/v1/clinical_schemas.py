"""
Wodoga Platform — Request Schemas for Clinical Operations

These Pydantic models replace the raw `body: dict` parameters that previously
accepted unvalidated input on 10 endpoints. Each model mirrors EXACTLY the
fields the corresponding endpoint reads, so behavior is unchanged — except that
malformed input is now rejected with a clear 422 instead of silently corrupting
data or raising an opaque error inside the handler.

Part of Phase 1 (security floor): "Replace all raw dict request bodies with
validated schemas." See the remediation plan.

CONVENTIONS FOLLOWED:
- Field sets derived directly from the body.get(...) calls in each endpoint
  (verified against current code, not assumed)
- Optional fields preserve their previous defaults (None or empty string)
- Field validators ONLY enforce constraints the endpoint already enforced
  by hand; we do not add new business rules in this layer
- UUIDs are typed as UUID (not str) so malformed UUIDs are rejected up front
"""

from typing import Optional
from uuid import UUID

from pydantic import BaseModel, field_validator


# ── PATCH /medications/reconciliation/{id}  — resolve_reconciliation ──
class ReconciliationResolveRequest(BaseModel):
    status: str  # 'reviewed' or 'escalated'
    resolution_notes: Optional[str] = ""

    @field_validator("status")
    @classmethod
    def status_valid(cls, v: str) -> str:
        if v not in ("reviewed", "escalated"):
            raise ValueError("status must be 'reviewed' or 'escalated'")
        return v


# ── PATCH /care-plans/{id}  — update_care_plan ──
# Endpoint accepts a subset of editable fields via a dynamic body[field] loop.
# All fields optional; only fields present are updated.
class CarePlanUpdateRequest(BaseModel):
    primary_diagnosis: Optional[str] = None
    ordering_physician: Optional[str] = None
    visit_frequency: Optional[str] = None
    duration: Optional[str] = None
    goals: Optional[str] = None
    interventions: Optional[str] = None
    expected_outcomes: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    review_date: Optional[str] = None


# ── PATCH /billing/{claim_id}/status  — update_claim_status ──
class ClaimStatusUpdateRequest(BaseModel):
    status: str
    amount_paid: Optional[float] = None
    denial_code: Optional[str] = None
    denial_reason: Optional[str] = None

    @field_validator("status")
    @classmethod
    def status_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("status is required")
        return v


# ── POST /pharm-orders  — create_pharm_order ──
class PharmOrderCreateRequest(BaseModel):
    patient_id: UUID
    drug_name: str
    medication_id: Optional[UUID] = None
    pharmacy_name: Optional[str] = None
    pharmacy_phone: Optional[str] = None
    quantity: Optional[str] = None
    expected_delivery: Optional[str] = None
    is_urgent: Optional[bool] = False
    notes: Optional[str] = None

    @field_validator("drug_name")
    @classmethod
    def drug_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("drug_name is required")
        return v


# ── PATCH /pharm-orders/{id}  — update_pharm_order ──
# Subset of editable fields, dynamic body[field] loop.
class PharmOrderUpdateRequest(BaseModel):
    drug_name: Optional[str] = None
    stage: Optional[str] = None
    pharmacy_name: Optional[str] = None
    pharmacy_phone: Optional[str] = None
    quantity: Optional[str] = None
    expected_delivery: Optional[str] = None
    is_urgent: Optional[bool] = None
    notes: Optional[str] = None


# ── POST /oasis  — create_oasis ──
class OASISCreateRequest(BaseModel):
    patient_id: UUID
    assessment_type: str
    assessment_date: Optional[str] = None
    m1032_hospitalization_risk: Optional[str] = None
    m1800_grooming: Optional[str] = None
    m2020_oral_medications: Optional[str] = None
    clinical_notes: Optional[str] = None
    responses: Optional[dict] = None

    @field_validator("assessment_type")
    @classmethod
    def type_valid(cls, v: str) -> str:
        # SOC, ROC, FU, TRN, DC are the real OASIS reasons for assessment
        allowed = {"SOC", "ROC", "FU", "TRN", "DC"}
        if v not in allowed:
            raise ValueError(f"assessment_type must be one of {', '.join(sorted(allowed))}")
        return v


# ── POST /messages  — send_message (staff) ──
class MessageSendRequest(BaseModel):
    recipient_id: UUID
    subject: str
    body: str
    patient_id: Optional[UUID] = None
    is_urgent: Optional[bool] = False
    parent_message_id: Optional[UUID] = None

    @field_validator("subject", "body")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("subject and body cannot be empty")
        return v


# ── POST /staff/invite  — invite_staff ──
class StaffInviteRequest(BaseModel):
    email: str
    first_name: str
    last_name: str
    role: str
    phone: Optional[str] = None
    license_number: Optional[str] = None
    license_type: Optional[str] = None

    @field_validator("email")
    @classmethod
    def email_present(cls, v: str) -> str:
        if not v or "@" not in v:
            raise ValueError("a valid email is required")
        return v

    @field_validator("first_name", "last_name", "role")
    @classmethod
    def required_field(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("field is required")
        return v


# ── POST /eligibility/provider-contracts  — add_provider_contract ──
# NOTE: matches what the endpoint actually reads. The endpoint does NOT
# currently use plan_name or is_accepting_new from the body.
class ProviderContractRequest(BaseModel):
    provider_id: UUID
    insurance_provider: str
    plan_name: Optional[str] = ""
    plan_type: Optional[str] = None
    payer_id: Optional[str] = None
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    is_accepting_new: Optional[bool] = True
    notes: Optional[str] = None

    @field_validator("insurance_provider")
    @classmethod
    def insurer_present(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("insurance_provider is required")
        return v


# ── POST /portal/me/messages  — portal_send_message ──
# Patient-facing. recipient_id is optional (server auto-routes to assigned
# provider/caregiver if not provided). Subject defaults to "Message from
# patient" if blank; body defaults to "".
class PortalMessageSendRequest(BaseModel):
    recipient_id: Optional[UUID] = None
    subject: Optional[str] = "Message from patient"
    body: Optional[str] = ""
