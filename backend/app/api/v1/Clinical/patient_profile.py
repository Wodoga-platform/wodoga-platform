"""
Wodoga Platform — Patient Profile extensions.
Path: backend/app/api/v1/clinical/patient_profile.py

Contacts (NOK/POA), code status, holds, payer type, preferred pharmacy.

PHI posture mirrors patients.py: contact phone/phone_alt/email/address and
hold location_detail are encrypted with enc_scalar/dec_scalar; names, roles,
dates and enums stay plaintext (the columns lists must scan/sort/filter on).
"""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLogger
from app.core.permissions import Permission, TokenPayload, require_permissions
from app.core.phi_crypto import enc_scalar, dec_scalar
from app.dependencies import (
    get_audit_logger,
    get_current_user_payload,
    get_db_for_tenant,
)
from app.api.v1.clinical import constants as C

router = APIRouter(prefix="/clinical", tags=["Clinical Patient Profile"])

# ═══════════════════════════ CONTACTS ════════════════════════════════════════

CONTACT_ROLES = {"emergency", "next_of_kin", "poa_healthcare",
                 "poa_financial", "guardian", "other"}
LEGAL_ROLES = {"poa_healthcare", "poa_financial", "guardian"}


class ContactIn(BaseModel):
    role: str
    full_name: str = Field(min_length=1, max_length=120)
    relationship: str | None = None
    priority: int = Field(default=1, ge=1, le=9)
    phone: str | None = None
    phone_alt: str | None = None
    email: str | None = None
    address: str | None = None
    doc_on_file: bool = False
    notes: str | None = None


@router.get(
    "/patients/{patient_id}/contacts",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))],
)
async def list_contacts(patient_id: UUID, db: AsyncSession = Depends(get_db_for_tenant)):
    rows = (await db.execute(text("""
        SELECT id, role, priority, full_name, relationship, phone, phone_alt,
               email, address, doc_on_file, notes, created_at
        FROM patient_contacts WHERE patient_id = :pid AND is_active
        ORDER BY role, priority
    """), {"pid": str(patient_id)})).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        for f in ("phone", "phone_alt", "email", "address"):
            d[f] = dec_scalar(d[f])
        d["legal_warning"] = (d["role"] in LEGAL_ROLES and not d["doc_on_file"])
        out.append(d)
    return out


