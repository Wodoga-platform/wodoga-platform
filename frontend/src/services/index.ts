/**
 * Wodoga Platform — API Services
 * Typed wrappers around every backend endpoint.
 * Import individual services in components and hooks.
 */

import { get, post, patch, del, apiClient } from './api';
import type {
  AuthTokens, Patient, PatientSummary, Visit, Vitals, VitalsTrends,
  Medication, ReconciliationResult, CarePlan, Referral, BillingClaim,
  BillingSummary, PharmOrder, EligibilityCheck, ProviderContract,
  OASISAssessment, Message, StaffMember, Notification, AuditLog,
  IntakeForm, PaginatedResponse,
} from '@/types';

// ════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════
export const authService = {
  login: (email: string, password: string) =>
    apiClient.post<AuthTokens | { mfa_required: boolean; temp_token: string }>(
      '/auth/login', { email, password }
    ).then(r => r.data),

  verifyMFA: (temp_token: string, mfa_code: string) =>
    apiClient.post<AuthTokens>('/auth/verify-mfa', { temp_token, mfa_code }).then(r => r.data),

  refresh: (refresh_token: string) =>
    apiClient.post<AuthTokens>('/auth/refresh', { refresh_token }).then(r => r.data),

  logout: (refresh_token: string) =>
    apiClient.post('/auth/logout', { refresh_token }),

  changePassword: (current_password: string, new_password: string) =>
    apiClient.post('/auth/change-password', { current_password, new_password }),

  enableMFA: () =>
    apiClient.post('/auth/enable-mfa').then(r => r.data),

  confirmMFA: (mfa_code: string) =>
    apiClient.post('/auth/confirm-mfa', { mfa_code }),
};

// ════════════════════════════════════════════════════════════
// PATIENTS
// ════════════════════════════════════════════════════════════
export const patientService = {
  list: (params?: {
    page?: number; per_page?: number; search?: string;
    status?: string; caregiver_id?: string; provider_id?: string;
  }) =>
    apiClient.get<{ data: Patient[]; pagination: PaginatedResponse<Patient>['pagination'] }>(
      '/patients', { params }
    ).then(r => r.data),

  get: (id: string) =>
    apiClient.get<{ data: Patient }>(`/patients/${id}`).then(r => r.data.data),

  summary: (id: string) =>
    apiClient.get<{ data: PatientSummary }>(`/patients/${id}/summary`).then(r => r.data.data),

  chart: (id: string) =>
    apiClient.get<{ data: any }>(`/patients/${id}/chart`).then(r => r.data.data),

  timeline: (id: string) =>
    apiClient.get<{ data: any[] }>(`/patients/${id}/timeline`).then(r => r.data.data),

  mapLocations: (caregiverId?: string) =>
    apiClient.get<{ data: any[] }>('/patients/map/locations', {
      params: caregiverId ? { caregiver_id: caregiverId } : {},
    }).then(r => r.data.data),

  backfillGeocode: () =>
    apiClient.post<{ data: { checked: number; geocoded: number }; message: string }>(
      '/patients/map/backfill-geocode',
    ).then(r => r.data),

  create: (body: Partial<Patient>) =>
    apiClient.post<{ data: Patient }>('/patients', body).then(r => r.data.data),

  update: (id: string, body: Partial<Patient>) =>
    apiClient.patch<{ data: Patient }>(`/patients/${id}`, body).then(r => r.data),

  delete: (id: string) =>
    apiClient.delete(`/patients/${id}`),
};

// ════════════════════════════════════════════════════════════
// VISITS
// ════════════════════════════════════════════════════════════
export const visitService = {
  list: (params?: {
    patient_id?: string; caregiver_id?: string; status?: string;
    visit_date?: string; date_from?: string; date_to?: string;
    page?: number; per_page?: number;
  }) =>
    apiClient.get<{ data: Visit[]; pagination: PaginatedResponse<Visit>['pagination'] }>(
      '/visits', { params }
    ).then(r => r.data),

  get: (id: string) =>
    apiClient.get<{ data: Visit }>(`/visits/${id}`).then(r => r.data.data),

  create: (body: {
    patient_id: string; caregiver_id?: string; visit_date: string;
    visit_time?: string; visit_type: string; notes?: string;
  }) =>
    apiClient.post<{ data: Visit }>('/visits', body).then(r => r.data.data),

  update: (id: string, body: Partial<Visit>) =>
    apiClient.patch(`/visits/${id}`, body).then(r => r.data),

  checkin: (id: string, lat?: number, lon?: number) =>
    apiClient.post(`/visits/${id}/checkin`, { latitude: lat, longitude: lon }).then(r => r.data),

  checkout: (id: string, lat?: number, lon?: number) =>
    apiClient.post(`/visits/${id}/checkout`, { latitude: lat, longitude: lon }).then(r => r.data),

  saveSOAP: (id: string, note: {
    subjective: string; objective: string; assessment: string; plan: string;
    duration_minutes?: number; visit_status?: string;
  }) =>
    apiClient.post(`/visits/${id}/soap`, note).then(r => r.data),

  cancel: (id: string, reason?: string) =>
    apiClient.delete(`/visits/${id}`, { params: { reason } }),
};

