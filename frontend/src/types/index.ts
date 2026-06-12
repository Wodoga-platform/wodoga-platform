// ============================================================
// WODOGA PLATFORM — TYPE DEFINITIONS
// All types match the backend API response shapes exactly.
// ============================================================

// ── Auth ────────────────────────────────────────────────────
export interface AuthUser {
  id:              string;
  first_name:      string;
  last_name:       string;
  email:           string;
  role:            UserRole;
  organization_id: string;
  permissions:     Permission[];
  mfa_enabled?:    boolean;
}

export type UserRole =
  | 'admin'
  | 'provider'
  | 'pharmacy_staff'
  | 'biller'
  | 'viewer'
  | 'caregiver'
  | 'patient';

export interface AuthTokens {
  access_token:  string;
  refresh_token: string;
  token_type:    string;
  expires_in:    number;
  user:          AuthUser;
}

export interface LoginRequest {
  email:    string;
  password: string;
}

export interface MFAVerifyRequest {
  temp_token: string;
  mfa_code:   string;
}

// ── Permissions ──────────────────────────────────────────────
export type Permission =
  | 'patients:view'    | 'patients:create'  | 'patients:edit'    | 'patients:delete'
  | 'intake_forms:view' | 'intake_forms:create'
  | 'visits:view'      | 'visits:create'    | 'visits:edit'
  | 'visits:checkin'   | 'visits:soap_note'
  | 'care_plans:view'  | 'care_plans:create'
  | 'vitals:view'      | 'vitals:create'
  | 'medications:view' | 'medications:prescribe' | 'medications:reconcile'
  | 'pharm_orders:view' | 'pharm_orders:create' | 'pharm_orders:advance'
  | 'referrals:view'   | 'referrals:create' | 'referrals:advance'
  | 'billing:view'     | 'billing:create'   | 'billing:update'
  | 'eligibility:check'
  | 'oasis:view'       | 'oasis:create'
  | 'messages:send'    | 'messages:view'
  | 'documents:view'   | 'documents:upload'
  | 'staff:view'       | 'staff:manage'
  | 'audit:view'       | 'notifications:view'
  | 'reports:view'     | 'organizations:manage'
  | 'portal:access';

// ── Pagination ───────────────────────────────────────────────
export interface Pagination {
  page:     number;
  per_page: number;
  total:    number;
  pages:    number;
}

export interface PaginatedResponse<T> {
  data:       T[];
  pagination: Pagination;
}

// ── Organization ─────────────────────────────────────────────
export interface Organization {
  id:                  string;
  name:                string;
  slug:                string;
  type:                'home_health' | 'pharmacy' | 'both';
  email:               string;
  phone:               string | null;
  address_line1:       string | null;
  city:                string | null;
  state:               string | null;
  zip:                 string | null;
  subscription_tier:   'trial' | 'basic' | 'professional' | 'enterprise';
  subscription_status: 'active' | 'suspended' | 'cancelled';
  hipaa_baa_signed:    boolean;
  created_at:          string;
}

// ── Patient ───────────────────────────────────────────────────
export type PatientStatus = 'active' | 'discharged' | 'on_hold' | 'deceased' | 'transferred';
export type FallRisk      = 'low' | 'moderate' | 'high';
export type BloodType     = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'unknown';

export interface InsuranceInfo {
  provider:   string;
  member_id:  string;
  group_id?:  string;
  plan_name?: string;
}

export interface EmergencyContact {
  name:         string;
  relationship: string;
  phone:        string;
  email?:       string;
}

export interface Patient {
  id:                  string;
  organization_id:     string;
  mrn:                 string | null;
  first_name:          string;
  last_name:           string;
  date_of_birth:       string;
  gender:              string | null;
  phone:               string | null;
  email:               string | null;
  address_line1:       string | null;
  address_line2:       string | null;
  city:                string | null;
  state:               string | null;
  zip:                 string | null;
  blood_type:          BloodType | null;
  primary_diagnosis:   string | null;
  secondary_diagnoses: string[];
  allergies:           string[];
  medical_history:     string | null;
  emergency_contact:   EmergencyContact | null;
  insurance_primary:   InsuranceInfo | null;
  insurance_secondary: InsuranceInfo | null;
  assigned_caregiver:  string | null;
  assigned_provider:   string | null;
  caregiver_name?:     string | null;
  provider_name?:      string | null;
  fall_risk:           FallRisk | null;
  status:              PatientStatus;
  notes:               string | null;
  admission_date:      string | null;
  discharge_date:      string | null;
  created_at:          string;
  updated_at:          string;
}

export interface PatientSummary {
  patient:     Patient;
  vitals:      Vitals[];
  medications: Medication[];
  visits:      Visit[];
  care_plan:   CarePlan | null;
  billing:     {
    pending_count:  number;
    approved_count: number;
    denied_count:   number;
    total_billed:   number;
    total_paid:     number;
  };
}

