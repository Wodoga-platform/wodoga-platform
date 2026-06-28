# Wodoga — Comprehensive Role-By-Role Permission Audit v2

**Context:** Earlier audit (v1) caught the high-level structural issues. This deeper review goes permission-by-permission for each role, asking "does this make sense in a real clinic?" Performed while Caleb was out, as a professional sweep before he returns to push and test.

**Method:** For each non-admin role, walk every permission they currently have. Mark each:
- **KEEP** — clinically correct, no change
- **REVOKE** — does not match real clinical workflow; remove the permission
- **DISCUSS** — ambiguous, defaults to keeping but flagged for Caleb's call later

Also for each role: identify permissions that the audit *grants but the role probably shouldn't have*, and flag them as REVOKE candidates with explanation.

**Conservatism rule:** I revoke only when the case is genuinely clear-cut. Anything ambiguous stays as DISCUSS, because reverting an over-revoke takes time Caleb might not have.

---

## ADMIN — All 38 permissions

Admin is intentionally full-access. The mitigation is operational policy (few admins per org, audited actions, periodic review). No permission changes proposed.

---

## PROVIDER (Physician / NP / PA) — 26 permissions

| Permission | Decision | Reasoning |
|---|---|---|
| patients:view | KEEP | Core clinical workflow |
| patients:create | KEEP | Providers often initiate patient records at first encounter |
| patients:edit | KEEP | Updating demographics, clinical info |
| intake_forms:view | KEEP | Reviews intake before first visit |
| intake_forms:create | KEEP | May complete intake during first encounter |
| visits:view | KEEP | Core |
| visits:create | KEEP | Schedules follow-ups, orders visits |
| visits:edit | KEEP | Reschedules, updates |
| visits:soap_note | KEEP | Documents own SOAP notes |
| care_plans:view | KEEP | Reviews care plans |
| care_plans:create | KEEP | Authors care plans (this is core to the provider role) |
| vitals:view | KEEP | Reviews vitals trends |
| vitals:create | KEEP | Records vitals during encounters |
| medications:view | KEEP | Reviews med list |
| medications:prescribe | KEEP | Core provider responsibility |
| medications:reconcile | KEEP | Initiates reconciliation |
| pharm_orders:view | KEEP | Reviews status of orders they wrote |
| referrals:view | KEEP | Reviews referrals |
| referrals:create | KEEP | Writes referrals |
| referrals:advance | KEEP | Updates referral status |
| eligibility:check | KEEP | Verifies coverage before care |
| oasis:view | KEEP | Reviews assessments |
| oasis:create | KEEP | Performs assessments |
| messages:send | KEEP | Communicates with team |
| messages:view | KEEP | Reads messages |
| documents:view | KEEP | Reviews patient documents |
| documents:upload | KEEP | Uploads clinical docs |
| notifications:view | KEEP | Receives notifications |
| reports:view | KEEP | Reviews clinical reports |

**Provider verdict:** No changes. Permissions match clinical reality.

**Notable absences (correctly):** No billing, no staff:manage, no pharm_orders:create/advance (pharmacy owns that workflow), no patients:delete.

---

## CAREGIVER (CNA / Home Health Aide) — 15 permissions (already revoked patients:edit)

