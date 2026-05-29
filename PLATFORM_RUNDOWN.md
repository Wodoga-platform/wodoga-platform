# Wodoga Platform — Complete Professional Rundown
## What Works, How It Works, and What You Need to Connect

---

## THE SHORT ANSWER

Yes. Everything is connected through the code. The database, the backend server,
and the frontend interface are three separate pieces that talk to each other
automatically. When a nurse records vitals on the screen, the frontend sends that
to the backend, the backend validates who they are and what they're allowed to do,
writes it to the database, checks for alert thresholds, and fires a notification
to the provider — all in under one second, all without you touching anything.

What is fully built and works right now versus what needs a third-party account
to activate is documented in full below.

---

# SECTION 1 — WHAT IS FULLY BUILT AND WORKS RIGHT NOW

Everything in this section works the moment you follow the setup guide.
No external accounts, no API keys, no additional setup required.

---

## 1.1 Authentication System

**What it does:**
Every staff member logs in with their email and password. The system checks
their credentials, verifies their role, and issues a secure digital token
(called a JWT) that proves who they are for the next 30 minutes. After
30 minutes it automatically refreshes silently in the background.

**How it connects:**
Login page → Backend auth endpoint → Database user lookup → JWT token issued
→ Token stored in browser → Every subsequent request carries the token →
Backend reads and verifies the token before doing anything.

**Two-Factor Authentication (2FA) — Built but needs activation:**
The code for 2FA is fully written using TOTP (the same technology as
Google Authenticator). In demo mode, the 6-digit code appears on screen
so you can test it. To activate real 2FA where the code goes to a phone
app, your staff simply:
1. Logs in
2. Goes to their account settings
3. Clicks "Enable MFA"
4. Scans the QR code with Google Authenticator, Authy, or Microsoft Authenticator
5. Confirms with their first code

From that point forward, every login requires their phone. This costs nothing
and requires no third-party account — Google Authenticator is free.

**Account lockout:**
After 5 failed login attempts, the account locks for 30 minutes automatically.
This is built and works with no setup.

**Session timeout:**
Users are warned at 14 minutes and logged out at 15 minutes of inactivity.
Built and works with no setup.

---

## 1.2 Role-Based Access Control

**What it does:**
Six roles are built: Admin, Provider, Pharmacy Staff, Biller, Viewer, Caregiver.
Each role has a specific set of permissions. A Caregiver physically cannot access
billing pages. A Biller cannot see SOAP notes. An admin sees everything.

**How it connects:**
When a user logs in, their permissions are embedded directly in their JWT token.
Every single API endpoint checks those permissions on the server before returning
any data. The frontend also hides navigation items the user cannot access.
This is enforced in two places — once on screen and once on the server —
so even a technically sophisticated person cannot bypass it.

**What you need to do:**
Nothing. This works automatically based on the role assigned when you invite staff.

---

## 1.3 Patient Records

**What it does:**
Complete patient folders with demographics, medical history, insurance, allergies,
emergency contacts, assigned caregiver, assigned provider, fall risk, and notes.
Soft-delete preserves records for HIPAA compliance — nothing is ever truly deleted.

**How it connects:**
Patient page → API call to `/api/v1/patients` → Backend checks permissions and
organization context → PostgreSQL returns only that organization's patients
(row-level security prevents any cross-tenant data access) → Frontend renders the list.

**What you need to do:**
Nothing. Works immediately after setup.

---

## 1.4 Home Visit Scheduling and Documentation

**What it does:**
Staff schedule visits for specific patients with a caregiver, date, time, and visit
type. Caregivers can GPS check in and check out. After completing a visit, they
document it using the SOAP format (Subjective, Objective, Assessment, Plan) which
is the clinical standard required by Medicare.

**How it connects:**
Visit scheduled in frontend → Saved to visits table in database → Caregiver
opens visit on their device → Clicks check-in → Browser captures GPS coordinates
→ Coordinates saved to visit record → After visit, caregiver fills SOAP note →
Saved to same visit record → Dashboard shows completed vs pending documentation.

