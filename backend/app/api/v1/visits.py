"""
Wodoga Platform — Visits API
GET    /api/v1/visits                 List visits (paginated, filterable)
POST   /api/v1/visits                 Schedule a new visit
GET    /api/v1/visits/{id}            Get single visit detail
PATCH  /api/v1/visits/{id}            Update visit (status, notes)
POST   /api/v1/visits/{id}/checkin    GPS check-in
POST   /api/v1/visits/{id}/checkout   GPS check-out
POST   /api/v1/visits/{id}/soap       Create or update SOAP note
DELETE /api/v1/visits/{id}            Cancel a visit
"""

from typing import Optional
from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditAction, AuditLogger
from app.core.phi_crypto import dec_list, dec_scalar
from app.core.permissions import Permission, TokenPayload, require_permissions
from app.dependencies import (
    get_audit_logger,
    get_client_ip,
    get_current_user_payload,
    get_db_for_tenant,
)


def _to_date(val):
    """Convert 'YYYY-MM-DD' to a date object for asyncpg DATE columns; pass through None/date."""
    if isinstance(val, str) and val:
        return datetime.strptime(val, "%Y-%m-%d").date()
    return val or None


def _to_time(val):
    """Convert 'HH:MM' to a time object for asyncpg TIME columns; pass through None/time."""
    if isinstance(val, str) and val:
        return datetime.strptime(val, "%H:%M").time()
    return val or None

router = APIRouter(prefix="/visits", tags=["Visits"])


# ── Schemas ────────────────────────────────────────────────────
class VisitCreate(BaseModel):
    patient_id: UUID
    caregiver_id: Optional[UUID] = None
    care_plan_id: Optional[UUID] = None
    visit_date: str
    visit_time: Optional[str] = None
    visit_type: str
    notes: Optional[str] = None


class VisitUpdate(BaseModel):
    caregiver_id: Optional[UUID] = None
    visit_date: Optional[str] = None
    visit_time: Optional[str] = None
    visit_type: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    cancellation_reason: Optional[str] = None


