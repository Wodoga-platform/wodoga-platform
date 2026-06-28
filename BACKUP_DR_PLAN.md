# Wodoga — Backup & Disaster Recovery Plan

**Version 1.0** — Initial documentation of current posture, written 2026-06.

**Audience:** Wodoga leadership, prospective customers performing security review, future independent HIPAA reviewer.

**This document is deliberately honest, not aspirational.** It documents what we actually do today, what gaps exist, and what we will do to close them. Customers and auditors can distinguish marketing from real plans, and this document is meant to be the latter.

---

## 1. Purpose

This plan defines how Wodoga protects clinical data against loss, corruption, or extended unavailability, and how we restore service if any of those occur. It exists because:

- HIPAA Security Rule §164.308(a)(7) requires a contingency plan including data backup, disaster recovery, and emergency mode operation procedures
- Customers will (rightly) ask before trusting us with PHI
- The team needs an actual playbook if something bad happens, not panic improvisation

This plan currently covers the production environment only. Staging does not yet exist (see Section 9).

---

## 2. Definitions

**RPO (Recovery Point Objective)** — The maximum amount of data, measured in time, that we can lose. An RPO of 1 hour means a disaster can cost us at most the last hour's data.

**RTO (Recovery Time Objective)** — The maximum acceptable downtime before service is restored. An RTO of 4 hours means within 4 hours of a disaster, the system is back online for users.

**PHI (Protected Health Information)** — Patient health information as defined by HIPAA.

**Catastrophic loss** — Total destruction or permanent inaccessibility of primary data store.

**Logical corruption** — Data is intact and accessible but contains incorrect values (e.g. accidental mass-update, malicious tampering, app bug overwriting records).

---

## 3. Current Architecture (what's actually deployed)

