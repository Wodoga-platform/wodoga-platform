"""
Wodoga Platform — ICD-10 structured coding.
Path: backend/app/api/v1/clinical/icd10.py

GET   /api/v1/clinical/icd10/search
GET   /api/v1/clinical/icd10/patients/{patient_id}/diagnoses
POST  /api/v1/clinical/icd10/patients/{patient_id}/diagnoses
PATCH /api/v1/clinical/icd10/diagnoses/{dx_id}/resolve
POST  /api/v1/clinical/icd10/import           (admin only)

Clinical guards:
  * laterality mismatch warning (derived from the CMS description, which is
    authoritative — the side digit's position varies by code family)
  * non-billable header codes rejected as a primary diagnosis
  * exactly one active primary per patient (DB partial-unique index → 409)
"""

import io
import re
import zipfile

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date
from uuid import UUID

from app.core.audit import AuditLogger
from app.core.permissions import Permission, TokenPayload, require_permissions
from app.dependencies import (
    get_audit_logger,
    get_current_user_payload,
    get_db_for_tenant,
    require_admin,
)
from app.api.v1.clinical import constants as C

router = APIRouter(prefix="/clinical/icd10", tags=["Clinical ICD-10"])

CMS_ZIP_URL = "https://www.cms.gov/files/zip/2026-code-descriptions-tabular-order.zip"
ORDER_FILE_HINT = "icd10cm_order_"

_LEFT = re.compile(r"\bleft\b", re.I)
_RIGHT = re.compile(r"\bright\b", re.I)


def _side_from_description(description: str):
    left, right = bool(_LEFT.search(description)), bool(_RIGHT.search(description))
    if left and not right:
        return "left"
    if right and not left:
        return "right"
    return None


def _family(code: str) -> str:
    return code[:4]


# ── search ───────────────────────────────────────────────────────────────────

@router.get(
    "/search",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))],
)
async def search_codes(
    q: str = Query(min_length=2, max_length=80),
    limit: int = Query(default=15, le=50),
    db: AsyncSession = Depends(get_db_for_tenant),
):
    code_q = q.replace(".", "").upper()
    rows = (await db.execute(text("""
        SELECT code, code_dotted, description, billable
        FROM icd10_codes
        WHERE code LIKE :code_pfx OR lower(description) LIKE :desc
        ORDER BY billable DESC, (code LIKE :code_pfx) DESC, length(code) ASC, code ASC
        LIMIT :lim
    """), {"code_pfx": code_q + "%", "desc": f"%{q.lower()}%", "lim": limit})).mappings().all()
    return [dict(r) for r in rows]


# ── patient diagnoses ────────────────────────────────────────────────────────

class DiagnosisIn(BaseModel):
    icd10_code: str = Field(max_length=8)
    rank: int = Field(default=2, ge=1, le=25)
    onset_date: date | None = None


@router.get(
    "/patients/{patient_id}/diagnoses",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))],
)
async def list_diagnoses(
    patient_id: UUID,
    db: AsyncSession = Depends(get_db_for_tenant),
):
    rows = (await db.execute(text("""
        SELECT d.id, d.icd10_code, c.code_dotted, c.description, c.billable,
               d.rank, d.onset_date, d.resolved_date, d.created_at
        FROM patient_diagnoses d
        JOIN icd10_codes c ON c.code = d.icd10_code
        WHERE d.patient_id = :pid
        ORDER BY (d.resolved_date IS NULL) DESC, d.rank, d.created_at
    """), {"pid": str(patient_id)})).mappings().all()
    return [dict(r) for r in rows]


