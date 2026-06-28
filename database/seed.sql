-- ============================================================
-- WODOGA PLATFORM — DATABASE SEED FILE
-- Run after schema.sql
-- Creates default roles, permissions, and a demo organization
-- ============================================================

-- ============================================================
-- DEFAULT PERMISSIONS REFERENCE
-- These permission strings are what the backend checks against.
-- ============================================================

-- PERMISSION MANIFEST (for reference — enforced in application)
-- patients:view          patients:create         patients:edit
-- patients:delete        intake_forms:create     intake_forms:view
-- visits:view            visits:create           visits:edit
-- visits:checkin         visits:soap_note        care_plans:view
-- care_plans:create      vitals:view             vitals:create
-- medications:view       medications:prescribe   medications:reconcile
-- pharm_orders:view      pharm_orders:create     pharm_orders:advance
-- referrals:view         referrals:create        referrals:advance
-- billing:view           billing:create          billing:update
-- eligibility:check      oasis:view              oasis:create
-- messages:send          messages:view           documents:view
-- documents:upload       staff:view              staff:manage
-- audit:view             notifications:view      portal:access
-- reports:view           organizations:manage

-- ============================================================
-- DEMO ORGANIZATION
-- ============================================================
INSERT INTO organizations (
  id, name, slug, type, email, phone,
  address_line1, city, state, zip,
  subscription_tier, subscription_status,
  hipaa_baa_signed, hipaa_baa_signed_at, hipaa_baa_signed_by
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Arlington Home Health & Pharmacy',
  'arlington-home-health',
  'both',
  'admin@arlingtonhh.com',
  '(817) 555-1000',
  '100 Healthcare Blvd',
  'Arlington', 'TX', '76010',
  'professional', 'active',
  TRUE, NOW(), 'Dr. Sarah Johnson'
);

-- ============================================================
-- DEFAULT ROLES FOR DEMO ORGANIZATION
-- ============================================================

INSERT INTO roles (id, organization_id, name, display_name, permissions) VALUES

-- ADMIN: Full access to everything
('b0000000-0000-0000-0000-000000000001',
 'a0000000-0000-0000-0000-000000000001',
 'admin', 'Administrator',
 '["patients:view","patients:create","patients:edit","patients:delete",
   "intake_forms:create","intake_forms:view",
   "visits:view","visits:create","visits:edit","visits:checkin","visits:soap_note",
   "care_plans:view","care_plans:create",
   "vitals:view","vitals:create",
   "medications:view","medications:prescribe","medications:reconcile",
   "pharm_orders:view","pharm_orders:create","pharm_orders:advance",
   "referrals:view","referrals:create","referrals:advance",
   "billing:view","billing:create","billing:update",
   "eligibility:check",
   "oasis:view","oasis:create",
   "messages:send","messages:view",
   "documents:view","documents:upload",
   "staff:view","staff:manage",
   "audit:view",
   "notifications:view",
   "reports:view",
   "organizations:manage"]'::jsonb),

-- PROVIDER: Clinical focus — patients, prescribing, care plans
('b0000000-0000-0000-0000-000000000002',
 'a0000000-0000-0000-0000-000000000001',
 'provider', 'Provider / Physician',
 '["patients:view","patients:create","patients:edit",
   "intake_forms:view","intake_forms:create",
   "visits:view","visits:create","visits:edit","visits:soap_note",
   "care_plans:view","care_plans:create",
   "vitals:view","vitals:create",
   "medications:view","medications:prescribe","medications:reconcile",
   "pharm_orders:view",
   "referrals:view","referrals:create","referrals:advance",
   "eligibility:check",
   "oasis:view","oasis:create",
   "messages:send","messages:view",
   "documents:view","documents:upload",
   "notifications:view",
   "reports:view"]'::jsonb),

-- PHARMACY STAFF: Medication and order focus
('b0000000-0000-0000-0000-000000000003',
 'a0000000-0000-0000-0000-000000000001',
 'pharmacy_staff', 'Pharmacy Staff',
 '["patients:view",
   "medications:view",
   "pharm_orders:view","pharm_orders:create","pharm_orders:advance",
   "messages:send","messages:view",
   "documents:view","documents:upload",
   "notifications:view"]'::jsonb),

-- BILLER: Billing and eligibility focus
('b0000000-0000-0000-0000-000000000004',
 'a0000000-0000-0000-0000-000000000001',
 'biller', 'Billing Specialist',
 '["patients:view",
   "billing:view","billing:create","billing:update",
   "eligibility:check",
   "documents:view",
   "messages:send","messages:view",
   "notifications:view",
   "reports:view"]'::jsonb),

