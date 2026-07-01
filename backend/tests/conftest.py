"""
Wodoga Platform — Test Configuration & Shared Fixtures
=======================================================

WHAT THIS FILE IS (plain English):
Before any test runs, pytest reads this file to set up shared "fixtures" —
reusable pieces every test can ask for, like a database connection or a
pair of test organizations.

The most important fixtures here create TWO separate organizations
("Clinic A" and "Clinic B") so our tenant-isolation tests can prove one
clinic cannot see the other's data.

HOW TO RUN THE TESTS:
  cd backend
  pip install pytest pytest-asyncio  (already in requirements.txt)
  pytest                              (runs everything)
  pytest -v                           (verbose — shows each test name)
  pytest tests/test_tenant_isolation.py -v   (just the critical ones)

REQUIREMENT:
  A test database must be reachable. By default these tests use the same
  DATABASE_URL as your app. To use a SEPARATE test database (recommended),
  set TEST_DATABASE_URL in your environment before running.
  The tests create their own data with unique names and clean up after
  themselves, so they won't pollute real data — but a separate test DB is
  always safest.
"""

import asyncio
import os
import uuid
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

# Use a dedicated test database if provided, else fall back to the app's.
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL")


@pytest.fixture(scope="session")
def event_loop():
    """One event loop for the whole test session (needed for async fixtures)."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def engine():
    """A database engine shared across all tests."""
    if not TEST_DATABASE_URL:
        pytest.skip("No DATABASE_URL or TEST_DATABASE_URL set — cannot run DB tests.")
    eng = create_async_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def raw_db(engine) -> AsyncGenerator[AsyncSession, None]:
    """
    A plain database session with NO organization context set.
    Used only by setup/teardown to create and remove test data as superuser.
    """
    SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def two_orgs(engine):
    """
    Creates two separate test organizations, each with one patient,
    then cleans them both up after the test.

    Returns a dict with org A and org B IDs and their patient names,
    so tests can verify isolation between them.
    """
    SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    org_a = str(uuid.uuid4())
    org_b = str(uuid.uuid4())
    tag = uuid.uuid4().hex[:8]  # unique marker so we can find/clean our rows
    patient_a = str(uuid.uuid4())
    patient_b = str(uuid.uuid4())

    async with SessionLocal() as s:
        # Create two organizations (organizations table has no RLS, so no context needed)
        for oid, name in [(org_a, f"TEST-A-{tag}"), (org_b, f"TEST-B-{tag}")]:
            await s.execute(
                text("""
                    INSERT INTO organizations (id, name, slug, type, email,
                        subscription_tier, subscription_status, hipaa_baa_signed)
                    VALUES (:id, :name, :slug, 'both', :email, 'trial', 'active', FALSE)
                """),
                {"id": oid, "name": name, "slug": name.lower(),
                 "email": f"{name.lower()}@test.local"},
            )
        await s.commit()

        # Insert each patient WITH that org's context set, because RLS now
        # enforces the policy on INSERT too (a row's org must match context).
        # set_config(..., true) sets it for this transaction only.
        async with SessionLocal() as sa:
            await sa.execute(
                text("SELECT set_config('app.organization_id', :org, true)"),
                {"org": org_a},
            )
            await sa.execute(
                text("""
                    INSERT INTO patients (id, organization_id, first_name, last_name, date_of_birth)
                    VALUES (:id, :org, 'Alice', :tag, '1950-01-01')
                """),
                {"id": patient_a, "org": org_a, "tag": f"A-{tag}"},
            )
            await sa.commit()

        async with SessionLocal() as sb:
            await sb.execute(
                text("SELECT set_config('app.organization_id', :org, true)"),
                {"org": org_b},
            )
            await sb.execute(
                text("""
                    INSERT INTO patients (id, organization_id, first_name, last_name, date_of_birth)
                    VALUES (:id, :org, 'Bob', :tag, '1950-01-01')
                """),
                {"id": patient_b, "org": org_b, "tag": f"B-{tag}"},
            )
            await sb.commit()

    data = {
        "org_a": org_a, "org_b": org_b, "tag": tag,
        "patient_a": patient_a, "patient_b": patient_b,
    }
    yield data

    # ── Cleanup: remove everything we created ──
    # Patients are RLS-protected, so delete each org's patient with that
    # org's context set. Organizations have no RLS, so they delete freely.
    for oid in (org_a, org_b):
        async with SessionLocal() as s:
            await s.execute(
                text("SELECT set_config('app.organization_id', :org, false)"),
                {"org": oid},
            )
            await s.execute(text("DELETE FROM patients WHERE organization_id = :o"),
                            {"o": oid})
            await s.commit()
    async with SessionLocal() as s:
        await s.execute(text("DELETE FROM organizations WHERE id IN (:a, :b)"),
                        {"a": org_a, "b": org_b})
        await s.commit()


async def tenant_session(engine, organization_id: str) -> AsyncSession:
    """
    Helper: opens a session scoped to one organization, exactly the way the
    real app does it in get_db_for_tenant. Row-level security will then only
    allow this session to see that org's rows.
    """
    SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    session = SessionLocal()
    # UUID() guards against injection, mirroring the real app.
    # set_config(...) reliably sets the parameter even when it's not
    # pre-registered in postgresql.conf. The 'false' makes it apply to
    # the whole session (until the connection closes).
    safe_org = str(uuid.UUID(organization_id))
    await session.execute(
        text("SELECT set_config('app.organization_id', :org, false)"),
        {"org": safe_org},
    )
    return session


# ════════════════════════════════════════════════════════════════════
# ROLE-BASED USER FIXTURES (added for access-control integration tests)
# ════════════════════════════════════════════════════════════════════
#
# WHAT THIS ADDS (plain English):
# The fixtures above create organizations and patients. To test access
# control — "can a biller see clinical fields?", "can a caregiver edit a
# patient?" — we also need USERS with specific ROLES. These helpers create
# a single-org world with a patient and a user of whatever role the test
# asks for, then clean it all up.
#
# Roles are looked up BY NAME (not hardcoded UUID) so these fixtures work
# regardless of the role UUIDs in the test database, as long as seed.sql
# has been applied (which creates the standard roles).


async def _make_org(session, tag: str) -> str:
    """Create one test organization, return its id."""
    oid = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO organizations (id, name, slug, type, email,
                subscription_tier, subscription_status, hipaa_baa_signed)
            VALUES (:id, :name, :slug, 'both', :email, 'trial', 'active', FALSE)
        """),
        {"id": oid, "name": f"TEST-{tag}", "slug": f"test-{tag}",
         "email": f"test-{tag}@test.local"},
    )
    return oid


