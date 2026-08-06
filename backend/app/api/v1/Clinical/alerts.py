"""
Wodoga Platform — Clinical Alerts (compute-on-read).
Path: backend/app/api/v1/clinical/alerts.py

GET /api/v1/clinical/alerts               agency-wide feed
GET /api/v1/clinical/alerts?patient_id=…  scoped to one patient

Alerts are computed at request time by deterministic SQL — there is no
background job on Railway yet, so nothing is stored or synced. Consequences:
always current, zero new infrastructure, nothing to backfill. When a
scheduler exists (Azure), snapshot these same queries for notifications and
trends; the definitions don't change.

RLS scoping: every query runs on the get_db_for_tenant session, which has
already SET app.organization_id, so results are automatically limited to the
caller's organization — the same mechanism patients.py relies on.

Alert families:
  frequency_shortfall  — a completed anchored week delivered < ordered minimum
                         (bounded to a trailing window so a first deploy
                         doesn't surface months of history)
  frequency_at_risk    — current week can no longer mathematically hit minimum
  document_expiring    — active tracked_documents expiring within 60 days
  code_status_missing  — active patient with no documented code status
  code_status_stale    — code status last verified > 60 days ago
  patient_on_hold      — an active hold (so nobody schedules into it)
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLogger
from app.core.permissions import Permission, TokenPayload, require_permissions
from app.dependencies import (
    get_audit_logger,
    get_current_user_payload,
    get_db_for_tenant,
)
from app.api.v1.clinical.constants import VISIT_TYPE_TO_DISCIPLINE_SQL

router = APIRouter(prefix="/clinical/alerts", tags=["Clinical Alerts"])

# Trailing window for completed-week shortfalls (days). Keeps alerts
# actionable — a shortfall from months ago is history, not a to-do. ~6 weeks.
SHORTFALL_LOOKBACK_DAYS = 42

# Visit facts, mapped from the real visits table. Only completed visits count.
_VISIT_FACTS = f"""
    SELECT patient_id,
           {VISIT_TYPE_TO_DISCIPLINE_SQL} AS discipline,
           visit_date
    FROM visits
    WHERE status = 'completed'
