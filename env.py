# Alembic Rollout Runbook — Wodoga

This document walks you through introducing Alembic to the Wodoga platform.
It's written to be followed step-by-step, with explicit check points where you
verify things are working before continuing. **Do not skip the verifications.**

## What's already done (in this session, in the repo)

- `backend/alembic.ini` — the Alembic config file
- `backend/alembic/env.py` — connection logic with safety logging
- `backend/alembic/script.py.mako` — template for new migrations
- `backend/alembic/versions/0001_baseline.py` — the empty baseline migration
- `backend/alembic/versions/README.md` — conventions doc

The `alembic` Python package is already in your `requirements.txt`, so when
Railway redeploys after you push, it'll be installed automatically.

## What you do — in order, with checks

### Step 1: Pull and push the new files

Pull these new files into your local repo (the ones in this session's output),
commit them, push to GitHub. **At this point, nothing changes about how the app
runs.** Alembic isn't being executed — the files are just sitting there.

**Verify:**
- The app still boots normally on Railway (you should see no errors after deploy)
- Visit your live site and log in. Everything should work exactly as before.

If anything broke at this stage, something is wrong with how the files were
added (unlikely — they don't touch app startup). Stop and check before going on.

---

### Step 2: Verify Alembic can be invoked locally (no DB needed yet)

In your local terminal, in the `backend/` directory:

```
alembic --version
```

You should see something like `alembic 1.13.1`. If you don't have it installed
locally, install it: `pip install alembic`.

Then, still in `backend/`:

```
alembic history
```

This should print a single entry: the baseline (`0001_baseline`). It does NOT
touch the database — it just reads the migration files.

**If this works:** Alembic understands our setup. Good.

**If you get errors:** they're likely path or import related — paste them to me
and we'll fix.

---

### Step 3: Set up `ALEMBIC_DATABASE_URL` in Railway

Alembic needs to connect as the **table owner**, not as `wodoga_app`. Add a new
Railway environment variable on your backend service:

- **Name:** `ALEMBIC_DATABASE_URL`
- **Value:** Use the postgres owner credentials, in this format:
  ```
  postgresql+psycopg2://postgres:THE_POSTGRES_PASSWORD@postgres.railway.internal:5432/railway
  ```
  Replace `THE_POSTGRES_PASSWORD` with the actual `POSTGRES_PASSWORD` from your
  Postgres service's Variables tab.

**Why a separate env var:** the runtime app should NEVER have DDL privileges.
This second URL is only used by Alembic, which only runs when you explicitly
invoke it.

**Verify:** After saving the variable, check that the app still boots normally.
The new env var is unused by the app itself — it's only read when Alembic runs.

---

### Step 4: The big moment — `alembic stamp head` against production

This is the one production touch. It runs ONE SQL statement:

```sql
INSERT INTO alembic_version (version_num) VALUES ('0001_baseline');
```

That's it. No tables created, dropped, or altered. It just records "the
database is at version 0001_baseline" in a new tracking table.

**The safest way to do this:**

Option A — Run it from a one-off Railway shell or local shell that has the
`ALEMBIC_DATABASE_URL` set:

```
cd backend
ALEMBIC_DATABASE_URL='postgresql+psycopg2://postgres:...@postgres.railway.internal:5432/railway' \
  alembic stamp head
```

You should see output like:
```
ALEMBIC TARGET DATABASE
  Host:  postgres.railway.internal
  Port:  5432
  DB:    railway
  Role:  postgres
INFO  [alembic.runtime.migration] Stamped 'head' as base
```

**This is the moment to read the target carefully.** If the host/db/role looks
wrong, hit Ctrl+C immediately. The safety logging exists for exactly this.

**Verify:**
```
alembic current
```
Should output `0001_baseline (head)`.

Or check directly in the Railway query tab:
```sql
SELECT * FROM alembic_version;
```
You should see one row with `version_num = '0001_baseline'`.

---

### Step 5: Confirm everything still works

This is non-negotiable. Before declaring done:

- App boots normally
- Log in still works (staff)
- Log in still works (patient portal)
- Pull up a patient
- Record a vital
- Run a reconciliation
- Send a message

If anything is different, stop. (Nothing should be different. We added a single
row to a single new table.)

---

## After this: how every future schema change works

The hand-running-ALTER-statements era is over. From now on:

1. You decide a schema change is needed (say, adding a column)
2. From `backend/`, run: `alembic revision -m "add x to y"`
3. Alembic creates a new file in `versions/` from the template
4. You (with me) write the SQL inside the `upgrade()` and `downgrade()` functions
5. Test locally if possible
6. Run `alembic upgrade head --sql` to see exactly what SQL will execute
7. Run `alembic upgrade head` against production (with `ALEMBIC_DATABASE_URL` set)
8. Commit the new migration file to git

Every change is versioned. Every change is reviewable. Every change has a clear
rollback path. This is the foundation that makes the encryption work safe.

---

## What can go wrong, and what to do about it

**"Permission denied" when running stamp:**
Your `ALEMBIC_DATABASE_URL` is using the wrong role. Make sure it's the postgres
superuser, not `wodoga_app`.

**"Can't locate revision identified by 'head'":**
The versions/ directory wasn't deployed correctly. Check that
`alembic/versions/0001_baseline.py` is present in production.

**Wrong database in the safety log:**
Stop immediately. Check `ALEMBIC_DATABASE_URL`. Better to spend an hour
verifying than to stamp the wrong DB.

**App stops booting after deploy:**
The files I added don't touch app boot. If this happens, something else was
deployed at the same time. Roll back, investigate the other change.

---

## When you're ready

Walk through this with me, step by step. We do not rush. When you finish step 4,
the Alembic foundation is real — and from there, the PHI encryption work can
flow through proper migrations the way it's supposed to.