- **Application:** FastAPI backend on Railway, Next.js frontend on Vercel
- **Primary data store:** Railway-managed PostgreSQL instance, single primary, no read replicas
- **Object storage:** Not yet wired (planned: Azure Blob Storage for document attachments; currently documents pointer-only without binary storage)
- **Secrets management:** Doppler (in setup, blocked on Railway team subscription as of this document's writing)
- **Hosting region:** Railway's chosen region for the project (US-based)

**What this means in plain terms:** all customer data currently lives in one PostgreSQL database in one cloud provider. We are reliant on Railway's backup and uptime guarantees as our primary protection.

---

## 4. Current Backup Posture (honest assessment)

### What Railway provides

Railway's managed Postgres service provides automated daily backups on paid plans (retention period varies by plan tier). Backups are stored in Railway's infrastructure and are restorable via Railway's interface.

**What we have NOT done:**
- Tested a restore from Railway backup (i.e. we don't actually know how long it takes or whether it works)
- Configured off-Railway backup storage (no second copy outside the primary provider)
- Implemented point-in-time recovery (PITR) beyond what Railway's defaults provide
- Documented or rehearsed the restore procedure

### What this implies for current RPO/RTO

**Current realistic RPO:** Up to 24 hours of data loss (one backup interval). For a clinical system, this is too long for production with real PHI. Acceptable for the design-partner / fake-data phase we're currently in.

**Current realistic RTO:** Unknown, because we haven't tested. Estimate 2–8 hours based on Railway's documented restore mechanics, but this is conjecture until we run a drill.

**Honest summary:** We have basic provider-managed backups and no tested restore. This is acceptable for the design-partner phase. It is **not acceptable for production PHI** without the improvements in Section 6.

---

## 5. Threat Model — What We're Defending Against

| Threat | Likelihood | Current Defense | Gap |
|---|---|---|---|
| Application bug deletes/corrupts data | Medium | Daily Railway backup | RPO too coarse for real-time recovery |
| Database disk failure / hardware fault | Low | Railway's underlying infrastructure | We trust Railway's HA posture but don't verify |
| Railway service outage (regional) | Low | None — single-region | No multi-region or off-provider replica |
| **Railway as a company goes away / shuts our account** | Low but real | **None** | This is the biggest gap. We have no off-Railway copy. |
| Malicious insider with admin DB access | Low | Audit logging on app actions, RLS at row level | DB-level superuser still bypasses RLS by definition |
| Ransomware / external attacker with credential theft | Low | Doppler-bound secrets, rate-limited login | If credentials leak, attacker can encrypt or exfiltrate data; no immutable backup tier |
| Accidental hard-delete by admin user | Medium | Audit log | No "soft-delete then purge" pattern; deletes are immediate |

---

## 6. Roadmap — What We Will Build, In Order

These are the concrete improvements needed before real PHI enters the system. They are listed in order of cost-effectiveness.

### Phase 1 (before real PHI) — REQUIRED

1. **Verify Railway's backup tier and document the actual retention.** Pin this down to numbers: how many daily backups, for how long, recovery granularity. Currently assumed; not verified.
2. **Conduct one restore drill from Railway backup.** Document elapsed time and any issues encountered. This sets a measured RTO baseline instead of a guess. Run on staging once it exists.
3. **Establish an off-Railway backup copy.** Daily dump → encrypted at rest → stored outside Railway. Options: AWS S3 with versioning, Backblaze B2, or a separate Postgres dump pushed to a different provider. The point is a copy that survives Railway disappearing.
4. **Document the data deletion / retention policy.** Currently undefined. HIPAA requires retention rules; customers will ask.
5. **Implement soft-delete on patient and clinical records.** Currently `DELETE FROM patients` is immediate and irreversible. A `deleted_at` column plus filtered queries gives a recovery window for accidental deletion.

### Phase 2 (early production PHI) — STRONGLY RECOMMENDED

6. **Move to a Postgres deployment with point-in-time recovery (PITR).** Reduces RPO from 24 hours to minutes. Railway's higher tier may support this; alternatively migrate to a Postgres provider that does (Crunchy Bridge, Supabase, RDS).
7. **Set up monitoring on backup success.** A failed daily backup that nobody notices for a week is the actual disaster scenario, not the original event. Alert if a backup doesn't complete.
8. **Document and rehearse incident response.** Who to call, in what order, with what authority to act. Currently undefined.

### Phase 3 (scale / regulated customers) — FUTURE

9. **Multi-region failover capacity.** A regional Railway outage takes us down entirely today. At scale this is unacceptable.
10. **Quarterly DR drills.** Industry standard for clinical software.

---

## 7. Restore Procedure (current best understanding)

This is what we would do today if we needed to restore from backup. It has not been rehearsed, and the times are estimates.

**Step 1 — Decide.** Confirm the incident requires restore (vs. forward-fix). For data corruption, a partial restore to a specific point may be preferable to a full restore that loses recent legitimate writes.

**Step 2 — Communicate.** Notify affected users that the system is being restored. Notify any agency partners. Begin incident log.

**Step 3 — Snapshot current state.** Even in a disaster, capture the current broken state (it may contain forensic information).

**Step 4 — Restore via Railway interface.** Use Railway's database backup restore UI to roll back to the most recent good backup.

**Step 5 — Verify.** Run checks on critical tables (patient count, recent visits, recent vitals) to confirm restore succeeded.

**Step 6 — Replay manual data.** Any legitimate writes between the backup point and the incident are lost. Affected users may need to re-enter data; communicate this clearly.

**Step 7 — Document.** Write up what happened, what we did, what the gap was. This becomes input for improving the plan.

**Estimated end-to-end time:** 2–8 hours. **This is a guess, not a measurement.** Item 2 in the roadmap closes that gap.

---

## 8. Roles & Responsibilities (current state)

| Role | Who | Responsibility |
|---|---|---|
| Decide to invoke DR plan | Caleb (founder) | Authority to call an incident |
| Execute restore | Caleb (founder) | Run the procedure |
| Customer communication | Business partner + Caleb | Notify affected agencies/users |
| Post-incident review | Caleb + Claude (AI advisor) | Document, update plan |

**Honest note:** Wodoga is currently a two-person operation. Single points of failure at the human level are real. As the team grows, this should expand to include named backup decision-makers and clear escalation paths.

---

## 9. Gaps Not Yet Closed (the honest list)

These are real gaps that this document acknowledges rather than papers over. They are NOT failures — they are the natural state of an early-stage clinical system. They are tracked here so they can be closed deliberately rather than forgotten.

1. **No tested restore procedure** — the most consequential gap
2. **No off-Railway backup** — total dependency on a single provider
3. **No staging environment** — testing of any DR procedure is therefore live or in our heads
4. **No PITR** — 24-hour RPO is too coarse for clinical production
5. **No soft-delete on clinical records** — accidental hard-delete is irreversible
6. **No documented data retention policy** — required for HIPAA
7. **No incident response runbook beyond this document** — single page, single author
8. **No backup-success monitoring** — silent failures are possible
9. **Single human decision-maker** — operational continuity risk

---

## 10. Document Maintenance

This plan should be:
- Reviewed at least quarterly
- Updated whenever the architecture changes materially
- Re-read before any independent security review
- Updated immediately after any actual incident, with lessons learned incorporated

**Version history:**
- 1.0 (2026-06): Initial plan, design-partner phase