**What you need to do:**
GPS check-in uses the browser's built-in location API. On a phone or tablet,
the browser will ask "Allow this site to access your location?" — the caregiver
clicks Allow. No third-party account needed.

---

## 1.5 Vital Signs Recording and Alerts

**What it does:**
Record blood pressure, heart rate, oxygen saturation, temperature, respiratory
rate, weight, blood glucose, and pain scale. The system automatically flags
dangerous readings: O₂ below 94%, BP above 160/100, BP below 90 systolic,
glucose above 250 or below 70, temperature above 99.5°F. Flagged vitals
immediately generate a notification to the patient's assigned provider.

**How it connects:**
Caregiver records vitals → Backend checks all values against thresholds →
If any threshold is crossed, a notification row is created for the provider →
Provider sees the alert in their notification bell in real time (on next page
load or within 30 seconds via auto-refresh) → Vitals are stored permanently
and build trend history over time.

**What you need to do:**
Nothing. Thresholds are configurable in the backend code if you want to
adjust them for specific clinical standards.

---

## 1.6 Medication Management

**What it does:**
Full prescription tracking with drug name, dosage, route, frequency, refill
count, prescriber, and pharmacy. The dashboard and sidebar badge alert staff
when any patient has fewer than 2 refills remaining. Discontinued medications
are preserved in history.

**How it connects:**
Provider prescribes medication in the app → Stored in medications table →
Every page load checks refill counts and shows warnings → Pharmacy staff
can advance pharmaceutical orders through the pipeline.

**What you need to do:**
Nothing for basic medication management. The pharmacy order pipeline
(tracking from prescription through delivery) is fully built. Connecting
it to actual pharmacy systems is covered in Section 2.

---

## 1.7 Medication Reconciliation

**What it does:**
A formal process that checks a patient's current medication list for dangerous
drug interactions and duplicate drug classes. The built-in engine checks for
known conflicts including ACE inhibitor + potassium, dual antiplatelet therapy,
loop diuretics with Metformin, and warfarin combinations.

**How it connects:**
Staff clicks Run Reconciliation for a patient → Backend pulls all active
medications for that patient → Runs conflict detection logic → Returns list
of conflicts with clinical explanations → Creates a formal reconciliation
record in the database with who ran it and when → Provider reviews.

**What you need to do:**
Nothing for the built-in conflict pairs. To connect to a comprehensive drug
interaction database (tens of thousands of known interactions), see Section 2.

---

## 1.8 Care Plans

**What it does:**
Physician-approved care plans with primary diagnosis, ordering physician, visit
frequency, duration, goals, interventions, and expected outcomes. Linked to
patients. Visible in the patient portal.

**How it connects:**
Provider creates care plan in app → Stored in care_plans table → Linked to
patient → Visible on patient detail panel, patient portal, and caregiver visits.

**What you need to do:**
Nothing.

---

## 1.9 Referral Pipeline

**What it does:**
A visual Kanban board tracking incoming referrals from first contact through
admission. Stages: New Lead → Contacted → Evaluating → Insurance Check → Admitted.
When a referral reaches Admitted, the system automatically creates a patient record.

**How it connects:**
New referral entered → Stored in referrals table → Staff advance through stages
with one click → On admission, a patient record is auto-created and linked to
the original referral for tracking. Urgency levels (Routine, Urgent, Emergent)
are displayed with color coding.

**What you need to do:**
Nothing.

---

## 1.10 Billing and Claims

**What it does:**
Submit insurance claims with service type, CPT code, ICD-10 codes, amount,
and insurance information. Track claim status through the workflow: Draft →
Submitted → Pending → Approved → Paid or Denied → Appealed. Summary dashboard
shows total pending, approved, and denied with dollar amounts.

