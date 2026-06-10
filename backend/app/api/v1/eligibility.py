"""
Wodoga Platform — Insurance Eligibility Service
Connects to real eligibility APIs (Waystar, Availity)
or runs in simulation mode for development and demos.
The provider is configured via the ELIGIBILITY_PROVIDER environment variable.
"""

import random
from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.audit import AuditAction, AuditLogger
from app.core.permissions import Permission, TokenPayload, require_permissions
from app.dependencies import get_audit_logger, get_current_user_payload, get_db_for_tenant

router = APIRouter(prefix="/eligibility", tags=["Insurance Eligibility"])
settings = get_settings()


# ── Request Schema ─────────────────────────────────────────────
class EligibilityCheckRequest(BaseModel):
    patient_id: Optional[UUID] = None
    insurance_provider: str
    member_id: str
    group_id: Optional[str] = None
    patient_first_name: Optional[str] = None
    patient_last_name: Optional[str] = None
    patient_dob: Optional[str] = None
    service_date: Optional[str] = None
    service_type: Optional[str] = "30"     # CMS service type code — 30 = Home Health


# ── Run Eligibility Check ─────────────────────────────────────
@router.post(
    "/check",
    dependencies=[Depends(require_permissions(Permission.ELIGIBILITY_CHECK))],
)
async def check_eligibility(
    body: EligibilityCheckRequest,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Runs a real-time insurance eligibility verification.

    In production: Routes to Waystar or Availity based on ELIGIBILITY_PROVIDER.
    In development/demo: Returns realistic simulated results.

    Every check is recorded in insurance_eligibility_checks for compliance
    and referenceable in billing workflows.
    """
    # Fetch patient details if patient_id provided
    patient_name = ""
    if body.patient_id:
        result = await db.execute(
            text("SELECT first_name, last_name, date_of_birth FROM patients WHERE id = :id"),
            {"id": str(body.patient_id)},
        )
        patient = result.mappings().first()
        if patient:
            patient_name = f"{patient['first_name']} {patient['last_name']}"
            if not body.patient_first_name:
                body.patient_first_name = patient["first_name"]
            if not body.patient_last_name:
                body.patient_last_name = patient["last_name"]
            if not body.patient_dob:
                body.patient_dob = str(patient["date_of_birth"])

    # ── Route to configured provider ──────────────────────────
    provider = settings.eligibility_provider
    result_data = {}
    api_transaction_id = None
    api_response_raw = None
    error_message = None

    try:
        if provider == "waystar":
            result_data, api_transaction_id, api_response_raw = await _check_waystar(body)
        elif provider == "availity":
            result_data, api_transaction_id, api_response_raw = await _check_availity(body)
        else:
            result_data = _simulate_eligibility(body)
    except Exception as e:
        result_data = {"result": "error", "coverage_active": False}
        error_message = str(e)

    # ── Persist the check ─────────────────────────────────────
    import json
    check_result = await db.execute(
        text("""
            INSERT INTO insurance_eligibility_checks (
                organization_id, patient_id, checked_by,
                insurance_provider, member_id, group_id, service_date,
                result, coverage_active, coverage_details,
                copay_amount, deductible_remaining,
                api_provider, api_transaction_id, api_response_raw,
                error_message
            ) VALUES (
                :org, :patient, :checked_by,
                :insurer, :member, :group, :service_date,
                :result, :active, :details,
                :copay, :deductible,
                :api_provider, :txn_id, :raw,
                :error
            )
            RETURNING id, checked_at
        """),
        {
            "org":          str(current_user.organization_id),
            "patient":      str(body.patient_id) if body.patient_id else None,
            "checked_by":   str(current_user.user_id),
            "insurer":      body.insurance_provider,
            "member":       body.member_id,
            "group":        body.group_id,
            "service_date": date.fromisoformat(str(body.service_date)) if body.service_date else None,
            "result":       result_data.get("result", "error"),
            "active":       result_data.get("coverage_active", False),
            "details":      json.dumps(result_data.get("coverage_details", {})),
            "copay":        result_data.get("copay_amount"),
            "deductible":   result_data.get("deductible_remaining"),
            "api_provider": provider,
            "txn_id":       api_transaction_id,
            "raw":          api_response_raw,
            "error":        error_message,
        },
    )
    check = check_result.mappings().first()

    await audit.log(
        AuditAction.ELIGIBILITY_CHECKED,
        f"Eligibility check: {patient_name or body.member_id} — {body.insurance_provider} — {result_data.get('result', 'error')}",
        patient_id=body.patient_id,
        resource_type="eligibility_check",
        resource_id=check["id"],
    )

    return {
        "data": {
            "check_id":          str(check["id"]),
            "checked_at":        check["checked_at"].isoformat(),
            "result":            result_data.get("result"),
            "coverage_active":   result_data.get("coverage_active"),
            "insurance_provider": body.insurance_provider,
            "member_id":         body.member_id,
            "coverage_details":  result_data.get("coverage_details", {}),
            "copay_amount":      result_data.get("copay_amount"),
            "deductible_remaining": result_data.get("deductible_remaining"),
            "patient_name":      patient_name,
            "provider_used":     provider,
            "is_simulated":      provider not in ("waystar", "availity"),
            "simulation_warning": (
                "DEMO RESULT — simulated insurance check, not a real "
                "verification."
            ) if provider not in ("waystar", "availity") else None,
            "error":             error_message,
        }
    }


# ── History ───────────────────────────────────────────────────
@router.get(
    "/history",
    dependencies=[Depends(require_permissions(Permission.ELIGIBILITY_CHECK))],
)
async def eligibility_history(
    patient_id: Optional[UUID] = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Returns a history of eligibility checks for the organization or a specific patient."""
    params = {"limit": limit}
    where = ""
    if patient_id:
        where = "WHERE ec.patient_id = :patient_id"
        params["patient_id"] = str(patient_id)

    result = await db.execute(
        text(f"""
            SELECT ec.*,
                   CONCAT(p.first_name, ' ', p.last_name) AS patient_name
            FROM insurance_eligibility_checks ec
            LEFT JOIN patients p ON p.id = ec.patient_id
            {where}
            ORDER BY ec.checked_at DESC
            LIMIT :limit
        """),
        params,
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


# ── Provider Insurance Contracts ──────────────────────────────
@router.get(
    "/provider-contracts",
    dependencies=[Depends(require_permissions(Permission.ELIGIBILITY_CHECK))],
)
async def list_provider_contracts(
    provider_id: Optional[UUID] = None,
    insurance_provider: Optional[str] = None,
    db: AsyncSession = Depends(get_db_for_tenant),
):
    """Returns which insurance plans each provider in the organization accepts."""
    conditions = ["pic.is_active = TRUE"]
    params = {}

    if provider_id:
        conditions.append("pic.provider_id = :provider_id")
        params["provider_id"] = str(provider_id)
    if insurance_provider:
        conditions.append("pic.insurance_provider ILIKE :insurer")
        params["insurer"] = f"%{insurance_provider}%"

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT
                pic.*,
                CONCAT(u.first_name, ' ', u.last_name) as provider_name,
                u.npi_number
            FROM provider_insurance_contracts pic
            JOIN users u ON u.id = pic.provider_id
            WHERE {where}
            ORDER BY u.last_name, pic.insurance_provider
        """),
        params,
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


@router.post(
    "/provider-contracts",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.STAFF_MANAGE))],
)
async def add_provider_contract(
    body: dict,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Adds an insurance contract for a provider.
    This is how physicians specify which insurance plans they accept.
    Called by admins when onboarding providers or updating contracts.
    """
    result = await db.execute(
        text("""
            INSERT INTO provider_insurance_contracts (
                organization_id, provider_id, insurance_provider,
                plan_name, plan_type, payer_id,
                contract_start, contract_end,
                is_accepting_new, notes
            ) VALUES (
                :org, :provider, :insurer,
                :plan_name, :plan_type, :payer_id,
                :start, :end, :accepting, :notes
            )
            ON CONFLICT (organization_id, provider_id, insurance_provider, plan_name)
            DO UPDATE SET
                is_active = TRUE,
                is_accepting_new = EXCLUDED.is_accepting_new,
                updated_at = NOW()
            RETURNING id
        """),
        {
            "org":        str(current_user.organization_id),
            "provider":   str(body.get("provider_id")),
            "insurer":    body.get("insurance_provider"),
            "plan_name":  body.get("plan_name", ""),
            "plan_type":  body.get("plan_type"),
            "payer_id":   body.get("payer_id"),
            "start":      body.get("contract_start"),
            "end":        body.get("contract_end"),
            "accepting":  body.get("is_accepting_new", True),
            "notes":      body.get("notes"),
        },
    )
    new = result.mappings().first()

    await audit.log(
        "PROVIDER_CONTRACT_ADDED",
        f"Added insurance contract: {body.get('insurance_provider')} for provider {body.get('provider_id')}",
    )

    return {"data": dict(new), "message": "Insurance contract saved."}


# ══════════════════════════════════════════════════════════════
# ELIGIBILITY PROVIDER IMPLEMENTATIONS
# ══════════════════════════════════════════════════════════════

async def _check_waystar(body: EligibilityCheckRequest) -> tuple[dict, str, str]:
    """
    Calls the Waystar eligibility API.
    Requires WAYSTAR_API_KEY and WAYSTAR_SUBMITTER_ID in environment.
    Returns (result_data, transaction_id, raw_response).

    Waystar API docs: https://waystar.com/api-documentation
    """
    if not settings.waystar_api_key:
        raise ValueError("Waystar API key not configured.")

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            f"{settings.waystar_api_url}/realtime",
            headers={
                "Authorization": f"Bearer {settings.waystar_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "submitterId": settings.waystar_submitter_id,
                "payerId": body.insurance_provider,
                "subscriber": {
                    "memberId": body.member_id,
                    "groupId": body.group_id,
                    "firstName": body.patient_first_name,
                    "lastName": body.patient_last_name,
                    "dateOfBirth": body.patient_dob,
                },
                "serviceDate": body.service_date or date.today().isoformat(),
                "serviceType": body.service_type,
            },
        )

    raw = response.text
    if response.status_code != 200:
        return {"result": "error", "coverage_active": False}, None, raw

    data = response.json()
    txn_id = data.get("transactionId")

    active = data.get("eligibilityStatus") == "1"  # 1 = Active per X12 standard
    return {
        "result": "eligible" if active else "not_eligible",
        "coverage_active": active,
        "coverage_details": data.get("benefits", {}),
        "copay_amount": data.get("copayAmount"),
        "deductible_remaining": data.get("deductibleRemaining"),
    }, txn_id, raw


async def _check_availity(body: EligibilityCheckRequest) -> tuple[dict, str, str]:
    """
    Calls the Availity eligibility API.
    Requires AVAILITY_CLIENT_ID and AVAILITY_CLIENT_SECRET in environment.
    Availity is free for Medicare and many Blue Cross queries.
    """
    if not settings.availity_client_id:
        raise ValueError("Availity credentials not configured.")

    # First obtain access token
    async with httpx.AsyncClient(timeout=15.0) as client:
        token_response = await client.post(
            f"{settings.availity_api_url}/token",
            data={
                "grant_type": "client_credentials",
                "client_id": settings.availity_client_id,
                "client_secret": settings.availity_client_secret,
                "scope": "hipaa",
            },
        )
        token = token_response.json().get("access_token")

        # Run eligibility check
        response = await client.get(
            f"{settings.availity_api_url}/coverages",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "payerId": body.insurance_provider,
                "memberId": body.member_id,
                "firstName": body.patient_first_name,
                "lastName": body.patient_last_name,
                "birthDate": body.patient_dob,
                "serviceType": body.service_type,
            },
        )

    raw = response.text
    data = response.json()
    txn_id = data.get("id")

    coverages = data.get("coverages", [])
    active = any(c.get("status") == "1" for c in coverages)

    return {
        "result": "eligible" if active else "not_eligible",
        "coverage_active": active,
        "coverage_details": {"coverages": coverages},
        "copay_amount": None,
        "deductible_remaining": None,
    }, txn_id, raw


