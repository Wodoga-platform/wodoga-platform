"""
Wodoga Platform — Patient Portal API
Separate, restricted endpoints for patient portal access.
Patients can only see their own data — enforced at every level.

GET  /api/v1/portal/me                  Own profile
GET  /api/v1/portal/me/visits           Upcoming and past visits
GET  /api/v1/portal/me/medications      Active medications
GET  /api/v1/portal/me/vitals           Vitals history
GET  /api/v1/portal/me/care-plan        Active care plan
GET  /api/v1/portal/me/messages         Secure messages with care team
POST /api/v1/portal/me/messages         Send a message to the care team
GET  /api/v1/portal/me/documents        Documents shared with patient
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLogger
from app.core.permissions import TokenPayload
from app.dependencies import get_audit_logger, get_current_user_payload, get_db_for_tenant

router = APIRouter(prefix="/portal", tags=["Patient Portal"])


async def get_portal_patient_id(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
) -> UUID:
    """
    Resolves the patient ID for the logged-in portal user.
    Enforces that only patient-role users can access portal endpoints.
    """
    if current_user.role != "patient":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "portal_only", "message": "This endpoint is for patients only."},
        )
    result = await db.execute(
        text("SELECT id FROM patients WHERE portal_user_id = :uid AND deleted_at IS NULL"),
        {"uid": str(current_user.user_id)},
    )
    patient = result.mappings().first()
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": "No patient record found for this account."},
        )
    return patient["id"]


# ── My Profile ─────────────────────────────────────────────────
@router.get("/me")
async def portal_my_profile(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Returns the patient's own profile — limited fields only."""
    patient_id = await get_portal_patient_id(current_user, db)

    result = await db.execute(
        text("""
            SELECT
                p.id, p.first_name, p.last_name, p.date_of_birth,
                p.phone, p.email, p.address_line1, p.city, p.state, p.zip,
                p.primary_diagnosis, p.allergies, p.blood_type,
                p.emergency_contact, p.insurance_primary, p.status,
                CONCAT(cg.first_name, ' ', cg.last_name) AS caregiver_name,
                cg.phone AS caregiver_phone,
                CONCAT(pv.first_name, ' ', pv.last_name) AS provider_name
            FROM patients p
            LEFT JOIN users cg ON cg.id = p.assigned_caregiver
            LEFT JOIN users pv ON pv.id = p.assigned_provider
            WHERE p.id = :id
        """),
        {"id": str(patient_id)},
    )
    profile = result.mappings().first()

    await audit.log(
        "PORTAL_PROFILE_VIEWED",
        "Patient viewed their own portal profile",
        patient_id=patient_id,
        resource_type="patient",
        resource_id=patient_id,
    )
    return {"data": dict(profile)}