**How it connects:**
Biller creates claim → Stored in billing_claims table → Status updated manually
as responses come from insurers → Audit trail records every status change with
who made it and when.

**What you need to do:**
The claim management system is fully built. To submit claims electronically
directly from Wodoga to insurance companies (rather than manually), you need
to connect a clearinghouse. This is covered in Section 2.

---

## 1.11 Insurance Eligibility Verification

**What it does:**
Before scheduling a visit, staff can verify whether a patient's insurance is
currently active. The system returns coverage status, copay amount, and
deductible remaining.

**Current state:**
In development mode, the verification runs a realistic simulation that returns
Eligible, Not Eligible, or Pending Review based on the insurer type. Medicare
and Medicaid are biased toward eligible. Commercial plans have a 25% chance of
returning other results. This is realistic for testing and demos.

**To activate real eligibility checks:**
See Section 2.3.

---

## 1.12 OASIS Assessments

**What it does:**
The OASIS-E form is the federal government's required assessment for all Medicare
home health patients. It must be completed at start of care, resumption of care,
follow-up, transfer, and discharge. Wodoga has a structured form that captures
the required data points including hospitalization risk, grooming ability, and
oral medication management.

**How it connects:**
Provider opens OASIS form for a patient → Completes the required sections →
Submits → Stored in oasis_assessments table with timestamp, clinician, and
all responses → Visible in audit log.

**What you need to do:**
The form is built. To submit OASIS data electronically to CMS (the federal
agency that requires it), you need to connect to a state-specific OASIS
submission system. Most billing services handle this — see Section 2.

---

## 1.13 Secure Internal Messaging

**What it does:**
Staff can send messages to each other within the platform. Messages are stored
in the database and logged in the audit trail. An unread badge shows in the
sidebar. Messages can be tagged to a specific patient for context.

**How it connects:**
Staff sends message → Stored in messages table → Notification created for
recipient → Badge appears in sidebar → Recipient opens and reads → Marked
read and logged in audit trail.

**What you need to do:**
Nothing for internal messaging. To send messages via SMS or email to external
parties, see Section 2.

---

## 1.14 Patient Portal

**What it does:**
Patients log in at a separate URL with their own credentials. They see only
their own information: upcoming visits, active medications, recent vitals,
their care plan and personal goals, and secure messages from their care team.
They can send messages to their care team directly from the portal.

**How it connects:**
Patient receives invitation email (or you give them credentials) → They log in
at `/portal` → Backend checks they have the Patient role → All API calls are
scoped to only their patient record → They cannot see any other patient's data.

**What you need to do:**
Invite patients by creating a portal account for them in the admin panel.
They set their own password via invitation link. For the invitation email
to be sent automatically, you need SendGrid (see Section 2).

---

## 1.15 Audit Log

**What it does:**
Every single action in the system is recorded permanently: logins, logouts,
failed login attempts, every patient record viewed, every medication prescribed,
every document accessed, every message sent, every status change. Records
cannot be edited or deleted — the database user has INSERT permission only.

**How it connects:**
Every API endpoint calls the audit logger before returning a response. The
logger writes directly to the audit_logs table. Admins can view, filter,
and export the log from the Audit Log page.

**What you need to do:**
Nothing. This is automatic.

---

## 1.16 Notifications

**What it does:**
System-generated alerts appear in the notification bell for relevant staff:
low O₂ readings, high blood pressure, low refills, missed visits, denied claims,
new referrals, and care plan reviews due.

**How it connects:**
Backend events trigger notification creation → Notifications table stores them
with priority level → Frontend polls every 30 seconds → Badge shows unread count
→ Clicking the bell shows the notification panel.

**What you need to do:**
Nothing for in-app notifications. For push notifications to phones and SMS
alerts, see Section 2.

---

## 1.17 Multi-Tenant Architecture

**What it does:**
Every organization that subscribes to Wodoga gets completely isolated data.
Arlington Home Health cannot see Dallas Pharmacy Group's patients, staff,
or records — ever — regardless of any application logic.

