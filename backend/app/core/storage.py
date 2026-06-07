"""
Wodoga Platform — Blob Storage helper

Wraps Azure Blob Storage for secure, HIPAA-conscious document handling:
- Private container (no public access)
- Server-side upload (file bytes never bypass our audit/validation)
- Short-lived SAS URLs for viewing (time-limited, read-only)

The module is intentionally thin and provider-specific details are isolated
here, so a future swap to S3/R2 only touches this file.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status

from app.config import get_settings

settings = get_settings()

# Allowed upload types: wound-care photos and scanned clinical documents
ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic",
    "application/pdf",
}
MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB per file


def _client():
    """Return an Azure BlobServiceClient, or raise a clear error if unconfigured."""
    if not settings.azure_storage_connection_string:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "storage_not_configured",
                "message": "Document storage is not yet configured. "
                           "Add AZURE_STORAGE_CONNECTION_STRING to enable uploads.",
            },
        )
    # Imported lazily so the app still boots if the package/config is absent
    from azure.storage.blob import BlobServiceClient
    return BlobServiceClient.from_connection_string(settings.azure_storage_connection_string)


def is_storage_configured() -> bool:
    return bool(settings.azure_storage_connection_string)


def validate_upload(content: bytes, mime_type: str) -> None:
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "unsupported_type",
                    "message": f"File type '{mime_type}' is not allowed. "
                               "Upload an image (JPG, PNG, WEBP, HEIC) or PDF."},
        )
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "file_too_large",
                    "message": "File exceeds the 25 MB limit."},
        )
    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "empty_file", "message": "The uploaded file is empty."},
        )


def upload_document(
    content: bytes,
    original_filename: str,
    mime_type: str,
    organization_id: str,
    patient_id: str,
) -> dict:
    """
    Upload bytes to the private documents container.
    Returns metadata to persist in the documents table.
    """
    container = settings.azure_storage_container_documents
    # Path keeps each org and patient isolated within the container
    ext = original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else "bin"
    stored_name = f"{uuid.uuid4()}.{ext}"
    blob_path = f"{organization_id}/{patient_id}/{stored_name}"
    checksum = hashlib.sha256(content).hexdigest()

    from azure.storage.blob import ContentSettings
    svc = _client()

    # Ensure the container exists and is private
    container_client = svc.get_container_client(container)
    try:
        container_client.create_container()
    except Exception:
        pass  # already exists

    blob_client = svc.get_blob_client(container=container, blob=blob_path)
    blob_client.upload_blob(
        content,
        overwrite=True,
        content_settings=ContentSettings(content_type=mime_type),
    )

    return {
        "file_name_stored": stored_name,
        "blob_container": container,
        "blob_path": blob_path,
        "file_size_bytes": len(content),
        "mime_type": mime_type,
        "checksum_sha256": checksum,
    }


def generate_view_url(blob_path: str, blob_container: Optional[str] = None) -> str:
    """Generate a short-lived, read-only SAS URL for viewing a blob."""
    from azure.storage.blob import generate_blob_sas, BlobSasPermissions

    container = blob_container or settings.azure_storage_container_documents
    svc = _client()
    account_name = svc.account_name
    account_key = svc.credential.account_key

    expiry = datetime.now(timezone.utc) + timedelta(
        hours=settings.azure_storage_sas_token_expiry_hours
    )
    sas = generate_blob_sas(
        account_name=account_name,
        container_name=container,
        blob_name=blob_path,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=expiry,
    )
    return f"https://{account_name}.blob.core.windows.net/{container}/{blob_path}?{sas}"


def delete_document(blob_path: str, blob_container: Optional[str] = None) -> None:
    container = blob_container or settings.azure_storage_container_documents
    svc = _client()
    try:
        svc.get_blob_client(container=container, blob=blob_path).delete_blob()
    except Exception:
        pass  # already gone; the DB soft-delete is the source of truth
