"""
Wodoga Platform — Patients API
GET    /api/v1/patients              List all patients (paginated, filterable)
POST   /api/v1/patients              Create a new patient record
GET    /api/v1/patients/{id}         Get a single patient's full record
PATCH  /api/v1/patients/{id}         Update patient information
DELETE /api/v1/patients/{id}         Soft-delete a patient record
GET    /api/v1/patients/{id}/summary Full patient summary (all linked records)
"""

from typing import Optional
from datetime import datetime, date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditAction, AuditLogger
from app.core.permissions import Permission, TokenPayload, require_permissions
from app.dependencies import (
    get_audit_logger,
    get_client_ip,
    get_current_user_payload,
    get_db_for_tenant,
)

router = APIRouter(prefix="/patients", tags=["Patients"])


# ── Schemas ────────────────────────────────────────────────────
class PatientCreate(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: str
    gender: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    blood_type: Optional[str] = None
    primary_diagnosis: Optional[str] = None
    secondary_diagnoses: Optional[list[str]] = []
    allergies: Optional[list[str]] = []
    medical_history: Optional[str] = None
    emergency_contact: Optional[dict] = None
    insurance_primary: Optional[dict] = None
    insurance_secondary: Optional[dict] = None
    assigned_caregiver: Optional[UUID] = None
    assigned_provider: Optional[UUID] = None
    fall_risk: Optional[str] = None
    notes: Optional[str] = None


class PatientUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    blood_type: Optional[str] = None
    primary_diagnosis: Optional[str] = None
    secondary_diagnoses: Optional[list[str]] = None
    allergies: Optional[list[str]] = None
    medical_history: Optional[str] = None
    emergency_contact: Optional[dict] = None
    insurance_primary: Optional[dict] = None
    insurance_secondary: Optional[dict] = None
    assigned_caregiver: Optional[UUID] = None
    assigned_provider: Optional[UUID] = None
    fall_risk: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


# ── List Patients ─────────────────────────────────────────────
@router.get(
    "",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))],
)
async def list_patients(
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    search: Optional[str] = Query(None, description="Search by name, diagnosis, or MRN"),
    status: Optional[str] = Query(None),
    caregiver_id: Optional[UUID] = Query(None),
    provider_id: Optional[UUID] = Query(None),
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Returns a paginated list of patients for the current organization.
    RLS ensures only this organization's patients are ever returned.
    Supports search, status filter, and caregiver/provider filter.
    """
    offset = (page - 1) * per_page

    # Build the WHERE clause dynamically
    conditions = ["p.deleted_at IS NULL"]
    params: dict = {"limit": per_page, "offset": offset}

    if search:
        conditions.append(
            "(p.first_name ILIKE :search OR p.last_name ILIKE :search "
            "OR p.primary_diagnosis ILIKE :search OR p.mrn ILIKE :search "
            "OR CONCAT(p.first_name, ' ', p.last_name) ILIKE :search)"
        )
        params["search"] = f"%{search}%"

    if status:
        conditions.append("p.status = :status")
        params["status"] = status

    if caregiver_id:
        conditions.append("p.assigned_caregiver = :caregiver_id")
        params["caregiver_id"] = str(caregiver_id)

    if provider_id:
        conditions.append("p.assigned_provider = :provider_id")
        params["provider_id"] = str(provider_id)

    # Caregivers can only see their assigned patients
    if current_user.role == "caregiver":
        conditions.append("p.assigned_caregiver = :current_user_id")
        params["current_user_id"] = str(current_user.user_id)

    where = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT
                p.id, p.mrn, p.first_name, p.last_name,
                p.date_of_birth, p.gender, p.phone, p.email,
                p.primary_diagnosis, p.status, p.fall_risk,
                p.insurance_primary,
                p.assigned_caregiver, p.assigned_provider,
                p.created_at, p.updated_at,
                CONCAT(cg.first_name, ' ', cg.last_name) AS caregiver_name,
                CONCAT(pv.first_name, ' ', pv.last_name) AS provider_name,
                COUNT(*) OVER() AS total_count
            FROM patients p
            LEFT JOIN users cg ON cg.id = p.assigned_caregiver
            LEFT JOIN users pv ON pv.id = p.assigned_provider
            WHERE {where}
            ORDER BY p.last_name ASC, p.first_name ASC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.mappings().all()

    total = rows[0]["total_count"] if rows else 0
    patients = [dict(row) for row in rows]

    # Strip total_count from individual patient records
    for p in patients:
        p.pop("total_count", None)

    await audit.log(
        AuditAction.PATIENT_VIEWED,
        f"Listed patients (page {page}, search: {search or 'none'})",
    )

    return {
        "data": patients,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": -(-total // per_page),  # Ceiling division
        },
    }


# ── Get Single Patient ────────────────────────────────────────
@router.get(
    "/{patient_id}",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))],
)
async def get_patient(
    patient_id: UUID,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Returns the full record for a single patient.
    RLS ensures only patients in the current organization are accessible.
    Every access to a patient record is logged — HIPAA requirement.
    """
    result = await db.execute(
        text("""
            SELECT
                p.*,
                CONCAT(cg.first_name, ' ', cg.last_name) AS caregiver_name,
                CONCAT(pv.first_name, ' ', pv.last_name) AS provider_name
            FROM patients p
            LEFT JOIN users cg ON cg.id = p.assigned_caregiver
            LEFT JOIN users pv ON pv.id = p.assigned_provider
            WHERE p.id = :id AND p.deleted_at IS NULL
        """),
        {"id": str(patient_id)},
    )
    patient = result.mappings().first()

    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": "Patient not found."},
        )

    # Caregivers can only access their assigned patients
    if (
        current_user.role == "caregiver"
        and str(patient["assigned_caregiver"]) != str(current_user.user_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "permission_denied", "message": "You are not assigned to this patient."},
        )

    await audit.log(
        AuditAction.PATIENT_VIEWED,
        f"Viewed patient record: {patient['first_name']} {patient['last_name']}",
        patient_id=patient_id,
        resource_type="patient",
        resource_id=patient_id,
    )

    return {"data": dict(patient)}