| Permission | Decision | Reasoning |
|---|---|---|
| patients:view | KEEP | Needs to see assigned patients' charts |
| intake_forms:create | **REVOKE** | A CNA doesn't perform formal intake — that's a clinician or admin task. CNAs do home-care delivery, not patient onboarding. |
| intake_forms:view | KEEP | May need to read prior intake for context |
| visits:view | KEEP | Sees own assigned visits |
| visits:create | **DISCUSS** | A CNA scheduling their own visits is plausible in some agencies but usually office staff handles this. **Recommend revoke**, but flagging as DISCUSS. |
| visits:checkin | KEEP | Core to home-visit workflow (GPS check-in is the CNA's job) |
| visits:soap_note | KEEP | Documents own visit observations |
| vitals:view | KEEP | Reviews vitals before recording new ones |
| vitals:create | KEEP | Records vitals during visit (core CNA task) |
| medications:view | KEEP | Needs to know what the patient is on (med administration) |
| messages:send | KEEP | Communicates with care team |
| messages:view | KEEP | Receives messages |
| documents:view | KEEP | Reviews patient documents |
| documents:upload | KEEP | Uploads visit photos, signatures, consent forms |
| notifications:view | KEEP | Receives notifications |

**Caregiver verdict:** 1 clear revoke (intake_forms:create), 1 flagged for discussion (visits:create).

**Major over-grant noted in v1 audit** (caregiver sees ALL patients, not just assigned) is a **code change** in patients.py, not a permission flip. Tracked separately as audit finding Major #3.

---

## PHARMACY_STAFF — 11 permissions

| Permission | Decision | Reasoning |
|---|---|---|
| patients:view | KEEP | Needs identifiers + insurance for orders |
| medications:view | KEEP | Reviews the med list to fulfill orders |
| medications:reconcile | **REVOKE** | This is a *clinical* action (deciding what's correct after discrepancies surface). Pharmacy staff *flag* discrepancies; the *resolution* is clinical, owned by the provider. Reviewed against the reconciliation endpoint — it marks the reconciliation as "reviewed" or "escalated", which is a clinical judgment call. Pharmacy staff shouldn't make that call. |
| pharm_orders:view | KEEP | Core |
| pharm_orders:create | KEEP | Creates orders to fulfill |
| pharm_orders:advance | KEEP | Advances order stages |
| messages:send | KEEP | Coordinates with clinical team |
| messages:view | KEEP | Reads messages |
| documents:view | KEEP | Sees Rx-related docs |
| documents:upload | KEEP | Uploads Rx/pharmacy docs (v1 acceptable — gap tracked re: doc categorization) |
| notifications:view | KEEP | Receives notifications |

**Pharmacy verdict:** 1 clear revoke (medications:reconcile).

---

## BILLER — 10 permissions

| Permission | Decision | Reasoning |
|---|---|---|
| patients:view | **KEEP (with code change)** | Biller does need patient identifiers + insurance, but currently sees clinical fields. The fix is field-level filtering on the patient endpoint (Critical #1, being implemented in this session). |
| billing:view | KEEP | Core |
| billing:create | KEEP | Creates claims |
| billing:update | KEEP | Updates claim status |
| eligibility:check | KEEP | Verifies coverage before billing |
| documents:view | KEEP | Sees billing-related docs (v1 acceptable — gap tracked re: doc categorization) |
| messages:send | KEEP | Communicates with team |
| messages:view | KEEP | Reads messages |
| notifications:view | KEEP | Receives notifications |
| reports:view | KEEP | Reviews billing reports |

**Biller verdict:** No permission revokes. The fix is the Critical #1 code change to patients endpoint (also done this session).

---

## VIEWER (Read-Only Supervisor / Auditor) — 9 permissions

| Permission | Decision | Reasoning |
|---|---|---|
| patients:view | KEEP | Reviews patient records (with same Critical #1 caveat — but for read-only supervisors, the full record is generally appropriate) |
| visits:view | KEEP | Reviews visit history |
| care_plans:view | KEEP | Reviews care plans |
| vitals:view | KEEP | Reviews vitals trends |
| medications:view | KEEP | Reviews med history |
| billing:view | KEEP | Reviews billing |
| messages:view | KEEP | Reviews messages |
| documents:view | KEEP | Reviews documents |
| notifications:view | KEEP | Receives notifications |

**Viewer verdict:** No changes. The "audit:view" question from v1 audit remains a DISCUSS for Caleb. Right now correctly not granted (more restrictive).

---

## PATIENT (Portal user) — 3 permissions

| Permission | Decision | Reasoning |
|---|---|---|
| portal:access | KEEP | Required for portal |
| messages:send | KEEP | Patient messages care team |
| messages:view | KEEP | Reads messages from care team |
| notifications:view | KEEP | Receives portal notifications |

**Patient verdict:** No changes. All correct.

---

## Summary of permission changes to apply

### Migrations (revokes):
1. **Caregiver — REVOKE `intake_forms:create`** (Critical #2 follow-up)
2. **Pharmacy_staff — REVOKE `medications:reconcile`** (clinical judgment call belongs to provider)

### Flagged for Caleb's decision (NOT applied):
3. Caregiver — `visits:create`? (probably office staff in real agencies, but defensible)
4. Viewer — should they have `audit:view`? (depends on whether they're clinical supervisor or internal auditor)

### Code changes (this session):
5. **Critical #1**: Patient endpoint field-filtering for biller role (and any future role with `patients:view` but no clinical permissions). Returns only billing-relevant fields when caller is biller.
6. **Comprehensive button gating sweep**: every action button across the app wrapped in `<Gated>` so it reflects the user's actual permissions.
7. Major audit finding #3 (caregivers seeing ALL patients) — flagged for Caleb's decision since the right scoping logic deserves discussion (does "assigned" mean assigned_caregiver only, or also visit-based assignment?).

---

## What gets pushed when Caleb returns

The plan is to land all the above as a coherent set:

- 1 Alembic migration: 0003 revoking caregiver intake_forms:create
- 1 Alembic migration: 0004 revoking pharmacy medications:reconcile
- 1 seed.sql update reflecting both
- Critical #1 code: patients.py change for biller field filtering
- Frontend: comprehensive Gated sweep across all action buttons

All staged. Nothing pushed. Caleb reviews and pushes when he's ready.
