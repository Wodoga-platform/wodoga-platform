'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, MapPin } from 'lucide-react';
import { Button, Badge, Avatar, EmptyState, PageLoader } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { visitService, patientService, staffService } from '@/services';
import { fmtDate, fmtTime, VISIT_TYPE_LABEL, cn } from '@/utils';
import type { Visit } from '@/types';

type Tab = 'scheduled' | 'completed' | 'all';

export default function VisitsPage() {
  const qc = useQueryClient();
  const [tab, setTab]             = useState<Tab>('scheduled');
  const [schedOpen, setSchedOpen] = useState(false);
  const [soapVisit, setSoapVisit] = useState<Visit | null>(null);

  const statusParam = tab === 'all' ? undefined : tab;

  const { data, isLoading } = useQuery({
    queryKey: ['visits', tab],
    queryFn:  () => visitService.list({ status: statusParam, per_page: 50 }),
  });

  const { data: patients } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const { data: caregivers } = useQuery({
    queryKey: ['staff', 'caregivers'],
    queryFn:  () => staffService.list('caregiver'),
  });

  // ── Schedule visit ────────────────────────────────────────
  const { register: rs, handleSubmit: hs, reset: rr } = useForm();
  const scheduleMut = useMutation({
    mutationFn: (body: any) => visitService.create(body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['visits'] }); toast.success('Visit scheduled ✓'); setSchedOpen(false); rr(); },
    onError:    () => toast.error('Failed to schedule visit.'),
  });

  // ── GPS check-in ──────────────────────────────────────────
  const checkinMut = useMutation({
    mutationFn: ({ id, lat, lon }: { id: string; lat?: number; lon?: number }) =>
      visitService.checkin(id, lat, lon),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['visits'] }); toast.success('GPS check-in confirmed ✓'); },
  });

  const handleCheckin = (visit: Visit) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => checkinMut.mutate({ id: visit.id, lat: pos.coords.latitude, lon: pos.coords.longitude }),
        ()  => checkinMut.mutate({ id: visit.id }),
      );
    } else {
      checkinMut.mutate({ id: visit.id });
    }
  };

  // ── SOAP note ─────────────────────────────────────────────
  const { register: rsoap, handleSubmit: hsoap, reset: rsoap_reset } = useForm();
  const soapMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => visitService.saveSOAP(id, data),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['visits'] }); toast.success('SOAP note saved ✓'); setSoapVisit(null); rsoap_reset(); },
    onError:    () => toast.error('Failed to save SOAP note.'),
  });

  const visits = data?.data || [];

  const TABS: { key: Tab; label: string }[] = [
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'completed', label: 'Completed' },
    { key: 'all',       label: 'All Visits' },
  ];

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Home Visits</h1>
          <p className="page-subtitle">Schedule, document, and track all caregiver visits</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setSchedOpen(true)}>
          Schedule Visit
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-surface-border mb-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all',
              tab === t.key ? 'border-forest text-forest' : 'border-transparent text-ink-3 hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card">
        {isLoading ? <PageLoader /> : visits.length === 0 ? (
          <EmptyState icon="🏠" title={`No ${tab} visits`} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Caregiver</th>
                <th>Date & Time</th>
                <th>Type</th>
                {tab !== 'completed' && <th>GPS</th>}
                {tab === 'completed' && <th>SOAP Note</th>}
                {tab === 'completed' && <th>Duration</th>}
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visits.map(v => (
                <tr key={v.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Avatar firstName={v.patient_first} lastName={v.patient_last} size="sm" />
                      <span className="font-medium text-sm">{v.patient_first} {v.patient_last}</span>
                    </div>
                  </td>
                  <td className="text-sm text-ink-2">{v.caregiver_name || '—'}</td>
                  <td className="text-sm">
                    <span className="font-medium">{fmtDate(v.visit_date)}</span>
                    {v.visit_time && <span className="text-ink-3 font-mono text-xs ml-2">{fmtTime(v.visit_time)}</span>}
                  </td>
                  <td className="text-xs">{VISIT_TYPE_LABEL[v.visit_type] || v.visit_type}</td>

                  {tab !== 'completed' && (
                    <td>
                      {v.checkin_at
                        ? <Badge variant="green"><MapPin size={10} className="inline mr-1" />Checked In</Badge>
                        : v.status === 'scheduled'
                          ? <Button size="xs" variant="secondary" icon={<MapPin size={11} />}
                              onClick={() => handleCheckin(v)}>Check In</Button>
                          : <span className="text-ink-4 text-xs">—</span>
                      }
                    </td>
                  )}

                  {tab === 'completed' && (
                    <td>
                      {v.has_soap_note
                        ? <Badge variant="green">✓ Documented</Badge>
                        : <Button size="xs" variant="amber" onClick={() => setSoapVisit(v)}>Add SOAP</Button>
                      }
                    </td>
                  )}

                  {tab === 'completed' && (
                    <td className="text-xs text-ink-3">{v.duration_minutes ? `${v.duration_minutes} min` : '—'}</td>
                  )}

                  <td>
                    <Badge variant={
                      v.status === 'completed'   ? 'green' :
                      v.status === 'scheduled'   ? 'blue'  :
                      v.status === 'in_progress' ? 'amber' : 'gray'
                    }>
                      {v.status.replace('_', ' ')}
                    </Badge>
                  </td>

                  <td>
                    {v.status === 'scheduled' && (
                      <Button size="xs" variant="primary" onClick={() => setSoapVisit(v)}>Document</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Schedule Visit Modal ── */}
      <Modal
        open={schedOpen}
        onClose={() => { setSchedOpen(false); rr(); }}
        title="Schedule Home Visit"
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setSchedOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={scheduleMut.isPending}
              onClick={hs(d => scheduleMut.mutate(d))}>Schedule Visit</Button>
          </ModalFooter>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="form-label">Patient *</label>
            <select className="form-select" {...rs('patient_id', { required: true })}>
              <option value="">Select patient...</option>
              {patients?.data.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Caregiver</label>
            <select className="form-select" {...rs('caregiver_id')}>
              <option value="">Assign caregiver...</option>
              {caregivers?.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Date *</label>
              <input type="date" className="form-input" {...rs('visit_date', { required: true })} />
            </div>
            <div>
              <label className="form-label">Time</label>
              <input type="time" className="form-input" {...rs('visit_time')} />
            </div>
          </div>
          <div>
            <label className="form-label">Visit Type</label>
            <select className="form-select" {...rs('visit_type', { required: true })}>
              {Object.entries(VISIT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} {...rs('notes')} />
          </div>
        </div>
      </Modal>

      {/* ── SOAP Note Modal ── */}
      {soapVisit && (
        <Modal
          open={!!soapVisit}
          onClose={() => { setSoapVisit(null); rsoap_reset(); }}
          title="SOAP Visit Note"
          subtitle={`${soapVisit.patient_first} ${soapVisit.patient_last} · ${fmtDate(soapVisit.visit_date)} · ${VISIT_TYPE_LABEL[soapVisit.visit_type]}`}
          size="lg"
          footer={
            <ModalFooter>
              <Button variant="secondary" onClick={() => setSoapVisit(null)}>Cancel</Button>
              <Button variant="primary" loading={soapMut.isPending}
                onClick={hsoap(d => soapMut.mutate({ id: soapVisit.id, data: {
                  subjective: d.s, objective: d.o, assessment: d.a, plan: d.p,
                  duration_minutes: d.duration ? parseInt(d.duration) : undefined,
                  visit_status: 'completed',
                }}))}>
                Save SOAP Note
              </Button>
            </ModalFooter>
          }
        >
          {[
            { key: 's', label: 'S — Subjective', color: '#1d4ed8', hint: "Patient's own words, reported symptoms, chief complaint..." },
            { key: 'o', label: 'O — Objective',  color: '#7c3aed', hint: 'Vital signs, physical exam findings, wound assessment...' },
            { key: 'a', label: 'A — Assessment', color: '#b45309', hint: 'Clinical judgment, diagnosis, response to treatment...' },
            { key: 'p', label: 'P — Plan',        color: '#166534', hint: 'Next steps, medication changes, follow-up date...' },
          ].map(({ key, label, color, hint }) => (
            <div key={key} className="mb-4 border border-surface-border rounded overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-bg border-b border-surface-border">
                <div className="w-5 h-5 rounded text-white flex items-center justify-center text-[11px] font-bold"
                     style={{ background: color }}>
                  {label[0]}
                </div>
                <span className="text-xs font-bold text-ink-2 uppercase tracking-wide">{label}</span>
              </div>
              <textarea
                className="w-full px-3 py-2.5 text-sm bg-white border-none outline-none resize-y min-h-[70px] leading-relaxed"
                placeholder={hint}
                defaultValue={key === 's' ? soapVisit.soap_subjective || '' :
                              key === 'o' ? soapVisit.soap_objective  || '' :
                              key === 'a' ? soapVisit.soap_assessment || '' :
                                            soapVisit.soap_plan       || ''}
                {...rsoap(key)}
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div>
              <label className="form-label">Duration (minutes)</label>
              <input type="number" className="form-input" defaultValue={60} min={5} {...rsoap('duration')} />
            </div>
            <div>
              <label className="form-label">Visit Status</label>
              <select className="form-select" {...rsoap('visit_status')}>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