@router.post(
    "/patients/{patient_id}/contacts",
    status_code=201,
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def add_contact(
    patient_id: UUID,
    body: ContactIn,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    if body.role not in CONTACT_ROLES:
        raise HTTPException(422, f"role must be one of {sorted(CONTACT_ROLES)}")
    row = (await db.execute(text("""
        INSERT INTO patient_contacts
            (organization_id, patient_id, role, priority, full_name, relationship,
             phone, phone_alt, email, address, doc_on_file, notes)
        VALUES (:org, :pid, :role, :prio, :name, :rel,
                :phone, :phone_alt, :email, :addr, :doc, :notes)
        RETURNING id
    """), {"org": str(current_user.organization_id), "pid": str(patient_id),
           "role": body.role, "prio": body.priority, "name": body.full_name,
           "rel": body.relationship, "phone": enc_scalar(body.phone),
           "phone_alt": enc_scalar(body.phone_alt), "email": enc_scalar(body.email),
           "addr": enc_scalar(body.address), "doc": body.doc_on_file,
           "notes": body.notes})).mappings().first()
    await audit.log(
        C.CONTACT_ADDED, f"Added {body.role} contact",
        patient_id=patient_id, resource_type="patient_contact", resource_id=row["id"],
        new_state={"role": body.role, "full_name": body.full_name,
                   "doc_on_file": body.doc_on_file})
    return {"id": row["id"],
            "legal_warning": body.role in LEGAL_ROLES and not body.doc_on_file}


@router.patch(
    "/contacts/{contact_id}",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def update_contact(
    contact_id: UUID,
    body: ContactIn,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    prev = (await db.execute(text("""
        SELECT patient_id, role, full_name, doc_on_file
        FROM patient_contacts WHERE id = :id AND is_active
    """), {"id": str(contact_id)})).mappings().first()
    if not prev:
        raise HTTPException(404, "Contact not found")
    if body.role not in CONTACT_ROLES:
        raise HTTPException(422, f"role must be one of {sorted(CONTACT_ROLES)}")
    await db.execute(text("""
        UPDATE patient_contacts
        SET role=:role, priority=:prio, full_name=:name, relationship=:rel,
            phone=:phone, phone_alt=:phone_alt, email=:email, address=:addr,
            doc_on_file=:doc, notes=:notes, updated_at=NOW()
        WHERE id = :id
    """), {"role": body.role, "prio": body.priority, "name": body.full_name,
           "rel": body.relationship, "phone": enc_scalar(body.phone),
           "phone_alt": enc_scalar(body.phone_alt), "email": enc_scalar(body.email),
           "addr": enc_scalar(body.address), "doc": body.doc_on_file,
           "notes": body.notes, "id": str(contact_id)})
    await audit.log(
        C.CONTACT_UPDATED, f"Updated {body.role} contact",
        patient_id=prev["patient_id"], resource_type="patient_contact",
        resource_id=contact_id,
        previous_state={"role": prev["role"], "full_name": prev["full_name"],
                        "doc_on_file": prev["doc_on_file"]},
        new_state={"role": body.role, "full_name": body.full_name,
                   "doc_on_file": body.doc_on_file})
    return {"ok": True}


@router.delete(
    "/contacts/{contact_id}",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def deactivate_contact(
    contact_id: UUID,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Soft delete — contact history is part of the record. (The app role has
    no SQL DELETE grant; this is an UPDATE.)"""
    prev = (await db.execute(text("""
        SELECT patient_id, role, full_name FROM patient_contacts WHERE id = :id
    """), {"id": str(contact_id)})).mappings().first()
    if not prev:
        raise HTTPException(404, "Contact not found")
    await db.execute(text("""
        UPDATE patient_contacts SET is_active = FALSE, updated_at = NOW() WHERE id = :id
    """), {"id": str(contact_id)})
    await audit.log(
        C.CONTACT_REMOVED, f"Deactivated {prev['role']} contact",
        patient_id=prev["patient_id"], resource_type="patient_contact",
        resource_id=contact_id,
        previous_state={"role": prev["role"], "full_name": prev["full_name"]},
        new_state={"is_active": False})
    return {"ok": True}


# ═══════════════════════════ CODE STATUS ═════════════════════════════════════

CODE_STATUSES = {"full_code", "dnr", "dni", "dnr_dni", "comfort_care"}
CS_SOURCES = {"polst_most", "living_will", "verbal_patient", "verbal_surrogate",
              "chart_review", "other"}


class CodeStatusIn(BaseModel):
    code_status: str
    source: str
    verified_on: date | None = None


@router.put(
    "/patients/{patient_id}/code-status",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def set_code_status(
    patient_id: UUID,
    body: CodeStatusIn,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """PUT-only, no DELETE: a code status can be corrected or re-verified but
    never silently un-documented. Every change is audited — code status is
    exactly what discovery reads."""
    if body.code_status not in CODE_STATUSES:
        raise HTTPException(422, f"code_status must be one of {sorted(CODE_STATUSES)}")
    if body.source not in CS_SOURCES:
        raise HTTPException(422, f"source must be one of {sorted(CS_SOURCES)}")
    prev = (await db.execute(text("""
        SELECT code_status, code_status_source, code_status_verified_on
        FROM patients WHERE id = :pid
    """), {"pid": str(patient_id)})).mappings().first()
    if not prev:
        raise HTTPException(404, "Patient not found")
    verified = body.verified_on or date.today()
    await db.execute(text("""
        UPDATE patients
        SET code_status = :cs, code_status_source = :src,
            code_status_verified_on = :von, code_status_verified_by = :uid,
            updated_at = NOW()
        WHERE id = :pid
    """), {"cs": body.code_status, "src": body.source, "von": verified,
           "uid": str(current_user.user_id), "pid": str(patient_id)})
    await audit.log(
        C.CODE_STATUS_SET, f"Set code status to {body.code_status}",
        patient_id=patient_id, resource_type="patient_code_status",
        resource_id=patient_id,
        previous_state={k: str(v) for k, v in prev.items()},
        new_state={"code_status": body.code_status, "source": body.source,
                   "verified_on": str(verified)})
    return {"ok": True, "verified_on": str(verified)}


# ═══════════════════════════ HOLDS ═══════════════════════════════════════════

HOLD_TYPES = {"hospitalized", "snf_rehab", "incarcerated", "travel",
              "family_request", "refused_services", "unsafe_environment", "other"}


class HoldIn(BaseModel):
    hold_type: str
    started_on: date
    location_detail: str | None = None
    expected_return: date | None = None
    billing_note: str | None = None


@router.get(
    "/patients/{patient_id}/holds",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))],
)
async def list_holds(patient_id: UUID, db: AsyncSession = Depends(get_db_for_tenant)):
    rows = (await db.execute(text("""
        SELECT id, hold_type, location_detail, started_on, expected_return,
               ended_on, billing_note, created_at
        FROM patient_holds WHERE patient_id = :pid ORDER BY started_on DESC
    """), {"pid": str(patient_id)})).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        d["location_detail"] = dec_scalar(d["location_detail"])
        d["active"] = d["ended_on"] is None
        out.append(d)
    return out


@router.post(
    "/patients/{patient_id}/holds",
    status_code=201,
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def start_hold(
    patient_id: UUID,
    body: HoldIn,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    if body.hold_type not in HOLD_TYPES:
        raise HTTPException(422, f"hold_type must be one of {sorted(HOLD_TYPES)}")
    try:
        row = (await db.execute(text("""
            INSERT INTO patient_holds
                (organization_id, patient_id, hold_type, location_detail,
                 started_on, expected_return, billing_note, created_by)
            VALUES (:org, :pid, :type, :loc, :start, :ret, :bnote, :uid)
            RETURNING id
        """), {"org": str(current_user.organization_id), "pid": str(patient_id),
               "type": body.hold_type, "loc": enc_scalar(body.location_detail),
               "start": body.started_on, "ret": body.expected_return,
               "bnote": body.billing_note,
               "uid": str(current_user.user_id)})).mappings().first()
    except IntegrityError as e:
        if "uq_holds_one_active" in str(e.orig):
            raise HTTPException(409,
                "Patient already has an active hold — end it before starting another.")
        raise
    await audit.log(
        C.HOLD_STARTED, f"Started hold: {body.hold_type}",
        patient_id=patient_id, resource_type="patient_hold", resource_id=row["id"],
        new_state={"hold_type": body.hold_type, "started_on": str(body.started_on)})
    return {"id": row["id"]}


@router.patch(
    "/holds/{hold_id}/end",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def end_hold(
    hold_id: UUID,
    ended_on: date | None = None,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    prev = (await db.execute(text("""
        SELECT patient_id, hold_type, started_on FROM patient_holds
        WHERE id = :id AND ended_on IS NULL
    """), {"id": str(hold_id)})).mappings().first()
    if not prev:
        raise HTTPException(404, "No active hold with that id")
    end = ended_on or date.today()
    await db.execute(
        text("UPDATE patient_holds SET ended_on = :e WHERE id = :id"),
        {"e": end, "id": str(hold_id)})
    await audit.log(
        C.HOLD_ENDED, f"Ended hold: {prev['hold_type']}",
        patient_id=prev["patient_id"], resource_type="patient_hold", resource_id=hold_id,
        previous_state={"hold_type": prev["hold_type"],
                        "started_on": str(prev["started_on"])},
        new_state={"ended_on": str(end)})
    return {"ok": True}


# ═══════════════════ PAYER + PHARMACY ════════════════════════════════════════

PAYER_TYPES = {"medicare", "medicare_advantage", "medicaid", "commercial",
               "private_pay", "va_champva", "workers_comp", "other"}


@router.put(
    "/patients/{patient_id}/payer",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def set_payer(
    patient_id: UUID,
    payer_type: str,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    if payer_type not in PAYER_TYPES:
        raise HTTPException(422, f"payer_type must be one of {sorted(PAYER_TYPES)}")
    prev = (await db.execute(
        text("SELECT payer_type FROM patients WHERE id = :pid"),
        {"pid": str(patient_id)})).mappings().first()
    if not prev:
        raise HTTPException(404, "Patient not found")
    await db.execute(
        text("UPDATE patients SET payer_type = :pt, updated_at = NOW() WHERE id = :pid"),
        {"pt": payer_type, "pid": str(patient_id)})
    await audit.log(
        C.PAYER_SET, f"Set payer type to {payer_type}",
        patient_id=patient_id, resource_type="patient_payer", resource_id=patient_id,
        previous_state={"payer_type": prev["payer_type"]},
        new_state={"payer_type": payer_type})
    return {"ok": True}


class PharmacyIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    phone: str | None = None
    fax: str | None = None
    address_line1: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None
    npi: str | None = None


@router.get(
    "/pharmacies",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_VIEW))],
)
async def list_pharmacies(db: AsyncSession = Depends(get_db_for_tenant)):
    rows = (await db.execute(text("""
        SELECT id, name, phone, fax, address_line1, city, state, zip, npi
        FROM pharmacies WHERE is_active ORDER BY name
    """))).mappings().all()
    return [dict(r) for r in rows]


@router.post(
    "/pharmacies",
    status_code=201,
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def add_pharmacy(
    body: PharmacyIn,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    row = (await db.execute(text("""
        INSERT INTO pharmacies
            (organization_id, name, phone, fax, address_line1, city, state, zip, npi)
        VALUES (:org, :name, :phone, :fax, :a1, :city, :state, :zip, :npi)
        RETURNING id
    """), {"org": str(current_user.organization_id), "name": body.name,
           "phone": body.phone, "fax": body.fax, "a1": body.address_line1,
           "city": body.city, "state": body.state, "zip": body.zip,
           "npi": body.npi})).mappings().first()
    await audit.log(C.PHARMACY_ADDED, f"Added pharmacy {body.name}",
                    resource_type="pharmacy", resource_id=row["id"])
    return {"id": row["id"]}


@router.put(
    "/patients/{patient_id}/preferred-pharmacy",
    dependencies=[Depends(require_permissions(Permission.PATIENTS_EDIT))],
)
async def set_preferred_pharmacy(
    patient_id: UUID,
    pharmacy_id: UUID | None = None,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    if pharmacy_id:
        ph = (await db.execute(
            text("SELECT id FROM pharmacies WHERE id = :id AND is_active"),
            {"id": str(pharmacy_id)})).mappings().first()
        if not ph:
            raise HTTPException(404, "Pharmacy not found")
    await db.execute(text("""
        UPDATE patients SET preferred_pharmacy_id = :ph, updated_at = NOW() WHERE id = :pid
    """), {"ph": str(pharmacy_id) if pharmacy_id else None, "pid": str(patient_id)})
    await audit.log(
        C.PREF_PHARMACY_SET, "Set preferred pharmacy",
        patient_id=patient_id, resource_type="patient_preferred_pharmacy",
        resource_id=patient_id,
        new_state={"pharmacy_id": str(pharmacy_id) if pharmacy_id else None})
    return {"ok": True}

# Profile photos (#9) need no endpoint here: patients.photo_url and
# users.profile_photo_url already exist. The frontend renders initials until
# those are populated. Actual photo UPLOAD waits for Azure blob under the BAA
# — do not wire uploads to Railway volumes or Vercel as a stopgap.