// ════════════════════════════════════════════════════════════
// VITALS
// ════════════════════════════════════════════════════════════
export const vitalsService = {
  record: (body: Partial<Vitals> & { patient_id: string }) =>
    apiClient.post<{ data: Partial<Vitals>; alerts: string[] }>('/vitals', body).then(r => r.data),

  history: (patientId: string, params?: { limit?: number; date_from?: string; date_to?: string }) =>
    apiClient.get<{ data: Vitals[]; trends: VitalsTrends }>(`/vitals/patient/${patientId}`, { params })
      .then(r => r.data),

  alerts: (days?: number) =>
    apiClient.get<{ data: Vitals[] }>('/vitals/alerts', { params: { days } }).then(r => r.data.data),

  get: (id: string) =>
    apiClient.get<{ data: Vitals }>(`/vitals/${id}`).then(r => r.data.data),
};

// ════════════════════════════════════════════════════════════
// MEDICATIONS
// ════════════════════════════════════════════════════════════
export const medicationService = {
  list: (params?: { patient_id?: string; status?: string; low_refills?: boolean }) =>
    apiClient.get<{ data: Medication[] }>('/medications', { params }).then(r => r.data.data),

  prescribe: (body: Partial<Medication> & { patient_id: string; drug_name: string; dosage: string }) =>
    apiClient.post<{ data: Medication }>('/medications', body).then(r => r.data.data),

  update: (id: string, body: Partial<Medication>) =>
    apiClient.patch(`/medications/${id}`, body).then(r => r.data),

  reconcile: (patientId: string) =>
    apiClient.post<{ data: ReconciliationResult }>('/medications/reconciliation', null, {
      params: { patient_id: patientId },
    }).then(r => r.data.data),
};

// ════════════════════════════════════════════════════════════
// CARE PLANS
// ════════════════════════════════════════════════════════════
export const carePlanService = {
  list: (params?: { patient_id?: string; active_only?: boolean }) =>
    apiClient.get<{ data: CarePlan[] }>('/care-plans', { params }).then(r => r.data.data),

  create: (body: Partial<CarePlan> & { patient_id: string }) =>
    apiClient.post<{ data: CarePlan }>('/care-plans', body).then(r => r.data.data),

  update: (id: string, body: Record<string, any>) =>
    apiClient.patch<{ data: CarePlan }>(`/care-plans/${id}`, body).then(r => r.data.data),
};

// ════════════════════════════════════════════════════════════
// REFERRALS
// ════════════════════════════════════════════════════════════
export const referralService = {
  list: (stage?: string) =>
    apiClient.get<{ data: Referral[] }>('/referrals', { params: { stage } }).then(r => r.data.data),

  create: (body: Partial<Referral>) =>
    apiClient.post<{ data: Referral }>('/referrals', body).then(r => r.data.data),

  advance: (id: string) =>
    apiClient.post<{ data: { stage: string } }>(`/referrals/${id}/advance`).then(r => r.data),
};

// ════════════════════════════════════════════════════════════
// BILLING
// ════════════════════════════════════════════════════════════
export const billingService = {
  list: (params?: { patient_id?: string; claim_status?: string; page?: number }) =>
    apiClient.get<{ data: BillingClaim[]; pagination: PaginatedResponse<BillingClaim>['pagination'] }>(
      '/billing', { params }
    ).then(r => r.data),

  summary: () =>
    apiClient.get<{ data: BillingSummary }>('/billing/summary').then(r => r.data.data),

  submit: (body: Partial<BillingClaim> & { patient_id: string }) =>
    apiClient.post<{ data: BillingClaim }>('/billing', body).then(r => r.data.data),

  updateStatus: (id: string, status: string, extra?: Record<string, unknown>) =>
    apiClient.patch(`/billing/${id}/status`, { status, ...extra }).then(r => r.data),
};

// ════════════════════════════════════════════════════════════
// ELIGIBILITY
// ════════════════════════════════════════════════════════════
export const eligibilityService = {
  check: (body: {
    patient_id?: string; insurance_provider: string;
    member_id: string; service_date?: string;
  }) =>
    apiClient.post<{ data: EligibilityCheck }>('/eligibility/check', body).then(r => r.data.data),

  history: (patientId?: string) =>
    apiClient.get<{ data: EligibilityCheck[] }>('/eligibility/history', {
      params: { patient_id: patientId },
    }).then(r => r.data.data),

  listContracts: (providerId?: string) =>
    apiClient.get<{ data: ProviderContract[] }>('/eligibility/provider-contracts', {
      params: { provider_id: providerId },
    }).then(r => r.data.data),

  addContract: (body: Partial<ProviderContract>) =>
    apiClient.post('/eligibility/provider-contracts', body).then(r => r.data),
};