class GPSCheckIn(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class SOAPNote(BaseModel):
    subjective: str
    objective: str
    assessment: str
    plan: str
    duration_minutes: Optional[int] = None
    visit_status: str = "completed"
    signature_url: Optional[str] = None


# ── List Visits ────────────────────────────────────────────────
@router.get(
    "",
    dependencies=[Depends(require_permissions(Permission.VISITS_VIEW))],
)
async def list_visits(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    patient_id: Optional[UUID] = Query(None),
    caregiver_id: Optional[UUID] = Query(None),
    status: Optional[str] = Query(None),
    visit_date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    offset = (page - 1) * per_page
    conditions = ["v.visit_date IS NOT NULL"]
    params: dict = {"limit": per_page, "offset": offset}

    if patient_id:
        conditions.append("v.patient_id = :patient_id")
        params["patient_id"] = str(patient_id)
    if caregiver_id:
        conditions.append("v.caregiver_id = :caregiver_id")
        params["caregiver_id"] = str(caregiver_id)
    if status:
        conditions.append("v.status = :status")
        params["status"] = status
    if visit_date:
        conditions.append("v.visit_date = :visit_date")
        params["visit_date"] = _to_date(visit_date)
    if date_from:
        conditions.append("v.visit_date >= :date_from")
        params["date_from"] = _to_date(date_from)
    if date_to:
        conditions.append("v.visit_date <= :date_to")
        params["date_to"] = _to_date(date_to)

    # Caregivers only see their own visits
    if current_user.role == "caregiver":
        conditions.append("v.caregiver_id = :current_caregiver")
        params["current_caregiver"] = str(current_user.user_id)

    where = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT
                v.*,
                p.first_name AS patient_first,
                p.last_name  AS patient_last,
                p.primary_diagnosis,
                CONCAT(cg.first_name, ' ', cg.last_name) AS caregiver_name,
                (v.soap_subjective IS NOT NULL) AS has_soap_note,
                COUNT(*) OVER() AS total_count
            FROM visits v
            JOIN patients p ON p.id = v.patient_id
            LEFT JOIN users cg ON cg.id = v.caregiver_id
            WHERE {where}
            ORDER BY v.visit_date DESC, v.visit_time ASC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.mappings().all()
    total = rows[0]["total_count"] if rows else 0
    visits = [dict(r) for r in rows]
    for v in visits:
        v.pop("total_count", None)

    return {
        "data": visits,
        "pagination": {
            "page": page, "per_page": per_page,
            "total": total, "pages": -(-total // per_page),
        },
    }


# ── Overdue / Missed Visit Alerts ──────────────────────────────
@router.get(
    "/overdue",
    dependencies=[Depends(require_permissions(Permission.VISITS_VIEW))],
)
async def get_overdue_visits(
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    """
    Returns visits that are past their scheduled date but still not completed
    (a patient who hasn't been seen). Also generates a one-time notification
    for the assigned caregiver the first time each visit becomes overdue.
    """
    # 1) Create one-time alerts for newly-overdue visits with a caregiver assigned
    newly_overdue = await db.execute(
        text("""
            SELECT v.id, v.caregiver_id, v.patient_id, v.visit_date,
                   p.first_name, p.last_name
            FROM visits v
            JOIN patients p ON p.id = v.patient_id
            WHERE v.organization_id = :org
              AND v.status = 'scheduled'
              AND v.visit_date < CURRENT_DATE
              AND COALESCE(v.overdue_alerted, FALSE) = FALSE
              AND v.caregiver_id IS NOT NULL
        """),
        {"org": str(current_user.organization_id)},
    )
    for row in newly_overdue.mappings().all():
        await db.execute(
            text("""
                INSERT INTO notifications (
                    organization_id, user_id, patient_id,
                    notification_type, title, body, action_url, priority
                ) VALUES (
                    :org, :user, :patient,
                    'visit_missed', :title, :body, :url, 'high'
                )
            """),
            {
                "org": str(current_user.organization_id),
                "user": str(row["caregiver_id"]),
                "patient": str(row["patient_id"]),
                "title": "Missed visit",
                "body": f"{row['first_name']} {row['last_name']} has not been seen — "
                        f"visit was scheduled for {row['visit_date']}.",
                "url": f"/patients/{row['patient_id']}",
            },
        )
    # Mark all overdue scheduled visits as alerted so we don't re-notify
    await db.execute(
        text("""
            UPDATE visits SET overdue_alerted = TRUE
            WHERE organization_id = :org AND status = 'scheduled'
              AND visit_date < CURRENT_DATE
              AND COALESCE(overdue_alerted, FALSE) = FALSE
        """),
        {"org": str(current_user.organization_id)},
    )

    # 2) Return the current overdue list with days overdue
    result = await db.execute(
        text("""
            SELECT v.id, v.patient_id, v.visit_date, v.visit_time, v.visit_type,
                   (CURRENT_DATE - v.visit_date) AS days_overdue,
                   p.first_name, p.last_name, p.phone, p.primary_diagnosis,
                   CONCAT(c.first_name, ' ', c.last_name) AS caregiver_name
            FROM visits v
            JOIN patients p ON p.id = v.patient_id
            LEFT JOIN users c ON c.id = v.caregiver_id
            WHERE v.organization_id = :org
              AND v.status = 'scheduled'
              AND v.visit_date < CURRENT_DATE
            ORDER BY v.visit_date ASC
        """),
        {"org": str(current_user.organization_id)},
    )
    # This JOIN pulls p.phone from the patients table, which is encrypted.
    # Decrypt ONLY that column — a whole-row decrypt would be wrong here,
    # because `visits` has its own `notes` column that collides by name with
    # `patients.notes` and must not be touched.
    rows = []
    for r in result.mappings().all():
        row = dict(r)
        row["phone"] = dec_scalar(row.get("phone"))
        rows.append(row)
    return {"data": rows}


# ── Get Single Visit ───────────────────────────────────────────
@router.get(
    "/{visit_id}",
    dependencies=[Depends(require_permissions(Permission.VISITS_VIEW))],
)
async def get_visit(
    visit_id: UUID,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    result = await db.execute(
        text("""
            SELECT
                v.*,
                p.first_name AS patient_first,
                p.last_name  AS patient_last,
                p.primary_diagnosis,
                p.allergies,
                CONCAT(cg.first_name, ' ', cg.last_name) AS caregiver_name
            FROM visits v
            JOIN patients p ON p.id = v.patient_id
            LEFT JOIN users cg ON cg.id = v.caregiver_id
            WHERE v.id = :id
        """),
        {"id": str(visit_id)},
    )
    visit = result.mappings().first()
    if not visit:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Visit not found."})

    await audit.log(
        AuditAction.PATIENT_VIEWED,
        f"Viewed visit: {visit['patient_first']} {visit['patient_last']} — {visit['visit_type']}",
        patient_id=visit["patient_id"],
        resource_type="visit",
        resource_id=visit_id,
    )
    # p.allergies comes from the encrypted patients table — the caregiver sees
    # this at the bedside, so it must be a real list, not ciphertext. Decrypt
    # ONLY that column: a whole-row decrypt would be wrong here, because
    # `visits` has its own `notes` column that collides by name with
    # `patients.notes` and must be left alone.
    visit_data = dict(visit)
    visit_data["allergies"] = dec_list(visit_data.get("allergies"))
    return {"data": visit_data}


# ── Schedule Visit ─────────────────────────────────────────────
@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.VISITS_CREATE))],
)
async def create_visit(
    body: VisitCreate,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    # Verify patient belongs to org (RLS handles this, but explicit is clearer)
    patient_check = await db.execute(
        text("SELECT first_name, last_name FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(body.patient_id)},
    )
    patient = patient_check.mappings().first()
    if not patient:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Patient not found."})

    result = await db.execute(
        text("""
            INSERT INTO visits (
                organization_id, patient_id, caregiver_id, care_plan_id,
                visit_date, visit_time, visit_type, status, notes
            ) VALUES (
                :org, :patient, :caregiver, :care_plan,
                :date, :time, :type, 'scheduled', :notes
            )
            RETURNING id, visit_date, visit_time, visit_type, status, created_at
        """),
        {
            "org":        str(current_user.organization_id),
            "patient":    str(body.patient_id),
            "caregiver":  str(body.caregiver_id) if body.caregiver_id else None,
            "care_plan":  str(body.care_plan_id) if body.care_plan_id else None,
            "date":       _to_date(body.visit_date),
            "time":       _to_time(body.visit_time),
            "type":       body.visit_type,
            "notes":      body.notes,
        },
    )
    new_visit = result.mappings().first()

    await audit.log(
        AuditAction.VISIT_CREATED,
        f"Scheduled {body.visit_type} for {patient['first_name']} {patient['last_name']} on {body.visit_date}",
        patient_id=body.patient_id,
        resource_type="visit",
        resource_id=new_visit["id"],
    )
    return {"data": dict(new_visit), "message": "Visit scheduled successfully."}


# ── Update Visit ───────────────────────────────────────────────
@router.patch(
    "/{visit_id}",
    dependencies=[Depends(require_permissions(Permission.VISITS_EDIT))],
)
async def update_visit(
    visit_id: UUID,
    body: VisitUpdate,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    existing = await _get_visit_or_404(db, visit_id)

    updates = body.model_dump(exclude_none=True)
    if not updates:
        return {"data": dict(existing), "message": "No changes provided."}

    set_clauses, params = [], {"id": str(visit_id)}
    for field, value in updates.items():
        set_clauses.append(f"{field} = :{field}")
        if field == "visit_date":
            params[field] = _to_date(value)
        elif field == "visit_time":
            params[field] = _to_time(value)
        elif isinstance(value, UUID):
            params[field] = str(value)
        else:
            params[field] = value

    await db.execute(
        text(f"UPDATE visits SET {', '.join(set_clauses)}, updated_at = NOW() WHERE id = :id"),
        params,
    )
    await audit.log(
        AuditAction.VISIT_UPDATED,
        f"Updated visit {visit_id}: {list(updates.keys())}",
        patient_id=existing["patient_id"],
        resource_type="visit",
        resource_id=visit_id,
        previous_state=dict(existing),
        new_state=updates,
    )
    return {"message": "Visit updated successfully."}


# ── GPS Check-In ───────────────────────────────────────────────
@router.post(
    "/{visit_id}/checkin",
    dependencies=[Depends(require_permissions(Permission.VISITS_CHECKIN))],
)
async def gps_checkin(
    visit_id: UUID,
    body: GPSCheckIn,
    request: Request,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Records caregiver GPS check-in at the start of a visit."""
    visit = await _get_visit_or_404(db, visit_id)

    if visit["status"] not in ("scheduled", "in_progress"):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_state", "message": "Only scheduled visits can be checked into."},
        )

    await db.execute(
        text("""
            UPDATE visits SET
                status = 'in_progress',
                checkin_at = NOW(),
                checkin_lat = :lat,
                checkin_lon = :lon,
                updated_at = NOW()
            WHERE id = :id
        """),
        {"lat": body.latitude, "lon": body.longitude, "id": str(visit_id)},
    )

    ip = get_client_ip(request)
    await audit.log(
        AuditAction.VISIT_CHECKIN,
        f"GPS check-in recorded for visit {visit_id}"
        + (f" at {body.latitude:.4f}, {body.longitude:.4f}" if body.latitude else " (no GPS)"),
        patient_id=visit["patient_id"],
        resource_type="visit",
        resource_id=visit_id,
        ip_address=ip,
    )
    return {"message": "Check-in recorded.", "checked_in_at": "now"}


# ── GPS Check-Out ──────────────────────────────────────────────
@router.post(
    "/{visit_id}/checkout",
    dependencies=[Depends(require_permissions(Permission.VISITS_CHECKIN))],
)
async def gps_checkout(
    visit_id: UUID,
    body: GPSCheckIn,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Records caregiver GPS check-out at the end of a visit."""
    visit = await _get_visit_or_404(db, visit_id)

    await db.execute(
        text("""
            UPDATE visits SET
                checkout_at = NOW(),
                checkout_lat = :lat,
                checkout_lon = :lon,
                updated_at = NOW()
            WHERE id = :id
        """),
        {"lat": body.latitude, "lon": body.longitude, "id": str(visit_id)},
    )

    await audit.log(
        AuditAction.VISIT_UPDATED,
        f"GPS check-out recorded for visit {visit_id}",
        patient_id=visit["patient_id"],
        resource_type="visit",
        resource_id=visit_id,
    )
    return {"message": "Check-out recorded."}


# ── SOAP Note ──────────────────────────────────────────────────
@router.post(
    "/{visit_id}/soap",
    dependencies=[Depends(require_permissions(Permission.VISITS_SOAP))],
)
async def create_soap_note(
    visit_id: UUID,
    body: SOAPNote,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Creates or replaces the SOAP note for a visit.
    Marks the visit as completed and records who documented it.
    """
    visit = await _get_visit_or_404(db, visit_id)

    await db.execute(
        text("""
            UPDATE visits SET
                soap_subjective      = :s,
                soap_objective       = :o,
                soap_assessment      = :a,
                soap_plan            = :p,
                soap_documented_at   = NOW(),
                soap_documented_by   = :by,
                clinician_signature_url = :sig,
                duration_minutes     = :duration,
                status               = :visit_status,
                updated_at           = NOW()
            WHERE id = :id
        """),
        {
            "s":            body.subjective,
            "o":            body.objective,
            "a":            body.assessment,
            "p":            body.plan,
            "by":           str(current_user.user_id),
            "sig":          body.signature_url,
            "duration":     body.duration_minutes,
            "visit_status": body.visit_status,
            "id":           str(visit_id),
        },
    )

    await audit.log(
        AuditAction.SOAP_NOTE_CREATED,
        f"SOAP note documented for visit {visit_id} — {visit.get('visit_type', '')}",
        patient_id=visit["patient_id"],
        resource_type="visit",
        resource_id=visit_id,
    )
    return {"message": "SOAP note saved successfully."}


# ── Cancel Visit ───────────────────────────────────────────────
@router.delete(
    "/{visit_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permissions(Permission.VISITS_EDIT))],
)
async def cancel_visit(
    visit_id: UUID,
    reason: Optional[str] = Query(None),
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    visit = await _get_visit_or_404(db, visit_id)

    await db.execute(
        text("""
            UPDATE visits SET
                status = 'cancelled',
                cancellation_reason = :reason,
                cancelled_by = :uid,
                updated_at = NOW()
            WHERE id = :id
        """),
        {"reason": reason, "uid": str(current_user.user_id), "id": str(visit_id)},
    )
    await audit.log(
        AuditAction.VISIT_UPDATED,
        f"Visit cancelled: {visit_id}" + (f" — Reason: {reason}" if reason else ""),
        patient_id=visit["patient_id"],
        resource_type="visit",
        resource_id=visit_id,
    )


# ── Helper ─────────────────────────────────────────────────────
async def _get_visit_or_404(db: AsyncSession, visit_id: UUID) -> dict:
    result = await db.execute(
        text("SELECT * FROM visits WHERE id = :id"),
        {"id": str(visit_id)},
    )
    visit = result.mappings().first()
    if not visit:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Visit not found."})
    return dict(visit)
