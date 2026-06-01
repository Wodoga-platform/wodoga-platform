'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Search, Plus, Upload } from 'lucide-react';
import {
  Button, Badge, Avatar, EmptyState, PageLoader,
  StatCard, InfoField, Alert,
} from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { patientService, visitService, medicationService } from '@/services';
import {
  fmtDate, fmtTime, calcAge, cn, PATIENT_STATUS_BADGE,
  FALL_RISK_BADGE, truncate, VISIT_TYPE_LABEL
} from '@/utils';
import type { Patient } from '@/types';

// ── Schema ─────────────────────────────────────────────────────
const patientSchema = z.object({
  first_name:        z.string().min(1, 'Required'),
  last_name:         z.string().min(1, 'Required'),
  date_of_birth:     z.string().min(1, 'Required'),
  gender:            z.string().optional(),
  phone:             z.string().optional(),
  email:             z.string().email().optional().or(z.literal('')),
  address_line1:     z.string().optional(),
  city:              z.string().optional(),
  state:             z.string().optional(),
  zip:               z.string().optional(),
  blood_type:        z.string().optional(),
  primary_diagnosis: z.string().optional(),
  allergies_str:     z.string().optional(),
  medical_history:   z.string().optional(),
  insurance_provider: z.string().optional(),
  insurance_member_id: z.string().optional(),
  notes:             z.string().optional(),
});

type PatientForm = z.infer<typeof patientSchema>;

