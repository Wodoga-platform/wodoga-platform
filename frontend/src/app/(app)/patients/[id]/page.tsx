'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Activity, Pill, Home, ClipboardList, FileText,
  Receipt, Clock, Truck, AlertTriangle, Image as ImageIcon,
} from 'lucide-react';
import { Button, Badge, Avatar, PageLoader, EmptyState, InfoField } from '@/components/ui';
import { patientService } from '@/services';
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
        <div className="card p-8">
          <EmptyState
            icon="🖼️"
            title="Document & image storage coming online"
            description="Wound-care photos, scanned forms, and clinical documents will live here. This requires secure cloud storage, which is the next piece being set up."
          />
        </div>
      )}
    </>
  );
}
