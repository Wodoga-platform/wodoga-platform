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
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, date

from app.core.audit import AuditAction, AuditLogger
from app.core.permissions import Permission, TokenPayload, require_permissions, require_any_permission
from app.core.phi_crypto import (
    dec_scalar,
    enc_float,
    encrypt_patient_fields,
    decrypt_patient_row,
    decrypt_patient_rows,
)
from app.dependencies import (
    get_audit_logger,
    get_client_ip,
    get_current_user_payload,
    get_db_for_tenant,
)

router = APIRouter(prefix="/patients", tags=["Patients"])


# ── Schemas ────────────────────────────────────────────────────

# Normalizers applied at the API boundary so that near-miss values from any
# client (a form sending "Non-binary", a script sending "MALE") are coerced to
# the exact tokens the database CHECK constraints require. This mirrors the
# normalization the CSV importer already does, closing the gap where the
# single-record create/update path had none — the same "normalize at every
# entry point" lesson that bit us on enum casing before.

_VALID_GENDERS = {"male", "female", "non_binary", "other", "prefer_not_to_say"}
_VALID_BLOOD = {"a+", "a-", "b+", "b-", "ab+", "ab-", "o+", "o-", "unknown"}


def _normalize_gender_value(v):
    """Coerce a gender string to the DB's allowed token, or leave it for the
    DB to reject if it's genuinely not a recognized value."""
    if v is None:
        return None
    s = str(v).strip().lower().replace("-", "_").replace(" ", "_")
    if not s:
        return None
    return s if s in _VALID_GENDERS else s  # pass through; DB constraint is final arbiter


def _normalize_blood_value(v):
    """Coerce a blood type to the DB's notation: uppercase letters (A+, O-,
    AB+), with the sole exception of 'unknown', which the constraint stores
    lowercase. Checked against the real schema.sql CHECK constraint."""
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    if s.lower() == "unknown":
        return "unknown"
    return s.upper()


