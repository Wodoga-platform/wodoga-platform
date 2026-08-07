/**
 * Wodoga Platform — Clinical Operations service.
 * Path: frontend/src/services/clinical.ts
 *
 * Typed wrappers around the /clinical endpoints, matching the pattern in
 * services/index.ts (apiClient + .then(r => r.data)). Import in components:
 *     import { clinicalService } from '@/services/clinical';
 */

import { apiClient } from './api';

// ── Types ────────────────────────────────────────────────────────────────────
export type AlertSeverity = 'high' | 'medium' | 'low' | 'info';
export type AlertKind =
  | 'frequency_shortfall' | 'frequency_at_risk' | 'document_expiring'
  | 'code_status_missing' | 'code_status_stale' | 'patient_on_hold';

export interface ClinicalAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  patient_id: string | null;
  patient_name: string;
  title: string;
  detail: Record<string, unknown>;
}
export interface AlertFeed {
  count: number;
  counts_by_severity: Record<AlertSeverity, number>;
  alerts: ClinicalAlert[];
}

export interface Icd10Code {
  code: string; code_dotted: string; description: string; billable: boolean;
}
export interface PatientDiagnosis {
  id: string; icd10_code: string; code_dotted: string; description: string;
  billable: boolean; rank: number; onset_date: string | null;
  resolved_date: string | null; created_at: string;
}
export interface FrequencyOrder {
  id: string; discipline: 'SN' | 'PT' | 'OT';
  visits_min: number; visits_max: number; duration_weeks: number;
  start_date: string; end_date: string; status: string;
  source_ref: string | null; notes: string | null; created_at: string;
}
export interface PatientContact {
  id: string; role: string; priority: number; full_name: string;
  relationship: string | null; phone: string | null; phone_alt: string | null;
  email: string | null; address: string | null; doc_on_file: boolean;
  notes: string | null; legal_warning: boolean;
}
export interface PatientHold {
  id: string; hold_type: string; location_detail: string | null;
  started_on: string; expected_return: string | null; ended_on: string | null;
  billing_note: string | null; active: boolean;
}
export interface Pharmacy {
  id: string; name: string; phone: string | null; fax: string | null;
  address_line1: string | null; city: string | null; state: string | null;
  zip: string | null; npi: string | null;
}

// ── Service ──────────────────────────────────────────────────────────────────
export const clinicalService = {
  // Alerts
  alerts: (patientId?: string) =>
    apiClient.get<AlertFeed>('/clinical/alerts',
      { params: patientId ? { patient_id: patientId } : {} }).then(r => r.data),

  // ICD-10 + diagnoses
  searchIcd: (q: string) =>
    apiClient.get<Icd10Code[]>('/clinical/icd10/search', { params: { q } }).then(r => r.data),
  listDiagnoses: (patientId: string) =>
    apiClient.get<PatientDiagnosis[]>(
      `/clinical/icd10/patients/${patientId}/diagnoses`).then(r => r.data),
  addDiagnosis: (patientId: string, body: { icd10_code: string; rank?: number; onset_date?: string }) =>
    apiClient.post<{ id: string; warnings: string[] }>(
      `/clinical/icd10/patients/${patientId}/diagnoses`, body).then(r => r.data),
  resolveDiagnosis: (dxId: string, resolvedDate?: string) =>
    apiClient.patch(`/clinical/icd10/diagnoses/${dxId}/resolve`, null,
      { params: resolvedDate ? { resolved_date: resolvedDate } : {} }).then(r => r.data),
  importIcd: (year = 2026) =>
    apiClient.post('/clinical/icd10/import', null, { params: { year } }).then(r => r.data),

  // Frequency orders
  listOrders: (patientId: string) =>
    apiClient.get<FrequencyOrder[]>(
      `/clinical/frequency-orders/patients/${patientId}`).then(r => r.data),
  createOrder: (body: {
    patient_id: string; discipline: string; start_date: string;
    shorthand?: string; visits_min?: number; visits_max?: number;
    duration_weeks?: number; source_ref?: string; notes?: string;
  }) => apiClient.post<{ id: string }>('/clinical/frequency-orders', body).then(r => r.data),
  setOrderStatus: (orderId: string, status: string) =>
    apiClient.patch(`/clinical/frequency-orders/${orderId}/status`, null,
      { params: { status } }).then(r => r.data),

  // Contacts
  listContacts: (patientId: string) =>
    apiClient.get<PatientContact[]>(
      `/clinical/patients/${patientId}/contacts`).then(r => r.data),
  addContact: (patientId: string, body: Partial<PatientContact>) =>
    apiClient.post(`/clinical/patients/${patientId}/contacts`, body).then(r => r.data),
  updateContact: (contactId: string, body: Partial<PatientContact>) =>
    apiClient.patch(`/clinical/contacts/${contactId}`, body).then(r => r.data),
  removeContact: (contactId: string) =>
    apiClient.delete(`/clinical/contacts/${contactId}`).then(r => r.data),

  // Code status
  setCodeStatus: (patientId: string, body: { code_status: string; source: string; verified_on?: string }) =>
    apiClient.put(`/clinical/patients/${patientId}/code-status`, body).then(r => r.data),

  // Holds
  listHolds: (patientId: string) =>
    apiClient.get<PatientHold[]>(`/clinical/patients/${patientId}/holds`).then(r => r.data),
  startHold: (patientId: string, body: {
    hold_type: string; started_on: string; location_detail?: string;
    expected_return?: string; billing_note?: string;
  }) => apiClient.post(`/clinical/patients/${patientId}/holds`, body).then(r => r.data),
  endHold: (holdId: string, endedOn?: string) =>
    apiClient.patch(`/clinical/holds/${holdId}/end`, null,
      { params: endedOn ? { ended_on: endedOn } : {} }).then(r => r.data),

  // Payer + pharmacy
  setPayer: (patientId: string, payerType: string) =>
    apiClient.put(`/clinical/patients/${patientId}/payer`, null,
      { params: { payer_type: payerType } }).then(r => r.data),
  listPharmacies: () =>
    apiClient.get<Pharmacy[]>('/clinical/pharmacies').then(r => r.data),
  addPharmacy: (body: Partial<Pharmacy>) =>
    apiClient.post('/clinical/pharmacies', body).then(r => r.data),
  setPreferredPharmacy: (patientId: string, pharmacyId: string | null) =>
    apiClient.put(`/clinical/patients/${patientId}/preferred-pharmacy`, null,
      { params: pharmacyId ? { pharmacy_id: pharmacyId } : {} }).then(r => r.data),
};
