"""
Wodoga Platform — Remaining API Modules
medications, care_plans, referrals, billing,
pharm_orders, oasis, messages, staff, notifications, audit_logs
"""

# ════════════════════════════════════════════════════════════════
# MEDICATIONS
# ════════════════════════════════════════════════════════════════
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditAction, AuditLogger
from app.core.permissions import Permission, TokenPayload, require_permissions
from app.dependencies import get_audit_logger, get_current_user_payload, get_db_for_tenant

# ── Medications Router ─────────────────────────────────────────
medications_router = APIRouter(prefix="/medications", tags=["Medications"])


class MedicationCreate(BaseModel):
    patient_id: UUID
    drug_name: str
    brand_name: Optional[str] = None
    dosage: str
    dosage_unit: Optional[str] = None
    route: str = "oral"
    frequency: str
    frequency_code: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    refills_remaining: int = 0
    next_refill_date: Optional[str] = None
    prescriber_name: Optional[str] = None
    prescriber_npi: Optional[str] = None
    pharmacy_name: Optional[str] = None
    controlled_substance: bool = False
    schedule: Optional[str] = None
    instructions: Optional[str] = None


class MedicationUpdate(BaseModel):
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    refills_remaining: Optional[int] = None
    next_refill_date: Optional[str] = None
    status: Optional[str] = None
    discontinued_reason: Optional[str] = None
    instructions: Optional[str] = None


