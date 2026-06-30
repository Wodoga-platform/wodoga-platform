-- ============================================================
-- WODOGA PLATFORM — PRODUCTION DATABASE SCHEMA
-- PostgreSQL 15+
-- Multi-tenant, HIPAA-conscious, row-level security enabled
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ============================================================
-- UTILITY: Auto-update updated_at timestamps
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLE 1: ORGANIZATIONS
-- Every client organization that subscribes to Wodoga.
-- This is the top-level tenant separator.
-- ============================================================
CREATE TABLE organizations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  slug                CITEXT UNIQUE NOT NULL,         -- URL-safe identifier e.g. "arlington-home-health"
  type                TEXT NOT NULL CHECK (type IN ('home_health', 'pharmacy', 'both')),
  email               CITEXT NOT NULL,
  phone               TEXT,
  address_line1       TEXT,
  address_line2       TEXT,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  npi_number          TEXT,                            -- National Provider Identifier
  tax_id              TEXT,                            -- Encrypted at application layer
  subscription_tier   TEXT NOT NULL DEFAULT 'trial'
                        CHECK (subscription_tier IN ('trial', 'basic', 'professional', 'enterprise')),
  subscription_status TEXT NOT NULL DEFAULT 'active'
                        CHECK (subscription_status IN ('active', 'suspended', 'cancelled')),
  hipaa_baa_signed    BOOLEAN NOT NULL DEFAULT FALSE,
  hipaa_baa_signed_at TIMESTAMPTZ,
  hipaa_baa_signed_by TEXT,
  logo_url            TEXT,
  settings            JSONB NOT NULL DEFAULT '{}',    -- Org-level config (timezone, preferences, etc.)
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ                     -- Soft delete
);

CREATE TRIGGER set_updated_at_organizations
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_status ON organizations(subscription_status);

-- ============================================================
-- TABLE 2: ROLES
-- System-defined roles scoped per organization.
-- ============================================================
CREATE TABLE roles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL CHECK (name IN (
                    'admin', 'provider', 'pharmacy_staff',
                    'biller', 'viewer', 'caregiver', 'patient'
                  )),
  display_name    TEXT NOT NULL,
  permissions     JSONB NOT NULL DEFAULT '[]',        -- Array of permission strings
  is_system_role  BOOLEAN NOT NULL DEFAULT TRUE,      -- System roles cannot be deleted
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

CREATE TRIGGER set_updated_at_roles
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_roles_organization ON roles(organization_id);

-- ============================================================
-- TABLE 3: USERS
-- All staff members and patients who log into Wodoga.
-- ============================================================
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id               UUID NOT NULL REFERENCES roles(id),
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  email                 CITEXT NOT NULL,
  phone                 TEXT,
  password_hash         TEXT NOT NULL,                -- bcrypt hash, never plaintext
  mfa_secret            TEXT,                         -- TOTP secret, encrypted at app layer
  mfa_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  license_number        TEXT,                         -- Clinical license number
  license_type          TEXT,                         -- RN, MD, CNA, RPh, etc.
  npi_number            TEXT,                         -- For provider users
  profile_photo_url     TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_email_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at     TIMESTAMPTZ,
  password_changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  password_reset_token  TEXT,
  password_reset_exp    TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  last_login_ip         INET,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,                  -- Account lockout after failed attempts
  invite_token          TEXT,                         -- For staff onboarding invitations
  invite_expires_at     TIMESTAMPTZ,
  settings              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,                  -- Soft delete
  UNIQUE(organization_id, email)
);