# ── Create Patient ────────────────────────────────────────────
@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.PATIENTS_CREATE))],
)
async def create_patient(
    body: PatientCreate,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Creates a new patient record for the current organization."""
    import json

    result = await db.execute(
        text("""
            INSERT INTO patients (
                organization_id, first_name, last_name, date_of_birth,
                gender, phone, email, address_line1, address_line2,
                city, state, zip, blood_type, primary_diagnosis,
                secondary_diagnoses, allergies, medical_history,
                emergency_contact, insurance_primary, insurance_secondary,
                assigned_caregiver, assigned_provider, fall_risk, notes
            ) VALUES (
                :org_id, :first_name, :last_name, :dob,
                :gender, :phone, :email, :addr1, :addr2,
                :city, :state, :zip, :blood, :dx,
                :secondary_dx, :allergies, :history,
                :emergency, :insurance_primary, :insurance_secondary,
                :caregiver, :provider, :fall_risk, :notes
            )
            RETURNING id, first_name, last_name, created_at
        """),
        {
            "org_id":            str(current_user.organization_id),
            "first_name":        body.first_name,
            "last_name":         body.last_name,
            "dob": datetime.strptime(body.date_of_birth, '%Y-%m-%d').date() if isinstance(body.date_of_birth, str) else body.date_of_birth,
            "gender": body.gender.lower().replace('-', '_') if body.gender else None,
            "phone":             body.phone,
            "email":             body.email,
            "addr1":             body.address_line1,
            "addr2":             body.address_line2,
            "city":              body.city,
            "state":             body.state,
            "zip":               body.zip,
            "blood": body.blood_type or None,
            "dx":                body.primary_diagnosis,
            "secondary_dx":      body.secondary_diagnoses or [],
            "allergies":         body.allergies or [],
            "history":           body.medical_history,
            "emergency":         json.dumps(body.emergency_contact) if body.emergency_contact else None,
            "insurance_primary": json.dumps(body.insurance_primary) if body.insurance_primary else None,
            "insurance_secondary": json.dumps(body.insurance_secondary) if body.insurance_secondary else None,
            "caregiver":         str(body.assigned_caregiver) if body.assigned_caregiver else None,
            "provider":          str(body.assigned_provider) if body.assigned_provider else None,
            "fall_risk": body.fall_risk or None,
            "notes":             body.notes,
        },
    )
    new_patient = result.mappings().first()

    await audit.log(
        AuditAction.PATIENT_CREATED,
        f"Created patient record: {body.first_name} {body.last_name}",
        patient_id=new_patient["id"],
        resource_type="patient",
        resource_id=new_patient["id"],
        new_state=body.model_dump(),
    )

    return {"data": dict(new_patient), "message": "Patient record created successfully."}


# ── Update Patient ────────────────────────────────────────────
@router.patch(
    "/{patient_id}",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def update_patient(
    patient_id: UUID,
    body: PatientUpdate,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Updates one or more fields on a patient record.
    Only provided fields are updated — others remain unchanged.
    Both before and after states are captured in the audit log.
    """
    import json

    # Fetch current state for audit log
    result = await db.execute(
        text("SELECT * FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(patient_id)},
    )
    existing = result.mappings().first()
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Patient not found."})

    # Build dynamic UPDATE
    updates = body.model_dump(exclude_none=True)
    if not updates:
        return {"data": dict(existing), "message": "No changes provided."}

    set_clauses = []
    params = {"id": str(patient_id)}

    field_map = {
        "first_name": "first_name", "last_name": "last_name",
        "date_of_birth": "date_of_birth", "gender": "gender",
        "phone": "phone", "email": "email",
        "address_line1": "address_line1", "address_line2": "address_line2",
        "city": "city", "state": "state", "zip": "zip",
        "blood_type": "blood_type", "primary_diagnosis": "primary_diagnosis",
        "secondary_diagnoses": "secondary_diagnoses", "allergies": "allergies",
        "medical_history": "medical_history", "fall_risk": "fall_risk",
        "status": "status", "notes": "notes",
        "assigned_caregiver": "assigned_caregiver",
        "assigned_provider": "assigned_provider",
    }

    json_fields = {"emergency_contact", "insurance_primary", "insurance_secondary"}

    for field, value in updates.items():
        if field in field_map:
            set_clauses.append(f"{field_map[field]} = :{field}")
            if field in json_fields and isinstance(value, dict):
                params[field] = json.dumps(value)
            elif isinstance(value, UUID):
                params[field] = str(value)
            else:
                params[field] = value

    if not set_clauses:
        return {"data": dict(existing), "message": "No valid fields to update."}

    await db.execute(
        text(f"UPDATE patients SET {', '.join(set_clauses)}, updated_at = NOW() WHERE id = :id"),
        params,
    )

    await audit.log(
        AuditAction.PATIENT_UPDATED,
        f"Updated patient: {existing['first_name']} {existing['last_name']}",
        patient_id=patient_id,
        resource_type="patient",
        resource_id=patient_id,
        previous_state=dict(existing),
        new_state=updates,
    )

    return {"message": "Patient record updated successfully."}


# ── Delete Patient (Soft) ─────────────────────────────────────
@router.delete(
    "/{patient_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permissions(Permission.PATIENTS_DELETE))],
)
async def delete_patient(
    patient_id: UUID,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Soft-deletes a patient record by setting deleted_at.
    The record is preserved in the database for HIPAA compliance.
    Hard deletion is never performed.
    """
    result = await db.execute(
        text("SELECT first_name, last_name FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(patient_id)},
    )
    patient = result.mappings().first()
    if not patient:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Patient not found."})

    await db.execute(
        text("UPDATE patients SET deleted_at = NOW() WHERE id = :id"),
        {"id": str(patient_id)},
    )

    await audit.log(
        AuditAction.PATIENT_DELETED,
        f"Soft-deleted patient: {patient['first_name']} {patient['last_name']}",
        patient_id=patient_id,
        resource_type="patient",
        resource_id=patient_id,
    )


# ── Patient Summary (All Linked Records) ──────────────────────
@router.get(
    "/{patient_id}/summary",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))],
)
async def get_patient_summary(
    patient_id: UUID,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Returns a complete summary of a patient including their most recent
    vitals, active medications, upcoming visits, active care plan,
    and latest billing status. Used for the patient detail panel.
    """
    patient_result = await db.execute(
        text("SELECT * FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(patient_id)},
    )
    patient = patient_result.mappings().first()
    if not patient:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    # Latest vitals
    vitals_result = await db.execute(
        text("SELECT * FROM vitals WHERE patient_id = :id ORDER BY recorded_at DESC LIMIT 5"),
        {"id": str(patient_id)},
    )
    vitals = [dict(r) for r in vitals_result.mappings().all()]

    # Active medications
    meds_result = await db.execute(
        text("SELECT * FROM medications WHERE patient_id = :id AND status = 'active' ORDER BY drug_name"),
        {"id": str(patient_id)},
    )
    medications = [dict(r) for r in meds_result.mappings().all()]

    # Upcoming visits
    visits_result = await db.execute(
        text("""
            SELECT v.*, CONCAT(u.first_name, ' ', u.last_name) as caregiver_name
            FROM visits v
            LEFT JOIN users u ON u.id = v.caregiver_id
            WHERE v.patient_id = :id AND v.status IN ('scheduled', 'in_progress')
            ORDER BY v.visit_date ASC, v.visit_time ASC
            LIMIT 5
        """),
        {"id": str(patient_id)},
    )
    visits = [dict(r) for r in visits_result.mappings().all()]

    # Active care plan
    care_plan_result = await db.execute(
        text("SELECT * FROM care_plans WHERE patient_id = :id AND status = 'active' LIMIT 1"),
        {"id": str(patient_id)},
    )
    care_plan = care_plan_result.mappings().first()

    # Billing summary
    billing_result = await db.execute(
        text("""
            SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
                COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
                COUNT(*) FILTER (WHERE status = 'denied') as denied_count,
                COALESCE(SUM(amount_billed), 0) as total_billed,
                COALESCE(SUM(amount_paid), 0) as total_paid
            FROM billing_claims
            WHERE patient_id = :id
        """),
        {"id": str(patient_id)},
    )
    billing_summary = billing_result.mappings().first()

    await audit.log(
        AuditAction.PATIENT_VIEWED,
        f"Viewed patient summary: {patient['first_name']} {patient['last_name']}",
        patient_id=patient_id,
        resource_type="patient",
        resource_id=patient_id,
    )

    return {
        "data": {
            "patient":       dict(patient),
            "vitals":        vitals,
            "medications":   medications,
            "visits":        visits,
            "care_plan":     dict(care_plan) if care_plan else None,
            "billing":       dict(billing_summary),
        }
    }
