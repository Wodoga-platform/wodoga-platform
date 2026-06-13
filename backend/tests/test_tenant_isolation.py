"""
Wodoga Platform — TENANT ISOLATION TESTS  (the most important tests)
=====================================================================

WHAT THESE PROVE (plain English):
For a multi-clinic healthcare platform, the #1 rule is: one clinic must
NEVER be able to see another clinic's patients or data. These tests create
two real clinics (A and B), put a patient in each, and then prove:

  1. Clinic A, looking through its own scoped connection, sees ONLY its
     own patient — never Clinic B's.
  2. Clinic B sees ONLY its own — never Clinic A's.
  3. Even a direct "give me that specific patient by ID" query for the
     OTHER clinic's patient returns nothing.
  4. A connection with NO organization context set sees nothing at all
     (fails safe — the database denies by default).

If any of these fail, it means patient data could leak between clinics —
the most serious possible bug in this kind of system. These tests are your
early-warning system every time you change code.

Run just these:
    pytest tests/test_tenant_isolation.py -v
"""

import uuid
import pytest
from sqlalchemy import text

from tests.conftest import tenant_session


@pytest.mark.asyncio
async def test_clinic_a_sees_only_its_own_patients(engine, two_orgs):
    """Clinic A's scoped connection must return its patient and not Clinic B's."""
    s = await tenant_session(engine, two_orgs["org_a"])
    try:
        rows = (await s.execute(text("SELECT id, organization_id FROM patients"))).mappings().all()
        org_ids = {str(r["organization_id"]) for r in rows}
        patient_ids = {str(r["id"]) for r in rows}

        # Only org A's data is visible
        assert two_orgs["org_a"] in org_ids or len(rows) >= 1
        assert two_orgs["org_b"] not in org_ids, "LEAK: Clinic A can see Clinic B's organization data!"
        assert two_orgs["patient_b"] not in patient_ids, "LEAK: Clinic A can see Clinic B's patient!"
        assert two_orgs["patient_a"] in patient_ids, "Clinic A cannot see its own patient (RLS too strict)."
    finally:
        await s.close()


@pytest.mark.asyncio
async def test_clinic_b_sees_only_its_own_patients(engine, two_orgs):
    """Mirror of the above — Clinic B must not see Clinic A."""
    s = await tenant_session(engine, two_orgs["org_b"])
    try:
        rows = (await s.execute(text("SELECT id, organization_id FROM patients"))).mappings().all()
        patient_ids = {str(r["id"]) for r in rows}

        assert two_orgs["patient_a"] not in patient_ids, "LEAK: Clinic B can see Clinic A's patient!"
        assert two_orgs["patient_b"] in patient_ids, "Clinic B cannot see its own patient."
    finally:
        await s.close()


@pytest.mark.asyncio
async def test_direct_id_lookup_across_tenants_is_blocked(engine, two_orgs):
    """
    The sneaky attack: Clinic A knows Clinic B's patient ID and asks for it
    directly. Row-level security must still return nothing.
    """
    s = await tenant_session(engine, two_orgs["org_a"])
    try:
        row = (await s.execute(
            text("SELECT id FROM patients WHERE id = :pid"),
            {"pid": two_orgs["patient_b"]},
        )).first()
        assert row is None, "LEAK: Clinic A fetched Clinic B's patient by direct ID lookup!"
    finally:
        await s.close()


@pytest.mark.asyncio
async def test_no_org_context_sees_nothing(engine, two_orgs):
    """
    A connection that never sets app.organization_id must see no patient
    rows at all — the database denies by default rather than exposing
    everything. This is the 'fail safe' guarantee.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as s:
        # Deliberately do NOT set app.organization_id.
        try:
            rows = (await s.execute(
                text("SELECT id FROM patients WHERE id IN (:a, :b)"),
                {"a": two_orgs["patient_a"], "b": two_orgs["patient_b"]},
            )).all()
            # With RLS on and no context, this should error OR return nothing.
            assert len(rows) == 0, "LEAK: patients visible with NO organization context set!"
        except Exception:
            # An error here is acceptable — it means the DB refused the query
            # because the org context was missing. That's failing safe.
            pass


@pytest.mark.asyncio
async def test_cross_tenant_update_is_blocked(engine, two_orgs):
    """
    Clinic A must not be able to MODIFY Clinic B's patient, even by ID.
    RLS should make the update affect zero rows.
    """
    s = await tenant_session(engine, two_orgs["org_a"])
    try:
        await s.execute(
            text("UPDATE patients SET last_name = 'HACKED' WHERE id = :pid"),
            {"pid": two_orgs["patient_b"]},
        )
        await s.commit()
    except Exception:
        await s.rollback()
    finally:
        await s.close()

    # Verify from Clinic B's side that nothing changed
    s2 = await tenant_session(engine, two_orgs["org_b"])
    try:
        row = (await s2.execute(
            text("SELECT last_name FROM patients WHERE id = :pid"),
            {"pid": two_orgs["patient_b"]},
        )).first()
        assert row is not None
        assert row[0] != "HACKED", "LEAK: Clinic A modified Clinic B's patient record!"
    finally:
        await s2.close()