**How it connects:**
The PostgreSQL database has Row Level Security enabled on every table. Every
query automatically filters by the logged-in user's organization ID. This is
enforced at the database level, not just the application level. It cannot be
bypassed by a bug in the code.

**What you need to do:**
Nothing. This is built into the database schema.

---

# SECTION 2 — THIRD-PARTY CONNECTIONS
## What needs an external account and exactly how to connect it

---

## 2.1 Two-Factor Authentication via SMS (Twilio)

**What this adds:**
Instead of a code generated by an authenticator app, staff receive a 6-digit
code via text message to their phone number. Some organizations prefer this
because staff do not need to install an app.

**Note:** The authenticator app version (Google Authenticator, Authy) is fully
built and works with zero setup. Twilio is only needed if you specifically want
SMS codes instead.

**How to set it up:**
1. Go to **twilio.com** and create a free account
2. Verify your phone number
3. Navigate to Console → Phone Numbers → Buy a Number (~$1/month)
4. Copy your Account SID and Auth Token from the console
5. Open your backend `.env` file and fill in:
   ```
   TWILIO_ACCOUNT_SID=your_account_sid_here
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_FROM_NUMBER=+1XXXXXXXXXX
   ```
6. Restart the backend server

**Cost:** Roughly $1/month for the phone number plus $0.0075 per SMS sent.
For 500 staff members logging in daily, approximately $115/month.

---

## 2.2 Staff Invitation and Patient Portal Emails (SendGrid)

**What this adds:**
When you invite a staff member, they automatically receive a professional email
with a link to set their password. When you create a patient portal account,
the patient automatically receives their invitation. Password reset emails
also work.

**Without this:** You have to manually tell staff their login credentials.
Everything else still works — invitations just don't send automatically.

**How to set it up:**
1. Go to **sendgrid.com** and create a free account
   (Free tier: 100 emails/day, plenty for starting out)
2. Go to Settings → API Keys → Create API Key
3. Choose "Restricted Access" and enable "Mail Send"
4. Copy the API key
5. Open your backend `.env` file and fill in:
   ```
   SENDGRID_API_KEY=SG.your_key_here
   EMAIL_FROM=noreply@yourdomain.com
   EMAIL_FROM_NAME=Wodoga Platform
   ```
6. Verify your sender domain in SendGrid (they walk you through it)
7. Restart the backend server

**Cost:** Free up to 100 emails/day. $19.95/month for up to 50,000 emails.

---

## 2.3 Real-Time Insurance Eligibility (Waystar or Availity)

**What this adds:**
Instead of the built-in simulation, eligibility checks query real insurance
databases and return actual live coverage status, copay amounts, and deductible
information in under 3 seconds.

**Option A — Availity (Recommended to start)**

Availity is free for Medicare, Medicaid, and most Blue Cross plans. This covers
the majority of home health patients. It is the most cost-effective starting point.

How to set it up:
1. Go to **availity.com** and click "Register"
2. Select "Healthcare Organization"
3. Complete the registration — you will need your organization's NPI number
4. Once approved (1-2 business days), go to your account → API Access
5. Create an application and note your Client ID and Client Secret
6. Open your backend `.env` file and fill in:
   ```
   ELIGIBILITY_PROVIDER=availity
   AVAILITY_API_URL=https://api.availity.com/availity/v1
   AVAILITY_CLIENT_ID=your_client_id
   AVAILITY_CLIENT_SECRET=your_client_secret
   ```
7. Restart the backend server

**Cost:** Free for most government payers. Small per-transaction fees for some
commercial plans.

**Option B — Waystar (For broader commercial coverage)**

Waystar connects to 1,000+ payers including all commercial plans.

