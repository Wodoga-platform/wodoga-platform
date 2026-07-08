'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Home, MapPin, Plus, X } from 'lucide-react';
import { Button, Badge, Avatar, EmptyState, PageLoader, InfoField, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { visitService, patientService, staffService } from '@/services';
import { fmtDate, fmtTime, VISIT_TYPE_LABEL, cn } from '@/utils';
import type { Visit, VisitStatus } from '@/types';

type Tab = 'scheduled' | 'in_progress' | 'completed' | 'all';

const STATUS_BADGE: Record<string, any> = {
  scheduled:   'blue',
  in_progress: 'amber',
  completed:   'green',
  cancelled:   'gray',
  missed:      'red',
};

export default function VisitsPage() {
  const qc = useQueryClient();
  const [tab,        setTab]        = useState<Tab>('scheduled');
  const [schedOpen,  setSchedOpen]  = useState(false);
  const [soapVisit,  setSoapVisit]  = useState<Visit | null>(null);
  const [selected,   setSelected]   = useState<Visit | null>(null);

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

  // ── Status update ─────────────────────────────────────────
  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: VisitStatus }) =>
      visitService.update(id, { status }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['visits'] });
      toast.success(`Visit marked as ${vars.status.replace('_', ' ')} ✓`);
      // Update selected visit status locally
      if (selected && selected.id === vars.id) {
        setSelected({ ...selected, status: vars.status });
      }
    },
    onError: () => toast.error('Failed to update visit status.'),
  });

  // ── GPS check-in ──────────────────────────────────────────
  const checkinMut = useMutation({
    mutationFn: ({ id, lat, lon }: { id: string; lat?: number; lon?: number }) =>
      visitService.checkin(id, lat, lon),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] });
      toast.success('GPS check-in confirmed ✓');
      if (selected) setSelected({ ...selected, status: 'in_progress', checkin_at: new Date().toISOString() });
    },
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
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['visits'] });
      toast.success('SOAP note saved ✓');
      setSoapVisit(null);
      rsoap_reset();
      if (selected) setSelected({ ...selected, status: 'completed', has_soap_note: true });
    },
    onError: () => toast.error('Failed to save SOAP note.'),
  });

  const visits = data?.data || [];

  const TABS: { key: Tab; label: string }[] = [
    { key: 'scheduled',   label: 'Scheduled' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'completed',   label: 'Completed' },
    { key: 'all',         label: 'All Visits' },
  ];

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Home Visits</h1>
          <p className="page-subtitle">Schedule, document, and track all caregiver visits</p>
        </div>
        <Gated permission="visits:create">
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setSchedOpen(true)}>
            Schedule Visit
          </Button>
        </Gated>
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

      <div className="flex gap-5">
        {/* ── Visits Table ── */}
        <div className={cn('flex-1 min-w-0', selected ? 'max-w-[calc(100%-420px)]' : '')}>
          <div className="card">
            {isLoading ? <PageLoader /> : visits.length === 0 ? (
              <EmptyState icon={Home} title={`No ${tab} visits`}
                action={
                  <Gated permission="visits:create">
                    <Button variant="primary" size="sm" onClick={() => setSchedOpen(true)}>Schedule Visit</Button>
                  </Gated>
                }
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Caregiver</th>
                    <th>Date & Time</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map(v => (
                    <tr
                      key={v.id}
                      onClick={() => setSelected(v)}
                      className={cn('cursor-pointer', selected?.id === v.id && 'bg-forest-ghost/40')}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar firstName={v.patient_first} lastName={v.patient_last} size="sm" />
                          <span className="font-medium text-sm">{v.patient_first} {v.patient_last}</span>
                        </div>
                      </td>
                      <td className="text-sm text-ink-2">{v.caregiver_name || <span className="text-ink-4">Unassigned</span>}</td>
                      <td className="text-sm">
                        <span className="font-medium">{fmtDate(v.visit_date)}</span>
                        {v.visit_time && <span className="text-ink-3 font-mono text-xs ml-2">{fmtTime(v.visit_time)}</span>}
                      </td>
                      <td className="text-xs">{VISIT_TYPE_LABEL[v.visit_type] || v.visit_type?.replace(/_/g, ' ')}</td>
                      <td>
                        <Badge variant={STATUS_BADGE[v.status] || 'gray'}>
                          {v.status?.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1.5">
                          {v.status === 'scheduled' && !v.checkin_at && (
                            <Gated permission="visits:checkin">
                              <Button size="xs" variant="secondary" icon={<MapPin size={11} />}
                                onClick={() => handleCheckin(v)}>
                                Check In
                              </Button>
                            </Gated>
                          )}
                          {(v.status === 'scheduled' || v.status === 'in_progress') && (
                            <Gated permission="visits:soap_note">
                              <Button size="xs" variant="primary" onClick={() => setSoapVisit(v)}>
                                Document
                              </Button>
                            </Gated>
                          )}
                          {v.status === 'completed' && !v.has_soap_note && (
                            <Gated permission="visits:soap_note">
                              <Button size="xs" variant="amber" onClick={() => setSoapVisit(v)}>
                                Add SOAP
                              </Button>
                            </Gated>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Visit Detail Panel ── */}
        {selected && (
          <div className="w-[400px] flex-shrink-0">
            <div className="card sticky top-5">
              {/* Header */}
              <div className="p-5 pb-4 bg-gradient-to-br from-forest-ghost to-white border-b border-surface-border">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar firstName={selected.patient_first} lastName={selected.patient_last} size="lg" square />
                    <div>
                      <div className="font-display text-lg font-semibold">
                        {selected.patient_first} {selected.patient_last}
                      </div>
                      <div className="text-xs text-ink-3 mt-0.5">
                        {VISIT_TYPE_LABEL[selected.visit_type] || selected.visit_type?.replace(/_/g, ' ')}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="w-7 h-7 flex items-center justify-center rounded border border-surface-border text-ink-3 hover:bg-red-ghost hover:text-red transition-colors text-xs"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Status badge */}
                <div className="mt-3">
                  <Badge variant={STATUS_BADGE[selected.status] || 'gray'} className="text-xs">
                    {selected.status?.replace('_', ' ')}
                  </Badge>
                  {selected.checkin_at && (
                    <span className="ml-2 text-xs text-green font-medium">
                      <MapPin size={10} className="inline mr-0.5" />Checked In
                    </span>
                  )}
                </div>
              </div>

              <div className="p-5 max-h-[65vh] overflow-y-auto space-y-4">

                {/* Visit Details */}
                <div>
                  <div className="section-title">Visit Information</div>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoField label="Date" value={fmtDate(selected.visit_date)} />
                    <InfoField label="Time" value={selected.visit_time ? fmtTime(selected.visit_time) : '—'} />
                    <InfoField label="Caregiver" value={selected.caregiver_name || 'Unassigned'} />
                    <InfoField label="Duration" value={selected.duration_minutes ? `${selected.duration_minutes} min` : '—'} />
                  </div>
                  {selected.notes && <InfoField label="Notes" value={selected.notes} />}
                </div>

                {/* GPS Info */}
                {(selected.checkin_at || selected.checkout_at) && (
                  <div>
                    <div className="section-title">GPS Tracking</div>
                    <div className="grid grid-cols-2 gap-3">
                      {selected.checkin_at && (
                        <InfoField label="Check-In" value={new Date(selected.checkin_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
                      )}
                      {selected.checkout_at && (
                        <InfoField label="Check-Out" value={new Date(selected.checkout_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
                      )}
                      {selected.checkin_lat && (
                        <InfoField label="Location" value={`${Number(selected.checkin_lat).toFixed(4)}, ${Number(selected.checkin_lon).toFixed(4)}`} />
                      )}
                    </div>
                  </div>
                )}

                {/* SOAP Note */}
                {selected.soap_subjective && (
                  <div>
                    <div className="section-title">SOAP Note</div>
                    <div className="space-y-2">
                      {[
                        { label: 'S — Subjective', value: selected.soap_subjective, color: '#1d4ed8' },
                        { label: 'O — Objective',  value: selected.soap_objective,  color: '#7c3aed' },
                        { label: 'A — Assessment', value: selected.soap_assessment, color: '#b45309' },
                        { label: 'P — Plan',        value: selected.soap_plan,       color: '#166534' },
                      ].map(({ label, value, color }) => value ? (
                        <div key={label} className="p-3 bg-bg rounded border border-surface-border">
                          <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color }}>{label}</div>
                          <div className="text-sm text-ink-2 leading-relaxed">{value}</div>
                        </div>
                      ) : null)}
                    </div>
                  </div>
                )}

                {/* Status Actions */}
                <div>
                  <div className="section-title">Update Status</div>
                  <div className="flex flex-wrap gap-2">
                    {selected.status === 'scheduled' && (
                      <>
                        {!selected.checkin_at && (
                          <Gated permission="visits:checkin">
                            <Button size="xs" variant="secondary" icon={<MapPin size={11} />}
                              loading={checkinMut.isPending}
                              onClick={() => handleCheckin(selected)}>
                              GPS Check In
                            </Button>
                          </Gated>
                        )}
                        <Gated permission="visits:soap_note">
                          <Button size="xs" variant="primary"
                            onClick={() => setSoapVisit(selected)}>
                            Document Visit
                          </Button>
                        </Gated>
                        <Gated permission="visits:edit">
                          <Button size="xs" variant="secondary"
                            loading={updateMut.isPending}
                            onClick={() => updateMut.mutate({ id: selected.id, status: 'missed' })}>
                            Mark Missed
                          </Button>
                        </Gated>
                        <Gated permission="visits:edit">
                          <Button size="xs" className="bg-red-ghost text-red border border-red-pale"
                            loading={updateMut.isPending}
                            onClick={() => updateMut.mutate({ id: selected.id, status: 'cancelled' })}>
                            Cancel Visit
                          </Button>
                        </Gated>
                      </>
                    )}
                    {selected.status === 'in_progress' && (
                      <>
                        <Gated permission="visits:soap_note">
                          <Button size="xs" variant="primary"
                            onClick={() => setSoapVisit(selected)}>
                            Document & Complete
                          </Button>
                        </Gated>
                        <Gated permission="visits:edit">
                          <Button size="xs" variant="secondary"
                            loading={updateMut.isPending}
                            onClick={() => updateMut.mutate({ id: selected.id, status: 'completed' })}>
                            Mark Completed
                          </Button>
                        </Gated>
                      </>
                    )}
                    {selected.status === 'completed' && !selected.has_soap_note && (
                      <Gated permission="visits:soap_note">
                        <Button size="xs" variant="amber"
                          onClick={() => setSoapVisit(selected)}>
                          Add SOAP Note
                        </Button>
                      </Gated>
                    )}
                    {selected.status === 'completed' && selected.has_soap_note && (
                      <Button size="xs" variant="secondary"
                        onClick={() => setSoapVisit(selected)}>
                        Edit SOAP Note
                      </Button>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </div>
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
          subtitle={`${soapVisit.patient_first} ${soapVisit.patient_last} · ${fmtDate(soapVisit.visit_date)} · ${VISIT_TYPE_LABEL[soapVisit.visit_type] || soapVisit.visit_type}`}
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
                Save & Complete Visit
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
              <label className="form-label">Final Status</label>
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