# ── My Visits ──────────────────────────────────────────────────
@router.get("/me/visits")
async def portal_my_visits(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Returns upcoming and recent past visits for the patient."""
    patient_id = await get_portal_patient_id(current_user, db)

    result = await db.execute(
        text("""
            SELECT
                v.id, v.visit_date, v.visit_time, v.visit_type,
                v.status, v.notes,
                CONCAT(cg.first_name, ' ', cg.last_name) AS caregiver_name
            FROM visits v
            LEFT JOIN users cg ON cg.id = v.caregiver_id
            WHERE v.patient_id = :pid
              AND v.visit_date >= CURRENT_DATE - INTERVAL '30 days'
            ORDER BY v.visit_date DESC, v.visit_time ASC
        """),
        {"pid": str(patient_id)},
    )
    visits = [dict(r) for r in result.mappings().all()]

    await audit.log(
        "PORTAL_VISITS_VIEWED",
        "Patient viewed their visits",
        patient_id=patient_id,
        resource_type="visit",
    )
    return {
        "data": {
            "upcoming": [v for v in visits if v["status"] in ("scheduled", "in_progress")],
            "past":     [v for v in visits if v["status"] in ("completed", "cancelled", "missed")],
        }
    }


# ── My Medications ─────────────────────────────────────────────
@router.get("/me/medications")
async def portal_my_medications(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Returns active medications — clinical details appropriate for patient view."""
    patient_id = await get_portal_patient_id(current_user, db)

    result = await db.execute(
        text("""
            SELECT
                drug_name, brand_name, dosage, route, frequency,
                start_date, refills_remaining, next_refill_date,
                prescriber_name, pharmacy_name, instructions
            FROM medications
            WHERE patient_id = :pid AND status = 'active'
            ORDER BY drug_name
        """),
        {"pid": str(patient_id)},
    )
    await audit.log(
        "PORTAL_MEDICATIONS_VIEWED",
        "Patient viewed their medications",
        patient_id=patient_id,
        resource_type="medication",
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


# ── My Vitals ──────────────────────────────────────────────────
@router.get("/me/vitals")
async def portal_my_vitals(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Returns the patient's recent vitals history."""
    patient_id = await get_portal_patient_id(current_user, db)

    result = await db.execute(
        text("""
            SELECT
                recorded_at,
                bp_systolic, bp_diastolic, heart_rate,
                oxygen_saturation, temperature, weight_lbs,
                blood_glucose, pain_scale, notes
            FROM vitals
            WHERE patient_id = :pid
            ORDER BY recorded_at DESC
            LIMIT 20
        """),
        {"pid": str(patient_id)},
    )
    await audit.log(
        "PORTAL_VITALS_VIEWED",
        "Patient viewed their vitals history",
        patient_id=patient_id,
        resource_type="vitals",
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


# ── My Care Plan ───────────────────────────────────────────────
@router.get("/me/care-plan")
async def portal_my_care_plan(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Returns the patient's active care plan in patient-friendly format."""
    patient_id = await get_portal_patient_id(current_user, db)

    result = await db.execute(
        text("""
            SELECT
                primary_diagnosis, ordering_physician,
                start_date, end_date, review_date,
                visit_frequency, duration,
                goals, expected_outcomes, status
            FROM care_plans
            WHERE patient_id = :pid AND status = 'active'
            ORDER BY start_date DESC
            LIMIT 1
        """),
        {"pid": str(patient_id)},
    )
    care_plan = result.mappings().first()

    await audit.log(
        "PORTAL_CARE_PLAN_VIEWED",
        "Patient viewed their care plan",
        patient_id=patient_id,
        resource_type="care_plan",
    )
    return {"data": dict(care_plan) if care_plan else None}


# ── My Messages ────────────────────────────────────────────────
@router.get("/me/messages")
async def portal_my_messages(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Returns secure messages between the patient and their care team."""
    patient_id = await get_portal_patient_id(current_user, db)

    result = await db.execute(
        text("""
            SELECT
                m.id, m.subject, m.body, m.created_at, m.is_read,
                CONCAT(s.first_name, ' ', s.last_name) AS sender_name,
                s.id = :uid AS is_from_me
            FROM messages m
            JOIN users s ON s.id = m.sender_id
            WHERE (m.sender_id = :uid OR m.recipient_id = :uid)
              AND m.patient_id = :pid
            ORDER BY m.created_at DESC
            LIMIT 50
        """),
        {"uid": str(current_user.user_id), "pid": str(patient_id)},
    )
    await audit.log("PORTAL_MESSAGES_VIEWED", "Patient viewed secure messages", patient_id=patient_id)
    return {"data": [dict(r) for r in result.mappings().all()]}


@router.post("/me/messages", status_code=status.HTTP_201_CREATED)
async def portal_send_message(
    body: dict,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Allows a patient to send a message to their assigned care team."""
    if current_user.role != "patient":
        raise HTTPException(status_code=403, detail={"error": "portal_only"})

    patient_id = await get_portal_patient_id(current_user, db)

    # Find the assigned provider/caregiver to send to
    result = await db.execute(
        text("""
            SELECT assigned_provider, assigned_caregiver, organization_id
            FROM patients WHERE id = :id
        """),
        {"id": str(patient_id)},
    )
    patient = result.mappings().first()

    recipient_id = body.get("recipient_id") or patient["assigned_provider"] or patient["assigned_caregiver"]
    if not recipient_id:
        raise HTTPException(
            status_code=400,
            detail={"error": "no_recipient", "message": "No care team member assigned to send to."},
        )

    msg_result = await db.execute(
        text("""
            INSERT INTO messages (
                organization_id, sender_id, recipient_id, patient_id,
                subject, body
            ) VALUES (:org, :sender, :recipient, :patient, :subject, :body)
            RETURNING id, created_at
        """),
        {
            "org": str(patient["organization_id"]),
            "sender": str(current_user.user_id),
            "recipient": str(recipient_id),
            "patient": str(patient_id),
            "subject": body.get("subject", "Message from patient"),
            "body": body.get("body", ""),
        },
    )
    msg = msg_result.mappings().first()

    await audit.log(
        "PORTAL_MESSAGE_SENT",
        f"Patient sent message to care team: \"{body.get('subject')}\"",
        patient_id=patient_id, resource_type="message", resource_id=msg["id"],
    )
    return {"data": dict(msg), "message": "Message sent to your care team."}


# ── My Documents ───────────────────────────────────────────────
@router.get("/me/documents")
async def portal_my_documents(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Returns documents that have been shared with the patient."""
    patient_id = await get_portal_patient_id(current_user, db)

    result = await db.execute(
        text("""
            SELECT
                id, document_type, file_name, description,
                created_at, tags
            FROM documents
            WHERE patient_id = :pid AND is_active = TRUE
            ORDER BY created_at DESC
        """),
        {"pid": str(patient_id)},
    )
    await audit.log(
        "PORTAL_DOCUMENTS_VIEWED",
        "Patient viewed their documents",
        patient_id=patient_id,
        resource_type="document",
    )
    return {"data": [dict(r) for r in result.mappings().all()]}