def _simulate_eligibility(body: EligibilityCheckRequest) -> dict:
    """
    Realistic simulation for development and demos.
    Medicare/Medicaid are biased toward eligible (90%).
    Commercial plans are biased toward eligible (75%).
    Used when ELIGIBILITY_PROVIDER=simulated.
    """
    insurer = body.insurance_provider.lower()
    is_government = any(x in insurer for x in ["medicare", "medicaid", "cms", "tricare"])

    roll = random.random()
    if is_government:
        if roll < 0.88:
            result, active = "eligible", True
        elif roll < 0.95:
            result, active = "pending_review", False
        else:
            result, active = "not_eligible", False
    else:
        if roll < 0.74:
            result, active = "eligible", True
        elif roll < 0.87:
            result, active = "pending_review", False
        else:
            result, active = "not_eligible", False

    return {
        "result": result,
        "coverage_active": active,
        "coverage_details": {
            "plan_name": f"{body.insurance_provider} Standard Plan",
            "plan_type": "PPO" if not is_government else ("Medicare" if "medicare" in insurer else "Medicaid"),
            "group_id": body.group_id or "GRP-0000",
            "effective_date": "2024-01-01",
            "termination_date": "2024-12-31",
            "network": "In-Network",
            "home_health_covered": active,
            "simulated": True,
        },
        "copay_amount": round(random.uniform(0, 45), 2) if active else None,
        "deductible_remaining": round(random.uniform(0, 2500), 2) if active else None,
    }
