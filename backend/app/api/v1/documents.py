"""
Wodoga Platform — Patient Documents & Images

Secure upload, listing, viewing, and deletion of patient documents
(wound-care photos, scanned forms, etc.). Files live in a private Azure
Blob container; viewing is via short-lived SAS URLs. Every action is audited.
"""

from uuid import UUID

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, UploadFile, status,
)
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.audit import AuditAction, AuditLogger
from app.core.permissions import Permission, TokenPayload, require_permissions
from app.dependencies import (
    get_audit_logger, get_current_user_payload, get_db_for_tenant,
)

router = APIRouter(prefix="/documents", tags=["Documents"])

# document_type values permitted by the documents table CHECK constraint
VALID_DOC_TYPES = {
    "intake_form", "physician_order", "insurance_card", "prescription",
    "lab_result", "imaging", "consent_form", "care_plan",
    "referral_document", "id_document", "other",
}


@router.get(
    "/storage-status",
    dependencies=[Depends(require_permissions(Permission.DOCUMENTS_VIEW))],
)
async def storage_status():
    """Tells the frontend whether blob storage is wired up yet."""
    return {"data": {"configured": storage.is_storage_configured()}}


@router.get(
    "/patient/{patient_id}",
    dependencies=[Depends(require_permissions(Permission.DOCUMENTS_VIEW))],
)
async def list_patient_documents(
    patient_id: UUID,
    db: AsyncSession = Depends(get_db_for_tenant),
):
    """List all active documents for a patient (metadata only, no file bytes)."""
    result = await db.execute(
        text("""
            SELECT d.id, d.document_type, d.file_name, d.mime_type,
                   d.file_size_bytes, d.description, d.tags, d.created_at,
                   CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
            FROM documents d
            LEFT JOIN users u ON u.id = d.uploaded_by
            WHERE d.patient_id = :pid AND d.is_active = TRUE
            ORDER BY d.created_at DESC
        """),
        {"pid": str(patient_id)},
    )
    return {"data": [dict(r) for r in result.mappings().all()]}


@router.post(
    "/patient/{patient_id}",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permissions(Permission.DOCUMENTS_UPLOAD))],
)
async def upload_patient_document(
    patient_id: UUID,
    file: UploadFile = File(...),
    document_type: str = Form("imaging"),
    description: str = Form(""),
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Upload a wound-care photo or clinical document for a patient."""
    if document_type not in VALID_DOC_TYPES:
        document_type = "other"

    # Confirm patient exists in this org
    p = await db.execute(
        text("SELECT first_name, last_name FROM patients WHERE id = :id AND deleted_at IS NULL"),
        {"id": str(patient_id)},
    )
    patient = p.mappings().first()
    if not patient:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    content = await file.read()
    mime = file.content_type or "application/octet-stream"
    storage.validate_upload(content, mime)

    meta = storage.upload_document(
        content=content,
        original_filename=file.filename or "upload",
        mime_type=mime,
        organization_id=str(current_user.organization_id),
        patient_id=str(patient_id),
    )

    result = await db.execute(
        text("""
            INSERT INTO documents (
                organization_id, patient_id, uploaded_by,
                document_type, file_name, file_name_stored,
                blob_container, blob_path, file_size_bytes,
                mime_type, checksum_sha256, is_encrypted,
                is_scanned, scan_result, description
            ) VALUES (
                :org, :patient, :by,
                :dtype, :fname, :stored,
                :container, :path, :size,
                :mime, :checksum, TRUE,
                FALSE, 'pending', :desc
            ) RETURNING id, file_name, document_type, mime_type, created_at
        """),
        {
            "org": str(current_user.organization_id),
            "patient": str(patient_id),
            "by": str(current_user.user_id),
            "dtype": document_type,
            "fname": file.filename or "upload",
            "stored": meta["file_name_stored"],
            "container": meta["blob_container"],
            "path": meta["blob_path"],
            "size": meta["file_size_bytes"],
            "mime": meta["mime_type"],
            "checksum": meta["checksum_sha256"],
            "desc": description or None,
        },
    )
    doc = result.mappings().first()

    await audit.log(
        AuditAction.DOCUMENT_UPLOADED,
        f"Uploaded {document_type.replace('_', ' ')}: {file.filename} "
        f"for {patient['first_name']} {patient['last_name']}",
        patient_id=patient_id, resource_type="document", resource_id=doc["id"],
    )
    return {"data": dict(doc), "message": "Document uploaded."}


@router.get(
    "/{document_id}/url",
    dependencies=[Depends(require_permissions(Permission.DOCUMENTS_VIEW))],
)
async def get_document_url(
    document_id: UUID,
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Return a short-lived SAS URL to view/download a document."""
    result = await db.execute(
        text("""
            SELECT id, patient_id, blob_container, blob_path, file_name, mime_type
            FROM documents WHERE id = :id AND is_active = TRUE
        """),
        {"id": str(document_id)},
    )
    doc = result.mappings().first()
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    url = storage.generate_view_url(doc["blob_path"], doc["blob_container"])

    await audit.log(
        AuditAction.DOCUMENT_VIEWED,
        f"Viewed document: {doc['file_name']}",
        patient_id=doc["patient_id"], resource_type="document", resource_id=document_id,
    )
    return {"data": {"url": url, "file_name": doc["file_name"], "mime_type": doc["mime_type"]}}


@router.delete(
    "/{document_id}",
    dependencies=[Depends(require_permissions(Permission.DOCUMENTS_UPLOAD))],
)
async def delete_document(
    document_id: UUID,
    current_user: TokenPayload = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db_for_tenant),
    audit: AuditLogger = Depends(get_audit_logger),
):
    """Soft-delete a document and remove the blob."""
    result = await db.execute(
        text("SELECT id, patient_id, blob_container, blob_path, file_name FROM documents WHERE id = :id"),
        {"id": str(document_id)},
    )
    doc = result.mappings().first()
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    await db.execute(
        text("UPDATE documents SET is_active = FALSE, deleted_at = NOW(), deleted_by = :uid WHERE id = :id"),
        {"id": str(document_id), "uid": str(current_user.user_id)},
    )
    storage.delete_document(doc["blob_path"], doc["blob_container"])

    await audit.log(
        AuditAction.DOCUMENT_DELETED,
        f"Deleted document: {doc['file_name']}",
        patient_id=doc["patient_id"], resource_type="document", resource_id=document_id,
    )
    return {"data": {"deleted": True}, "message": "Document deleted."}