class PatientCreate(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: date
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
    assigned_pharmacy_staff: Optional[UUID] = None
    fall_risk: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("gender", mode="before")
    @classmethod
    def _normalize_gender(cls, v):
        return _normalize_gender_value(v)

    @field_validator("blood_type", mode="before")
    @classmethod
    def _normalize_blood(cls, v):
        return _normalize_blood_value(v)


class PatientUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[date] = None
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
    assigned_pharmacy_staff: Optional[UUID] = None
    fall_risk: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("gender", mode="before")
    @classmethod
    def _normalize_gender(cls, v):
        return _normalize_gender_value(v)

    @field_validator("blood_type", mode="before")
    @classmethod
    def _normalize_blood(cls, v):
        return _normalize_blood_value(v)


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

    # Decrypt PHI (this SELECT pulls phone, email, insurance_primary).
    # NOTE: `search` above still only matches first_name / last_name /
    # primary_diagnosis / mrn — the columns we deliberately left in
    # plaintext. Searching by phone or email is not possible and never was;
    # encrypted columns cannot be matched with ILIKE.
    patients = decrypt_patient_rows(rows)

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
                CONCAT(pv.first_name, ' ', pv.last_name) AS provider_name,
                CONCAT(ph.first_name, ' ', ph.last_name) AS pharmacy_staff_name
            FROM patients p
            LEFT JOIN users cg ON cg.id = p.assigned_caregiver
            LEFT JOIN users pv ON pv.id = p.assigned_provider
            LEFT JOIN users ph ON ph.id = p.assigned_pharmacy_staff
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

    # Decrypt PHI first, THEN apply the biller strip below. Order matters:
    # the strip removes keys, and decrypt_patient_row only touches keys that
    # are present — so decrypting after the strip would still be correct, but
    # decrypting first keeps a single, predictable shape for the row and
    # means any future consumer of patient_data gets real values.
    patient_data = decrypt_patient_row(patient)

    # ── Role-based field filtering (HIPAA minimum-necessary) ─────────
    # Billers need patient identifiers, demographics, insurance, and
    # billing-relevant clinical codes (diagnoses for ICD billing). They do
    # NOT need free-text clinical fields like allergies, medical history,
    # or notes. This is the Critical #1 finding from PERMISSION_AUDIT_V2.md
    # — closing the HIPAA minimum-necessary gap for the biller role.
    if current_user.role == "biller":
        clinical_fields_to_strip = (
            "allergies", "medical_history",
            "secondary_diagnoses", "notes", "photo_url",
            "fall_risk", "blood_type",
        )
        for field in clinical_fields_to_strip:
            patient_data.pop(field, None)

    return {"data": patient_data}


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
    # ── PHI encryption ───────────────────────────────────────────────
    # Every parameter below is bound under its REAL COLUMN NAME, not an
    # abbreviation. That is deliberate: encrypt_patient_fields() keys off
    # column names, so if the SQL and the param dict ever drift apart, the
    # encryption would silently skip a field and write plaintext PHI. Using
    # the column name as the single identifier in both places makes that
    # class of bug impossible.
    params = {
        "organization_id":     str(current_user.organization_id),
        "first_name":          body.first_name,
        "last_name":           body.last_name,
        "date_of_birth":       body.date_of_birth,
        "gender":              body.gender,
        "city":                body.city,
        "state":               body.state,
        "zip":                 body.zip,
        "blood_type":          body.blood_type,
        "primary_diagnosis":   body.primary_diagnosis,
        "fall_risk":           body.fall_risk,
        "assigned_caregiver":  str(body.assigned_caregiver) if body.assigned_caregiver else None,
        "assigned_provider":   str(body.assigned_provider) if body.assigned_provider else None,
        # ── everything below this line gets encrypted ────────────────
        "phone":               body.phone,
        "email":               body.email,
        "address_line1":       body.address_line1,
        "address_line2":       body.address_line2,
        "medical_history":     body.medical_history,
        "notes":               body.notes,
        "secondary_diagnoses": body.secondary_diagnoses or [],
        "allergies":           body.allergies or [],
        "emergency_contact":   body.emergency_contact,
        "insurance_primary":   body.insurance_primary,
        "insurance_secondary": body.insurance_secondary,
    }
    params = encrypt_patient_fields(params)

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
                :organization_id, :first_name, :last_name, :date_of_birth,
                :gender, :phone, :email, :address_line1, :address_line2,
                :city, :state, :zip, :blood_type, :primary_diagnosis,
                :secondary_diagnoses, :allergies, :medical_history,
                :emergency_contact, :insurance_primary, :insurance_secondary,
                :assigned_caregiver, :assigned_provider, :fall_risk, :notes
            )
            RETURNING id, first_name, last_name, created_at
        """),
        params,
    )
    new_patient = result.mappings().first()

    # Geocode the address once and cache coordinates (best-effort).
    # We geocode from `body` — the PLAINTEXT request payload — not from the
    # params dict, which is now ciphertext.
    from app.core.geocoding import build_address_string, geocode_address
    addr = build_address_string(body.address_line1, body.city, body.state, body.zip)
    coords = await geocode_address(addr)
    if coords:
        await db.execute(
            text("UPDATE patients SET latitude = :lat, longitude = :lon WHERE id = :id"),
            # Coordinates are PHI — they pin the patient's home. Encrypt.
            {"lat": enc_float(coords[0]), "lon": enc_float(coords[1]),
             "id": str(new_patient["id"])},
        )

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
    # Fetch current state for the audit log AND for the geocode fallback
    # below. This is a SELECT *, so every PHI column comes back as
    # ciphertext — decrypt it once, here, and use the decrypted dict
    # everywhere downstream.
    result = await db.execute(
        text("SELECT * FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(patient_id)},
    )
    existing_row = result.mappings().first()
    if not existing_row:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Patient not found."})
    existing = decrypt_patient_row(existing_row)

    # Build dynamic UPDATE
    updates = body.model_dump(exclude_none=True)
    if not updates:
        return {"data": existing, "message": "No changes provided."}

    set_clauses = []
    params = {"id": str(patient_id)}

    # ALLOWLIST — every updatable column. Values are checked against this
    # before being interpolated into the SET clause, which is what keeps the
    # dynamic SQL safe.
    #
    # NOTE — BUG FIX: emergency_contact, insurance_primary and
    # insurance_secondary were previously MISSING from this map. Because the
    # loop below only acts on fields found in the map, a PATCH containing any
    # of those three silently did nothing — the request returned 200 and the
    # data was never written. The `json_fields` set that used to sit below
    # this map was therefore dead code. They are added here.
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
        "emergency_contact": "emergency_contact",
        "insurance_primary": "insurance_primary",
        "insurance_secondary": "insurance_secondary",
        "assigned_caregiver": "assigned_caregiver",
        "assigned_provider": "assigned_provider",
        "assigned_pharmacy_staff": "assigned_pharmacy_staff",
    }

    for field, value in updates.items():
        if field in field_map:
            set_clauses.append(f"{field_map[field]} = :{field}")
            params[field] = str(value) if isinstance(value, UUID) else value

    if not set_clauses:
        return {"data": existing, "message": "No valid fields to update."}

    # Encrypt whichever PHI columns this PATCH actually touched. Fields not
    # present in `params` are left alone, so partial updates stay partial.
    # No json.dumps() is needed — enc_json() serialises dicts itself.
    params = encrypt_patient_fields(params)

    await db.execute(
        text(f"UPDATE patients SET {', '.join(set_clauses)}, updated_at = NOW() WHERE id = :id"),
        params,
    )

    # If any address field changed, re-geocode and refresh cached coordinates
    address_fields = {"address_line1", "city", "state", "zip"}
    if address_fields & set(updates.keys()):
        from app.core.geocoding import build_address_string, geocode_address
        # `updates` is the plaintext request body and `existing` is the
        # DECRYPTED row, so the address string built here is real text. If
        # `existing` were used raw, a PATCH that changed only `city` would
        # feed the geocoder a base64 blob for address_line1.
        addr = build_address_string(
            updates.get("address_line1", existing["address_line1"]),
            updates.get("city", existing["city"]),
            updates.get("state", existing["state"]),
            updates.get("zip", existing["zip"]),
        )
        coords = await geocode_address(addr)
        if coords:
            await db.execute(
                text("UPDATE patients SET latitude = :lat, longitude = :lon WHERE id = :id"),
                {"lat": enc_float(coords[0]), "lon": enc_float(coords[1]),
                 "id": str(patient_id)},
            )

    await audit.log(
        AuditAction.PATIENT_UPDATED,
        f"Updated patient: {existing['first_name']} {existing['last_name']}",
        patient_id=patient_id,
        resource_type="patient",
        resource_id=patient_id,
        # `existing` is already a plain dict (decrypted above). These PHI
        # snapshots are encrypted at rest by AuditLogger.log() before insert
        # (see app/core/audit.py) and decrypted by the audit viewer on read,
        # so passing decrypted values here is correct — the encryption happens
        # at the single audit write choke point, not at each call site.
        previous_state=existing,
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
        text("UPDATE patients SET deleted_at = NOW(), deleted_by = :uid WHERE id = :id"),
        {"id": str(patient_id), "uid": str(current_user.user_id)},
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
    dependencies=[
        Depends(require_permissions(Permission.PATIENTS_VIEW)),
        # Summary aggregates vitals, meds, visits, care plan — clinical PHI
        Depends(require_any_permission(
            Permission.VISITS_VIEW,
            Permission.VITALS_VIEW,
            Permission.MEDS_VIEW,
        )),
    ],
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
    patient = decrypt_patient_row(patient_result.mappings().first())
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
            "patient":       patient,
            "vitals":        vitals,
            "medications":   medications,
            "visits":        visits,
            "care_plan":     dict(care_plan) if care_plan else None,
            "billing":       dict(billing_summary),
        }
    }


@router.get(
    "/{patient_id}/chart",
    dependencies=[
        Depends(require_permissions(Permission.PATIENTS_VIEW)),
        # PERMISSION_AUDIT_V2 Critical #1: chart contains visits, vitals,
        # medications — clinical PHI. Requires at least one clinical
        # view permission, so billers (patients:view only) cannot reach
        # it even though they have patients:view.
        Depends(require_any_permission(
            Permission.VISITS_VIEW,
            Permission.VITALS_VIEW,
            Permission.MEDS_VIEW,
        )),
    ],
)
async def get_patient_chart(
    patient_id: UUID,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Returns the COMPLETE patient chart — full history of every linked record:
    all visits with SOAP notes, all vitals, all medications, all OASIS
    assessments, all claims, all care plans, and all pharmacy orders.
    This is the comprehensive patient file.
    """
    patient_result = await db.execute(
        text("SELECT * FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(patient_id)},
    )
    patient = decrypt_patient_row(patient_result.mappings().first())
    if not patient:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    # Full visit history (with SOAP notes), most recent first
    visits_result = await db.execute(
        text("""
            SELECT v.*, CONCAT(u.first_name, ' ', u.last_name) AS caregiver_name
            FROM visits v
            LEFT JOIN users u ON u.id = v.caregiver_id
            WHERE v.patient_id = :id
            ORDER BY v.visit_date DESC, v.visit_time DESC
        """),
        {"id": str(patient_id)},
    )
    visits = [dict(r) for r in visits_result.mappings().all()]

    # Full vitals history
    vitals_result = await db.execute(
        text("SELECT * FROM vitals WHERE patient_id = :id ORDER BY recorded_at DESC"),
        {"id": str(patient_id)},
    )
    vitals = [dict(r) for r in vitals_result.mappings().all()]

    # All medications (active and discontinued)
    meds_result = await db.execute(
        text("SELECT * FROM medications WHERE patient_id = :id ORDER BY status, drug_name"),
        {"id": str(patient_id)},
    )
    medications = [dict(r) for r in meds_result.mappings().all()]

    # All pharmacy orders (delivery status)
    pharm_result = await db.execute(
        text("SELECT * FROM pharmaceutical_orders WHERE patient_id = :id ORDER BY created_at DESC"),
        {"id": str(patient_id)},
    )
    pharm_orders = [dict(r) for r in pharm_result.mappings().all()]

    # All OASIS assessments
    oasis_result = await db.execute(
        text("""
            SELECT oa.*, CONCAT(u.first_name, ' ', u.last_name) AS conducted_by_name
            FROM oasis_assessments oa
            LEFT JOIN users u ON u.id = oa.conducted_by
            WHERE oa.patient_id = :id
            ORDER BY oa.assessment_date DESC
        """),
        {"id": str(patient_id)},
    )
    oasis = [dict(r) for r in oasis_result.mappings().all()]

    # All care plans
    care_plans_result = await db.execute(
        text("SELECT * FROM care_plans WHERE patient_id = :id ORDER BY start_date DESC"),
        {"id": str(patient_id)},
    )
    care_plans = [dict(r) for r in care_plans_result.mappings().all()]

    # All claims
    claims_result = await db.execute(
        text("SELECT * FROM billing_claims WHERE patient_id = :id ORDER BY service_date DESC"),
        {"id": str(patient_id)},
    )
    claims = [dict(r) for r in claims_result.mappings().all()]

    await audit.log(
        AuditAction.PATIENT_VIEWED,
        f"Opened full chart: {patient['first_name']} {patient['last_name']}",
        patient_id=patient_id, resource_type="patient", resource_id=patient_id,
    )

    return {
        "data": {
            "patient":      patient,
            "visits":       visits,
            "vitals":       vitals,
            "medications":  medications,
            "pharm_orders": pharm_orders,
            "oasis":        oasis,
            "care_plans":   care_plans,
            "claims":       claims,
        }
    }


@router.get(
    "/{patient_id}/timeline",
    dependencies=[
        Depends(require_permissions(Permission.PATIENTS_VIEW)),
        # See chart endpoint for rationale — timeline aggregates clinical events
        Depends(require_any_permission(
            Permission.VISITS_VIEW,
            Permission.VITALS_VIEW,
            Permission.MEDS_VIEW,
        )),
    ],
)
async def get_patient_timeline(
    patient_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    """
    Returns a chronological history feed for a patient, built from the audit
    trail — every recorded action (discharge, claim filed, medication
    delivered, SOAP note, OASIS submitted, etc.) tied to this patient.
    """
    result = await db.execute(
        text("""
            SELECT action, description, user_name, user_role,
                   resource_type, created_at, success
            FROM audit_logs
            WHERE patient_id = :id
              AND action NOT IN ('PATIENT_VIEWED', 'VITALS_VIEWED',
                                 'MEDICATION_VIEWED', 'CARE_PLAN_VIEWED',
                                 'DOCUMENT_VIEWED', 'INTAKE_FORM_VIEWED')
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        {"id": str(patient_id), "limit": limit},
    )
    events = [dict(r) for r in result.mappings().all()]
    return {"data": events}


@router.get(
    "/map/locations",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))],
)
async def get_patient_map_locations(
    caregiver_id: Optional[UUID] = Query(None, description="Filter to one caregiver's patients"),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    """
    Returns active patients that have geocoded coordinates, for the map view.
    Optionally filtered to a single caregiver's assigned patients.
    """
    conditions = ["p.deleted_at IS NULL", "p.status = 'active'",
                  "p.latitude IS NOT NULL", "p.longitude IS NOT NULL"]
    params = {}
    if caregiver_id:
        conditions.append("p.assigned_caregiver = :cg")
        params["cg"] = str(caregiver_id)

    result = await db.execute(
        text(f"""
            SELECT p.id, p.first_name, p.last_name, p.latitude, p.longitude,
                   p.address_line1, p.city, p.state, p.zip,
                   p.primary_diagnosis, p.phone,
                   CONCAT(c.first_name, ' ', c.last_name) AS caregiver_name
            FROM patients p
            LEFT JOIN users c ON c.id = p.assigned_caregiver
            WHERE {' AND '.join(conditions)}
            ORDER BY p.last_name
        """),
        params,
    )
    # Decrypt: this SELECT pulls address_line1, phone, latitude and longitude.
    # dec_float() casts the coordinates back to real numbers, which is what
    # the Leaflet map on the frontend expects — it does `p.latitude != null`
    # and passes them straight into L.marker([lat, lng]).
    return {"data": decrypt_patient_rows(result.mappings().all())}


@router.post(
    "/map/backfill-geocode",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def backfill_geocode(
    db: AsyncSession = Depends(get_db_for_tenant),
):
    """
    One-time helper: geocode any active patients that have an address but no
    coordinates yet. Safe to run repeatedly; only fills in what's missing.
    """
    from app.core.geocoding import build_address_string, geocode_address, is_geocoding_configured
    if not is_geocoding_configured():
        raise HTTPException(
            status_code=503,
            detail={"error": "geocoding_not_configured",
                    "message": "Add AZURE_MAPS_KEY to enable geocoding."},
        )

    result = await db.execute(
        text("""
            SELECT id, address_line1, city, state, zip
            FROM patients
            WHERE deleted_at IS NULL AND status = 'active'
              AND (latitude IS NULL OR longitude IS NULL)
              AND address_line1 IS NOT NULL
            LIMIT 200
        """),
    )
    # The `address_line1 IS NOT NULL` and `latitude IS NULL` predicates in the
    # query above still work correctly against encrypted TEXT columns — NULL
    # is NULL regardless of encryption, which is exactly why this filter did
    # not need to change.
    rows = result.mappings().all()
    updated = 0
    for r in rows:
        row = decrypt_patient_row(r)   # address_line1 is ciphertext on disk
        addr = build_address_string(row["address_line1"], row["city"], row["state"], row["zip"])
        coords = await geocode_address(addr)
        if coords:
            await db.execute(
                text("UPDATE patients SET latitude = :lat, longitude = :lon WHERE id = :id"),
                {"lat": enc_float(coords[0]), "lon": enc_float(coords[1]),
                 "id": str(row["id"])},
            )
            updated += 1

    return {"data": {"checked": len(rows), "geocoded": updated},
            "message": f"Geocoded {updated} of {len(rows)} patients."}


@router.post(
    "/import-csv",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_CREATE))],
)
async def import_patients_csv(
    file: UploadFile = File(...),
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Bulk-create patients from an uploaded CSV. Expected headers (case-insensitive,
    flexible): first_name, last_name, date_of_birth, gender, phone, email,
    address_line1, city, state, zip, primary_diagnosis.
    Required per row: first_name, last_name, date_of_birth (YYYY-MM-DD).
    Geocoding is skipped here for speed — run the map backfill afterward.
    """
    import csv
    import io

    raw = await file.read()
    try:
        text_data = raw.decode("utf-8-sig")  # handle Excel BOM
    except UnicodeDecodeError:
        text_data = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text_data))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail={"error": "empty_csv",
                            "message": "The CSV appears to be empty or has no header row."})

    # Normalize header names → canonical keys
    def norm(s: str) -> str:
        return (s or "").strip().lower().replace(" ", "_")

    valid_genders = {"male", "female", "non_binary", "other", "prefer_not_to_say"}
    valid_blood = {"a+","a-","b+","b-","ab+","ab-","o+","o-","unknown"}

    created, errors = 0, []
    row_num = 1
    for row in reader:
        row_num += 1
        r = {norm(k): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
        first = r.get("first_name") or r.get("firstname") or r.get("first")
        last = r.get("last_name") or r.get("lastname") or r.get("last")
        dob = r.get("date_of_birth") or r.get("dob") or r.get("birthdate")

        if not (first and last and dob):
            errors.append(f"Row {row_num}: missing required first_name, last_name, or date_of_birth")
            continue

        # Validate date
        try:
            dob_val = datetime.strptime(dob, "%Y-%m-%d").date()
        except ValueError:
            errors.append(f"Row {row_num}: date_of_birth '{dob}' must be YYYY-MM-DD")
            continue

        gender = norm(r.get("gender") or "")
        gender = gender if gender in valid_genders else None
        blood = (r.get("blood_type") or "").strip().lower()
        blood = blood if blood in valid_blood else None

        # Bulk import is a WRITE PATH and must encrypt exactly like the
        # single-record create does. If it did not, every CSV-imported
        # patient would sit in the database with a plaintext phone, email and
        # street address while the rest of the table was encrypted — the
        # encryption would be quietly bypassed at the highest-volume entry
        # point in the product. Column-name-keyed params, same as create.
        row_params = encrypt_patient_fields({
            "organization_id":   str(current_user.organization_id),
            "first_name":        first,
            "last_name":         last,
            "date_of_birth":     dob_val,
            "gender":            gender,
            "city":              r.get("city") or None,
            "state":             r.get("state") or None,
            "zip":               r.get("zip") or r.get("zip_code") or r.get("postal_code") or None,
            "blood_type":        blood,
            "primary_diagnosis": r.get("primary_diagnosis") or r.get("diagnosis") or None,
            # ── encrypted ───────────────────────────────────────────
            "phone":             r.get("phone") or None,
            "email":             r.get("email") or None,
            "address_line1":     r.get("address_line1") or r.get("address") or None,
        })

        try:
            await db.execute(
                text("""
                    INSERT INTO patients (
                        organization_id, first_name, last_name, date_of_birth,
                        gender, phone, email, address_line1, city, state, zip,
                        blood_type, primary_diagnosis, status
                    ) VALUES (
                        :organization_id, :first_name, :last_name, :date_of_birth,
                        :gender, :phone, :email, :address_line1, :city, :state, :zip,
                        :blood_type, :primary_diagnosis, 'active'
                    )
                """),
                row_params,
            )
            created += 1
        except Exception as e:
            errors.append(f"Row {row_num}: {str(e)[:120]}")

    await audit.log(
        AuditAction.PATIENT_CREATED,
        f"Imported {created} patient(s) from CSV ({len(errors)} skipped)",
        resource_type="patient",
    )
    return {
        "data": {"created": created, "skipped": len(errors), "errors": errors[:25]},
        "message": f"Imported {created} patient(s). {len(errors)} row(s) skipped.",
    }
