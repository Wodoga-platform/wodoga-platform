# Wodoga Migrations

This directory holds all Alembic migration files for the Wodoga platform.

## Conventions for this project

**1. Hand-written SQL only.** We do NOT use Alembic's autogenerate feature.
Every migration is reviewed by a human and written explicitly. See `../env.py`
for why.

**2. One migration per logical change.** Don't bundle unrelated schema changes
into a single migration. They're harder to review and impossible to partially
revert.

**3. Every migration runs as the table owner**, not as `wodoga_app`. Alembic
gets its credentials from `ALEMBIC_DATABASE_URL`. See env.py.

**4. PHI-touching migrations need extra care.** Any migration that adds,
removes, or alters a column on a table holding patient data must:
  - Be tested on a non-production copy first
  - Include a verification SELECT in the upgrade()
  - Have a clear downgrade() OR be explicitly marked one-way

**5. RLS policies.** Postgres does not always preserve row-level security
policies through table alterations. If your migration touches a table with
RLS, the migration MUST explicitly recreate the policies in `upgrade()`.

## How to generate a new migration

From `backend/`:
```
alembic revision -m "describe the change"
```

This creates a new file in `versions/` based on the template in
`../script.py.mako`. Edit it to add your SQL.

## How to apply migrations

Local development (against your dev database, app role owns tables):
```
alembic upgrade head
```

Against production (requires ALEMBIC_DATABASE_URL with owner credentials):
```
ALEMBIC_DATABASE_URL='postgresql+psycopg2://postgres:...@.../railway' alembic upgrade head
```

## How to see what would run without running it

```
alembic upgrade head --sql
```

This emits the SQL to stdout instead of executing it. **Always do this before
running a migration in production.**

## How to check current state

```
alembic current      # what version is the database at?
alembic history      # show all migrations in order
alembic heads        # which migrations have no children (the "tips")?
```

## How to roll back

```
alembic downgrade -1     # go back one migration
alembic downgrade <rev>  # go back to a specific revision
```

Some migrations are explicitly one-way (the downgrade raises
`NotImplementedError`) — those cannot be auto-reverted and need a manual fix.