// ════════════════════════════════════════════════════════════
// PATIENTS PAGE
// ════════════════════════════════════════════════════════════
export default function PatientsPage() {
  const qc = useQueryClient();

  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page,         setPage]         = useState(1);
  const [createOpen,   setCreateOpen]   = useState(false);
  const [selected,     setSelected]     = useState<Patient | null>(null);
  const [detailTab,    setDetailTab]    = useState<'info' | 'vitals' | 'meds' | 'visits' | 'billing'>('info');

  // ── Queries ────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['patients', 'list', search, statusFilter, page],
    queryFn:  () => patientService.list({ search, status: statusFilter, page, per_page: 25 }),
    placeholderData: (prev) => prev,
  });

  const { data: summary } = useQuery({
    queryKey: ['patients', 'summary', selected?.id],
    queryFn:  () => patientService.summary(selected!.id),
    enabled:  !!selected?.id,
  });

  // ── Mutations ──────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (body: Partial<Patient>) => patientService.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success('Patient folder created ✓');
      setCreateOpen(false);
      reset();
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create patient.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => patientService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success('Patient record deleted.');
      setSelected(null);
    },
  });

  // ── Form ───────────────────────────────────────────────────
  const { register, handleSubmit, formState: { errors }, reset } = useForm<PatientForm>({
    resolver: zodResolver(patientSchema),
  });

  const onSubmit = (data: PatientForm) => {
    const { allergies_str, insurance_provider, insurance_member_id, ...rest } = data;
    createMutation.mutate({
      ...rest,
      email:     rest.email || undefined,
      blood_type: rest.blood_type as any,
      allergies: allergies_str ? allergies_str.split(',').map(s => s.trim()).filter(Boolean) : [],
      insurance_primary: insurance_provider
        ? { provider: insurance_provider, member_id: insurance_member_id || '' }
        : undefined,
    });
  };

  const patients    = data?.data       || [];
  const pagination  = data?.pagination;

  return (
    <>
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Patient Records</h1>
          <p className="page-subtitle">
            {pagination?.total ?? '—'} total records — click any row to open the full record
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<Upload size={13} />}>Import CSV</Button>
          <Button variant="primary"   size="sm" icon={<Plus   size={13} />} onClick={() => setCreateOpen(true)}>
            New Patient
          </Button>
        </div>
      </div>

      <div className="flex gap-5">
        {/* ── Table ── */}
        <div className={cn('flex-1 min-w-0', selected ? 'max-w-[calc(100%-440px)]' : '')}>
          <div className="card">
            {/* Filters */}
            <div className="card-header">
              <div>
                <div className="text-sm font-bold">All Patients</div>
                <div className="text-xs text-ink-3 mt-0.5">{pagination?.total || 0} records</div>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
                  <input
                    className="form-input pl-7 py-1.5 w-48 text-xs"
                    placeholder="Search patients..."
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                  />
                </div>
                <select
                  className="form-select py-1.5 text-xs w-32"
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                >
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="discharged">Discharged</option>
                  <option value="on_hold">On Hold</option>
                </select>
              </div>
            </div>

            {isLoading ? <PageLoader /> : patients.length === 0 ? (
              <EmptyState
                icon="👥"
                title="No patients found"
                description={search ? `No results for "${search}"` : 'Add your first patient to get started.'}
                action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>Add Patient</Button>}
              />
            ) : (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Age / DOB</th>
                      <th>Diagnosis</th>
                      <th>Insurance</th>
                      <th>Caregiver</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patients.map(p => {
                      const sb = PATIENT_STATUS_BADGE[p.status] || { label: p.status, variant: 'gray' as const };
                      const isActive = selected?.id === p.id;
                      return (
                        <tr
                          key={p.id}
                          onClick={() => { setSelected(p); setDetailTab('info'); }}
                          className={cn(isActive && 'bg-forest-ghost/40')}
                        >
                          <td>
                            <div className="flex items-center gap-2.5">
                              <Avatar firstName={p.first_name} lastName={p.last_name} seed={p.id} size="sm" />
                              <div>
                                <div className="font-semibold text-sm">{p.first_name} {p.last_name}</div>
                                <div className="text-xs text-ink-3">{p.phone || '—'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="text-xs">
                            <span className="font-medium">{calcAge(p.date_of_birth)}</span>
                            <span className="text-ink-3 ml-1.5">{fmtDate(p.date_of_birth)}</span>
                          </td>
                          <td className="text-xs max-w-[160px]">{truncate(p.primary_diagnosis, 40) || '—'}</td>
                          <td className="text-xs">{p.insurance_primary?.provider || '—'}</td>
                          <td className="text-xs">{p.caregiver_name || <span className="text-ink-4">Unassigned</span>}</td>
                          <td><Badge variant={sb.variant}>{sb.label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Pagination */}
                {pagination && pagination.pages > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-surface-border text-xs text-ink-3">
                    <span>Page {pagination.page} of {pagination.pages}</span>
                    <div className="flex gap-1.5">
                      <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
                      <Button size="xs" variant="secondary" disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}>Next →</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Detail Panel ── */}
        {selected && (
          <div className="w-[420px] flex-shrink-0">
            <div className="card sticky top-5">
              {/* Panel header */}
              <div className="p-5 pb-4 bg-gradient-to-br from-forest-ghost to-white border-b border-surface-border">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar firstName={selected.first_name} lastName={selected.last_name}
                            seed={selected.id} size="lg" square />
                    <div>
                      <div className="font-display text-lg font-semibold">
                        {selected.first_name} {selected.last_name}
                      </div>
                      <div className="text-xs text-ink-3 mt-0.5">
                        {calcAge(selected.date_of_birth)} · {fmtDate(selected.date_of_birth)}
                        {selected.blood_type && ` · ${selected.blood_type}`}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="w-7 h-7 flex items-center justify-center rounded border border-surface-border
                               text-ink-3 hover:bg-red-ghost hover:text-red transition-colors text-xs"
                  >✕</button>
                </div>

                {/* Tabs */}
                <div className="flex gap-0.5 mt-4 bg-surface-2 rounded p-0.5">
                  {(['info', 'meds', 'visits', 'billing'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setDetailTab(tab)}
                      className={cn(
                        'flex-1 py-1.5 text-[11px] font-semibold rounded capitalize transition-all',
                        detailTab === tab
                          ? 'bg-white text-forest shadow-xs'
                          : 'text-ink-3 hover:text-ink',
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-5 max-h-[65vh] overflow-y-auto">
                {/* Info tab */}
                {detailTab === 'info' && (
                  <div className="space-y-4">
                    <div>
                      <div className="section-title">Demographics</div>
                      <div className="grid grid-cols-2 gap-3">
                        <InfoField label="Gender"     value={selected.gender} />
                        <InfoField label="Blood Type" value={selected.blood_type} />
                        <InfoField label="Phone"      value={selected.phone} />
                        <InfoField label="Email"      value={selected.email} />
                      </div>
                      <InfoField label="Address" value={[selected.address_line1, selected.city, selected.state, selected.zip].filter(Boolean).join(', ')} />
                    </div>
                    <div>
                      <div className="section-title">Medical</div>
                      <InfoField label="Primary Diagnosis" value={<strong>{selected.primary_diagnosis}</strong>} />
                      <InfoField label="Allergies"
                        value={selected.allergies?.length
                          ? <span className="text-red font-semibold">{selected.allergies.join(', ')}</span>
                          : 'None known'} />
                      {selected.medical_history && (
                        <InfoField label="Medical History" value={selected.medical_history} />
                      )}
                      {selected.fall_risk && (
                        <InfoField label="Fall Risk"
                          value={<Badge variant={FALL_RISK_BADGE[selected.fall_risk]?.variant || 'gray'}>
                            {FALL_RISK_BADGE[selected.fall_risk]?.label || selected.fall_risk}
                          </Badge>} />
                      )}
                    </div>
                    <div>
                      <div className="section-title">Insurance</div>
                      <div className="grid grid-cols-2 gap-3">
                        <InfoField label="Provider" value={selected.insurance_primary?.provider} />
                        <InfoField label="Member ID" value={selected.insurance_primary?.member_id} />
                      </div>
                    </div>
                    {selected.notes && (
                      <div>
                        <div className="section-title">Notes</div>
                        <p className="text-sm text-ink-2 leading-relaxed">{selected.notes}</p>
                      </div>
                    )}
                    <div className="flex gap-2 pt-2 border-t border-surface-border">
                      <Button size="xs" variant="primary" className="flex-1">+ Schedule Visit</Button>
                      <Button size="xs" variant="secondary">+ Vitals</Button>
                      <Button size="xs" variant="danger"
                        onClick={() => confirm('Delete this patient record? This cannot be undone.') && deleteMutation.mutate(selected.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                )}

                {/* Meds tab */}
                {detailTab === 'meds' && (
                  <div>
                    {summary?.medications.length === 0 ? (
                      <EmptyState icon="💊" title="No prescriptions" />
                    ) : (
                      summary?.medications.map(m => (
                        <div key={m.id} className="flex gap-3 p-3 bg-bg rounded mb-2 border border-surface-border">
                          <div className="w-9 h-9 bg-purple-pale rounded flex items-center justify-center text-lg flex-shrink-0">💊</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold">{m.drug_name} <span className="font-normal text-ink-3">{m.dosage}</span></div>
                            <div className="text-xs text-ink-3">{m.route} · {m.frequency}</div>
                            <div className="text-xs mt-0.5">
                              Refills: <span className={cn('font-bold', m.refills_remaining === 0 ? 'text-red' : 'text-forest')}>
                                {m.refills_remaining}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Visits tab */}
                {detailTab === 'visits' && (
                  <div>
                    {summary?.visits.length === 0 ? (
                      <EmptyState icon="🏠" title="No visits" />
                    ) : (
                      summary?.visits.map(v => (
                        <div key={v.id} className="flex gap-2.5 py-3 border-b border-surface-borderLt last:border-0">
                          <div className="mt-1.5 w-2.5 h-2.5 rounded-full border-2 border-forest bg-white flex-shrink-0" />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold">{v.visit_type.replace(/_/g, ' ')}</span>
                              <Badge variant={v.status === 'completed' ? 'green' : v.status === 'scheduled' ? 'blue' : 'gray'}>
                                {v.status}
                              </Badge>
                            </div>
                            <div className="text-xs text-ink-3">{fmtDate(v.visit_date)}{v.visit_time && ` at ${fmtTime(v.visit_time)}`}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Billing tab */}
                {detailTab === 'billing' && (
                  <div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="text-center p-3 bg-bg rounded border border-surface-border">
                        <div className="text-xl font-bold text-forest font-display">
                          ${(summary?.billing.total_billed || 0).toFixed(0)}
                        </div>
                        <div className="text-[10px] text-ink-3 uppercase tracking-wide mt-1">Total Billed</div>
                      </div>
                      <div className="text-center p-3 bg-bg rounded border border-surface-border">
                        <div className="text-xl font-bold text-blue font-display">
                          ${(summary?.billing.total_paid || 0).toFixed(0)}
                        </div>
                        <div className="text-[10px] text-ink-3 uppercase tracking-wide mt-1">Paid</div>
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs text-ink-3 justify-center">
                      <span>{summary?.billing.pending_count || 0} pending</span>
                      <span>{summary?.billing.approved_count || 0} approved</span>
                      <span className="text-red">{summary?.billing.denied_count || 0} denied</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Create Patient Modal ── */}
      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); reset(); }}
        title="New Patient Folder"
        subtitle="Enter complete patient information to create a new record"
        size="lg"
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => { setCreateOpen(false); reset(); }}>Cancel</Button>
            <Button variant="primary" loading={createMutation.isPending} onClick={handleSubmit(onSubmit)}>
              Create Patient Folder
            </Button>
          </ModalFooter>
        }
      >
        <form className="space-y-0">
          <div className="section-title">Demographics</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="form-label">First Name *</label>
              <input className="form-input" placeholder="Jane" {...register('first_name')} />
              {errors.first_name && <p className="text-xs text-red mt-1">{errors.first_name.message}</p>}
            </div>
            <div>
              <label className="form-label">Last Name *</label>
              <input className="form-input" placeholder="Smith" {...register('last_name')} />
              {errors.last_name && <p className="text-xs text-red mt-1">{errors.last_name.message}</p>}
            </div>
            <div>
              <label className="form-label">Date of Birth *</label>
              <input type="date" className="form-input" {...register('date_of_birth')} />
            </div>
            <div>
              <label className="form-label">Gender</label>
              <select className="form-select" {...register('gender')}>
                <option value="">Select</option>
                <option>Male</option><option>Female</option><option>Non-binary</option><option>Other</option>
              </select>
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input className="form-input" placeholder="(555) 000-0000" {...register('phone')} />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input type="email" className="form-input" placeholder="patient@email.com" {...register('email')} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="col-span-3">
              <label className="form-label">Address</label>
              <input className="form-input" placeholder="123 Main St" {...register('address_line1')} />
            </div>
            <div><label className="form-label">City</label><input className="form-input" {...register('city')} /></div>
            <div><label className="form-label">State</label><input className="form-input" placeholder="TX" {...register('state')} /></div>
            <div><label className="form-label">ZIP</label><input className="form-input" {...register('zip')} /></div>
          </div>

          <div className="section-title mt-4">Medical</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="form-label">Primary Diagnosis</label>
              <input className="form-input" placeholder="CHF, COPD..." {...register('primary_diagnosis')} />
            </div>
            <div>
              <label className="form-label">Blood Type</label>
              <select className="form-select" {...register('blood_type')}>
                <option value="">Unknown</option>
                {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div className="mb-3">
            <label className="form-label">Known Allergies (comma-separated)</label>
            <input className="form-input" placeholder="Penicillin, Sulfa drugs..." {...register('allergies_str')} />
          </div>
          <div className="mb-4">
            <label className="form-label">Medical History</label>
            <textarea className="form-textarea" rows={3} placeholder="Relevant history, prior conditions..." {...register('medical_history')} />
          </div>

          <div className="section-title">Insurance</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="form-label">Insurance Provider</label>
              <input className="form-input" placeholder="Medicare, Blue Cross..." {...register('insurance_provider')} />
            </div>
            <div>
              <label className="form-label">Member ID</label>
              <input className="form-input" placeholder="MCR-000000" {...register('insurance_member_id')} />
            </div>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} placeholder="Admission notes..." {...register('notes')} />
          </div>
        </form>
      </Modal>
    </>
  );
}