CREATE TRIGGER set_updated_at_users
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_users_organization ON users(organization_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_active ON users(is_active) WHERE deleted_at IS NULL;

-- ============================================================
-- TABLE 4: REFRESH TOKENS
-- Tracks active JWT refresh tokens for session management.
-- ============================================================
CREATE TABLE refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,               -- SHA-256 hash of the token
  expires_at      TIMESTAMPTZ NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  revoked         BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expiry ON refresh_tokens(expires_at);

-- ============================================================
-- TABLE 5: PATIENTS
-- Every patient record, scoped to one organization.
-- ============================================================
CREATE TABLE patients (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assigned_caregiver  UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_provider   UUID REFERENCES users(id) ON DELETE SET NULL,
  portal_user_id      UUID REFERENCES users(id) ON DELETE SET NULL, -- Patient portal login
  mrn                 TEXT,                                          -- Medical Record Number
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  date_of_birth       DATE NOT NULL,
  gender              TEXT CHECK (gender IN ('male', 'female', 'non_binary', 'other', 'prefer_not_to_say')),
  phone               TEXT,
  email               CITEXT,
  address_line1       TEXT,
  address_line2       TEXT,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  blood_type          TEXT CHECK (blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-','unknown')),
  primary_diagnosis   TEXT,
  secondary_diagnoses TEXT[],                         -- Array of additional diagnoses
  allergies           TEXT[],                         -- Array of known allergies
  medical_history     TEXT,
  emergency_contact   JSONB,                          -- {name, relationship, phone, email}
  insurance_primary   JSONB,                          -- {provider, member_id, group_id, plan_name}
  insurance_secondary JSONB,
  admission_date      DATE,
  discharge_date      DATE,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'discharged', 'on_hold', 'deceased', 'transferred')),
  fall_risk           TEXT CHECK (fall_risk IN ('low', 'moderate', 'high')),
  notes               TEXT,
  photo_url           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,                    -- Soft delete preserves records for compliance
  deleted_by          UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TRIGGER set_updated_at_patients
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_patients_organization ON patients(organization_id);
CREATE INDEX idx_patients_caregiver ON patients(assigned_caregiver);
CREATE INDEX idx_patients_provider ON patients(assigned_provider);
CREATE INDEX idx_patients_status ON patients(status);
CREATE INDEX idx_patients_dob ON patients(date_of_birth);
-- Full text search on patient names
CREATE INDEX idx_patients_name_search ON patients USING gin(
  to_tsvector('english', first_name || ' ' || last_name)
);

-- ============================================================
-- TABLE 6: INTAKE FORMS
-- Digital admission intake forms with signature tracking.
-- ============================================================
CREATE TABLE intake_forms (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  completed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  form_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  chief_complaint     TEXT,
  onset_date          DATE,
  referring_physician TEXT,
  symptoms            TEXT,
  current_medications TEXT,
  fall_risk_level     TEXT CHECK (fall_risk_level IN ('low', 'moderate', 'high')),
  functional_status   TEXT CHECK (functional_status IN ('independent', 'needs_assistance', 'dependent')),
  living_situation    TEXT,
  advance_directive   BOOLEAN,
  signature_url       TEXT,                           -- URL to signed signature image in Blob Storage
  signed_at           TIMESTAMPTZ,
  is_signed           BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'complete'
                        CHECK (status IN ('draft', 'complete', 'requires_review')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_intake_forms
  BEFORE UPDATE ON intake_forms
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_intake_forms_organization ON intake_forms(organization_id);
CREATE INDEX idx_intake_forms_patient ON intake_forms(patient_id);

-- ============================================================
-- TABLE 7: CARE PLANS
-- Physician-approved care plans linked to patients.
-- ============================================================
CREATE TABLE care_plans (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  primary_diagnosis   TEXT NOT NULL,
  ordering_physician  TEXT NOT NULL,
  start_date          DATE NOT NULL,
  end_date            DATE,
  review_date         DATE,
  visit_frequency     TEXT NOT NULL,                  -- e.g. "3x/week", "Daily"
  duration            TEXT,                           -- e.g. "60 days"
  goals               TEXT,
  interventions       TEXT,
  expected_outcomes   TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  physician_signature_url TEXT,
  physician_signed_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_care_plans
  BEFORE UPDATE ON care_plans
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_care_plans_organization ON care_plans(organization_id);
CREATE INDEX idx_care_plans_patient ON care_plans(patient_id);
CREATE INDEX idx_care_plans_status ON care_plans(status);

-- ============================================================
-- TABLE 8: VISITS
-- All home visits — scheduled, completed, or cancelled.
-- ============================================================
CREATE TABLE visits (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  care_plan_id        UUID REFERENCES care_plans(id) ON DELETE SET NULL,
  caregiver_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  visit_date          DATE NOT NULL,
  visit_time          TIME,
  visit_type          TEXT NOT NULL CHECK (visit_type IN (
                        'wellness_check', 'medication_administration', 'wound_care',
                        'physical_therapy', 'occupational_therapy', 'post_surgery_care',
                        'chronic_disease_management', 'hospice_support', 'other'
                      )),
  status              TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'missed')),
  -- GPS Check-in data
  checkin_at          TIMESTAMPTZ,
  checkin_lat         DECIMAL(9,6),
  checkin_lon         DECIMAL(9,6),
  checkout_at         TIMESTAMPTZ,
  checkout_lat        DECIMAL(9,6),
  checkout_lon        DECIMAL(9,6),
  duration_minutes    INTEGER,
  -- SOAP Note
  soap_subjective     TEXT,
  soap_objective      TEXT,
  soap_assessment     TEXT,
  soap_plan           TEXT,
  soap_documented_at  TIMESTAMPTZ,
  soap_documented_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  clinician_signature_url TEXT,
  -- Scheduling notes
  notes               TEXT,
  cancellation_reason TEXT,
  cancelled_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_visits
  BEFORE UPDATE ON visits
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_visits_organization ON visits(organization_id);
CREATE INDEX idx_visits_patient ON visits(patient_id);
CREATE INDEX idx_visits_caregiver ON visits(caregiver_id);
CREATE INDEX idx_visits_date ON visits(visit_date);
CREATE INDEX idx_visits_status ON visits(status);

-- ============================================================
-- TABLE 9: VITALS
-- Patient vital signs recorded per visit or independently.
-- ============================================================
CREATE TABLE vitals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id            UUID REFERENCES visits(id) ON DELETE SET NULL,
  recorded_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Vital measurements (all nullable — record only what was taken)
  bp_systolic         INTEGER CHECK (bp_systolic BETWEEN 40 AND 300),
  bp_diastolic        INTEGER CHECK (bp_diastolic BETWEEN 20 AND 200),
  bp_position         TEXT CHECK (bp_position IN ('sitting', 'standing', 'lying')),
  heart_rate          INTEGER CHECK (heart_rate BETWEEN 20 AND 300),
  heart_rhythm        TEXT CHECK (heart_rhythm IN ('regular', 'irregular')),
  oxygen_saturation   INTEGER CHECK (oxygen_saturation BETWEEN 50 AND 100),
  oxygen_delivery     TEXT,                           -- e.g. "Room air", "2L nasal cannula"
  temperature         DECIMAL(4,1),
  temperature_route   TEXT CHECK (temperature_route IN ('oral', 'axillary', 'rectal', 'tympanic', 'temporal')),
  respiratory_rate    INTEGER CHECK (respiratory_rate BETWEEN 4 AND 60),
  weight_lbs          DECIMAL(5,1),
  blood_glucose       INTEGER,
  blood_glucose_timing TEXT CHECK (blood_glucose_timing IN ('fasting', 'pre_meal', 'post_meal', 'bedtime', 'random')),
  pain_scale          INTEGER CHECK (pain_scale BETWEEN 0 AND 10),
  pain_location       TEXT,
  -- Alert flags (set automatically by application logic)
  flag_low_o2         BOOLEAN NOT NULL DEFAULT FALSE,
  flag_high_bp        BOOLEAN NOT NULL DEFAULT FALSE,
  flag_low_bp         BOOLEAN NOT NULL DEFAULT FALSE,
  flag_high_glucose   BOOLEAN NOT NULL DEFAULT FALSE,
  flag_low_glucose    BOOLEAN NOT NULL DEFAULT FALSE,
  flag_high_temp      BOOLEAN NOT NULL DEFAULT FALSE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Vitals are never updated — a new record is always created
);

CREATE INDEX idx_vitals_organization ON vitals(organization_id);
CREATE INDEX idx_vitals_patient ON vitals(patient_id);
CREATE INDEX idx_vitals_visit ON vitals(visit_id);
CREATE INDEX idx_vitals_recorded_at ON vitals(recorded_at DESC);
CREATE INDEX idx_vitals_flags ON vitals(flag_low_o2, flag_high_bp) WHERE flag_low_o2 = TRUE OR flag_high_bp = TRUE;

-- ============================================================
-- TABLE 10: MEDICATIONS
-- All active prescriptions per patient.
-- ============================================================
CREATE TABLE medications (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  prescribed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  drug_name           TEXT NOT NULL,
  brand_name          TEXT,
  dosage              TEXT NOT NULL,
  dosage_unit         TEXT,
  route               TEXT NOT NULL CHECK (route IN (
                        'oral', 'topical', 'inhalation', 'injection',
                        'sublingual', 'transdermal', 'ophthalmic', 'otic', 'rectal', 'other'
                      )),
  frequency           TEXT NOT NULL,
  frequency_code      TEXT,                           -- SIG codes: QD, BID, TID, QID, PRN
  start_date          DATE,
  end_date            DATE,
  refills_remaining   INTEGER NOT NULL DEFAULT 0 CHECK (refills_remaining >= 0),
  next_refill_date    DATE,
  prescriber_name     TEXT,
  prescriber_npi      TEXT,
  pharmacy_name       TEXT,
  pharmacy_phone      TEXT,
  dea_number          TEXT,                           -- For controlled substances
  controlled_substance BOOLEAN NOT NULL DEFAULT FALSE,
  schedule            TEXT,                           -- Schedule II, III, IV, V
  instructions        TEXT,
  contraindications   TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'discontinued', 'on_hold', 'completed')),
  discontinued_reason TEXT,
  discontinued_at     TIMESTAMPTZ,
  discontinued_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_medications
  BEFORE UPDATE ON medications
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_medications_organization ON medications(organization_id);
CREATE INDEX idx_medications_patient ON medications(patient_id);
CREATE INDEX idx_medications_status ON medications(status);
CREATE INDEX idx_medications_refills ON medications(refills_remaining) WHERE refills_remaining <= 1;

-- ============================================================
-- TABLE 11: MEDICATION RECONCILIATION RECORDS
-- Documents formal reconciliation reviews and any conflicts found.
-- ============================================================
CREATE TABLE medication_reconciliations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  performed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conflicts_found     BOOLEAN NOT NULL DEFAULT FALSE,
  conflict_details    JSONB,                          -- Array of detected conflicts
  resolution_notes    TEXT,
  reviewed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'pending_review'
                        CHECK (status IN ('pending_review', 'reviewed', 'escalated')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_med_recon_organization ON medication_reconciliations(organization_id);
CREATE INDEX idx_med_recon_patient ON medication_reconciliations(patient_id);

-- ============================================================
-- TABLE 12: PHARMACEUTICAL ORDERS
-- Tracks medication orders through the delivery pipeline.
-- ============================================================
CREATE TABLE pharmaceutical_orders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medication_id       UUID REFERENCES medications(id) ON DELETE SET NULL,
  ordered_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  drug_name           TEXT NOT NULL,
  quantity            TEXT NOT NULL,
  quantity_unit       TEXT,
  pharmacy_name       TEXT,
  pharmacy_phone      TEXT,
  pharmacy_fax        TEXT,
  order_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery   DATE,
  actual_delivery     DATE,
  tracking_number     TEXT,
  stage               TEXT NOT NULL DEFAULT 'prescribed'
                        CHECK (stage IN (
                          'prescribed', 'verified', 'dispensed',
                          'in_transit', 'delivered', 'cancelled'
                        )),
  is_urgent           BOOLEAN NOT NULL DEFAULT FALSE,
  special_instructions TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_pharmaceutical_orders
  BEFORE UPDATE ON pharmaceutical_orders
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_pharm_orders_organization ON pharmaceutical_orders(organization_id);
CREATE INDEX idx_pharm_orders_patient ON pharmaceutical_orders(patient_id);
CREATE INDEX idx_pharm_orders_stage ON pharmaceutical_orders(stage);

-- ============================================================
-- TABLE 13: REFERRALS
-- Incoming patient referrals moving through the intake pipeline.
-- ============================================================
CREATE TABLE referrals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  converted_patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  managed_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Prospective patient info
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  date_of_birth       DATE,
  phone               TEXT,
  email               CITEXT,
  -- Referral details
  referral_source     TEXT,                           -- Hospital, physician, self, etc.
  referring_physician TEXT,
  referring_npi       TEXT,
  referral_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  diagnosis           TEXT,
  requested_services  TEXT[],
  urgency             TEXT NOT NULL DEFAULT 'routine'
                        CHECK (urgency IN ('routine', 'urgent', 'emergent')),
  -- Insurance
  insurance_provider  TEXT,
  insurance_id        TEXT,
  insurance_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Pipeline stage
  stage               TEXT NOT NULL DEFAULT 'new_lead'
                        CHECK (stage IN (
                          'new_lead', 'contacted', 'evaluating',
                          'insurance_check', 'admitted', 'declined', 'lost'
                        )),
  declined_reason     TEXT,
  notes               TEXT,
  follow_up_date      DATE,
  admitted_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_referrals
  BEFORE UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_referrals_organization ON referrals(organization_id);
CREATE INDEX idx_referrals_stage ON referrals(stage);
CREATE INDEX idx_referrals_follow_up ON referrals(follow_up_date) WHERE follow_up_date IS NOT NULL;

-- ============================================================
-- TABLE 14: PROVIDER INSURANCE CONTRACTS
-- Which insurance plans each provider in the organization accepts.
-- ============================================================
CREATE TABLE provider_insurance_contracts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  insurance_provider  TEXT NOT NULL,
  plan_name           TEXT,
  plan_type           TEXT CHECK (plan_type IN ('HMO', 'PPO', 'EPO', 'POS', 'HDHP', 'Medicare', 'Medicaid', 'other')),
  payer_id            TEXT,                           -- Electronic payer ID for claims
  contract_start      DATE,
  contract_end        DATE,
  is_accepting_new    BOOLEAN NOT NULL DEFAULT TRUE,  -- Accepting new patients under this plan
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, provider_id, insurance_provider, plan_name)
);

