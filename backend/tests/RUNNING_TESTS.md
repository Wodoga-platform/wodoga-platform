# Wodoga — Running the Tests

This guide explains how to run the test suite, including the integration
tests that need a database.

## The two kinds of tests we have

**1. Unit tests (no database needed)** — these test pure logic and run
anywhere, instantly:
- `tests/test_security.py` — password hashing, MFA, encryption, tokens
- `tests/test_audit_remediation.py` — rate-limit key extraction, biller
  field-filter logic, URL rewriting, bcrypt

Run them:
```
cd backend
pytest tests/test_security.py tests/test_audit_remediation.py -v --noconftest
```

The `--noconftest` flag skips the database fixture setup, so these run
even with no database available.

**2. Integration tests (need a real Postgres database)** — these test
actual database behavior: tenant isolation, role permissions, soft-delete:
- `tests/test_tenant_isolation.py` — the most important tests; prove one
  clinic can't see another's data
- `tests/test_access_control.py` — prove the audit's permission decisions
  are real in the database

These need a test database. See setup below.

## Setting up a test database

You have two options.

### Option A: Local Postgres (recommended for regular testing)

1. Install Postgres locally (if not already):
   - Mac: `brew install postgresql@16 && brew services start postgresql@16`
   - Windows: download from postgresql.org
   - Linux: `sudo apt install postgresql`

2. Create a test database:
   ```
   createdb wodoga_test
   ```

3. Apply the schema and seed:
   ```
   psql wodoga_test < database/schema.sql
   psql wodoga_test < database/seed.sql
   ```

4. Point the tests at it and run:
   ```
   cd backend
   export TEST_DATABASE_URL="postgresql+asyncpg://localhost/wodoga_test"
   pytest tests/test_tenant_isolation.py tests/test_access_control.py -v
   ```

### Option B: A separate Railway database (when you have the subscription)

Once the Railway subscription is active, you can spin up a *second*
Postgres service on Railway purely for testing — never point tests at
the production database. Set `TEST_DATABASE_URL` to that test instance's
connection string (with `+asyncpg`).

**NEVER set TEST_DATABASE_URL to the production database.** The tests
create and delete data. They clean up after themselves, but a bug in a
test could affect real data. Always use a dedicated test database.

## Running everything

Once a test database is configured:
```
cd backend
export TEST_DATABASE_URL="postgresql+asyncpg://localhost/wodoga_test"
pytest -v
```

This runs all tests — unit and integration.

## What "passing" looks like

- Unit tests: should always pass (no external dependency)
- Integration tests: pass if the schema + seed are applied to the test DB
- If a role is missing from the test DB, the relevant access-control test
  *skips* (yellow 's') rather than fails — that's expected on a
  schema-only database without seed.sql

## The safety net these provide

Every time you change code, run the tests before pushing. In particular:
- `test_tenant_isolation.py` catches the worst possible bug (cross-clinic
  data leakage)
- `test_access_control.py` catches silent re-opening of the permission
  gaps we closed in the audit

These are your early warning system. A failing test before push is a bug
caught; the same bug found in production is a much worse day.

## Future: continuous integration

When ready, these tests should run automatically on every push via GitHub
Actions (or similar). That requires a CI config that spins up a Postgres
container, applies schema + seed, and runs pytest. That's a future task —
for now, run them locally before pushing.
"""
