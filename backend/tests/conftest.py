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
