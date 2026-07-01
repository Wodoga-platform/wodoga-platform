"""
Wodoga Platform — Access Control Integration Tests
====================================================

WHAT THESE PROVE (plain English):
These tests verify that the role-permission decisions from the access
control audit (PERMISSION_AUDIT_V2.md) are actually true in the database.
They check the real `roles` table — so if a future migration or seed
change silently re-grants a permission we deliberately revoked, these
tests fail and warn us.

Specifically they confirm:
  - Caregiver does NOT have patients:edit, intake_forms:create, visits:create
  - Pharmacy_staff does NOT have medications:reconcile
  - Biller does NOT have any clinical-view permissions (visits, vitals, meds)
  - Provider DOES have the clinical permissions they need
  - The soft-delete attribution columns exist

These need a database with seed.sql applied. Run:
    pytest tests/test_access_control.py -v

If a role isn't present in the test DB, the relevant test skips rather
than fails (so a bare schema-only DB doesn't produce false failures).
"""
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession


async def _role_permissions(engine, role_name: str) -> set[str] | None:
    """Fetch the permissions array for a role as a set. None if role absent."""
    SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        row = (await s.execute(
            text("SELECT permissions FROM roles WHERE name = :n LIMIT 1"),
            {"n": role_name},
        )).first()
        if row is None:
            return None
        perms = row[0]
        # permissions is JSONB array → comes back as a Python list
        return set(perms) if isinstance(perms, list) else set()


# ────────────────────────────────────────────────────────────
# Caregiver — the role we tightened the most
# ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_caregiver_cannot_edit_patients(engine):
    """Migration 0002 revoked patients:edit from caregiver."""
    perms = await _role_permissions(engine, "caregiver")
    if perms is None:
        pytest.skip("caregiver role not in test DB")
    assert "patients:edit" not in perms, \
        "REGRESSION: caregiver regained patients:edit (audit Critical #2)"


@pytest.mark.asyncio
async def test_caregiver_cannot_create_intake(engine):
    """Migration 0003 revoked intake_forms:create from caregiver."""
    perms = await _role_permissions(engine, "caregiver")
    if perms is None:
        pytest.skip("caregiver role not in test DB")
    assert "intake_forms:create" not in perms, \
        "REGRESSION: caregiver regained intake_forms:create"


@pytest.mark.asyncio
async def test_caregiver_cannot_create_visits(engine):
    """Migration 0005 revoked visits:create from caregiver."""
    perms = await _role_permissions(engine, "caregiver")
    if perms is None:
        pytest.skip("caregiver role not in test DB")
    assert "visits:create" not in perms, \
        "REGRESSION: caregiver regained visits:create"


@pytest.mark.asyncio
async def test_caregiver_keeps_essential_permissions(engine):
    """Revokes shouldn't have stripped what caregivers legitimately need."""
    perms = await _role_permissions(engine, "caregiver")
    if perms is None:
        pytest.skip("caregiver role not in test DB")
    for needed in ("patients:view", "visits:checkin", "visits:soap_note",
                   "vitals:create", "medications:view"):
        assert needed in perms, f"caregiver lost essential permission {needed}"


# ────────────────────────────────────────────────────────────
# Pharmacy staff
# ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_pharmacy_cannot_reconcile(engine):
    """Migration 0004 revoked medications:reconcile from pharmacy_staff
    (clinical judgment belongs to the prescriber)."""
    perms = await _role_permissions(engine, "pharmacy_staff")
    if perms is None:
        pytest.skip("pharmacy_staff role not in test DB")
    assert "medications:reconcile" not in perms, \
        "REGRESSION: pharmacy_staff regained medications:reconcile"


@pytest.mark.asyncio
async def test_pharmacy_keeps_order_permissions(engine):
    """Pharmacy still needs its order-fulfillment permissions."""
    perms = await _role_permissions(engine, "pharmacy_staff")
    if perms is None:
        pytest.skip("pharmacy_staff role not in test DB")
    for needed in ("pharm_orders:view", "pharm_orders:create",
                   "pharm_orders:advance", "medications:view"):
        assert needed in perms, f"pharmacy_staff lost essential permission {needed}"


# ────────────────────────────────────────────────────────────
# Biller — must not have clinical-view permissions
# ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_biller_has_no_clinical_permissions(engine):
    """A biller needs billing + patient identifiers, NOT clinical data.
    This is the permission-level half of Critical #1 (the other half is
    the field-filtering in the endpoint)."""
    perms = await _role_permissions(engine, "biller")
    if perms is None:
        pytest.skip("biller role not in test DB")
    for forbidden in ("visits:view", "vitals:view", "medications:view",
                      "care_plans:view", "oasis:view"):
        assert forbidden not in perms, \
            f"biller should NOT have {forbidden} (HIPAA minimum-necessary)"


@pytest.mark.asyncio
async def test_biller_keeps_billing_permissions(engine):
    """Biller still needs to actually do billing."""
    perms = await _role_permissions(engine, "biller")
    if perms is None:
        pytest.skip("biller role not in test DB")
    for needed in ("billing:view", "billing:create", "patients:view"):
        assert needed in perms, f"biller lost essential permission {needed}"


# ────────────────────────────────────────────────────────────
# Provider — should retain full clinical access
# ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_provider_has_clinical_permissions(engine):
    """Providers must keep the permissions that let them do clinical work."""
    perms = await _role_permissions(engine, "provider")
    if perms is None:
        pytest.skip("provider role not in test DB")
    for needed in ("patients:view", "visits:create", "medications:prescribe",
                   "care_plans:create", "vitals:create"):
        assert needed in perms, f"provider lost essential permission {needed}"


# ────────────────────────────────────────────────────────────
# Soft-delete attribution columns (migration 0006)
# ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_soft_delete_attribution_columns_exist(engine):
    """Migration 0006 added deleted_by / cancelled_by for audit attribution."""
    SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    expected = [("patients", "deleted_by"), ("documents", "deleted_by"),
                ("visits", "cancelled_by")]
    async with SessionLocal() as s:
        for table, col in expected:
            row = (await s.execute(
                text("""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = :t AND column_name = :c
                """),
                {"t": table, "c": col},
            )).first()
            assert row is not None, \
                f"Missing attribution column {table}.{col} (migration 0006)"