// ── Visit ─────────────────────────────────────────────────────
export type VisitStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'missed';
export type VisitType   =
  | 'wellness_check'      | 'medication_administration' | 'wound_care'
  | 'physical_therapy'    | 'occupational_therapy'      | 'post_surgery_care'
  | 'chronic_disease_management' | 'hospice_support'   | 'other';

export interface SOAPNote {
  subjective: string;
  objective:  string;
  assessment: string;
  plan:       string;
}

export interface Visit {
  id:               string;
  patient_id:       string;
  caregiver_id:     string | null;
  care_plan_id:     string | null;
  visit_date:       string;
  visit_time:       string | null;
  visit_type:       VisitType;
  status:           VisitStatus;
  checkin_at:       string | null;
  checkin_lat:      number | null;
  checkin_lon:      number | null;
  checkout_at:      string | null;
  duration_minutes: number | null;
  soap_subjective:  string | null;
  soap_objective:   string | null;
  soap_assessment:  string | null;
  soap_plan:        string | null;
  soap_documented_at: string | null;
  has_soap_note?:   boolean;
  notes:            string | null;
  cancellation_reason: string | null;
  // Joined fields
  patient_first?:   string;
  patient_last?:    string;
  caregiver_name?:  string;
  created_at:       string;
  updated_at:       string;
}

// ── Vitals ────────────────────────────────────────────────────
export interface Vitals {
  id:                  string;
  patient_id:          string;
  visit_id:            string | null;
  recorded_by:         string | null;
  recorded_by_name?:   string;
  recorded_at:         string;
  bp_systolic:         number | null;
  bp_diastolic:        number | null;
  bp_position:         string | null;
  heart_rate:          number | null;
  oxygen_saturation:   number | null;
  oxygen_delivery:     string | null;
  temperature:         number | null;
  respiratory_rate:    number | null;
  weight_lbs:          number | null;
  blood_glucose:       number | null;
  blood_glucose_timing: string | null;
  pain_scale:          number | null;
  pain_location:       string | null;
  flag_low_o2:         boolean;
  flag_high_bp:        boolean;
  flag_low_bp:         boolean;
  flag_high_glucose:   boolean;
  flag_low_glucose:    boolean;
  flag_high_temp:      boolean;
  notes:               string | null;
  created_at:          string;
}

export interface VitalsTrends {
  bp_systolic:       'rising' | 'falling' | 'stable';
  oxygen_saturation: 'rising' | 'falling' | 'stable';
  heart_rate:        'rising' | 'falling' | 'stable';
  weight_lbs:        'rising' | 'falling' | 'stable';
  blood_glucose:     'rising' | 'falling' | 'stable';
}

// ── Medication ────────────────────────────────────────────────
export type MedicationStatus = 'active' | 'discontinued' | 'on_hold' | 'completed';

export interface Medication {
  id:                  string;
  patient_id:          string;
  drug_name:           string;
  brand_name:          string | null;
  dosage:              string;
  dosage_unit:         string | null;
  route:               string;
  frequency:           string;
  start_date:          string | null;
  end_date:            string | null;
  refills_remaining:   number;
  next_refill_date:    string | null;
  prescriber_name:     string | null;
  pharmacy_name:       string | null;
  controlled_substance: boolean;
  instructions:        string | null;
  status:              MedicationStatus;
  discontinued_reason: string | null;
  // Joined
  first_name?:         string;
  last_name?:          string;
  created_at:          string;
  updated_at:          string;
}

export interface ReconciliationResult {
  reconciliation_id:    string;
  medications_reviewed: number;
  conflicts_found:      number;
  conflicts: Array<{ drugs: string[]; warn: string }>;
  medications:          Medication[];
}

// ── Care Plan ─────────────────────────────────────────────────
export interface CarePlan {
  id:                 string;
  patient_id:         string;
  primary_diagnosis:  string;
  ordering_physician: string;
  start_date:         string;
  end_date:           string | null;
  review_date:        string | null;
  visit_frequency:    string;
  duration:           string | null;
  goals:              string | null;
  interventions:      string | null;
  expected_outcomes:  string | null;
  status:             'draft' | 'active' | 'completed' | 'cancelled';
  // Joined
  first_name?:        string;
  last_name?:         string;
  created_at:         string;
  updated_at:         string;
}

// ── Referral ──────────────────────────────────────────────────
export type ReferralStage  =
  | 'new_lead' | 'contacted' | 'evaluating'
  | 'insurance_check' | 'admitted' | 'declined' | 'lost';
export type ReferralUrgency = 'routine' | 'urgent' | 'emergent';

export interface Referral {
  id:                  string;
  first_name:          string;
  last_name:           string;
  date_of_birth:       string | null;
  phone:               string | null;
  referral_source:     string | null;
  referring_physician: string | null;
  diagnosis:           string | null;
  insurance_provider:  string | null;
  urgency:             ReferralUrgency;
  stage:               ReferralStage;
  notes:               string | null;
  follow_up_date:      string | null;
  managed_by_name?:    string;
  created_at:          string;
  updated_at:          string;
}

