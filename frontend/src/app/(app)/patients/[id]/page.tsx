'use client';

import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Activity, Pill, Home, ClipboardList, FileText,
  Receipt, Clock, Truck, AlertTriangle, Image as ImageIcon,
  Upload, Trash2, X as XIcon, Plus, UserMinus, Pencil, UserPlus, Copy,
} from 'lucide-react';
import { Button, Badge, Avatar, PageLoader, EmptyState, InfoField } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { patientService, documentService, vitalsService, visitService, staffService, portalService } from '@/services';
import {
  fmtDate, fmtTime, fmtDateTime, fmtRelative, fmtCurrency, calcAge,
  VISIT_TYPE_LABEL, PHARM_STAGE_LABEL, CLAIM_STATUS_BADGE,
  PATIENT_STATUS_BADGE, cn,
} from '@/utils';

type Tab = 'timeline' | 'visits' | 'vitals' | 'meds' | 'oasis' | 'claims' | 'documents';

const VISIT_STATUS_BADGE: Record<string, any> = {
  scheduled: 'blue', in_progress: 'amber', completed: 'green', cancelled: 'gray', missed: 'red',
};

// Maps each audit action to an icon + human label + color
const EVENT_META: Record<string, { label: string; color: string; icon: any }> = {
  PATIENT_CREATED:          { label: 'Patient admitted',        color: '#166534', icon: Home },
  PATIENT_UPDATED:          { label: 'Record updated',          color: '#4A4845', icon: FileText },
  PATIENT_DELETED:          { label: 'Patient discharged',      color: '#b91c1c', icon: AlertTriangle },
  CARE_PLAN_CREATED:        { label: 'Care plan created',       color: '#7c3aed', icon: ClipboardList },
  CARE_PLAN_UPDATED:        { label: 'Care plan updated',       color: '#7c3aed', icon: ClipboardList },
  VISIT_CREATED:            { label: 'Visit scheduled',         color: '#1d4ed8', icon: Home },
  VISIT_UPDATED:            { label: 'Visit updated',           color: '#1d4ed8', icon: Home },
  VISIT_GPS_CHECKIN:        { label: 'Caregiver checked in',    color: '#166534', icon: Home },
  SOAP_NOTE_CREATED:        { label: 'SOAP note documented',    color: '#166534', icon: FileText },
  VITALS_RECORDED:          { label: 'Vitals recorded',         color: '#0d9488', icon: Activity },
  MEDICATION_PRESCRIBED:    { label: 'Medication prescribed',   color: '#b45309', icon: Pill },
  MEDICATION_DISCONTINUED:  { label: 'Medication discontinued', color: '#b91c1c', icon: Pill },
  RECONCILIATION_RUN:       { label: 'Medications reconciled',  color: '#b45309', icon: Pill },
  PHARM_ORDER_CREATED:      { label: 'Pharmacy order placed',   color: '#b45309', icon: Truck },
  PHARM_ORDER_ADVANCED:     { label: 'Pharmacy order advanced', color: '#b45309', icon: Truck },
  REFERRAL_ADMITTED_AS_PATIENT: { label: 'Admitted from referral', color: '#166534', icon: Home },
  CLAIM_SUBMITTED:          { label: 'Insurance claim filed',   color: '#0369a1', icon: Receipt },
  CLAIM_UPDATED:            { label: 'Claim status updated',    color: '#0369a1', icon: Receipt },
  ELIGIBILITY_CHECKED:      { label: 'Eligibility verified',    color: '#0369a1', icon: Receipt },
  OASIS_CREATED:            { label: 'OASIS assessment',        color: '#7c3aed', icon: ClipboardList },
  OASIS_SUBMITTED:          { label: 'OASIS submitted',         color: '#7c3aed', icon: ClipboardList },
  DOCUMENT_UPLOADED:        { label: 'Document uploaded',       color: '#4A4845', icon: ImageIcon },
};

function eventMeta(action: string) {
  return EVENT_META[action] || { label: action.replace(/_/g, ' ').toLowerCase(), color: '#8A8784', icon: Clock };
}