// ════════════════════════════════════════════════════════════
// PHARMACEUTICAL ORDERS
// ════════════════════════════════════════════════════════════
export const pharmService = {
  list: (stage?: string) =>
    apiClient.get<{ data: PharmOrder[] }>('/pharm-orders', { params: { stage } }).then(r => r.data.data),

  create: (body: Partial<PharmOrder> & { patient_id: string }) =>
    apiClient.post<{ data: PharmOrder }>('/pharm-orders', body).then(r => r.data.data),

  advance: (id: string) =>
    apiClient.post<{ data: { stage: string } }>(`/pharm-orders/${id}/advance`).then(r => r.data),

  update: (id: string, body: Record<string, any>) =>
    apiClient.patch<{ data: PharmOrder }>(`/pharm-orders/${id}`, body).then(r => r.data.data),
};

// ════════════════════════════════════════════════════════════
// OASIS
// ════════════════════════════════════════════════════════════
export const oasisService = {
  list: (patientId?: string) =>
    apiClient.get<{ data: OASISAssessment[] }>('/oasis', {
      params: { patient_id: patientId },
    }).then(r => r.data.data),

  create: (body: Record<string, unknown>) =>
    apiClient.post<{ data: OASISAssessment }>('/oasis', body).then(r => r.data.data),
};

// ════════════════════════════════════════════════════════════
// MESSAGES
// ════════════════════════════════════════════════════════════
export const messageService = {
  inbox: () =>
    apiClient.get<{ data: Message[] }>('/messages', { params: { folder: 'inbox' } }).then(r => r.data.data),

  sent: () =>
    apiClient.get<{ data: Message[] }>('/messages', { params: { folder: 'sent' } }).then(r => r.data.data),

  send: (body: { recipient_id: string; subject: string; body: string; is_urgent?: boolean }) =>
    apiClient.post<{ data: Message }>('/messages', body).then(r => r.data.data),

  markRead: (id: string) =>
    apiClient.patch(`/messages/${id}/read`),
};

// ════════════════════════════════════════════════════════════
// STAFF
// ════════════════════════════════════════════════════════════
export const staffService = {
  list: (role?: string) =>
    apiClient.get<{ data: StaffMember[] }>('/staff', { params: { role } }).then(r => r.data.data),

  invite: (body: {
    first_name: string; last_name: string; email: string;
    role: string; phone?: string; license_number?: string;
  }) =>
    apiClient.post('/staff/invite', body).then(r => r.data),

  deactivate: (id: string) =>
    apiClient.patch(`/staff/${id}/deactivate`),
};

// ════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════
export const notificationService = {
  list: (unreadOnly?: boolean) =>
    apiClient.get<{ data: Notification[] }>('/notifications', {
      params: { unread_only: unreadOnly },
    }).then(r => r.data.data),

  markRead: (id: string) =>
    apiClient.patch(`/notifications/${id}/read`),

  markAllRead: () =>
    apiClient.post('/notifications/read-all'),
};

// ════════════════════════════════════════════════════════════
// AUDIT LOGS
// ════════════════════════════════════════════════════════════
export const auditService = {
  list: (params?: {
    action?: string; user_id?: string; patient_id?: string;
    date_from?: string; date_to?: string;
    page?: number; per_page?: number;
  }) =>
    apiClient.get<{ data: AuditLog[]; pagination: PaginatedResponse<AuditLog>['pagination'] }>(
      '/audit-logs', { params }
    ).then(r => r.data),
};

// ════════════════════════════════════════════════════════════
// PATIENT PORTAL
// ════════════════════════════════════════════════════════════
export const portalService = {
  myProfile:   () => apiClient.get('/portal/me').then(r => r.data.data),
  myVisits:    () => apiClient.get('/portal/me/visits').then(r => r.data.data),
  myMeds:      () => apiClient.get('/portal/me/medications').then(r => r.data.data),
  myVitals:    () => apiClient.get('/portal/me/vitals').then(r => r.data.data),
  myCarePlan:  () => apiClient.get('/portal/me/care-plan').then(r => r.data.data),
  myMessages:  () => apiClient.get('/portal/me/messages').then(r => r.data.data),
  myDocuments: () => apiClient.get('/portal/me/documents').then(r => r.data.data),
  sendMessage: (body: { subject: string; body: string }) =>
    apiClient.post('/portal/me/messages', body).then(r => r.data.data),
};

// ════════════════════════════════════════════════════════════
// DOCUMENTS & IMAGES
// ════════════════════════════════════════════════════════════
export const documentService = {
  storageStatus: () =>
    apiClient.get<{ data: { configured: boolean } }>('/documents/storage-status').then(r => r.data.data),

  listForPatient: (patientId: string) =>
    apiClient.get<{ data: any[] }>(`/documents/patient/${patientId}`).then(r => r.data.data),

  upload: (patientId: string, file: File, documentType: string, description: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('document_type', documentType);
    form.append('description', description);
    return apiClient.post<{ data: any }>(`/documents/patient/${patientId}`, form, {
      headers: { 'Content-Type': undefined as any },
    }).then(r => r.data.data);
  },

  getViewUrl: (documentId: string) =>
    apiClient.get<{ data: { url: string; file_name: string; mime_type: string } }>(
      `/documents/${documentId}/url`,
    ).then(r => r.data.data),

  remove: (documentId: string) =>
    apiClient.delete(`/documents/${documentId}`).then(r => r.data),
};