CREATE TRIGGER set_updated_at_provider_insurance
  BEFORE UPDATE ON provider_insurance_contracts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_provider_insurance_org ON provider_insurance_contracts(organization_id);
CREATE INDEX idx_provider_insurance_provider ON provider_insurance_contracts(provider_id);
CREATE INDEX idx_provider_insurance_payer ON provider_insurance_contracts(insurance_provider);

-- ============================================================
-- TABLE 15: INSURANCE ELIGIBILITY CHECKS
-- Record of every eligibility verification performed.
-- ============================================================
CREATE TABLE insurance_eligibility_checks (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID REFERENCES patients(id) ON DELETE SET NULL,
  checked_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  checked_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  insurance_provider  TEXT NOT NULL,
  member_id           TEXT NOT NULL,
  group_id            TEXT,
  service_date        DATE,
  -- Result
  result              TEXT NOT NULL CHECK (result IN ('eligible', 'not_eligible', 'pending_review', 'error')),
  coverage_active     BOOLEAN,
  coverage_details    JSONB,                          -- Full response from eligibility API
  copay_amount        DECIMAL(8,2),
  deductible_remaining DECIMAL(8,2),
  -- External API tracking
  api_provider        TEXT,                           -- 'waystar', 'availity', 'simulated'
  api_transaction_id  TEXT,
  api_response_raw    TEXT,                           -- Stored for compliance and debugging
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Never updated — always append-only
);