How to set it up:
1. Go to **waystar.com** and contact their sales team for an API account
2. They will provide you a Submitter ID and API key
3. Open your backend `.env` file and fill in:
   ```
   ELIGIBILITY_PROVIDER=waystar
   WAYSTAR_API_URL=https://api.waystar.com/eligibility/v1
   WAYSTAR_API_KEY=your_api_key_here
   WAYSTAR_SUBMITTER_ID=your_submitter_id
   ```
4. Restart the backend server

**Cost:** Approximately $0.10–$0.25 per eligibility transaction.
For 500 checks per month, roughly $50–$125/month.

---

## 2.4 Pharmacy Order Integration

**What is built:**
The pharmaceutical order pipeline (Prescribed → Verified → Dispensed → In Transit
→ Delivered) is fully built. Staff can create orders, track them through stages,
and mark them delivered. This works with no external connection.

**What third-party connections can add:**

**Option A — Surescripts (E-Prescribing)**
Surescripts is the national e-prescribing network. Connecting to it allows
providers to send prescriptions electronically directly to any pharmacy in
America from within Wodoga.

How to connect:
1. Apply at **surescripts.com** for a developer account
2. You will need your organization's NPI and DEA number
3. Complete their certification process (takes 4-8 weeks — they have a strict
   approval process because this involves controlled substances)
4. Once certified, they provide API credentials
5. This requires a developer to implement — it is a complex integration with
   specific message formats (NCPDP SCRIPT standard)

**Cost:** Surescripts charges per transaction. Typically $0.10–$0.30 per
e-prescription sent. They also charge a monthly platform fee.

**Option B — DoseSpot or DrFirst (Simpler E-Prescribing)**
These are third-party e-prescribing services that sit on top of Surescripts.
They handle the Surescripts certification for you and provide a simpler API.

DoseSpot: **dosespot.com** — contact their team for pricing
DrFirst: **drfirst.com** — contact their team for pricing

Both offer white-label integrations that can be embedded into Wodoga.

**Option C — Pharmacy Direct Connections**
Large pharmacy chains (CVS, Walgreens, Express Scripts) have their own APIs
for tracking order status. Connecting to these allows Wodoga to automatically
update order stages without staff doing it manually.

These connections are possible to build but require a business agreement with
each pharmacy chain. This is typically done once you have established client
volume that justifies the partnership.

---

## 2.5 Electronic Claims Submission (Clearinghouse)

**What is built:**
The billing module lets staff create and track claims manually. Status is
updated manually as responses come from insurers.

**What a clearinghouse adds:**
Claims are submitted electronically from Wodoga directly to insurance companies.
Responses (approved, denied, more information needed) come back automatically
and update the claim status without any manual work.

**Option A — Waystar (Most widely used in home health)**

1. Contact **waystar.com** for a clearinghouse account
2. They will assign you a Submitter ID
3. They provide API credentials for claim submission
4. A developer adds the claim submission endpoints to the billing module
   (approximately 2-3 days of development work on top of what is already built)

**Cost:** Typically $0.25–$0.45 per claim submitted electronically.
For a clinic submitting 200 claims per month, approximately $50–$90/month.

**Option B — Change Healthcare (Optum)**
The largest clearinghouse by volume. Enterprise pricing, better for larger
organizations. Contact **changehealthcare.com**.

---

## 2.6 OASIS Electronic Submission to CMS

**What is built:**
The OASIS assessment form captures all required data and stores it in the database.

**What additional connection adds:**
Electronic submission directly to CMS (the federal agency that requires OASIS).
Currently staff would need to export OASIS data and submit through a state-specific
system.

**How to connect:**
Most home health billing software (including clearinghouses like Waystar) includes
OASIS submission as part of their package. When you set up a clearinghouse account,
ask specifically about OASIS-E electronic submission. It is typically included.

