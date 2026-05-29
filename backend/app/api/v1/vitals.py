"""
Wodoga Platform — Vitals API
GET  /api/v1/vitals                   List vitals (filterable by patient)
POST /api/v1/vitals                   Record new vital signs
GET  /api/v1/vitals/{id}              Get a single vitals record
GET  /api/v1/vitals/patient/{pid}     Full vitals history for a patient
GET  /api/v1/vitals/alerts            All flagged vitals across the organization
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditAction, AuditLogger
from app.core.permissions import Permission, TokenPayload, require_permissions
from app.dependencies import get_audit_logger, get_current_user_payload, get_db_for_tenant

router = APIRouter(prefix="/vitals", tags=["Vitals"])


# ── Thresholds for auto-flagging ──────────────────────────────
BP_HIGH_SYSTOLIC  = 160
BP_HIGH_DIASTOLIC = 100
BP_LOW_SYSTOLIC   = 90
O2_LOW            = 94
GLUCOSE_HIGH      = 250
GLUCOSE_LOW       = 70
TEMP_HIGH         = 99.5


# ── Schema ─────────────────────────────────────────────────────
class VitalsCreate(BaseModel):
    patient_id: UUID
    visit_id: Optional[UUID] = None
    recorded_at: Optional[str] = None

    bp_systolic: Optional[int] = None
    bp_diastolic: Optional[int] = None
    bp_position: Optional[str] = None
    heart_rate: Optional[int] = None
    heart_rhythm: Optional[str] = None
    oxygen_saturation: Optional[int] = None
    oxygen_delivery: Optional[str] = None
    temperature: Optional[float] = None
    temperature_route: Optional[str] = None
    respiratory_rate: Optional[int] = None
    weight_lbs: Optional[float] = None
    blood_glucose: Optional[int] = None
    blood_glucose_timing: Optional[str] = None
    pain_scale: Optional[int] = None
    pain_location: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("pain_scale")
    @classmethod
    def validate_pain(cls, v):
        if v is not None and not (0 <= v <= 10):
            raise ValueError("Pain scale must be 0–10.")
        return v

    @field_validator("oxygen_saturation")
    @classmethod
    def validate_o2(cls, v):
        if v is not None and not (50 <= v <= 100):
            raise ValueError("O₂ saturation must be 50–100%.")
        return v


# ── Record Vitals ──────────────────────────────────────────────
@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.VITALS_CREATE))],
)
async def record_vitals(
    body: VitalsCreate,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """
    Records a new set of vital signs for a patient.
    Alert flags are computed automatically based on clinical thresholds.
    Flagged vitals trigger notifications to the assigned provider.
    Vitals are append-only — never updated.
    """
    # Verify patient
    p_result = await db.execute(
        text("SELECT first_name, last_name FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(body.patient_id)},
    )
    patient = p_result.mappings().first()
    if not patient:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Patient not found."})

    # Compute alert flags
    flags = _compute_flags(body)

    result = await db.execute(
        text("""
            INSERT INTO vitals (
                organization_id, patient_id, visit_id, recorded_by, recorded_at,
                bp_systolic, bp_diastolic, bp_position,
                heart_rate, heart_rhythm,
                oxygen_saturation, oxygen_delivery,
                temperature, temperature_route,
                respiratory_rate, weight_lbs,
                blood_glucose, blood_glucose_timing,
                pain_scale, pain_location,
                flag_low_o2, flag_high_bp, flag_low_bp,
                flag_high_glucose, flag_low_glucose, flag_high_temp,
                notes
            ) VALUES (
                :org, :patient, :visit, :recorded_by,
                COALESCE(:recorded_at::timestamptz, NOW()),
                :bp_sys, :bp_dia, :bp_pos,
                :hr, :rhythm,
                :o2, :o2_delivery,
                :temp, :temp_route,
                :rr, :weight,
                :glucose, :glucose_timing,
                :pain, :pain_loc,
                :flag_o2, :flag_high_bp, :flag_low_bp,
                :flag_high_glu, :flag_low_glu, :flag_temp,
                :notes
            )
            RETURNING id, recorded_at,
                      flag_low_o2, flag_high_bp, flag_low_bp,
                      flag_high_glucose, flag_low_glucose, flag_high_temp
        """),
        {
            "org":           str(current_user.organization_id),
            "patient":       str(body.patient_id),
            "visit":         str(body.visit_id) if body.visit_id else None,
            "recorded_by":   str(current_user.user_id),
            "recorded_at":   body.recorded_at,
            "bp_sys":        body.bp_systolic,
            "bp_dia":        body.bp_diastolic,
            "bp_pos":        body.bp_position,
            "hr":            body.heart_rate,
            "rhythm":        body.heart_rhythm,
            "o2":            body.oxygen_saturation,
            "o2_delivery":   body.oxygen_delivery,
            "temp":          body.temperature,
            "temp_route":    body.temperature_route,
            "rr":            body.respiratory_rate,
            "weight":        body.weight_lbs,
            "glucose":       body.blood_glucose,
            "glucose_timing": body.blood_glucose_timing,
            "pain":          body.pain_scale,
            "pain_loc":      body.pain_location,
            "flag_o2":       flags["low_o2"],
            "flag_high_bp":  flags["high_bp"],
            "flag_low_bp":   flags["low_bp"],
            "flag_high_glu": flags["high_glucose"],
            "flag_low_glu":  flags["low_glucose"],
            "flag_temp":     flags["high_temp"],
            "notes":         body.notes,
        },
    )
    new_vitals = result.mappings().first()

    # Build audit detail with key readings
    readings = []
    if body.bp_systolic:
        readings.append(f"BP {body.bp_systolic}/{body.bp_diastolic}")
    if body.oxygen_saturation:
        readings.append(f"O₂ {body.oxygen_saturation}%")
    if body.heart_rate:
        readings.append(f"HR {body.heart_rate}")
    if body.temperature:
        readings.append(f"Temp {body.temperature}°F")
    if body.blood_glucose:
        readings.append(f"Gluc {body.blood_glucose}")

    active_flags = [k for k, v in flags.items() if v]

    await audit.log(
        AuditAction.VITALS_RECORDED,
        f"Vitals recorded for {patient['first_name']} {patient['last_name']}: "
        + (", ".join(readings) if readings else "no readings entered")
        + (f" ⚠ Flags: {active_flags}" if active_flags else ""),
        patient_id=body.patient_id,
        resource_type="vitals",
        resource_id=new_vitals["id"],
    )

    # Create notifications for flagged vitals
    if active_flags:
        await _create_vitals_alerts(db, body, patient, flags, current_user)

    return {
        "data": dict(new_vitals),
        "alerts": active_flags,
        "message": "Vitals recorded." + (f" ⚠ {len(active_flags)} alert(s) generated." if active_flags else ""),
    }


# ── Patient Vitals History ─────────────────────────────────────
@router.get(
    "/patient/{patient_id}",
    dependencies=[Depends(require_permissions(Permission.VITALS_VIEW))],
)
async def patient_vitals_history(
    patient_id: UUID,
    limit: int = Query(30, ge=1, le=200),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Returns the full vitals history for a patient with trend data."""
    conditions = ["patient_id = :patient_id"]
    params: dict = {"patient_id": str(patient_id), "limit": limit}

    if date_from:
        conditions.append("recorded_at >= :date_from::timestamptz")
        params["date_from"] = date_from
    if date_to:
        conditions.append("recorded_at <= :date_to::timestamptz")
        params["date_to"] = date_to

    where = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT
                v.*,
                CONCAT(u.first_name, ' ', u.last_name) AS recorded_by_name
            FROM vitals v
            LEFT JOIN users u ON u.id = v.recorded_by
            WHERE {where}
            ORDER BY v.recorded_at DESC
            LIMIT :limit
        """),
        params,
    )
    vitals_list = [dict(r) for r in result.mappings().all()]

    # Compute trends from the last 10 readings
    trends = _compute_trends(vitals_list[:10])

    await audit.log(
        AuditAction.VITALS_VIEWED,
        f"Viewed vitals history for patient {patient_id}",
        patient_id=patient_id,
        resource_type="vitals",
    )

    return {"data": vitals_list, "trends": trends, "count": len(vitals_list)}


# ── Organization Vitals Alerts ─────────────────────────────────
@router.get(
    "/alerts",
    dependencies=[Depends(require_permissions(Permission.VITALS_VIEW))],
)
async def vitals_alerts(
    days: int = Query(7, ge=1, le=90),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    """Returns all flagged vitals readings from the last N days."""
    result = await db.execute(
        text("""
            SELECT
                v.*,
                p.first_name, p.last_name, p.primary_diagnosis,
                CONCAT(u.first_name, ' ', u.last_name) AS recorded_by_name
            FROM vitals v
            JOIN patients p ON p.id = v.patient_id
            LEFT JOIN users u ON u.id = v.recorded_by
            WHERE v.recorded_at >= NOW() - (:days || ' days')::interval
              AND (
                v.flag_low_o2 = TRUE OR v.flag_high_bp = TRUE OR
                v.flag_low_bp = TRUE OR v.flag_high_glucose = TRUE OR
                v.flag_low_glucose = TRUE OR v.flag_high_temp = TRUE
              )
            ORDER BY v.recorded_at DESC
        """),
        {"days": days},
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


# ── Single Vitals Record ───────────────────────────────────────
@router.get(
    "/{vitals_id}",
    dependencies=[Depends(require_permissions(Permission.VITALS_VIEW))],
)
async def get_vitals(
    vitals_id: UUID,
    db: AsyncSession = Depends(get_db_for_tenant),
):
    result = await db.execute(
        text("SELECT * FROM vitals WHERE id = :id"),
        {"id": str(vitals_id)},
    )
    vitals = result.mappings().first()
    if not vitals:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return {"data": dict(vitals)}


# ── Internal Helpers ───────────────────────────────────────────
def _compute_flags(body: VitalsCreate) -> dict:
    """Determines which clinical alert flags should be set."""
    return {
        "low_o2":      body.oxygen_saturation is not None and body.oxygen_saturation < O2_LOW,
        "high_bp":     (body.bp_systolic is not None and body.bp_systolic >= BP_HIGH_SYSTOLIC)
                    or (body.bp_diastolic is not None and body.bp_diastolic >= BP_HIGH_DIASTOLIC),
        "low_bp":      body.bp_systolic is not None and body.bp_systolic < BP_LOW_SYSTOLIC,
        "high_glucose": body.blood_glucose is not None and body.blood_glucose > GLUCOSE_HIGH,
        "low_glucose":  body.blood_glucose is not None and body.blood_glucose < GLUCOSE_LOW,
        "high_temp":   body.temperature is not None and body.temperature > TEMP_HIGH,
    }


def _compute_trends(vitals_list: list[dict]) -> dict:
    """
    Computes simple directional trends from the most recent readings.
    Compares the latest reading to the average of prior readings.
    """
    if len(vitals_list) < 2:
        return {}

    def trend(values: list) -> str:
        clean = [v for v in values if v is not None]
        if len(clean) < 2:
            return "stable"
        latest, avg_prior = clean[0], sum(clean[1:]) / len(clean[1:])
        diff = latest - avg_prior
        if abs(diff) < avg_prior * 0.03:
            return "stable"
        return "rising" if diff > 0 else "falling"

    return {
        "bp_systolic":       trend([v.get("bp_systolic") for v in vitals_list]),
        "oxygen_saturation": trend([v.get("oxygen_saturation") for v in vitals_list]),
        "heart_rate":        trend([v.get("heart_rate") for v in vitals_list]),
        "weight_lbs":        trend([v.get("weight_lbs") for v in vitals_list]),
        "blood_glucose":     trend([v.get("blood_glucose") for v in vitals_list]),
    }


async def _create_vitals_alerts(
    db: AsyncSession,
    body: VitalsCreate,
    patient: dict,
    flags: dict,
    current_user: TokenPayload,
) -> None:
    """Creates notifications for providers when vitals are flagged."""
    # Find the assigned provider for this patient
    result = await db.execute(
        text("SELECT assigned_provider FROM patients WHERE id = :id"),
        {"id": str(body.patient_id)},
    )
    patient_record = result.mappings().first()
    if not patient_record or not patient_record["assigned_provider"]:
        return

    flag_messages = {
        "low_o2":      f"Low O₂ saturation: {body.oxygen_saturation}% (threshold: {O2_LOW}%)",
        "high_bp":     f"High blood pressure: {body.bp_systolic}/{body.bp_diastolic} mmHg",
        "low_bp":      f"Low blood pressure: {body.bp_systolic}/{body.bp_diastolic} mmHg",
        "high_glucose": f"High blood glucose: {body.blood_glucose} mg/dL",
        "low_glucose":  f"Low blood glucose: {body.blood_glucose} mg/dL",
        "high_temp":   f"Elevated temperature: {body.temperature}°F",
    }

    for flag_key, is_flagged in flags.items():
        if not is_flagged:
            continue
        notif_type = {
            "low_o2": "low_o2_alert", "high_bp": "high_bp_alert",
            "low_bp": "high_bp_alert", "high_glucose": "low_glucose_alert",
            "low_glucose": "low_glucose_alert", "high_temp": "system",
        }.get(flag_key, "system")

        await db.execute(
            text("""
                INSERT INTO notifications (
                    organization_id, user_id, patient_id,
                    notification_type, title, body, priority
                ) VALUES (
                    :org, :user, :patient,
                    :type, :title, :body, 'high'
                )
            """),
            {
                "org":     str(current_user.organization_id),
                "user":    str(patient_record["assigned_provider"]),
                "patient": str(body.patient_id),
                "type":    notif_type,
                "title":   f"⚠ Vitals Alert — {patient['first_name']} {patient['last_name']}",
                "body":    flag_messages[flag_key],
            },
        )