CREATE INDEX idx_eligibility_organization ON insurance_eligibility_checks(organization_id);
CREATE INDEX idx_eligibility_patient ON insurance_eligibility_checks(patient_id);
CREATE INDEX idx_eligibility_checked_at ON insurance_eligibility_checks(checked_at DESC);

-- ============================================================
-- TABLE 16: BILLING CLAIMS
-- Insurance claims and payment tracking.
-- ============================================================
CREATE TABLE billing_claims (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id            UUID REFERENCES visits(id) ON DELETE SET NULL,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  claim_number        TEXT NOT NULL,
  service_type        TEXT NOT NULL,
  cpt_code            TEXT,
  icd10_codes         TEXT[],                         -- Array of diagnosis codes
  service_date        DATE NOT NULL,
  amount_billed       DECIMAL(10,2) NOT NULL,
  amount_approved     DECIMAL(10,2),
  amount_paid         DECIMAL(10,2),
  amount_patient_resp DECIMAL(10,2),
  insurance_provider  TEXT NOT NULL,
  insurance_id        TEXT,
  group_id            TEXT,
  prior_auth_number   TEXT,
  -- Status workflow
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN (
                          'draft', 'submitted', 'pending',
                          'approved', 'denied', 'appealed', 'paid', 'written_off'
                        )),
  submitted_at        TIMESTAMPTZ,
  denial_reason       TEXT,
  denial_code         TEXT,
  appeal_deadline     DATE,
  paid_at             TIMESTAMPTZ,
  payment_reference   TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_billing_claims
  BEFORE UPDATE ON billing_claims
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_billing_organization ON billing_claims(organization_id);
CREATE INDEX idx_billing_patient ON billing_claims(patient_id);
CREATE INDEX idx_billing_status ON billing_claims(status);
CREATE INDEX idx_billing_service_date ON billing_claims(service_date);

