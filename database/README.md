# Wodoga Platform — Database Layer

## Overview

PostgreSQL 15+ relational database with row-level security, multi-tenant
isolation, and an immutable audit trail. Every table is scoped to an
organization — cross-tenant data access is mathematically impossible
at the database level regardless of application code.

---

## Table Reference

| # | Table | Purpose |
|---|-------|---------|
| 1 | `organizations` | Top-level tenant — one row per client clinic |
| 2 | `roles` | Role definitions and permission arrays per organization |
| 3 | `users` | All staff and patient portal accounts |
| 4 | `refresh_tokens` | JWT session management |
| 5 | `patients` | All patient records |
| 6 | `intake_forms` | Digital admission intake with signature |
| 7 | `care_plans` | Physician-approved care plans |
| 8 | `visits` | Home visits with GPS check-in and SOAP notes |
| 9 | `vitals` | Patient vital signs history with alert flags |
| 10 | `medications` | Active prescriptions and refill tracking |
| 11 | `medication_reconciliations` | Formal conflict review records |
| 12 | `pharmaceutical_orders` | Order pipeline from prescription to delivery |
| 13 | `referrals` | Incoming referral pipeline |
| 14 | `provider_insurance_contracts` | Which insurances each provider accepts |
| 15 | `insurance_eligibility_checks` | Every eligibility verification performed |
| 16 | `billing_claims` | Insurance claims and payment tracking |
| 17 | `documents` | File metadata (files live in Azure Blob Storage) |
| 18 | `oasis_assessments` | Medicare-required OASIS-E assessments |
| 19 | `messages` | Encrypted internal staff messaging |
| 20 | `notifications` | System-generated clinical and operational alerts |
| 21 | `audit_logs` | Immutable record of every system action |

---

## How to Set Up the Database

### Prerequisites
- PostgreSQL 15 or higher installed
- psql command-line tool OR Azure Data Studio

### Step 1 — Create the database
```bash
psql -U postgres -c "CREATE DATABASE wodoga;"
```

### Step 2 — Run the schema
```bash
psql -U postgres -d wodoga -f schema.sql
```

### Step 3 — Run the seed data (demo only)
```bash
psql -U postgres -d wodoga -f seed.sql
```

### Step 4 — Set the application user password
After running the schema, update the database role password:
```sql
ALTER ROLE wodoga_app WITH PASSWORD 'your-secure-password-here';
ALTER ROLE wodoga_readonly WITH PASSWORD 'your-secure-readonly-password';
```

---

## How Row-Level Security Works

Every request the application makes sets a session variable before
querying the database:

```sql
SET app.organization_id = 'uuid-of-logged-in-users-org';
```

Every RLS policy then enforces:

```sql
WHERE organization_id = current_setting('app.organization_id')::UUID
```

This means even if the application has a bug and tries to fetch all
patients without a filter, the database returns only the patients
belonging to the current organization. Zero exceptions.

---

## Audit Log Rules

The `audit_logs` table is the only table where:
- The application database user (`wodoga_app`) has INSERT only
- UPDATE and DELETE are explicitly revoked
- Records are permanent — they can never be modified or removed

This satisfies HIPAA requirements for tamper-proof access logging.

---

## Migrations

All schema changes go through numbered migration files in this folder.
Every migration is recorded in `schema_migrations` with a version,
timestamp, and description.

Never modify `schema.sql` directly after deployment.
Always create a new migration file: `003_add_column_example.sql`

---

## Security Notes

- The `password_hash` column stores bcrypt hashes only — never plaintext
- The `mfa_secret` column stores TOTP secrets encrypted at the application layer
- The `tax_id` column in organizations is encrypted at the application layer
- The `api_response_raw` column in eligibility checks stores full API responses for compliance
- Soft deletes (`deleted_at`) preserve records for HIPAA retention requirements
- The `audit_logs` table denormalizes user information so records are
  preserved accurately even if the user account is later deleted