-- VIEWER: Read-only access for supervisors / auditors
('b0000000-0000-0000-0000-000000000005',
 'a0000000-0000-0000-0000-000000000001',
 'viewer', 'Read-Only Viewer',
 '["patients:view",
   "visits:view",
   "care_plans:view",
   "vitals:view",
   "medications:view",
   "billing:view",
   "messages:view",
   "documents:view",
   "notifications:view"]'::jsonb),

-- CAREGIVER: Field-focused — visits, vitals, patient care
('b0000000-0000-0000-0000-000000000006',
 'a0000000-0000-0000-0000-000000000001',
 'caregiver', 'Caregiver / CNA',
 '["patients:view",
   "intake_forms:view",
   "visits:view","visits:create","visits:checkin","visits:soap_note",
   "vitals:view","vitals:create",
   "medications:view",
   "messages:send","messages:view",
   "documents:view","documents:upload",
   "notifications:view"]'::jsonb),

-- PATIENT: Portal access — own records only
('b0000000-0000-0000-0000-000000000007',
 'a0000000-0000-0000-0000-000000000001',
 'patient', 'Patient Portal',
 '["portal:access",
   "messages:send","messages:view",
   "notifications:view"]'::jsonb);

-- ============================================================
-- DEMO STAFF USERS
-- Passwords are bcrypt hashes of 'Demo1234!'
-- CHANGE ALL PASSWORDS BEFORE ANY PRODUCTION USE
-- ============================================================

INSERT INTO users (
  id, organization_id, role_id,
  first_name, last_name, email, phone,
  password_hash, license_number, license_type,
  is_active, is_email_verified
) VALUES

-- Admin
('c0000000-0000-0000-0000-000000000001',
 'a0000000-0000-0000-0000-000000000001',
 'b0000000-0000-0000-0000-000000000001',
 'Sarah', 'Johnson', 's.johnson@arlingtonhh.com', '(817) 555-1001',
 '$2b$12$DEMO_HASH_REPLACE_BEFORE_PRODUCTION_USE_admin',
 'MD-112233', 'MD', TRUE, TRUE),

-- Provider
('c0000000-0000-0000-0000-000000000002',
 'a0000000-0000-0000-0000-000000000001',
 'b0000000-0000-0000-0000-000000000002',
 'Michael', 'Chen', 'm.chen@arlingtonhh.com', '(817) 555-1002',
 '$2b$12$DEMO_HASH_REPLACE_BEFORE_PRODUCTION_USE_provider',
 'MD-998877', 'MD', TRUE, TRUE),

-- Pharmacy Staff
('c0000000-0000-0000-0000-000000000003',
 'a0000000-0000-0000-0000-000000000001',
 'b0000000-0000-0000-0000-000000000003',
 'Lisa', 'Patel', 'l.patel@arlingtonhh.com', '(817) 555-1003',
 '$2b$12$DEMO_HASH_REPLACE_BEFORE_PRODUCTION_USE_pharmacy',
 'RPh-445566', 'RPh', TRUE, TRUE),

-- Caregiver
('c0000000-0000-0000-0000-000000000004',
 'a0000000-0000-0000-0000-000000000001',
 'b0000000-0000-0000-0000-000000000006',
 'Carlos', 'Rivera', 'c.rivera@arlingtonhh.com', '(817) 555-1004',
 '$2b$12$DEMO_HASH_REPLACE_BEFORE_PRODUCTION_USE_caregiver',
 'CNA-778899', 'CNA', TRUE, TRUE),

-- Biller
('c0000000-0000-0000-0000-000000000005',
 'a0000000-0000-0000-0000-000000000001',
 'b0000000-0000-0000-0000-000000000004',
 'Amy', 'Brooks', 'a.brooks@arlingtonhh.com', '(817) 555-1005',
 '$2b$12$DEMO_HASH_REPLACE_BEFORE_PRODUCTION_USE_biller',
 NULL, NULL, TRUE, TRUE);

-- ============================================================
-- PROVIDER INSURANCE CONTRACTS (Demo)
-- ============================================================
INSERT INTO provider_insurance_contracts (
  organization_id, provider_id,
  insurance_provider, plan_type, payer_id,
  is_accepting_new, is_active
) VALUES
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'Medicare', 'Medicare', '00010', TRUE, TRUE),
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'Medicaid', 'Medicaid', '77777', TRUE, TRUE),
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'Blue Cross Blue Shield', 'PPO', '00620', TRUE, TRUE),
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'Aetna', 'HMO', '60054', TRUE, TRUE),
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'United Healthcare', 'PPO', '87726', FALSE, TRUE);

-- ============================================================
-- SCHEMA MIGRATION RECORD
-- ============================================================
INSERT INTO schema_migrations (version, description)
VALUES ('002', 'Demo organization, roles, staff, and provider contracts seeded');