-- ============================================================
-- TABLE 17: DOCUMENTS
-- Metadata for all uploaded files.
-- Actual files live in Azure Blob Storage.
-- ============================================================
CREATE TABLE documents (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID REFERENCES patients(id) ON DELETE CASCADE,
  uploaded_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  document_type       TEXT NOT NULL CHECK (document_type IN (
                        'intake_form', 'physician_order', 'insurance_card',
                        'prescription', 'lab_result', 'imaging', 'consent_form',
                        'care_plan', 'referral_document', 'id_document', 'other'
                      )),
  file_name           TEXT NOT NULL,                  -- Original filename
  file_name_stored    TEXT NOT NULL,                  -- UUID-based name in Blob Storage
  blob_container      TEXT NOT NULL,                  -- Azure container name
  blob_path           TEXT NOT NULL,                  -- Full path in container
  file_size_bytes     BIGINT NOT NULL,
  mime_type           TEXT NOT NULL,
  checksum_sha256     TEXT NOT NULL,                  -- Integrity verification
  is_encrypted        BOOLEAN NOT NULL DEFAULT TRUE,
  is_scanned          BOOLEAN NOT NULL DEFAULT FALSE, -- Antivirus scan complete
  scan_result         TEXT CHECK (scan_result IN ('clean', 'infected', 'pending', 'error')),
  scanned_at          TIMESTAMPTZ,
  description         TEXT,
  tags                TEXT[],
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at          TIMESTAMPTZ,
  deleted_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_documents
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_documents_organization ON documents(organization_id);
CREATE INDEX idx_documents_patient ON documents(patient_id);
CREATE INDEX idx_documents_type ON documents(document_type);

-- ============================================================
-- TABLE 18: OASIS ASSESSMENTS
-- Medicare-required OASIS-E clinical assessments.
-- ============================================================
CREATE TABLE oasis_assessments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  conducted_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  assessment_type     TEXT NOT NULL CHECK (assessment_type IN (
                        'SOC', 'ROC', 'FU', 'TRN', 'DC'
                      )),                             -- Start/Resumption/Follow-Up/Transfer/Discharge
  assessment_date     DATE NOT NULL,
  -- OASIS-E data points stored as JSONB for flexibility
  -- (Full OASIS has 100+ items — JSONB allows structured storage without 100 columns)
  responses           JSONB NOT NULL DEFAULT '{}',
  -- Key items stored as columns for reporting/querying
  m1032_hospitalization_risk TEXT,
  m1800_grooming      TEXT,
  m2020_oral_medications TEXT,
  clinical_notes      TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'submitted', 'accepted', 'rejected')),
  submitted_to_cms_at TIMESTAMPTZ,
  cms_confirmation    TEXT,
  clinician_signature_url TEXT,
  signed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_oasis
  BEFORE UPDATE ON oasis_assessments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_oasis_organization ON oasis_assessments(organization_id);