async def _role_id_by_name(session, role_name: str) -> str | None:
    """Look up a role's UUID by its name. Returns None if not found."""
    row = (await session.execute(
        text("SELECT id FROM roles WHERE name = :n LIMIT 1"),
        {"n": role_name},
    )).first()
    return str(row[0]) if row else None


async def _make_user(session, org_id: str, role_name: str, tag: str) -> dict:
    """
    Create a user with the given role inside the given org.
    Returns {id, email, role_name, role_id} or raises if role missing.
    """
    role_id = await _role_id_by_name(session, role_name)
    if role_id is None:
        pytest.skip(f"Role '{role_name}' not present in test DB — seed.sql may not be applied.")
    uid = str(uuid.uuid4())
    email = f"{role_name}-{tag}@test.local"
    await session.execute(
        text("""
            INSERT INTO users (id, organization_id, role_id, first_name, last_name,
                email, password_hash, is_active, is_email_verified)
            VALUES (:id, :org, :role, :fn, 'Tester', :email,
                '$2b$12$abcdefghijklmnopqrstuv', TRUE, TRUE)
        """),
        {"id": uid, "org": org_id, "role": role_id,
         "fn": role_name.capitalize(), "email": email},
    )
    return {"id": uid, "email": email, "role_name": role_name, "role_id": role_id}


@pytest_asyncio.fixture
async def org_with_roles(engine):
    """
    Creates ONE organization containing:
      - one patient (with clinical fields populated)
      - one user of each standard role (admin, provider, biller,
        caregiver, pharmacy_staff, viewer)

    Yields a dict with the org id, patient id, and a 'users' map of
    role_name -> user dict. Cleans everything up afterward.

    Tests use this to verify role-based access: e.g. fetch the patient
    as the biller's role permissions and confirm clinical fields are
    stripped.
    """
    SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    patient_id = str(uuid.uuid4())
    roles_to_make = ["admin", "provider", "biller", "caregiver", "pharmacy_staff", "viewer"]
    users: dict = {}

    async with SessionLocal() as s:
        org_id = await _make_org(s, tag)
        await s.commit()

    # Create users (no RLS on users table for inserts as superuser here)
    async with SessionLocal() as s:
        for role_name in roles_to_make:
            try:
                u = await _make_user(s, org_id, role_name, tag)
                users[role_name] = u
            except Exception:
                # If a role doesn't exist, skip just that user
                pass
        await s.commit()

    # Create one patient WITH clinical fields, in org context (RLS on insert)
    async with SessionLocal() as s:
        await s.execute(
            text("SELECT set_config('app.organization_id', :org, false)"),
            {"org": org_id},
        )
        await s.execute(
            text("""
                INSERT INTO patients (id, organization_id, first_name, last_name,
                    date_of_birth, primary_diagnosis, allergies, medical_history, notes)
                VALUES (:id, :org, 'Clinical', 'Patient', '1950-01-01',
                    'I50.9', ARRAY['Penicillin'], 'CHF since 2019', 'Prefers mornings')
            """),
            {"id": patient_id, "org": org_id},
        )
        await s.commit()

    yield {"org_id": org_id, "patient_id": patient_id, "tag": tag, "users": users}

    # ── Cleanup ──
    async with SessionLocal() as s:
        await s.execute(
            text("SELECT set_config('app.organization_id', :org, false)"),
            {"org": org_id},
        )
        await s.execute(text("DELETE FROM patients WHERE organization_id = :o"), {"o": org_id})
        await s.commit()
    async with SessionLocal() as s:
        await s.execute(text("DELETE FROM users WHERE organization_id = :o"), {"o": org_id})
        await s.execute(text("DELETE FROM organizations WHERE id = :o"), {"o": org_id})
        await s.commit()