Alternatively, some states use the **iQIES system** (CMS's own portal).
Account setup is free at **iqies.cms.gov**.

---

## 2.7 Document Storage for Large Files (Azure Blob Storage)

**What is built:**
The document metadata system (tracking who uploaded what, when, and for which
patient) is fully built in the database.

**What Azure Blob Storage adds:**
Actual file uploads (PDFs, images, physician orders, insurance cards) stored
securely in the cloud rather than on your local computer. This is required for
any production deployment.

**How to set it up:**
1. Create a Microsoft Azure account at **portal.azure.com**
   (Free tier: 5GB of storage free for 12 months)
2. Create a Storage Account:
   - Click "Create a resource" → "Storage account"
   - Choose a name (e.g., wodogastorage)
   - Select your region
   - Click Create
3. Inside the Storage Account, create two containers:
   - `documents`
   - `signatures`
   - Set both to "Private" access level
4. Go to Access Keys → Copy the connection string
5. Open your backend `.env` file and fill in:
   ```
   AZURE_STORAGE_ACCOUNT_NAME=wodogastorage
   AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
   AZURE_STORAGE_CONTAINER_DOCUMENTS=documents
   AZURE_STORAGE_CONTAINER_SIGNATURES=signatures
   ```
6. Restart the backend server

**Cost:** First 5GB free. After that, approximately $0.018 per GB per month.
For a typical home health clinic with 500 patients, expect 10-50GB total
across all documents — roughly $1-$5/month in storage costs.

---

## 2.8 Push Notifications to Phones

**What is built:**
In-app notification bell with real-time alerts for O₂ flags, denied claims,
new referrals, and other events.

**What push notifications add:**
Alerts sent directly to the provider's phone even when they are not on the
Wodoga website. For example, a 2 AM O₂ alert that wakes a physician.

**How to set it up:**
This requires a service called **Firebase Cloud Messaging (FCM)** from Google.
It is free for most use cases.

1. Go to **firebase.google.com** and create a project
2. Go to Project Settings → Cloud Messaging → Generate a Server Key
3. A developer adds the push notification code to the frontend
   (approximately 1-2 days of additional development)
4. Add the FCM server key to the backend `.env`

**Cost:** Free for up to 1 million messages/month.

---

## 2.9 SMS Notifications for Patients and Staff

**What this adds:**
Text message reminders to patients before visits, alerts to on-call staff,
and password reset codes via SMS.

**How to set it up:**
Uses the same Twilio account from Section 2.1.

The backend already has Twilio integrated. Once you add the Twilio credentials
to `.env`, SMS features activate. Specific SMS workflows (appointment reminders,
on-call alerts) require small additions to the backend — approximately one day
of development per workflow type.

**Cost:** $0.0075 per SMS. For 500 appointment reminders per month, approximately
$3.75/month.

---

## 2.10 Video Visits (Telehealth)

**Note:** Telehealth was intentionally removed from the Wodoga platform at your
request. The section below is included for completeness if you ever decide
to add it back.

The two best options for HIPAA-compliant video:

**Daily.co** — simpler integration, developer-friendly
- **daily.co** → Create account → Get API key → Add to `.env`
- Approximately 2-3 days of development to embed in the platform
- Cost: $0.0035 per minute of video per participant

**Twilio Video** — uses the same Twilio account as SMS
- Extends your existing Twilio account
- Approximately 3-4 days of development
- Cost: $0.004 per minute per participant

---

# SECTION 3 — WHAT YOUR CLIENTS NEED TO DO

When a new clinic subscribes to Wodoga, here is exactly what they do and
what you do on your side.

---

**What you do:**

1. Create a new organization record in your admin database
2. Set up their roles and assign permissions
3. Create their first admin account and send them the login link
4. Sign their Business Associate Agreement (required by HIPAA)

This takes approximately 15 minutes per new client.

---

**What the client does:**

1. Signs your Terms of Service and BAA (digital signature)
2. Logs in with the admin account you created
3. Goes to Staff → Invite Staff for each employee
   - Each employee receives an invitation email
   - They click the link, set their own password, and set up their MFA
4. Goes to Eligibility → Provider Contracts for each physician
   - Checks the boxes for which insurances that physician accepts
   - Takes about 5 minutes per provider
5. Adds existing patients by importing a CSV file or entering manually
6. Their staff start using the platform

Total onboarding time for a 50-person clinic: approximately 4-6 hours
for their admin, mostly spent entering staff accounts.

---

# SECTION 4 — PRIORITY ORDER FOR CONNECTING THINGS

If you are setting up Wodoga for your first pilot client, connect these
in this order:

| Priority | What | Why |
|----------|------|-----|
| 1 | MFA via Authenticator App | Already built, free, just needs to be activated by each user |
| 2 | SendGrid | So staff invitation emails work automatically |
| 3 | Azure Blob Storage | So document uploads work |
| 4 | Availity (Eligibility) | Converts the demo to real insurance checks, mostly free |
| 5 | Waystar (Claims) | Automates billing workflow significantly |
| 6 | Twilio (SMS) | Patient reminders and on-call alerts |
| 7 | Surescripts or DoseSpot | E-prescribing, requires more setup time |
| 8 | OASIS Submission | Required for Medicare billing |

The first three are essential. Items 4-8 can be activated over time as you grow.

---

# SECTION 5 — WHAT REQUIRES A DEVELOPER

Most of what is described above is configuration — filling in API keys and
restarting the server. The following items require actual development work
on top of the existing codebase:

| Item | Estimated Effort |
|------|-----------------|
| Surescripts e-prescribing integration | 1-2 weeks |
| Electronic claims submission (clearinghouse) | 2-3 days |
| Push notifications to phones (FCM) | 1-2 days |
| Pharmacy chain direct connections (CVS, Walgreens API) | 1-2 weeks each |
| OASIS electronic CMS submission | 3-5 days |
| SMS appointment reminder automation | 1-2 days |

None of these are required to launch. They are enhancements that increase
automation over time. A freelance developer on Upwork can complete most
of them for $500-$2,000 per item at market rates.

---

# SUMMARY TABLE

| Feature | Status | What You Need |
|---------|--------|---------------|
| Patient Records | ✅ Fully built | Nothing |
| Visit Scheduling | ✅ Fully built | Nothing |
| GPS Check-In | ✅ Fully built | Nothing (browser handles GPS) |
| SOAP Documentation | ✅ Fully built | Nothing |
| Vitals + Alerts | ✅ Fully built | Nothing |
| Care Plans | ✅ Fully built | Nothing |
| Medication Management | ✅ Fully built | Nothing |
| Medication Reconciliation (basic) | ✅ Fully built | Nothing |
| Pharmaceutical Order Pipeline | ✅ Fully built | Nothing |
| Referral Pipeline | ✅ Fully built | Nothing |
| Billing Claims (manual) | ✅ Fully built | Nothing |
| OASIS Forms | ✅ Fully built | Nothing |
| Secure Messaging | ✅ Fully built | Nothing |
| Patient Portal | ✅ Fully built | Nothing |
| Audit Log | ✅ Fully built | Nothing |
| Role-Based Access | ✅ Fully built | Nothing |
| Multi-Tenant Isolation | ✅ Fully built | Nothing |
| MFA via Authenticator App | ✅ Built, user activates | Free app on their phone |
| Staff Invitation Emails | ⚙ Needs activation | SendGrid (free tier available) |
| Real Eligibility Checks | ⚙ Needs activation | Availity (free) or Waystar |
| Document File Uploads | ⚙ Needs activation | Azure Blob Storage |
| MFA via SMS | ⚙ Needs activation | Twilio (~$1/month) |
| Electronic Claims | ⚙ Needs developer | Waystar clearinghouse |
| E-Prescribing | ⚙ Needs developer | Surescripts or DoseSpot |
| Push Notifications | ⚙ Needs developer | Firebase (free) |
| OASIS CMS Submission | ⚙ Needs developer | iQIES or clearinghouse |
| Cloud Deployment | ⚙ Needs Azure account | Microsoft Azure |