CREATE INDEX idx_oasis_patient ON oasis_assessments(patient_id);
CREATE INDEX idx_oasis_type ON oasis_assessments(assessment_type);

-- ============================================================
-- TABLE 19: SECURE MESSAGES
-- HIPAA-compliant internal staff messaging.
-- ============================================================
CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sender_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id          UUID REFERENCES patients(id) ON DELETE SET NULL, -- Optional patient context
  subject             TEXT NOT NULL,
  body                TEXT NOT NULL,
  is_urgent           BOOLEAN NOT NULL DEFAULT FALSE,
  is_read             BOOLEAN NOT NULL DEFAULT FALSE,
  read_at             TIMESTAMPTZ,
  parent_message_id   UUID REFERENCES messages(id) ON DELETE SET NULL, -- Threading
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by_sender   BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by_recipient BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_messages_organization ON messages(organization_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_recipient ON messages(recipient_id);
CREATE INDEX idx_messages_unread ON messages(recipient_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_messages_patient ON messages(patient_id) WHERE patient_id IS NOT NULL;

-- ============================================================
-- TABLE 20: NOTIFICATIONS
-- System-generated alerts for clinical and operational events.
-- ============================================================
CREATE TABLE notifications (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id          UUID REFERENCES patients(id) ON DELETE CASCADE,
  notification_type   TEXT NOT NULL CHECK (notification_type IN (
                        'low_o2_alert', 'high_bp_alert', 'low_glucose_alert',
                        'medication_low_refill', 'medication_expired',
                        'visit_upcoming', 'visit_missed', 'soap_note_missing',
                        'claim_denied', 'eligibility_result', 'referral_new',
                        'care_plan_review_due', 'document_uploaded', 'system'
                      )),
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  action_url          TEXT,                           -- Deep link to relevant page
  priority            TEXT NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  is_read             BOOLEAN NOT NULL DEFAULT FALSE,
  read_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ                     -- Optional expiry for time-sensitive alerts
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_organization ON notifications(organization_id);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_priority ON notifications(priority) WHERE is_read = FALSE;

-- ============================================================
-- TABLE 21: AUDIT LOG
-- Immutable, append-only record of every system action.
-- This table NEVER has UPDATE or DELETE permissions granted.
-- ============================================================
CREATE TABLE audit_logs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  patient_id          UUID REFERENCES patients(id) ON DELETE SET NULL,
  -- Who
  user_name           TEXT,                           -- Denormalized — preserved if user deleted
  user_role           TEXT,                           -- Denormalized
  user_email          TEXT,                           -- Denormalized
  -- What
  action              TEXT NOT NULL,                  -- LOGIN, LOGOUT, VIEW_PATIENT, etc.
  resource_type       TEXT,                           -- 'patient', 'medication', 'document', etc.
  resource_id         UUID,                           -- ID of the affected record
  description         TEXT NOT NULL,
  -- Context
  ip_address          INET,
  user_agent          TEXT,
  request_id          TEXT,                           -- Correlation ID for request tracing
  -- Before/after state for modifications
  previous_state      JSONB,                          -- Snapshot before change
  new_state           JSONB,                          -- Snapshot after change
  -- Outcome
  success             BOOLEAN NOT NULL DEFAULT TRUE,
  error_message       TEXT,
  -- Timing
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NO updated_at — audit records are immutable
);

-- Audit log specific indexes optimized for compliance queries
CREATE INDEX idx_audit_organization ON audit_logs(organization_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_patient ON audit_logs(patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Enforces tenant isolation at the database level.
-- Even if application code has a bug, data cannot leak.
-- ============================================================

-- Enable RLS on all tenant-scoped tables
ALTER TABLE patients                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms                ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_plans                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vitals                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_reconciliations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmaceutical_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_insurance_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_claims              ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE oasis_assessments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications               ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                  ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see records belonging to their organization.
-- The application sets the current_setting 'app.organization_id' on each connection.

CREATE POLICY tenant_isolation_patients ON patients
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_users ON users
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_roles ON roles
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_intake_forms ON intake_forms
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_care_plans ON care_plans
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_visits ON visits
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_vitals ON vitals
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_medications ON medications
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_med_recon ON medication_reconciliations
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_pharm_orders ON pharmaceutical_orders
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_referrals ON referrals
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_provider_insurance ON provider_insurance_contracts
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_eligibility ON insurance_eligibility_checks
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_billing ON billing_claims
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_documents ON documents
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_oasis ON oasis_assessments
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_messages ON messages
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_notifications ON notifications
  USING (organization_id = current_setting('app.organization_id')::UUID);

CREATE POLICY tenant_isolation_audit ON audit_logs
  USING (organization_id = current_setting('app.organization_id')::UUID);

-- ============================================================
-- DATABASE ROLES & PERMISSIONS
-- Principle of least privilege — the app never uses a superuser.
-- ============================================================

-- Application user: Can read and write, never drop tables
CREATE ROLE wodoga_app WITH LOGIN PASSWORD 'CHANGE_IN_ENV';
GRANT CONNECT ON DATABASE wodoga TO wodoga_app;
GRANT USAGE ON SCHEMA public TO wodoga_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO wodoga_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO wodoga_app;

-- Audit log: Application can INSERT but NEVER UPDATE or DELETE
REVOKE UPDATE, DELETE ON audit_logs FROM wodoga_app;

-- Read-only user: For reporting and analytics dashboards
CREATE ROLE wodoga_readonly WITH LOGIN PASSWORD 'CHANGE_IN_ENV';
GRANT CONNECT ON DATABASE wodoga TO wodoga_readonly;
GRANT USAGE ON SCHEMA public TO wodoga_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wodoga_readonly;

-- ============================================================
-- SEED: DEFAULT PERMISSIONS PER ROLE
-- ============================================================
-- Note: This is called after organizations are created.
-- The application handles seeding roles per new organization.

-- ============================================================
-- SCHEMA VERSION TRACKING
-- Enables safe database migrations over time.
-- ============================================================
CREATE TABLE schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description TEXT
);

INSERT INTO schema_migrations (version, description)
VALUES ('001', 'Initial Wodoga production schema — all 21 tables');

-- ============================================================
-- END OF SCHEMA
-- ============================================================