"""


def _frequency_sql(patient_scoped: bool) -> str:
    """Shortfall / at-risk query. Extracted so tests exercise the exact SQL
    the endpoint runs. When patient_scoped, binds :patient_id; otherwise RLS
    alone scopes it (the agency-wide path)."""
    order_filter = "AND fo.patient_id = :patient_id" if patient_scoped else ""
    return f"""
    WITH visit_facts AS ({_VISIT_FACTS}),
    orders AS (
        SELECT fo.id AS order_id, fo.patient_id, fo.discipline,
               fo.visits_min, fo.visits_max, fo.start_date, fo.duration_weeks,
               p.first_name, p.last_name
        FROM frequency_orders fo
        JOIN patients p ON p.id = fo.patient_id
        WHERE fo.status = 'active' {order_filter}
    ),
    weeks AS (
        SELECT o.*, gs.week_index,
               (o.start_date + (gs.week_index * 7))     AS week_start,
               (o.start_date + (gs.week_index * 7) + 6) AS week_end
        FROM orders o
        CROSS JOIN LATERAL generate_series(0, o.duration_weeks - 1) AS gs(week_index)
        WHERE (o.start_date + (gs.week_index * 7)) <= CURRENT_DATE
    ),
    counted AS (
        SELECT w.*,
               (SELECT count(*) FROM visit_facts v
                 WHERE v.patient_id = w.patient_id
                   AND v.discipline = w.discipline
                   AND v.visit_date BETWEEN w.week_start AND w.week_end) AS delivered,
               (w.week_end < CURRENT_DATE) AS week_complete,
               EXISTS (SELECT 1 FROM patient_holds h
                        WHERE h.patient_id = w.patient_id
                          AND h.started_on <= w.week_start
                          AND COALESCE(h.ended_on, CURRENT_DATE) >= w.week_end
                      ) AS fully_on_hold
        FROM weeks w
    )
    SELECT order_id, patient_id, first_name, last_name, discipline,
           visits_min, visits_max, week_index + 1 AS week_number,
           week_start, week_end, delivered, week_complete
    FROM counted
    WHERE NOT fully_on_hold
      AND (
            (week_complete AND delivered < visits_min
                AND week_end >= CURRENT_DATE - {SHORTFALL_LOOKBACK_DAYS})
         OR (NOT week_complete
             AND delivered < visits_min
             AND (visits_min - delivered) > (week_end - CURRENT_DATE) + 1)
          )
    ORDER BY week_start DESC
    """


@router.get(
    "",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))],
)
async def alert_feed(
    request: Request,
    patient_id: Optional[UUID] = Query(default=None),
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    scoped = patient_id is not None
    params = {"patient_id": str(patient_id)} if scoped else {}
    alerts: list[dict] = []

    # 1 + 2 — frequency shortfall / at-risk
    rows = (await db.execute(text(_frequency_sql(scoped)), params)).mappings().all()
    for r in rows:
        complete = r["week_complete"]
        ordered = str(r["visits_min"]) + (
            f"-{r['visits_max']}" if r["visits_max"] != r["visits_min"] else "")
        alerts.append({
            "kind": "frequency_shortfall" if complete else "frequency_at_risk",
            "severity": "high" if complete else "medium",
            "patient_id": str(r["patient_id"]),
            "patient_name": f"{r['first_name']} {r['last_name']}",
            "title": (f"{r['discipline']} week {r['week_number']}: "
                      f"{r['delivered']}/{r['visits_min']} visits"
                      + ("" if complete else " — cannot meet minimum by week end")),
            "detail": {"order_id": str(r["order_id"]),
                       "week_start": str(r["week_start"]),
                       "week_end": str(r["week_end"]),
                       "ordered": ordered, "delivered": r["delivered"]},
        })

    # 3 — documents expiring within 60 days
    doc_filter = "AND d.patient_id = :patient_id" if scoped else ""
    doc_rows = (await db.execute(text(f"""
        SELECT d.id, d.patient_id, d.doc_type, d.title, d.expires_on,
               (d.expires_on - CURRENT_DATE) AS days_left,
               p.first_name, p.last_name
        FROM tracked_documents d
        LEFT JOIN patients p ON p.id = d.patient_id
        WHERE d.status = 'active' AND d.expires_on <= CURRENT_DATE + 60 {doc_filter}
        ORDER BY d.expires_on
    """), params)).mappings().all()
    for r in doc_rows:
        overdue = r["days_left"] < 0
        alerts.append({
            "kind": "document_expiring",
            "severity": "high" if overdue or r["days_left"] <= 14 else "medium",
            "patient_id": str(r["patient_id"]) if r["patient_id"] else None,
            "patient_name": (f"{r['first_name']} {r['last_name']}"
                             if r["first_name"] else "Agency-level"),
            "title": (f"{r['title']} ({r['doc_type']}) "
                      + (f"expired {-r['days_left']}d ago" if overdue
                         else f"expires in {r['days_left']}d")),
            "detail": {"document_id": str(r["id"]), "expires_on": str(r["expires_on"])},
        })

    # 4 + 5 — code status deficiencies
    cs_filter = "AND p.id = :patient_id" if scoped else ""
    cs_rows = (await db.execute(text(f"""
        SELECT p.id, p.first_name, p.last_name, p.code_status,
               p.code_status_verified_on,
               (CURRENT_DATE - p.code_status_verified_on) AS age_days
        FROM patients p
        WHERE p.deleted_at IS NULL AND p.status = 'active'
          AND (p.code_status IS NULL
               OR p.code_status_verified_on IS NULL
               OR p.code_status_verified_on < CURRENT_DATE - 60)
          {cs_filter}
    """), params)).mappings().all()
    for r in cs_rows:
        missing = r["code_status"] is None
        alerts.append({
            "kind": "code_status_missing" if missing else "code_status_stale",
            "severity": "high" if missing else "low",
            "patient_id": str(r["id"]),
            "patient_name": f"{r['first_name']} {r['last_name']}",
            "title": ("Code status not documented" if missing else
                      f"Code status last verified {r['age_days']}d ago — reverify at recert"),
            "detail": {"code_status": r["code_status"],
                       "verified_on": str(r["code_status_verified_on"] or "never")},
        })

    # 6 — active holds
    hold_filter = "AND h.patient_id = :patient_id" if scoped else ""
    hold_rows = (await db.execute(text(f"""
        SELECT h.id, h.patient_id, h.hold_type, h.started_on, h.expected_return,
               p.first_name, p.last_name
        FROM patient_holds h
        JOIN patients p ON p.id = h.patient_id
        WHERE h.ended_on IS NULL {hold_filter}
    """), params)).mappings().all()
    for r in hold_rows:
        alerts.append({
            "kind": "patient_on_hold",
            "severity": "info",
            "patient_id": str(r["patient_id"]),
            "patient_name": f"{r['first_name']} {r['last_name']}",
            "title": (f"On hold — {r['hold_type'].replace('_', ' ')} "
                      f"since {r['started_on']}"
                      + (f", expected back {r['expected_return']}"
                         if r["expected_return"] else "")),
            "detail": {"hold_id": str(r["id"])},
        })

    order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    alerts.sort(key=lambda a: order[a["severity"]])

    await audit.log(
        "CLINICAL_ALERTS_VIEWED",
        f"Viewed clinical alerts ({'patient' if scoped else 'agency-wide'})",
    )
    return {
        "count": len(alerts),
        "counts_by_severity": {s: sum(1 for a in alerts if a["severity"] == s)
                               for s in order},
        "alerts": alerts,
    }