// ── Edit Patient form ──────────────────────────────────────
const editPatientSchema = z.object({
  first_name:        z.string().min(1, 'Required'),
  last_name:          z.string().min(1, 'Required'),
  date_of_birth:      z.string().min(1, 'Required'),
  gender:             z.string().optional(),
  phone:              z.string().optional(),
  email:              z.string().optional(),
  address_line1:      z.string().optional(),
  city:               z.string().optional(),
  state:              z.string().optional(),
  zip:                z.string().optional(),
  blood_type:         z.string().optional(),
  primary_diagnosis:  z.string().optional(),
  allergies_str:      z.string().optional(),
  medical_history:    z.string().optional(),
  notes:              z.string().optional(),
});
type EditPatientForm = z.infer<typeof editPatientSchema>;

export default function PatientChartPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [tab, setTab] = useState<Tab>('timeline');

  const { data: chart, isLoading } = useQuery({
    queryKey: ['patient-chart', id],
    queryFn:  () => patientService.chart(id),
    enabled:  !!id,
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ['patient-timeline', id],
    queryFn:  () => patientService.timeline(id),
    enabled:  !!id,
  });

  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('imaging');
  const [viewerUrl, setViewerUrl] = useState<{ url: string; mime: string; name: string } | null>(null);

  const { data: storageStatus } = useQuery({
    queryKey: ['storage-status'],
    queryFn:  () => documentService.storageStatus(),
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['patient-documents', id],
    queryFn:  () => documentService.listForPatient(id),
    enabled:  !!id,
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => documentService.upload(id, file, docType, ''),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['patient-documents', id] });
      qc.invalidateQueries({ queryKey: ['patient-timeline', id] });
      toast.success('Document uploaded ✓');
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail?.message || e?.message || 'Upload failed.'),
  });

  const deleteMut = useMutation({
    mutationFn: (docId: string) => documentService.remove(docId),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['patient-documents', id] }); toast.success('Document deleted ✓'); },
    onError: () => toast.error('Failed to delete document.'),
  });

  const openDocument = async (docId: string) => {
    try {
      const res = await documentService.getViewUrl(docId);
      setViewerUrl({ url: res.url, mime: res.mime_type, name: res.file_name });
    } catch {
      toast.error('Could not open document.');
    }
  };

  // ── Record vitals / schedule visit / discharge ──────────────
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [visitOpen, setVisitOpen]   = useState(false);

  const { data: caregivers } = useQuery({
    queryKey: ['staff', 'caregivers'],
    queryFn:  () => staffService.list('caregiver'),
  });

  const refreshChart = () => {
    qc.invalidateQueries({ queryKey: ['patient-chart', id] });
    qc.invalidateQueries({ queryKey: ['patient-timeline', id] });
  };

  const { register: rv, handleSubmit: hv, reset: resetVitals } = useForm();
  const vitalsMut = useMutation({
    mutationFn: (body: any) => vitalsService.record({ ...body, patient_id: id }),
    onSuccess: (data: any) => {
      refreshChart();
      toast.success('Vitals recorded' + (data?.alerts?.length ? ` ⚠ ${data.alerts.length} alert(s)` : ' ✓'));
      setVitalsOpen(false); resetVitals();
    },
    onError: () => toast.error('Failed to record vitals.'),
  });

  const { register: rvs, handleSubmit: hvs, reset: resetVisit } = useForm();
  const visitMut = useMutation({
    mutationFn: (body: any) => visitService.create({ ...body, patient_id: id }),
    onSuccess: () => { refreshChart(); toast.success('Visit scheduled ✓'); setVisitOpen(false); resetVisit(); },
    onError: () => toast.error('Failed to schedule visit.'),
  });

  const dischargeMut = useMutation({
    mutationFn: () => patientService.update(id, { status: 'discharged' as any }),
    onSuccess: () => { refreshChart(); qc.invalidateQueries({ queryKey: ['patients'] }); toast.success('Patient discharged'); },
    onError: () => toast.error('Failed to discharge patient.'),
  });

  // ── Edit Patient ──────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);

  const editForm = useForm<EditPatientForm>({
    resolver: zodResolver(editPatientSchema),
  });

  const openEdit = () => {
    const p = chart!.patient;
    editForm.reset({
      first_name:        p.first_name || '',
      last_name:         p.last_name || '',
      date_of_birth:     p.date_of_birth ? String(p.date_of_birth).slice(0, 10) : '',
      gender:            p.gender || '',
      phone:             p.phone || '',
      email:             p.email || '',
      address_line1:     p.address_line1 || '',
      city:              p.city || '',
      state:             p.state || '',
      zip:               p.zip || '',
      blood_type:        p.blood_type || '',
      primary_diagnosis: p.primary_diagnosis || '',
      allergies_str:     (p.allergies || []).join(', '),
      medical_history:   p.medical_history || '',
      notes:             p.notes || '',
    });
    setEditOpen(true);
  };

  const editMutation = useMutation({
    mutationFn: (data: EditPatientForm) => {
      const { allergies_str, ...rest } = data;
      return patientService.update(id, {
        ...(rest as any),
        email: rest.email || undefined,
        allergies: allergies_str ? allergies_str.split(',').map(s => s.trim()).filter(Boolean) : [],
      });
    },
    onSuccess: () => {
      refreshChart();
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success('Patient record updated ✓');
      setEditOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail?.message || e?.message || 'Failed to update patient.'),
  });

  const onEditSubmit = (data: EditPatientForm) => editMutation.mutate(data);

  // ── Invite to Portal ──────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const inviteMutation = useMutation({
    mutationFn: () => portalService.invitePatient(id),
    onSuccess: (data: any) => {
      setInviteLink(data.setup_link);
      setLinkCopied(false);
      setInviteOpen(true);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail?.message || e?.message || 'Could not create portal invite.'),
  });

  const copyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setLinkCopied(true);
      toast.success('Link copied ✓');
    }
  };

  if (isLoading) return <PageLoader />;
  if (!chart)    return <EmptyState icon="🔍" title="Patient not found" />;

  const p = chart.patient;
  const statusBadge = PATIENT_STATUS_BADGE[p.status as keyof typeof PATIENT_STATUS_BADGE]
    || { label: p.status, variant: 'gray' as const };

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'timeline',  label: 'Timeline' },
    { key: 'visits',    label: 'Visits',      count: chart.visits.length },
    { key: 'vitals',    label: 'Vitals',      count: chart.vitals.length },
    { key: 'meds',      label: 'Medications', count: chart.medications.length },
    { key: 'oasis',     label: 'OASIS',       count: chart.oasis.length },
    { key: 'claims',    label: 'Claims',      count: chart.claims.length },
    { key: 'documents', label: 'Documents' },
  ];

  return (
    <>
      {/* Back */}
      <button onClick={() => router.push('/patients')}
        className="flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink mb-4 transition-colors">
        <ArrowLeft size={15} /> Back to Patients
      </button>

      {/* Patient header */}
      <div className="card mb-5">
        <div className="p-5 bg-gradient-to-br from-forest-ghost to-white border-b border-surface-border">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <Avatar firstName={p.first_name} lastName={p.last_name} seed={p.id} size="lg" square />
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="font-display text-2xl font-bold">{p.first_name} {p.last_name}</h1>
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                </div>
                <div className="text-sm text-ink-3 mt-1">
                  {calcAge(p.date_of_birth)} years · {fmtDate(p.date_of_birth)}
                  {p.gender && ` · ${p.gender}`}
                  {p.blood_type && ` · ${p.blood_type}`}
                </div>
                {p.primary_diagnosis && (
                  <div className="text-sm font-medium text-forest mt-1.5">{p.primary_diagnosis}</div>
                )}
              </div>
            </div>
            <div className="text-right text-xs text-ink-3 space-y-1">
              {p.phone && <div>{p.phone}</div>}
              {[p.address_line1, p.city, p.state].filter(Boolean).length > 0 && (
                <div>{[p.address_line1, p.city, p.state].filter(Boolean).join(', ')}</div>
              )}
              <div className="pt-2 flex gap-2 justify-end flex-wrap">
                <Button size="xs" variant="secondary" icon={<Pencil size={11} />} onClick={openEdit}>
                  Edit Patient
                </Button>
                <Button size="xs" variant="secondary" icon={<UserPlus size={11} />}
                  loading={inviteMutation.isPending}
                  onClick={() => inviteMutation.mutate()}>
                  Invite to Portal
                </Button>
                {p.status === 'active' && (
                  <Button size="xs" variant="secondary" icon={<UserMinus size={11} />}
                    loading={dischargeMut.isPending}
                    onClick={() => {
                      if (confirm(`Discharge ${p.first_name} ${p.last_name}? This marks the patient as discharged.`))
                        dischargeMut.mutate();
                    }}>
                    Discharge Patient
                  </Button>
                )}
              </div>
            </div>
          </div>
          {p.allergies?.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <AlertTriangle size={14} className="text-red" />
              <span className="font-semibold text-red">Allergies:</span>
              <span className="text-ink-2">{p.allergies.join(', ')}</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-3 overflow-x-auto border-b border-surface-border">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn(
                'px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all whitespace-nowrap',
                tab === t.key ? 'border-forest text-forest' : 'border-transparent text-ink-3 hover:text-ink',
              )}>
              {t.label}
              {t.count !== undefined && (
                <span className="ml-1.5 text-[10px] bg-surface-2 text-ink-3 font-bold px-1.5 py-0.5 rounded-full">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Timeline ── */}
      {tab === 'timeline' && (
        <div className="card p-5">
          <div className="section-title">Complete Patient History</div>
          {timeline.length === 0 ? (
            <EmptyState icon="📋" title="No history yet" description="Events will appear here as care is delivered." />
          ) : (
            <div className="relative pl-6">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-surface-border" />
              {timeline.map((e, i) => {
                const m = eventMeta(e.action);
                const Icon = m.icon;
                return (
                  <div key={i} className="relative pb-5 last:pb-0">
                    <div className="absolute -left-6 top-0.5 w-3.5 h-3.5 rounded-full border-2 border-white"
                         style={{ background: m.color }} />
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Icon size={13} style={{ color: m.color }} />
                          <span className="text-sm font-semibold" style={{ color: m.color }}>{m.label}</span>
                        </div>
                        <div className="text-sm text-ink-2 mt-0.5">{e.description}</div>
                        {e.user_name && (
                          <div className="text-xs text-ink-4 mt-0.5">by {e.user_name}{e.user_role ? ` · ${e.user_role}` : ''}</div>
                        )}
                      </div>
                      <div className="text-xs text-ink-3 whitespace-nowrap flex-shrink-0" title={fmtDateTime(e.created_at)}>
                        {fmtRelative(e.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Visits ── */}
      {tab === 'visits' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setVisitOpen(true)}>
              Schedule Visit
            </Button>
          </div>
          {chart.visits.length === 0 ? (
            <div className="card"><EmptyState icon="🏠" title="No visits recorded" /></div>
          ) : chart.visits.map((v: any) => (
            <div key={v.id} className="card p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{VISIT_TYPE_LABEL[v.visit_type] || v.visit_type?.replace(/_/g, ' ')}</span>
                    <Badge variant={VISIT_STATUS_BADGE[v.status] || 'gray'}>{v.status?.replace('_', ' ')}</Badge>
                  </div>
                  <div className="text-sm text-ink-3 mt-0.5">
                    {fmtDate(v.visit_date)}{v.visit_time && ` at ${fmtTime(v.visit_time)}`} · {v.caregiver_name || 'Unassigned'}
                  </div>
                </div>
              </div>
              {v.soap_subjective && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {[
                    { l: 'Subjective', v: v.soap_subjective, c: '#1d4ed8' },
                    { l: 'Objective',  v: v.soap_objective,  c: '#7c3aed' },
                    { l: 'Assessment', v: v.soap_assessment, c: '#b45309' },
                    { l: 'Plan',       v: v.soap_plan,       c: '#166534' },
                  ].map(s => s.v ? (
                    <div key={s.l} className="p-2.5 bg-bg rounded border border-surface-border">
                      <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: s.c }}>{s.l}</div>
                      <div className="text-sm text-ink-2">{s.v}</div>
                    </div>
                  ) : null)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Vitals ── */}
      {tab === 'vitals' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setVitalsOpen(true)}>
              Record Vitals
            </Button>
          </div>
          <div className="card">
          {chart.vitals.length === 0 ? <EmptyState icon="❤️" title="No vitals recorded" /> : (
            <table className="data-table">
              <thead><tr><th>Date</th><th>BP</th><th>HR</th><th>O₂</th><th>Temp</th><th>Resp</th><th>Weight</th><th>Pain</th><th>Flags</th></tr></thead>
              <tbody>
                {chart.vitals.map((v: any) => (
                  <tr key={v.id}>
                    <td className="text-xs">{fmtDateTime(v.recorded_at)}</td>
                    <td className="text-sm font-medium">{v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—'}</td>
                    <td className="text-sm">{v.heart_rate || '—'}</td>
                    <td className="text-sm">{v.oxygen_saturation ? `${v.oxygen_saturation}%` : '—'}</td>
                    <td className="text-sm">{v.temperature ? `${v.temperature}°` : '—'}</td>
                    <td className="text-sm">{v.respiratory_rate || '—'}</td>
                    <td className="text-sm">{v.weight_lbs ? `${v.weight_lbs} lb` : '—'}</td>
                    <td className="text-sm">{v.pain_scale != null ? `${v.pain_scale}/10` : '—'}</td>
                    <td>
                      {(v.flag_low_o2 || v.flag_high_bp || v.flag_low_bp || v.flag_high_glucose || v.flag_low_glucose || v.flag_high_temp)
                        ? <Badge variant="red">Alert</Badge>
                        : <Badge variant="green">Normal</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </div>
      )}

      {/* ── Medications ── */}
      {tab === 'meds' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header"><div className="text-sm font-bold">Medications</div></div>
            {chart.medications.length === 0 ? <EmptyState icon="💊" title="No medications" /> : (
              <table className="data-table">
                <thead><tr><th>Drug</th><th>Dosage</th><th>Frequency</th><th>Prescriber</th><th>Refills</th><th>Status</th></tr></thead>
                <tbody>
                  {chart.medications.map((m: any) => (
                    <tr key={m.id}>
                      <td className="font-semibold text-sm">{m.drug_name}{m.brand_name && <span className="text-ink-3 text-xs ml-1">({m.brand_name})</span>}</td>
                      <td className="text-sm">{m.dosage}</td>
                      <td className="text-sm">{m.frequency}</td>
                      <td className="text-sm text-ink-2">{m.prescriber_name || '—'}</td>
                      <td className="text-sm">{m.refills_remaining ?? '—'}</td>
                      <td><Badge variant={m.status === 'active' ? 'green' : 'gray'}>{m.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {chart.pharm_orders.length > 0 && (
            <div className="card">
              <div className="card-header"><div className="text-sm font-bold">Pharmacy Orders & Delivery</div></div>
              <table className="data-table">
                <thead><tr><th>Drug</th><th>Qty</th><th>Pharmacy</th><th>Ordered</th><th>Delivery Status</th></tr></thead>
                <tbody>
                  {chart.pharm_orders.map((o: any) => (
                    <tr key={o.id}>
                      <td className="font-semibold text-sm">{o.drug_name}</td>
                      <td className="text-sm">{o.quantity || '—'}</td>
                      <td className="text-sm">{o.pharmacy_name || '—'}</td>
                      <td className="text-xs">{fmtDate(o.created_at)}</td>
                      <td>
                        <Badge variant={o.stage === 'delivered' ? 'green' : o.stage === 'out_for_delivery' ? 'amber' : 'blue'}>
                          {PHARM_STAGE_LABEL[o.stage as keyof typeof PHARM_STAGE_LABEL] || o.stage?.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── OASIS ── */}
      {tab === 'oasis' && (
        <div className="space-y-3">
          {chart.oasis.length === 0 ? (
            <div className="card"><EmptyState icon="📋" title="No OASIS assessments" /></div>
          ) : chart.oasis.map((o: any) => (
            <div key={o.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold">{o.assessment_type} Assessment</span>
                  <div className="text-sm text-ink-3 mt-0.5">{fmtDate(o.assessment_date)} · {o.conducted_by_name || 'Unknown'}</div>
                </div>
                <Badge variant="green">{o.status}</Badge>
              </div>
              {o.clinical_notes && <div className="text-sm text-ink-2 mt-2 p-2.5 bg-bg rounded border border-surface-border">{o.clinical_notes}</div>}
            </div>
          ))}
        </div>
      )}

      {/* ── Claims ── */}
      {tab === 'claims' && (
        <div className="card">
          {chart.claims.length === 0 ? <EmptyState icon="💳" title="No claims filed" /> : (
            <table className="data-table">
              <thead><tr><th>Claim #</th><th>Service</th><th>Amount</th><th>Insurance</th><th>Date</th><th>Status</th></tr></thead>
              <tbody>
                {chart.claims.map((c: any) => {
                  const sb = CLAIM_STATUS_BADGE[c.status as keyof typeof CLAIM_STATUS_BADGE] || { label: c.status, variant: 'gray' as const };
                  return (
                    <tr key={c.id}>
                      <td className="font-mono text-xs text-ink-3">{c.claim_number}</td>
                      <td className="text-sm">{c.service_type}</td>
                      <td className="font-bold">{fmtCurrency(c.amount_billed)}</td>
                      <td className="text-sm">{c.insurance_provider}</td>
                      <td className="text-xs">{fmtDate(c.service_date)}</td>
                      <td><Badge variant={sb.variant}>{sb.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Documents (wound care images, etc.) ── */}
      {tab === 'documents' && (
        <div className="space-y-4">
          {!storageStatus?.configured && (
            <div className="card p-4 flex items-start gap-3" style={{ background: 'var(--amber-ghost, #fffbeb)' }}>
              <AlertTriangle size={18} className="text-amber flex-shrink-0 mt-0.5" />
              <div className="text-sm text-ink-2">
                <span className="font-semibold">Storage not connected yet.</span> Uploads will fail until the
                Azure storage connection is added. Everything else here is ready.
              </div>
            </div>
          )}

          {/* Upload bar */}
          <div className="card p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <select className="form-select w-auto" value={docType} onChange={e => setDocType(e.target.value)}>
                <option value="imaging">Wound Care Photo</option>
                <option value="consent_form">Consent Form</option>
                <option value="physician_order">Physician Order</option>
                <option value="lab_result">Lab Result</option>
                <option value="insurance_card">Insurance Card</option>
                <option value="id_document">ID Document</option>
                <option value="other">Other</option>
              </select>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadMut.mutate(f);
                  if (fileRef.current) fileRef.current.value = '';
                }}
              />
              <Button variant="primary" icon={<Upload size={14} />}
                loading={uploadMut.isPending}
                onClick={() => fileRef.current?.click()}>
                Upload File
              </Button>
              <span className="text-xs text-ink-3">Images (JPG, PNG, WEBP, HEIC) or PDF · up to 25 MB</span>
            </div>
          </div>

          {/* Gallery */}
          {documents.length === 0 ? (
            <div className="card"><EmptyState icon="🖼️" title="No documents yet"
              description="Upload wound-care photos, signed forms, or other clinical documents above." /></div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {documents.map((d: any) => {
                const isImage = d.mime_type?.startsWith('image/');
                return (
                  <div key={d.id} className="card overflow-hidden group">
                    <button onClick={() => openDocument(d.id)}
                      className="w-full h-32 bg-bg flex items-center justify-center hover:bg-surface-2 transition-colors">
                      {isImage
                        ? <ImageIcon size={28} className="text-ink-4" />
                        : <FileText size={28} className="text-ink-4" />}
                    </button>
                    <div className="p-2.5">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate" title={d.file_name}>{d.file_name}</div>
                          <div className="text-[10px] text-ink-3 mt-0.5">{d.document_type?.replace(/_/g, ' ')}</div>
                          <div className="text-[10px] text-ink-4">{fmtDate(d.created_at)}</div>
                        </div>
                        <button onClick={() => { if (confirm('Delete this document?')) deleteMut.mutate(d.id); }}
                          className="text-ink-4 hover:text-red transition-colors flex-shrink-0">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Document viewer modal */}
      {viewerUrl && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6"
          onClick={() => setViewerUrl(null)}>
          <div className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
              <span className="text-sm font-semibold truncate">{viewerUrl.name}</span>
              <div className="flex items-center gap-3">
                <a href={viewerUrl.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-forest font-semibold hover:underline">Open / Download</a>
                <button onClick={() => setViewerUrl(null)} className="text-ink-3 hover:text-ink"><XIcon size={18} /></button>
              </div>
            </div>
            <div className="overflow-auto p-2 flex items-center justify-center bg-bg">
              {viewerUrl.mime?.startsWith('image/')
                ? <img src={viewerUrl.url} alt={viewerUrl.name} className="max-w-full max-h-[75vh] object-contain" />
                : <iframe src={viewerUrl.url} className="w-[80vw] h-[75vh]" title={viewerUrl.name} />}
            </div>
          </div>
        </div>
      )}

      {/* ── Record Vitals Modal ── */}
      <Modal
        open={vitalsOpen}
        onClose={() => { setVitalsOpen(false); resetVitals(); }}
        title="Record Vital Signs"
        subtitle={`${p.first_name} ${p.last_name}`}
        size="lg"
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setVitalsOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={vitalsMut.isPending} onClick={hv(d => vitalsMut.mutate(d))}>Save Vitals</Button>
          </ModalFooter>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="form-label">BP Systolic</label><input type="number" className="form-input" placeholder="120" {...rv('bp_systolic')} /></div>
            <div><label className="form-label">BP Diastolic</label><input type="number" className="form-input" placeholder="80" {...rv('bp_diastolic')} /></div>
            <div><label className="form-label">Heart Rate</label><input type="number" className="form-input" placeholder="72" {...rv('heart_rate')} /></div>
            <div><label className="form-label">O₂ Saturation (%)</label><input type="number" className="form-input" placeholder="98" min="50" max="100" {...rv('oxygen_saturation')} /></div>
            <div><label className="form-label">Resp. Rate</label><input type="number" className="form-input" placeholder="16" {...rv('respiratory_rate')} /></div>
            <div><label className="form-label">Temperature (°F)</label><input type="number" step="0.1" className="form-input" placeholder="98.6" {...rv('temperature')} /></div>
            <div><label className="form-label">Weight (lbs)</label><input type="number" step="0.1" className="form-input" {...rv('weight_lbs')} /></div>
            <div><label className="form-label">Blood Glucose</label><input type="number" className="form-input" {...rv('blood_glucose')} /></div>
            <div><label className="form-label">Pain Scale (0–10)</label><input type="number" min="0" max="10" className="form-input" {...rv('pain_scale')} /></div>
          </div>
          <div><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} {...rv('notes')} /></div>
        </div>
      </Modal>

      {/* ── Schedule Visit Modal ── */}
      <Modal
        open={visitOpen}
        onClose={() => { setVisitOpen(false); resetVisit(); }}
        title="Schedule Home Visit"
        subtitle={`${p.first_name} ${p.last_name}`}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setVisitOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={visitMut.isPending} onClick={hvs(d => visitMut.mutate(d))}>Schedule Visit</Button>
          </ModalFooter>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="form-label">Caregiver</label>
            <select className="form-select" {...rvs('caregiver_id')}>
              <option value="">Assign caregiver...</option>
              {caregivers?.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="form-label">Date *</label><input type="date" className="form-input" {...rvs('visit_date', { required: true })} /></div>
            <div><label className="form-label">Time</label><input type="time" className="form-input" {...rvs('visit_time')} /></div>
          </div>
          <div>
            <label className="form-label">Visit Type</label>
            <select className="form-select" {...rvs('visit_type', { required: true })}>
              {Object.entries(VISIT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} {...rvs('notes')} /></div>
        </div>
      </Modal>

      {/* ── Edit Patient Modal ── */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Patient"
        subtitle={`${p.first_name} ${p.last_name}`}
        size="lg"
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={editMutation.isPending}
              onClick={editForm.handleSubmit(onEditSubmit)}>
              Save Changes
            </Button>
          </ModalFooter>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">First Name *</label>
            <input className="form-input" {...editForm.register('first_name')} />
            {editForm.formState.errors.first_name && (
              <p className="text-xs text-red mt-1">{editForm.formState.errors.first_name.message}</p>
            )}
          </div>
          <div>
            <label className="form-label">Last Name *</label>
            <input className="form-input" {...editForm.register('last_name')} />
            {editForm.formState.errors.last_name && (
              <p className="text-xs text-red mt-1">{editForm.formState.errors.last_name.message}</p>
            )}
          </div>
          <div>
            <label className="form-label">Date of Birth *</label>
            <input type="date" className="form-input" {...editForm.register('date_of_birth')} />
            {editForm.formState.errors.date_of_birth && (
              <p className="text-xs text-red mt-1">{editForm.formState.errors.date_of_birth.message}</p>
            )}
          </div>
          <div>
            <label className="form-label">Gender</label>
            <select className="form-select" {...editForm.register('gender')}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">Phone</label>
            <input className="form-input" placeholder="(555) 000-0000" {...editForm.register('phone')} />
          </div>
          <div>
            <label className="form-label">Email</label>
            <input type="email" className="form-input" {...editForm.register('email')} />
            {editForm.formState.errors.email && (
              <p className="text-xs text-red mt-1">{editForm.formState.errors.email.message}</p>
            )}
          </div>
          <div className="col-span-2">
            <label className="form-label">Address</label>
            <input className="form-input" placeholder="123 Main St" {...editForm.register('address_line1')} />
          </div>
          <div><label className="form-label">City</label><input className="form-input" {...editForm.register('city')} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="form-label">State</label><input className="form-input" placeholder="TX" {...editForm.register('state')} /></div>
            <div><label className="form-label">ZIP</label><input className="form-input" {...editForm.register('zip')} /></div>
          </div>
          <div>
            <label className="form-label">Blood Type</label>
            <select className="form-select" {...editForm.register('blood_type')}>
              <option value="">—</option>
              {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bt => <option key={bt} value={bt}>{bt}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Primary Diagnosis</label>
            <input className="form-input" placeholder="CHF, COPD..." {...editForm.register('primary_diagnosis')} />
          </div>
          <div className="col-span-2">
            <label className="form-label">Allergies (comma-separated)</label>
            <input className="form-input" placeholder="Penicillin, Sulfa drugs..." {...editForm.register('allergies_str')} />
          </div>
          <div className="col-span-2">
            <label className="form-label">Medical History</label>
            <textarea className="form-textarea" rows={3} {...editForm.register('medical_history')} />
          </div>
          <div className="col-span-2">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} {...editForm.register('notes')} />
          </div>
        </div>
      </Modal>

      {/* ── Portal Invite Link Modal ── */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Patient Portal Invite"
        subtitle={`${p.first_name} ${p.last_name}`}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>Done</Button>
            <Button variant="primary" icon={<Copy size={13} />} onClick={copyLink}>
              {linkCopied ? 'Copied ✓' : 'Copy Link'}
            </Button>
          </ModalFooter>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Share this secure link with the patient so they can set their password and access their portal.
            The link expires in 72 hours.
          </p>
          <div className="p-3 bg-forest-ghost rounded-lg border border-surface-border break-all text-xs font-mono text-ink-2">
            {inviteLink}
          </div>
          <p className="text-xs text-ink-3">
            Tip: once email is configured, this link can be sent to the patient automatically. For now,
            copy it and share it with them directly (text, email, or in person).
          </p>
        </div>
      </Modal>
    </>
  );
}
