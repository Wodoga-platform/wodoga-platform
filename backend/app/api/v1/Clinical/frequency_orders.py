"""
Wodoga Platform — Frequency Orders (structured plan-of-care frequencies).
Path: backend/app/api/v1/clinical/frequency_orders.py

GET   /api/v1/clinical/frequency-orders/patients/{patient_id}
POST  /api/v1/clinical/frequency-orders
PATCH /api/v1/clinical/frequency-orders/{order_id}/status

Accepts POC shorthand ("2w9", "1-3w4") or explicit fields. The parser rejects
anything ambiguous with a reason — a misparsed frequency is a false compliance
signal, worse than none.

discipline is limited to SN/PT/OT: those are the disciplines the visits table
can substantiate via visit_type (see constants.VISIT_TYPE_TO_DISCIPLINE_SQL).
"""

import re
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLogger
from app.core.permissions import Permission, TokenPayload, require_permissions
from app.dependencies import (
    get_audit_logger,
    get_current_user_payload,
    get_db_for_tenant,
)
from app.api.v1.clinical import constants as C

router = APIRouter(prefix="/clinical/frequency-orders", tags=["Clinical Frequency Orders"])

DISCIPLINES = {"SN", "PT", "OT"}
SHORTHAND = re.compile(r"^(\d{1,2})(?:-(\d{1,2}))?[wW](\d{1,2})$")


def parse_shorthand(value: str) -> tuple[int, int, int]:
    """'2w9' -> (2, 2, 9); '1-3w4' -> (1, 3, 4). Raises ValueError otherwise."""
    m = SHORTHAND.match(value.strip())
    if not m:
        raise ValueError(
            f"Can't parse '{value}' — expected forms like 2w9 or 1-3w4. Multiple "
            "phases (e.g. '3w2 2w4') must be entered as separate orders.")
    lo = int(m.group(1))
    hi = int(m.group(2)) if m.group(2) else lo
    weeks = int(m.group(3))
    if hi < lo:
        raise ValueError(f"'{value}': range max {hi} is below min {lo}")
    if weeks == 0 or weeks > 60:
        raise ValueError(f"'{value}': duration {weeks} weeks is outside 1-60")
    if hi > 14:
        raise ValueError(f"'{value}': {hi} visits/week is implausible — check the order")
    return lo, hi, weeks


class FrequencyOrderIn(BaseModel):
    patient_id: UUID
    discipline: str
    start_date: date
    shorthand: str | None = Field(default=None, description="e.g. 2w9")
    visits_min: int | None = None
    visits_max: int | None = None
    duration_weeks: int | None = None
    source_ref: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def normalize(self):
        self.discipline = self.discipline.upper()
        if self.discipline not in DISCIPLINES:
            raise ValueError(
                f"discipline must be one of {sorted(DISCIPLINES)} (SN/PT/OT are the "
                "disciplines the visits table can track today)")
        if self.shorthand:
            self.visits_min, self.visits_max, self.duration_weeks = \
                parse_shorthand(self.shorthand)
        if None in (self.visits_min, self.visits_max, self.duration_weeks):
            raise ValueError("Provide shorthand OR visits_min + visits_max + duration_weeks")
        if self.visits_max < self.visits_min:
            raise ValueError("visits_max must be >= visits_min")
        return self


@router.get(
    "/patients/{patient_id}",
    dependencies=[Depends(require_permissions(Permission.CARE_PLANS_VIEW))],
)
async def list_orders(patient_id: UUID, db: AsyncSession = Depends(get_db_for_tenant)):
    rows = (await db.execute(text("""
        SELECT id, discipline, visits_min, visits_max, duration_weeks, start_date,
               (start_date + duration_weeks * 7 - 1) AS end_date,
               status, source_ref, notes, created_at
        FROM frequency_orders WHERE patient_id = :pid
        ORDER BY status = 'active' DESC, start_date DESC
    """), {"pid": str(patient_id)})).mappings().all()
    return [dict(r) for r in rows]


@router.post(
    "",
    status_code=201,
    dependencies=[Depends(require_permissions(Permission.CARE_PLANS_CREATE))],
)
async def create_order(
    body: FrequencyOrderIn,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    overlap = (await db.execute(text("""
        SELECT id FROM frequency_orders
        WHERE patient_id = :pid AND discipline = :disc AND status = 'active'
          AND start_date <= (:start)::date + (:weeks * 7 - 1)
          AND (start_date + duration_weeks * 7 - 1) >= (:start)::date
        LIMIT 1
    """), {"pid": str(body.patient_id), "disc": body.discipline,
           "start": body.start_date, "weeks": body.duration_weeks})).mappings().first()
    if overlap:
        raise HTTPException(409, {
            "message": f"An active {body.discipline} order already covers part of this "
                       "window. Discontinue it first if the frequency changed.",
            "existing_order_id": str(overlap["id"])})

    row = (await db.execute(text("""
        INSERT INTO frequency_orders
            (organization_id, patient_id, discipline, visits_min, visits_max,
             duration_weeks, start_date, source_ref, notes, created_by)
        VALUES (:org, :pid, :disc, :vmin, :vmax, :weeks, :start, :ref, :notes, :uid)
        RETURNING id
    """), {"org": str(current_user.organization_id), "pid": str(body.patient_id),
           "disc": body.discipline, "vmin": body.visits_min, "vmax": body.visits_max,
           "weeks": body.duration_weeks, "start": body.start_date,
           "ref": body.source_ref, "notes": body.notes,
           "uid": str(current_user.user_id)})).mappings().first()

    await audit.log(
        C.FREQ_ORDER_CREATED,
        f"Created {body.discipline} frequency order "
        f"{body.visits_min}-{body.visits_max}w{body.duration_weeks}",
        patient_id=body.patient_id, resource_type="frequency_order",
        resource_id=row["id"],
        new_state={"discipline": body.discipline,
                   "frequency": f"{body.visits_min}-{body.visits_max}w{body.duration_weeks}",
                   "start_date": str(body.start_date)})
    return {"id": row["id"]}


@router.patch(
    "/{order_id}/status",
    dependencies=[Depends(require_permissions(Permission.CARE_PLANS_CREATE))],
)
async def set_status(
    order_id: UUID,
    status: str,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    if status not in ("active", "completed", "discontinued"):
        raise HTTPException(422, "status must be active|completed|discontinued")
    prev = (await db.execute(
        text("SELECT patient_id, status, discipline FROM frequency_orders WHERE id = :id"),
        {"id": str(order_id)})).mappings().first()
    if not prev:
        raise HTTPException(404, "Order not found")
    await db.execute(
        text("UPDATE frequency_orders SET status = :s WHERE id = :id"),
        {"s": status, "id": str(order_id)})
    await audit.log(
        C.FREQ_ORDER_UPDATED,
        f"{prev['discipline']} frequency order → {status}",
        patient_id=prev["patient_id"], resource_type="frequency_order",
        resource_id=order_id,
        previous_state={"status": prev["status"]}, new_state={"status": status})
    return {"ok": True}