// ── Billing ───────────────────────────────────────────────────
export type ClaimStatus =
  | 'draft' | 'submitted' | 'pending' | 'approved'
  | 'denied' | 'appealed' | 'paid' | 'written_off';

export interface BillingClaim {
  id:               string;
  patient_id:       string;
  claim_number:     string;
  service_type:     string;
  cpt_code:         string | null;
  service_date:     string;
  amount_billed:    number;
  amount_approved:  number | null;
  amount_paid:      number | null;
  insurance_provider: string;
  status:           ClaimStatus;
  denial_reason:    string | null;
  submitted_at:     string | null;
  paid_at:          string | null;
  // Joined
  first_name?:      string;
  last_name?:       string;
  created_at:       string;
}

export interface BillingSummary {
  pending_count:  number;
  approved_count: number;
  denied_count:   number;
  paid_count:     number;
  total_billed:   number;
  total_approved: number;
  total_paid:     number;
}

// ── Pharmaceutical Order ──────────────────────────────────────
export type PharmStage = 'prescribed' | 'verified' | 'dispensed' | 'in_transit' | 'delivered' | 'cancelled';

export interface PharmOrder {
  id:               string;
  patient_id:       string;
  drug_name:        string;
  quantity:         string;
  pharmacy_name:    string | null;
  order_date:       string;
  expected_delivery: string | null;
  actual_delivery:  string | null;
  stage:            PharmStage;
  is_urgent:        boolean;
  notes:            string | null;
  // Joined
  first_name?:      string;
  last_name?:       string;
  created_at:       string;
}

// ── Eligibility ───────────────────────────────────────────────
export type EligibilityResult = 'eligible' | 'not_eligible' | 'pending_review' | 'error';

export interface EligibilityCheck {
  id:                   string;
  patient_id:           string | null;
  insurance_provider:   string;
  member_id:            string;
  service_date:         string | null;
  result:               EligibilityResult;
  coverage_active:      boolean;
  coverage_details:     Record<string, unknown>;
  copay_amount:         number | null;
  deductible_remaining: number | null;
  checked_at:           string;
  patient_name?:        string;
}

export interface ProviderContract {
  id:                string;
  provider_id:       string;
  provider_name?:    string;
  insurance_provider: string;
  plan_name:         string | null;
  plan_type:         string | null;
  payer_id:          string | null;
  is_accepting_new:  boolean;
  is_active:         boolean;
}

// ── OASIS ─────────────────────────────────────────────────────
export type OASISType = 'SOC' | 'ROC' | 'FU' | 'TRN' | 'DC';

export interface OASISAssessment {
  id:                  string;
  patient_id:          string;
  assessment_type:     OASISType;
  assessment_date:     string;
  status:              'draft' | 'submitted' | 'accepted' | 'rejected';
  conducted_by_name?:  string;
  first_name?:         string;
  last_name?:          string;
  created_at:          string;
}

// ── Message ───────────────────────────────────────────────────
export interface Message {
  id:             string;
  subject:        string;
  body:           string;
  sender_name?:   string;
  recipient_name?: string;
  patient_id:     string | null;
  is_urgent:      boolean;
  is_read:        boolean;
  read_at:        string | null;
  created_at:     string;
}

// ── Staff / User ──────────────────────────────────────────────
export interface StaffMember {
  id:             string;
  first_name:     string;
  last_name:      string;
  email:          string;
  phone:          string | null;
  role:           UserRole;
  role_display:   string;
  license_number: string | null;
  license_type:   string | null;
  npi_number:     string | null;
  is_active:      boolean;
  last_login_at:  string | null;
  created_at:     string;
}

// ── Notification ──────────────────────────────────────────────
export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

export interface Notification {
  id:                 string;
  notification_type:  string;
  title:              string;
  body:               string;
  priority:           NotificationPriority;
  is_read:            boolean;
  created_at:         string;
  patient_first?:     string;
  patient_last?:      string;
}

// ── Audit Log ─────────────────────────────────────────────────
export interface AuditLog {
  id:            string;
  user_id:       string | null;
  user_name:     string | null;
  user_role:     string | null;
  patient_id:    string | null;
  action:        string;
  resource_type: string | null;
  description:   string;
  ip_address:    string | null;
  success:       boolean;
  created_at:    string;
}

// ── Intake Form ───────────────────────────────────────────────
export interface IntakeForm {
  id:              string;
  patient_id:      string;
  completed_by:    string | null;
  form_date:       string;
  chief_complaint: string | null;
  is_signed:       boolean;
  status:          'draft' | 'complete' | 'requires_review';
  first_name?:     string;
  last_name?:      string;
  created_at:      string;
}

// ── API Error ─────────────────────────────────────────────────
export interface ApiError {
  error:   string;
  message: string;
}