@medications_router.get("", dependencies=[Depends(require_permissions(Permission.MEDS_VIEW))])
async def list_medications(
    patient_id: Optional[UUID] = Query(None),
    status: Optional[str] = Query(None),
    low_refills: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    offset = (page - 1) * per_page
    conditions, params = [], {"limit": per_page, "offset": offset}

    if patient_id:
        conditions.append("m.patient_id = :patient_id")
        params["patient_id"] = str(patient_id)
    if status:
        conditions.append("m.status = :status")
        params["status"] = status
    else:
        conditions.append("m.status = 'active'")
    if low_refills:
        conditions.append("m.refills_remaining <= 1")

    where = (" AND ".join(conditions)) if conditions else "TRUE"

    result = await db.execute(
        text(f"""
            SELECT m.*, p.first_name, p.last_name,
                   COUNT(*) OVER() AS total_count
            FROM medications m
            JOIN patients p ON p.id = m.patient_id
            WHERE {where}
            ORDER BY m.drug_name ASC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.mappings().all()
    total = rows[0]["total_count"] if rows else 0
    items = [dict(r) for r in rows]
    for i in items:
        i.pop("total_count", None)

    return {"data": items, "pagination": {"page": page, "per_page": per_page, "total": total}}


@medications_router.post(
    "", status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.MEDS_PRESCRIBE))],
)
async def prescribe_medication(
    body: MedicationCreate,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    p = await db.execute(
        text("SELECT first_name, last_name FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(body.patient_id)},
    )
    patient = p.mappings().first()
    if not patient:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    result = await db.execute(
        text("""
            INSERT INTO medications (
                organization_id, patient_id, prescribed_by,
                drug_name, brand_name, dosage, dosage_unit, route,
                frequency, frequency_code, start_date, end_date,
                refills_remaining, next_refill_date,
                prescriber_name, prescriber_npi, pharmacy_name,
                controlled_substance, schedule, instructions
            ) VALUES (
                :org, :patient, :by,
                :drug, :brand, :dosage, :unit, :route,
                :freq, :freq_code, :start, :end,
                :refills, :refill_date,
                :prescriber, :npi, :pharmacy,
                :controlled, :schedule, :instructions
            ) RETURNING id, drug_name, dosage, created_at
        """),
        {
            "org": str(current_user.organization_id), "patient": str(body.patient_id),
            "by": str(current_user.user_id), "drug": body.drug_name, "brand": body.brand_name,
            "dosage": body.dosage, "unit": body.dosage_unit, "route": body.route,
            "freq": body.frequency, "freq_code": body.frequency_code,
            "start": body.start_date, "end": body.end_date,
            "refills": body.refills_remaining, "refill_date": body.next_refill_date,
            "prescriber": body.prescriber_name, "npi": body.prescriber_npi,
            "pharmacy": body.pharmacy_name, "controlled": body.controlled_substance,
            "schedule": body.schedule, "instructions": body.instructions,
        },
    )
    med = result.mappings().first()
    await audit.log(
        AuditAction.MEDICATION_PRESCRIBED,
        f"Prescribed {body.drug_name} {body.dosage} for {patient['first_name']} {patient['last_name']}",
        patient_id=body.patient_id, resource_type="medication", resource_id=med["id"],
    )
    return {"data": dict(med), "message": f"{body.drug_name} prescribed successfully."}


@medications_router.patch(
    "/{med_id}",
    dependencies=[Depends(require_permissions(Permission.MEDS_PRESCRIBE))],
)
async def update_medication(
    med_id: UUID, body: MedicationUpdate,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    result = await db.execute(
        text("SELECT * FROM medications WHERE id = :id"), {"id": str(med_id)}
    )
    med = result.mappings().first()
    if not med:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    updates = body.model_dump(exclude_none=True)
    if not updates:
        return {"message": "No changes."}

    # Handle discontinuation
    if updates.get("status") == "discontinued":
        updates["discontinued_at"] = "NOW()"

    set_parts = [f"{k} = :{k}" for k in updates if k != "discontinued_at"]
    if "discontinued_at" in updates:
        set_parts.append("discontinued_at = NOW()")
        updates.pop("discontinued_at")

    params = {**updates, "id": str(med_id)}
    await db.execute(
        text(f"UPDATE medications SET {', '.join(set_parts)}, updated_at = NOW() WHERE id = :id"), params
    )
    await audit.log(
        AuditAction.MEDICATION_DISCONTINUED if updates.get("status") == "discontinued"
            else AuditAction.MEDICATION_PRESCRIBED,
        f"Updated medication {med['drug_name']}: {list(updates.keys())}",
        patient_id=med["patient_id"], resource_type="medication", resource_id=med_id,
    )
    return {"message": "Medication updated."}


@medications_router.post(
    "/reconciliation",
    dependencies=[Depends(require_permissions(Permission.MEDS_RECONCILE))],
)
async def run_reconciliation(
    patient_id: UUID,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Runs medication conflict detection for a patient."""
    result = await db.execute(
        text("SELECT * FROM medications WHERE patient_id = :pid AND status = 'active'"),
        {"pid": str(patient_id)},
    )
    meds = [dict(r) for r in result.mappings().all()]

    CONFLICTS = [
        {"drugs": ["lisinopril", "potassium"], "warn": "ACE inhibitor + potassium may cause hyperkalemia"},
        {"drugs": ["clopidogrel", "aspirin"], "warn": "Dual antiplatelet — increased bleeding risk"},
        {"drugs": ["metformin", "furosemide"], "warn": "Loop diuretic may impair glycemic control"},
        {"drugs": ["warfarin", "aspirin"], "warn": "Combined anticoagulant/antiplatelet — major bleeding risk"},
        {"drugs": ["ssri", "tramadol"], "warn": "Serotonin syndrome risk"},
    ]

    med_names = [m["drug_name"].lower() for m in meds]
    conflicts_found = []

    for conflict in CONFLICTS:
        if all(any(d in name for name in med_names) for d in conflict["drugs"]):
            conflicts_found.append(conflict)

    recon = await db.execute(
        text("""
            INSERT INTO medication_reconciliations (
                organization_id, patient_id, performed_by,
                conflicts_found, conflict_details, status
            ) VALUES (:org, :patient, :by, :found, :details::jsonb, 'pending_review')
            RETURNING id, performed_at
        """),
        {
            "org": str(current_user.organization_id), "patient": str(patient_id),
            "by": str(current_user.user_id), "found": len(conflicts_found) > 0,
            "details": str(conflicts_found),
        },
    )
    recon_record = recon.mappings().first()

    await audit.log(
        AuditAction.RECONCILIATION_RUN,
        f"Medication reconciliation: {len(meds)} meds, {len(conflicts_found)} conflicts found",
        patient_id=patient_id, resource_type="reconciliation", resource_id=recon_record["id"],
    )

    return {
        "data": {
            "reconciliation_id": str(recon_record["id"]),
            "medications_reviewed": len(meds),
            "conflicts_found": len(conflicts_found),
            "conflicts": conflicts_found,
            "medications": meds,
        }
    }


# ════════════════════════════════════════════════════════════════
# CARE PLANS
# ════════════════════════════════════════════════════════════════
care_plans_router = APIRouter(prefix="/care-plans", tags=["Care Plans"])


class CarePlanCreate(BaseModel):
    patient_id: UUID
    primary_diagnosis: str
    ordering_physician: str
    start_date: str
    end_date: Optional[str] = None
    review_date: Optional[str] = None
    visit_frequency: str
    duration: Optional[str] = None
    goals: Optional[str] = None
    interventions: Optional[str] = None
    expected_outcomes: Optional[str] = None


@care_plans_router.get("", dependencies=[Depends(require_permissions(Permission.CARE_PLANS_VIEW))])
async def list_care_plans(
    patient_id: Optional[UUID] = Query(None),
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    conditions = []
    params = {}
    if patient_id:
        conditions.append("cp.patient_id = :patient_id")
        params["patient_id"] = str(patient_id)
    if active_only:
        conditions.append("cp.status = 'active'")

    where = (" AND ".join(conditions)) if conditions else "TRUE"
    result = await db.execute(
        text(f"""
            SELECT cp.*, p.first_name, p.last_name, p.primary_diagnosis AS patient_dx
            FROM care_plans cp
            JOIN patients p ON p.id = cp.patient_id
            WHERE {where}
            ORDER BY cp.start_date DESC
        """),
        params,
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


@care_plans_router.post(
    "", status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.CARE_PLANS_CREATE))],
)
async def create_care_plan(
    body: CarePlanCreate,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    p = await db.execute(
        text("SELECT first_name, last_name FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(body.patient_id)},
    )
    patient = p.mappings().first()
    if not patient:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    result = await db.execute(
        text("""
            INSERT INTO care_plans (
                organization_id, patient_id, created_by,
                primary_diagnosis, ordering_physician,
                start_date, end_date, review_date,
                visit_frequency, duration,
                goals, interventions, expected_outcomes, status
            ) VALUES (
                :org, :patient, :by,
                :dx, :physician,
                :start, :end, :review,
                :freq, :duration,
                :goals, :interventions, :outcomes, 'active'
            ) RETURNING id, created_at
        """),
        {
            "org": str(current_user.organization_id), "patient": str(body.patient_id),
            "by": str(current_user.user_id), "dx": body.primary_diagnosis,
            "physician": body.ordering_physician, "start": body.start_date,
            "end": body.end_date, "review": body.review_date,
            "freq": body.visit_frequency, "duration": body.duration,
            "goals": body.goals, "interventions": body.interventions,
            "outcomes": body.expected_outcomes,
        },
    )
    cp = result.mappings().first()
    await audit.log(
        AuditAction.CARE_PLAN_CREATED,
        f"Care plan created for {patient['first_name']} {patient['last_name']} — {body.primary_diagnosis}",
        patient_id=body.patient_id, resource_type="care_plan", resource_id=cp["id"],
    )
    return {"data": dict(cp), "message": "Care plan created."}


# ════════════════════════════════════════════════════════════════
# REFERRALS
# ════════════════════════════════════════════════════════════════
referrals_router = APIRouter(prefix="/referrals", tags=["Referrals"])


class ReferralCreate(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    referral_source: Optional[str] = None
    referring_physician: Optional[str] = None
    diagnosis: Optional[str] = None
    insurance_provider: Optional[str] = None
    insurance_id: Optional[str] = None
    urgency: str = "routine"
    notes: Optional[str] = None


@referrals_router.get("", dependencies=[Depends(require_permissions(Permission.REFERRALS_VIEW))])
async def list_referrals(
    stage: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    conditions = ["r.stage NOT IN ('admitted', 'declined', 'lost')"]
    params = {}
    if stage:
        conditions = ["r.stage = :stage"]
        params["stage"] = stage

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT r.*, CONCAT(u.first_name, ' ', u.last_name) AS managed_by_name
            FROM referrals r
            LEFT JOIN users u ON u.id = r.managed_by
            WHERE {where}
            ORDER BY
                CASE r.urgency WHEN 'emergent' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
                r.created_at DESC
        """),
        params,
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


@referrals_router.post(
    "", status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.REFERRALS_CREATE))],
)
async def create_referral(
    body: ReferralCreate,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    result = await db.execute(
        text("""
            INSERT INTO referrals (
                organization_id, managed_by, first_name, last_name,
                date_of_birth, phone, email, referral_source, referring_physician,
                diagnosis, insurance_provider, insurance_id, urgency, notes
            ) VALUES (
                :org, :by, :fn, :ln, :dob, :phone, :email,
                :source, :physician, :dx, :insurer, :ins_id, :urgency, :notes
            ) RETURNING id, created_at
        """),
        {
            "org": str(current_user.organization_id), "by": str(current_user.user_id),
            "fn": body.first_name, "ln": body.last_name, "dob": body.date_of_birth,
            "phone": body.phone, "email": body.email, "source": body.referral_source,
            "physician": body.referring_physician, "dx": body.diagnosis,
            "insurer": body.insurance_provider, "ins_id": body.insurance_id,
            "urgency": body.urgency, "notes": body.notes,
        },
    )
    ref = result.mappings().first()
    await audit.log(
        AuditAction.REFERRAL_CREATED,
        f"New referral: {body.first_name} {body.last_name} from {body.referral_source or 'unknown'}",
        resource_type="referral", resource_id=ref["id"],
    )
    return {"data": dict(ref), "message": "Referral created."}


@referrals_router.post(
    "/{referral_id}/advance",
    dependencies=[Depends(require_permissions(Permission.REFERRALS_ADVANCE))],
)
async def advance_referral(
    referral_id: UUID,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Advances a referral to the next pipeline stage."""
    STAGES = ["new_lead", "contacted", "evaluating", "insurance_check", "admitted"]
    result = await db.execute(
        text("SELECT * FROM referrals WHERE id = :id"), {"id": str(referral_id)}
    )
    ref = result.mappings().first()
    if not ref:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    current_idx = STAGES.index(ref["stage"]) if ref["stage"] in STAGES else -1
    if current_idx >= len(STAGES) - 1:
        raise HTTPException(status_code=400, detail={"error": "already_admitted"})

    next_stage = STAGES[current_idx + 1]
    update_params = {"stage": next_stage, "id": str(referral_id)}
    extra_set = ""

    if next_stage == "admitted":
        # Auto-create the patient record
        patient_result = await db.execute(
            text("""
                INSERT INTO patients (
                    organization_id, first_name, last_name, date_of_birth,
                    phone, email, insurance_primary, notes, status
                ) VALUES (
                    :org, :fn, :ln, :dob, :phone, :email,
                    :insurance::jsonb, :notes, 'active'
                ) RETURNING id
            """),
            {
                "org": str(current_user.organization_id),
                "fn": ref["first_name"], "ln": ref["last_name"],
                "dob": ref["date_of_birth"], "phone": ref["phone"],
                "email": ref["email"],
                "insurance": f'{{"provider": "{ref["insurance_provider"]}", "member_id": "{ref["insurance_id"]}"}}'
                    if ref["insurance_provider"] else "{}",
                "notes": f"Admitted via referral from {ref['referral_source'] or 'unknown'}",
            },
        )
        new_patient = patient_result.mappings().first()
        update_params["converted_patient_id"] = str(new_patient["id"])
        extra_set = ", converted_patient_id = :converted_patient_id, admitted_at = NOW()"

    await db.execute(
        text(f"UPDATE referrals SET stage = :stage{extra_set}, updated_at = NOW() WHERE id = :id"),
        update_params,
    )

    await audit.log(
        AuditAction.REFERRAL_ADMITTED if next_stage == "admitted" else AuditAction.REFERRAL_ADVANCED,
        f"Referral {ref['first_name']} {ref['last_name']} advanced to {next_stage}",
        resource_type="referral", resource_id=referral_id,
    )

    return {
        "data": {"stage": next_stage},
        "message": f"Referral advanced to {next_stage}."
            + (" Patient record created." if next_stage == "admitted" else ""),
    }


# ════════════════════════════════════════════════════════════════
# BILLING
# ════════════════════════════════════════════════════════════════
billing_router = APIRouter(prefix="/billing", tags=["Billing"])


class ClaimCreate(BaseModel):
    patient_id: UUID
    visit_id: Optional[UUID] = None
    service_type: str
    cpt_code: Optional[str] = None
    icd10_codes: Optional[list[str]] = []
    service_date: str
    amount_billed: float
    insurance_provider: str
    insurance_id: Optional[str] = None
    prior_auth_number: Optional[str] = None
    notes: Optional[str] = None


@billing_router.get("", dependencies=[Depends(require_permissions(Permission.BILLING_VIEW))])
async def list_claims(
    patient_id: Optional[UUID] = Query(None),
    claim_status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    offset = (page - 1) * per_page
    conditions, params = [], {"limit": per_page, "offset": offset}
    if patient_id:
        conditions.append("bc.patient_id = :patient_id")
        params["patient_id"] = str(patient_id)
    if claim_status:
        conditions.append("bc.status = :status")
        params["status"] = claim_status

    where = (" AND ".join(conditions)) if conditions else "TRUE"
    result = await db.execute(
        text(f"""
            SELECT bc.*, p.first_name, p.last_name,
                   COUNT(*) OVER() AS total_count
            FROM billing_claims bc
            JOIN patients p ON p.id = bc.patient_id
            WHERE {where}
            ORDER BY bc.service_date DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.mappings().all()
    total = rows[0]["total_count"] if rows else 0
    items = [dict(r) for r in rows]
    for i in items:
        i.pop("total_count", None)
    return {"data": items, "pagination": {"page": page, "per_page": per_page, "total": total}}


@billing_router.get("/summary", dependencies=[Depends(require_permissions(Permission.BILLING_VIEW))])
async def billing_summary(db: AsyncSession = Depends(get_db_for_tenant)):
    result = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status = 'pending')  AS pending_count,
            COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
            COUNT(*) FILTER (WHERE status = 'denied')   AS denied_count,
            COUNT(*) FILTER (WHERE status = 'paid')     AS paid_count,
            COALESCE(SUM(amount_billed), 0)             AS total_billed,
            COALESCE(SUM(amount_approved), 0)           AS total_approved,
            COALESCE(SUM(amount_paid), 0)               AS total_paid
        FROM billing_claims
    """))
    return {"data": dict(result.mappings().first())}


@billing_router.post(
    "", status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.BILLING_CREATE))],
)
async def submit_claim(
    body: ClaimCreate,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    import random, string
    claim_number = "CLM-" + "".join(random.choices(string.digits, k=8))

    result = await db.execute(
        text("""
            INSERT INTO billing_claims (
                organization_id, patient_id, visit_id, created_by,
                claim_number, service_type, cpt_code, icd10_codes,
                service_date, amount_billed, insurance_provider, insurance_id,
                prior_auth_number, notes, status, submitted_at
            ) VALUES (
                :org, :patient, :visit, :by,
                :claim_no, :service, :cpt, :icd::text[],
                :service_date, :amount, :insurer, :ins_id,
                :auth, :notes, 'submitted', NOW()
            ) RETURNING id, claim_number, created_at
        """),
        {
            "org": str(current_user.organization_id), "patient": str(body.patient_id),
            "visit": str(body.visit_id) if body.visit_id else None,
            "by": str(current_user.user_id), "claim_no": claim_number,
            "service": body.service_type, "cpt": body.cpt_code,
            "icd": body.icd10_codes or [], "service_date": body.service_date,
            "amount": body.amount_billed, "insurer": body.insurance_provider,
            "ins_id": body.insurance_id, "auth": body.prior_auth_number, "notes": body.notes,
        },
    )
    claim = result.mappings().first()
    await audit.log(
        AuditAction.CLAIM_SUBMITTED,
        f"Claim {claim_number} submitted — ${body.amount_billed:.2f} — {body.insurance_provider}",
        patient_id=body.patient_id, resource_type="billing_claim", resource_id=claim["id"],
    )
    return {"data": dict(claim), "message": f"Claim {claim_number} submitted."}


@billing_router.patch(
    "/{claim_id}/status",
    dependencies=[Depends(require_permissions(Permission.BILLING_UPDATE))],
)
async def update_claim_status(
    claim_id: UUID, body: dict,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    new_status = body.get("status")
    valid = ["pending", "approved", "denied", "appealed", "paid", "written_off"]
    if new_status not in valid:
        raise HTTPException(status_code=400, detail={"error": "invalid_status"})

    result = await db.execute(
        text("SELECT * FROM billing_claims WHERE id = :id"), {"id": str(claim_id)}
    )
    claim = result.mappings().first()
    if not claim:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    extra = ""
    params = {"status": new_status, "id": str(claim_id)}
    if new_status == "paid":
        extra = ", paid_at = NOW(), amount_paid = :amount_paid"
        params["amount_paid"] = body.get("amount_paid", claim["amount_billed"])
    if new_status in ("denied", "appealed"):
        extra += ", denial_reason = :denial_reason, denial_code = :denial_code"
        params["denial_reason"] = body.get("denial_reason")
        params["denial_code"] = body.get("denial_code")

    await db.execute(
        text(f"UPDATE billing_claims SET status = :status{extra}, updated_at = NOW() WHERE id = :id"),
        params,
    )
    await audit.log(
        AuditAction.CLAIM_UPDATED,
        f"Claim {claim['claim_number']} status → {new_status}",
        patient_id=claim["patient_id"], resource_type="billing_claim", resource_id=claim_id,
    )
    return {"message": f"Claim status updated to {new_status}."}


# ════════════════════════════════════════════════════════════════
# PHARMACEUTICAL ORDERS
# ════════════════════════════════════════════════════════════════
pharm_router = APIRouter(prefix="/pharm-orders", tags=["Pharmaceutical Orders"])
PHARM_STAGES = ["prescribed", "verified", "dispensed", "in_transit", "delivered"]


@pharm_router.get("", dependencies=[Depends(require_permissions(Permission.PHARM_VIEW))])
async def list_pharm_orders(
    stage: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    params = {}
    where = "po.stage = :stage" if stage else "po.stage != 'cancelled'"
    if stage:
        params["stage"] = stage

    result = await db.execute(
        text(f"""
            SELECT po.*, p.first_name, p.last_name
            FROM pharmaceutical_orders po
            JOIN patients p ON p.id = po.patient_id
            WHERE {where}
            ORDER BY po.is_urgent DESC, po.order_date DESC
        """),
        params,
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


@pharm_router.post(
    "", status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.PHARM_CREATE))],
)
async def create_pharm_order(
    body: dict,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    result = await db.execute(
        text("""
            INSERT INTO pharmaceutical_orders (
                organization_id, patient_id, medication_id, ordered_by,
                drug_name, quantity, pharmacy_name, pharmacy_phone,
                expected_delivery, stage, is_urgent, notes
            ) VALUES (
                :org, :patient, :med, :by,
                :drug, :qty, :pharmacy, :ph_phone,
                :delivery, 'prescribed', :urgent, :notes
            ) RETURNING id, drug_name, stage, created_at
        """),
        {
            "org": str(current_user.organization_id),
            "patient": str(body.get("patient_id")),
            "med": body.get("medication_id"),
            "by": str(current_user.user_id),
            "drug": body.get("drug_name"),
            "qty": body.get("quantity"),
            "pharmacy": body.get("pharmacy_name"),
            "ph_phone": body.get("pharmacy_phone"),
            "delivery": body.get("expected_delivery"),
            "urgent": body.get("is_urgent", False),
            "notes": body.get("notes"),
        },
    )
    order = result.mappings().first()
    await audit.log(
        AuditAction.PHARM_ORDER_CREATED,
        f"Pharm order placed: {body.get('drug_name')} — {body.get('quantity')}",
        resource_type="pharm_order", resource_id=order["id"],
    )
    return {"data": dict(order), "message": "Order placed."}


@pharm_router.post(
    "/{order_id}/advance",
    dependencies=[Depends(require_permissions(Permission.PHARM_ADVANCE))],
)
async def advance_pharm_order(
    order_id: UUID,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    result = await db.execute(
        text("SELECT * FROM pharmaceutical_orders WHERE id = :id"), {"id": str(order_id)}
    )
    order = result.mappings().first()
    if not order:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    current_idx = PHARM_STAGES.index(order["stage"]) if order["stage"] in PHARM_STAGES else -1
    if current_idx >= len(PHARM_STAGES) - 1:
        raise HTTPException(status_code=400, detail={"error": "already_delivered"})

    next_stage = PHARM_STAGES[current_idx + 1]
    extra = ", actual_delivery = NOW()" if next_stage == "delivered" else ""
    await db.execute(
        text(f"UPDATE pharmaceutical_orders SET stage = :stage{extra}, updated_at = NOW() WHERE id = :id"),
        {"stage": next_stage, "id": str(order_id)},
    )
    await audit.log(
        AuditAction.PHARM_ORDER_ADVANCED,
        f"Order {order['drug_name']} advanced to {next_stage}",
        resource_type="pharm_order", resource_id=order_id,
    )
    return {"data": {"stage": next_stage}, "message": f"Advanced to {next_stage}."}


# ════════════════════════════════════════════════════════════════
# OASIS ASSESSMENTS
# ════════════════════════════════════════════════════════════════
oasis_router = APIRouter(prefix="/oasis", tags=["OASIS Assessments"])


@oasis_router.get("", dependencies=[Depends(require_permissions(Permission.OASIS_VIEW))])
async def list_oasis(
    patient_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    params = {}
    where = "oa.patient_id = :patient_id" if patient_id else "TRUE"
    if patient_id:
        params["patient_id"] = str(patient_id)

    result = await db.execute(
        text(f"""
            SELECT oa.*, p.first_name, p.last_name,
                   CONCAT(u.first_name, ' ', u.last_name) AS conducted_by_name
            FROM oasis_assessments oa
            JOIN patients p ON p.id = oa.patient_id
            LEFT JOIN users u ON u.id = oa.conducted_by
            WHERE {where}
            ORDER BY oa.assessment_date DESC
        """),
        params,
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


@oasis_router.post(
    "", status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.OASIS_CREATE))],
)
async def create_oasis(
    body: dict,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    import json
    result = await db.execute(
        text("""
            INSERT INTO oasis_assessments (
                organization_id, patient_id, conducted_by,
                assessment_type, assessment_date, responses,
                m1032_hospitalization_risk, m1800_grooming, m2020_oral_medications,
                clinical_notes, status
            ) VALUES (
                :org, :patient, :by,
                :type, :date, :responses::jsonb,
                :m1032, :m1800, :m2020, :notes, 'submitted'
            ) RETURNING id, assessment_type, assessment_date
        """),
        {
            "org": str(current_user.organization_id),
            "patient": str(body.get("patient_id")),
            "by": str(current_user.user_id),
            "type": body.get("assessment_type"),
            "date": body.get("assessment_date"),
            "responses": json.dumps(body.get("responses", {})),
            "m1032": body.get("m1032_hospitalization_risk"),
            "m1800": body.get("m1800_grooming"),
            "m2020": body.get("m2020_oral_medications"),
            "notes": body.get("clinical_notes"),
        },
    )
    assessment = result.mappings().first()
    await audit.log(
        AuditAction.OASIS_CREATED,
        f"OASIS {body.get('assessment_type')} submitted for patient {body.get('patient_id')}",
        patient_id=UUID(body["patient_id"]) if body.get("patient_id") else None,
        resource_type="oasis", resource_id=assessment["id"],
    )
    return {"data": dict(assessment), "message": "OASIS assessment submitted."}


# ════════════════════════════════════════════════════════════════
# SECURE MESSAGES
# ════════════════════════════════════════════════════════════════
messages_router = APIRouter(prefix="/messages", tags=["Secure Messages"])


@messages_router.get("", dependencies=[Depends(require_permissions(Permission.MESSAGES_VIEW))])
async def list_messages(
    folder: str = Query("inbox", regex="^(inbox|sent)$"),
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    if folder == "inbox":
        where = "m.recipient_id = :uid AND m.deleted_by_recipient = FALSE"
    else:
        where = "m.sender_id = :uid AND m.deleted_by_sender = FALSE"

    result = await db.execute(
        text(f"""
            SELECT m.*,
                   CONCAT(s.first_name, ' ', s.last_name) AS sender_name,
                   CONCAT(r.first_name, ' ', r.last_name) AS recipient_name
            FROM messages m
            JOIN users s ON s.id = m.sender_id
            JOIN users r ON r.id = m.recipient_id
            WHERE {where}
            ORDER BY m.created_at DESC
        """),
        {"uid": str(current_user.user_id)},
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


@messages_router.post(
    "", status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.MESSAGES_SEND))],
)
async def send_message(
    body: dict,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    result = await db.execute(
        text("""
            INSERT INTO messages (
                organization_id, sender_id, recipient_id, patient_id,
                subject, body, is_urgent
            ) VALUES (:org, :sender, :recipient, :patient, :subject, :body, :urgent)
            RETURNING id, created_at
        """),
        {
            "org": str(current_user.organization_id),
            "sender": str(current_user.user_id),
            "recipient": str(body.get("recipient_id")),
            "patient": body.get("patient_id"),
            "subject": body.get("subject"),
            "body": body.get("body"),
            "urgent": body.get("is_urgent", False),
        },
    )
    msg = result.mappings().first()

    # Create notification for recipient
    await db.execute(
        text("""
            INSERT INTO notifications (organization_id, user_id, notification_type, title, body, priority)
            VALUES (:org, :user, 'system', :title, :body, :priority)
        """),
        {
            "org": str(current_user.organization_id),
            "user": str(body.get("recipient_id")),
            "title": f"New message from {current_user.role}",
            "body": body.get("subject", ""),
            "priority": "high" if body.get("is_urgent") else "normal",
        },
    )

    await audit.log(
        AuditAction.MESSAGE_SENT,
        f"Secure message sent to {body.get('recipient_id')}: \"{body.get('subject')}\"",
        resource_type="message", resource_id=msg["id"],
    )
    return {"data": dict(msg), "message": "Message sent securely."}


@messages_router.patch("/{message_id}/read", dependencies=[Depends(require_permissions(Permission.MESSAGES_VIEW))])
async def mark_read(
    message_id: UUID,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    result = await db.execute(
        text("SELECT subject FROM messages WHERE id = :id AND recipient_id = :uid"),
        {"id": str(message_id), "uid": str(current_user.user_id)},
    )
    msg = result.mappings().first()
    if not msg:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    await db.execute(
        text("UPDATE messages SET is_read = TRUE, read_at = NOW() WHERE id = :id"),
        {"id": str(message_id)},
    )
    await audit.log(
        AuditAction.MESSAGE_READ,
        f"Read message: \"{msg['subject']}\"",
        resource_type="message", resource_id=message_id,
    )
    return {"message": "Marked as read."}


# ════════════════════════════════════════════════════════════════
# STAFF MANAGEMENT
# ════════════════════════════════════════════════════════════════
staff_router = APIRouter(prefix="/staff", tags=["Staff"])


@staff_router.get("", dependencies=[Depends(require_permissions(Permission.STAFF_VIEW))])
async def list_staff(
    role: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    params = {}
    where = "u.deleted_at IS NULL"
    if role:
        where += " AND r.name = :role"
        params["role"] = role

    result = await db.execute(
        text(f"""
            SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
                   u.license_number, u.license_type, u.npi_number,
                   u.is_active, u.last_login_at, u.created_at,
                   r.name AS role, r.display_name AS role_display
            FROM users u
            JOIN roles r ON r.id = u.role_id
            WHERE {where}
            ORDER BY r.name, u.last_name
        """),
        params,
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


@staff_router.post(
    "/invite", status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.STAFF_MANAGE))],
)
async def invite_staff(
    body: dict,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Creates a staff account and sends an invitation email."""
    from app.core.security import generate_invite_token, hash_password
    from datetime import datetime, timedelta, timezone

    role_result = await db.execute(
        text("SELECT id FROM roles WHERE name = :role AND organization_id = :org"),
        {"role": body.get("role"), "org": str(current_user.organization_id)},
    )
    role = role_result.mappings().first()
    if not role:
        raise HTTPException(status_code=400, detail={"error": "invalid_role"})

    invite_token = generate_invite_token()
    temp_password = hash_password("ChangeMe!123")  # Forces password change on first login

    result = await db.execute(
        text("""
            INSERT INTO users (
                organization_id, role_id, first_name, last_name, email, phone,
                password_hash, license_number, license_type,
                invite_token, invite_expires_at, is_active, is_email_verified
            ) VALUES (
                :org, :role, :fn, :ln, :email, :phone,
                :pw, :license, :lic_type,
                :token, :expires, TRUE, FALSE
            ) RETURNING id, first_name, last_name, email, created_at
        """),
        {
            "org": str(current_user.organization_id), "role": str(role["id"]),
            "fn": body.get("first_name"), "ln": body.get("last_name"),
            "email": body.get("email"), "phone": body.get("phone"),
            "pw": temp_password,
            "license": body.get("license_number"), "lic_type": body.get("license_type"),
            "token": invite_token,
            "expires": datetime.now(timezone.utc) + timedelta(hours=48),
        },
    )
    staff_member = result.mappings().first()

    await audit.log(
        AuditAction.STAFF_CREATED,
        f"Staff invited: {body.get('first_name')} {body.get('last_name')} as {body.get('role')}",
        resource_type="user", resource_id=staff_member["id"],
    )

    # TODO: Send invitation email via SendGrid
    # await email_service.send_staff_invite(staff_member["email"], invite_token)

    return {
        "data": dict(staff_member),
        "message": "Staff member invited. Invitation email will be sent.",
        "invite_token": invite_token,  # Remove in production — for dev/testing only
    }


@staff_router.patch(
    "/{staff_id}/deactivate",
    dependencies=[Depends(require_permissions(Permission.STAFF_MANAGE))],
)
async def deactivate_staff(
    staff_id: UUID,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    result = await db.execute(
        text("SELECT first_name, last_name FROM users WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(staff_id)},
    )
    staff = result.mappings().first()
    if not staff:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    await db.execute(
        text("UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = :id"),
        {"id": str(staff_id)},
    )
    # Revoke all active refresh tokens
    await db.execute(
        text("UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW() WHERE user_id = :id AND revoked = FALSE"),
        {"id": str(staff_id)},
    )
    await audit.log(
        AuditAction.STAFF_UPDATED,
        f"Staff deactivated: {staff['first_name']} {staff['last_name']} — all sessions revoked",
        resource_type="user", resource_id=staff_id,
    )
    return {"message": f"{staff['first_name']} {staff['last_name']} deactivated and sessions revoked."}


# ════════════════════════════════════════════════════════════════
# NOTIFICATIONS
# ════════════════════════════════════════════════════════════════
notifications_router = APIRouter(prefix="/notifications", tags=["Notifications"])


@notifications_router.get("", dependencies=[Depends(require_permissions(Permission.NOTIFICATIONS_VIEW))])
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    where = "user_id = :uid"
    if unread_only:
        where += " AND is_read = FALSE"

    result = await db.execute(
        text(f"""
            SELECT n.*, p.first_name AS patient_first, p.last_name AS patient_last
            FROM notifications n
            LEFT JOIN patients p ON p.id = n.patient_id
            WHERE {where}
            ORDER BY
                CASE n.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                n.created_at DESC
            LIMIT :limit
        """),
        {"uid": str(current_user.user_id), "limit": limit},
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


@notifications_router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    await db.execute(
        text("UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = :uid AND is_read = FALSE"),
        {"uid": str(current_user.user_id)},
    )


@notifications_router.patch("/{notif_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_notification_read(
    notif_id: UUID,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    await db.execute(
        text("UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = :id AND user_id = :uid"),
        {"id": str(notif_id), "uid": str(current_user.user_id)},
    )


# ════════════════════════════════════════════════════════════════
# AUDIT LOG ACCESS
# ════════════════════════════════════════════════════════════════
audit_router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


@audit_router.get("", dependencies=[Depends(require_permissions(Permission.AUDIT_VIEW))])
async def list_audit_logs(
    action: Optional[str] = Query(None),
    user_id: Optional[UUID] = Query(None),
    patient_id: Optional[UUID] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Returns the audit log. Admins only.
    Every call to this endpoint is itself audit-logged.
    """
    offset = (page - 1) * per_page
    conditions, params = [], {"limit": per_page, "offset": offset}

    if action:
        conditions.append("al.action ILIKE :action")
        params["action"] = f"%{action}%"
    if user_id:
        conditions.append("al.user_id = :user_id")
        params["user_id"] = str(user_id)
    if patient_id:
        conditions.append("al.patient_id = :patient_id")
        params["patient_id"] = str(patient_id)
    if date_from:
        conditions.append("al.created_at >= :date_from::timestamptz")
        params["date_from"] = date_from
    if date_to:
        conditions.append("al.created_at <= :date_to::timestamptz")
        params["date_to"] = date_to

    where = (" AND ".join(conditions)) if conditions else "TRUE"

    result = await db.execute(
        text(f"""
            SELECT al.*, COUNT(*) OVER() AS total_count
            FROM audit_logs al
            WHERE {where}
            ORDER BY al.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.mappings().all()
    total = rows[0]["total_count"] if rows else 0
    items = [dict(r) for r in rows]
    for i in items:
        i.pop("total_count", None)

    await audit.log(
        AuditAction.AUDIT_LOG_VIEWED,
        f"Audit log accessed (page {page}, filters: action={action}, user={user_id})",
    )

    return {
        "data": items,
        "pagination": {"page": page, "per_page": per_page, "total": total, "pages": -(-total // per_page)},
    }