@router.post(
    "/patients/{patient_id}/diagnoses",
    status_code=201,
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def add_diagnosis(
    patient_id: UUID,
    body: DiagnosisIn,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    code = body.icd10_code.replace(".", "").upper()

    ref = (await db.execute(
        text("SELECT description, billable FROM icd10_codes WHERE code = :c"),
        {"c": code})).mappings().first()
    if not ref:
        raise HTTPException(422, f"{body.icd10_code} is not in the loaded ICD-10 set")
    if body.rank == 1 and not ref["billable"]:
        raise HTTPException(422,
            f"{body.icd10_code} is a non-billable header code and cannot be the "
            "primary diagnosis — choose a more specific child code")

    warnings: list[str] = []
    side = _side_from_description(ref["description"])
    if side:
        others = (await db.execute(text("""
            SELECT d.icd10_code, c.description
            FROM patient_diagnoses d JOIN icd10_codes c ON c.code = d.icd10_code
            WHERE d.patient_id = :pid AND d.resolved_date IS NULL
              AND d.icd10_code LIKE :fam
        """), {"pid": str(patient_id), "fam": _family(code) + "%"})).mappings().all()
        for o in others:
            oside = _side_from_description(o["description"])
            if oside and oside != side:
                warnings.append(
                    f"Laterality check: {o['icd10_code']} ({oside}) is already active "
                    f"in the same family — confirm this new {side}-sided code is a "
                    "distinct site, not a transcription error")

    try:
        row = (await db.execute(text("""
            INSERT INTO patient_diagnoses
                (organization_id, patient_id, icd10_code, rank, onset_date, added_by)
            VALUES (:org, :pid, :code, :rank, :onset, :uid)
            RETURNING id
        """), {"org": str(current_user.organization_id), "pid": str(patient_id),
               "code": code, "rank": body.rank,
               "onset": body.onset_date, "uid": str(current_user.user_id)})).mappings().first()
    except IntegrityError as e:
        msg = str(e.orig)
        if "uq_pdx_one_primary" in msg:
            raise HTTPException(409, "This patient already has an active primary "
                                     "diagnosis. Resolve or re-rank it first.")
        if "uq_pdx_active_code" in msg:
            raise HTTPException(409, "That code is already active for this patient.")
        raise

    await audit.log(
        C.DX_ADDED, f"Added diagnosis {code} (rank {body.rank})",
        patient_id=patient_id, resource_type="patient_diagnosis",
        resource_id=row["id"],
        new_state={"code": code, "rank": body.rank})
    return {"id": row["id"], "warnings": warnings}


@router.patch(
    "/diagnoses/{dx_id}/resolve",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def resolve_diagnosis(
    dx_id: UUID,
    resolved_date: date | None = None,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    prev = (await db.execute(
        text("SELECT patient_id, icd10_code, rank FROM patient_diagnoses WHERE id = :id"),
        {"id": str(dx_id)})).mappings().first()
    if not prev:
        raise HTTPException(404, "Diagnosis not found")
    await db.execute(text("""
        UPDATE patient_diagnoses SET resolved_date = COALESCE(:d, CURRENT_DATE)
        WHERE id = :id
    """), {"d": resolved_date, "id": str(dx_id)})
    await audit.log(
        C.DX_RESOLVED, f"Resolved diagnosis {prev['icd10_code']}",
        patient_id=prev["patient_id"], resource_type="patient_diagnosis",
        resource_id=dx_id,
        previous_state={"code": prev["icd10_code"], "rank": prev["rank"]},
        new_state={"resolved_date": str(resolved_date or date.today())})
    return {"ok": True}


# ── code-set import (admin) ──────────────────────────────────────────────────

def parse_order_file(text_data: str, year: int) -> list[dict]:
    """CMS fixed-width order file: cols 7-13 code, col 15 billable (0/1),
    col 78+ long description."""
    out = []
    for line in text_data.splitlines():
        if len(line) < 78:
            continue
        code = line[6:13].strip()
        billable = line[14:15].strip() == "1"
        desc = line[77:].strip()
        if not code or not desc:
            continue
        dotted = code if len(code) <= 3 else f"{code[:3]}.{code[3:]}"
        out.append({"code": code, "code_dotted": dotted, "description": desc,
                    "billable": billable, "effective_year": year})
    return out


@router.post("/import", dependencies=[Depends(require_admin)])
async def import_codes(
    year: int = 2026,
    file: UploadFile | None = None,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Admin-only. No file → fetch the CMS zip server-side (one click for a
    browser-only workflow). File upload = fallback if the CMS URL moves."""
    if file is not None:
        raw = await file.read()
    else:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(CMS_ZIP_URL, follow_redirects=True)
            if resp.status_code != 200:
                raise HTTPException(502,
                    f"CMS returned {resp.status_code} — download the zip from cms.gov "
                    "and re-POST it as a file upload")
            raw = resp.content

    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        name = next((n for n in z.namelist()
                     if ORDER_FILE_HINT in n.lower() and n.lower().endswith(".txt")), None)
        if not name:
            raise HTTPException(422, f"No {ORDER_FILE_HINT}*.txt in zip: {z.namelist()[:8]}")
        data = z.read(name).decode("utf-8", errors="replace")

    records = parse_order_file(data, year)
    if len(records) < 60_000:
        raise HTTPException(422,
            f"Parsed only {len(records)} codes — format may have shifted; aborting "
            "rather than loading a partial code set")

    await db.execute(text("DELETE FROM icd10_codes"))
    CHUNK = 500
    for i in range(0, len(records), CHUNK):
        chunk = records[i:i + CHUNK]
        await db.execute(text("""
            INSERT INTO icd10_codes (code, code_dotted, description, billable, effective_year)
            VALUES (:code, :code_dotted, :description, :billable, :effective_year)
        """), chunk)

    await audit.log(C.ICD_IMPORTED,
                    f"Imported ICD-10 code set ({len(records)} codes, {year})",
                    resource_type="icd10_codes")
    return {"loaded": len(records), "year": year, "source_file": name}
