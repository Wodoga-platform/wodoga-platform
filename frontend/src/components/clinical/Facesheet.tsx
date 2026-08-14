'use client';
/**
 * Wodoga Platform — Patient Facesheet (chart landing view).
 * Path: frontend/src/components/clinical/Facesheet.tsx
 *
 * At-a-glance clinical summary + input for code status and contacts +
 * printable ER-handoff sheet. Assembles existing data; the detail tabs
 * remain for full history.
 *
 * Usage in the patient chart:  <Facesheet patient={p} />
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, Plus, ShieldAlert, ShieldCheck, PauseCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Badge, Spinner } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { medicationService, vitalsService } from '@/services';
import { clinicalService } from '@/services/clinical';
import { AlertsPanel } from '@/components/clinical/AlertsPanel';
import { IcdDiagnoses } from '@/components/clinical/IcdDiagnoses';
import { fmtDate } from '@/utils';

const CODE_LABEL: Record<string, string> = {
  full_code: 'Full Code', dnr: 'DNR', dni: 'DNI', dnr_dni: 'DNR / DNI', comfort_care: 'Comfort Care',
};
const PAYER_LABEL: Record<string, string> = {
  medicare: 'Medicare', medicare_advantage: 'Medicare Advantage', medicaid: 'Medicaid',
  commercial: 'Commercial', private_pay: 'Private Pay', va_champva: 'VA / CHAMPVA',
  workers_comp: "Workers' Comp", other: 'Other',
};

type FacesheetPatient = {
  id: string; first_name: string; last_name: string; date_of_birth: string;
  gender?: string | null; phone?: string | null; address_line1?: string | null;
  city?: string | null; state?: string | null; allergies?: string[];
  primary_diagnosis?: string | null; code_status?: string | null;
  code_status_verified_on?: string | null; payer_type?: string | null;
};

function Section({ title, action, children }:
  { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="section-title flex items-center justify-between">
        <span>{title}</span>{action}
      </div>
      {children}
    </div>
  );
}

export function Facesheet({ patient }: { patient: FacesheetPatient }) {
  const qc = useQueryClient();
  const pid = patient.id;
  const [codeOpen, setCodeOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  const meds = useQuery({ queryKey: ['meds', pid],
    queryFn: () => medicationService.list({ patient_id: pid, status: 'active' }) });
  const vitals = useQuery({ queryKey: ['vitals-latest', pid],
    queryFn: () => vitalsService.history(pid, { limit: 1 }) });
  const contacts = useQuery({ queryKey: ['contacts', pid],
    queryFn: () => clinicalService.listContacts(pid) });
  const orders = useQuery({ queryKey: ['freq-orders', pid],
    queryFn: () => clinicalService.listOrders(pid) });

  const v = vitals.data?.data?.[0] as any;

  function printFacesheet() {
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w) return;
    const dx = (patient.primary_diagnosis || '—');
    const medRows = (meds.data ?? []).map((m: any) =>
      `<tr><td>${m.drug_name}</td><td>${m.dosage ?? ''} · ${m.frequency ?? ''}</td>` +
      `<td>${m.start_date ? fmtDate(m.start_date) : ''}</td></tr>`).join('');
    const contactRows = (contacts.data ?? []).map((c) =>
      `<tr><td>${c.role.replace(/_/g, ' ')}</td><td>${c.full_name}</td><td>${c.phone ?? ''}</td></tr>`).join('');
    w.document.write(`
      <html><head><title>Facesheet — ${patient.first_name} ${patient.last_name}</title>
      <style>body{font:13px -apple-system,sans-serif;padding:28px;color:#141816}
      h1{font-size:20px;margin:0 0 2px} .sub{color:#79827d;margin-bottom:16px}
      h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#79827d;border-bottom:1px solid #e2e6e4;padding-bottom:4px;margin:18px 0 8px}
      table{width:100%;border-collapse:collapse} td{padding:5px 6px;border-bottom:1px solid #eee;vertical-align:top}
      .kv{display:inline-block;width:32%;margin-bottom:8px} .kv b{display:block;font-size:10px;color:#79827d;text-transform:uppercase}
      .alert{color:#991b1b;font-weight:700}</style></head><body>
      <h1>${patient.first_name} ${patient.last_name}</h1>
      <div class="sub">${fmtDate(patient.date_of_birth)}${patient.gender ? ' · ' + patient.gender : ''} · ${patient.phone ?? ''}</div>
      <h2>At a glance</h2>
      <div class="kv"><b>Code status</b>${patient.code_status ? (CODE_LABEL[patient.code_status] ?? patient.code_status) : '<span class="alert">NOT DOCUMENTED</span>'}</div>
      <div class="kv"><b>Payer</b>${patient.payer_type ? (PAYER_LABEL[patient.payer_type] ?? patient.payer_type) : '—'}</div>
      <div class="kv"><b>Allergies</b>${(patient.allergies ?? []).join(', ') || '—'}</div>
      <div class="kv"><b>Primary Dx</b>${dx}</div>
      <h2>Active medications</h2><table>${medRows || '<tr><td>—</td></tr>'}</table>
      <h2>Contacts</h2><table>${contactRows || '<tr><td>—</td></tr>'}</table>
      </body></html>`);
    w.document.close(); w.focus(); w.print();
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button variant="ghost" onClick={printFacesheet}><Printer className="h-4 w-4" /> Print facesheet</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: 2 cols */}
        <div className="lg:col-span-2">
          <Section title="At a glance" action={
            <button onClick={() => setCodeOpen(true)}
              className="text-forest text-xs normal-case tracking-normal font-semibold">
              Set code status
            </button>}>
            <div className="grid grid-cols-3 gap-4">
              <div><div className="text-[11px] text-ink-3 uppercase">Code status</div>
                {patient.code_status
                  ? <div className="text-sm font-medium flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-forest" />{CODE_LABEL[patient.code_status] ?? patient.code_status}</div>
                  : <div className="text-sm font-semibold text-red flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" />Not documented</div>}
              </div>
              <div><div className="text-[11px] text-ink-3 uppercase">Payer</div>
                <div className="text-sm font-medium">{patient.payer_type ? (PAYER_LABEL[patient.payer_type] ?? patient.payer_type) : '—'}</div></div>
              <div><div className="text-[11px] text-ink-3 uppercase">Allergies</div>
                <div className="text-sm font-medium">{(patient.allergies ?? []).join(', ') || '—'}</div></div>
            </div>
          </Section>

          <Section title="Diagnoses (ICD-10)">
            <IcdDiagnoses patientId={pid} />
          </Section>

          <Section title="Active medications">
            {meds.isLoading ? <Spinner size="sm" /> :
              (meds.data ?? []).length === 0 ? <p className="text-sm text-ink-3">None on file.</p> :
              <table className="w-full"><thead><tr>
                <th className="text-left text-[11px] text-ink-3 uppercase py-1">Drug</th>
                <th className="text-left text-[11px] text-ink-3 uppercase py-1">Dose / Freq</th>
                <th className="text-left text-[11px] text-ink-3 uppercase py-1">Prescribed</th>
                <th className="text-left text-[11px] text-ink-3 uppercase py-1">Prescriber</th></tr></thead>
                <tbody>{(meds.data ?? []).map((m: any) => (
                  <tr key={m.id} className="border-t border-surface-borderLt">
                    <td className="py-2 text-sm">{m.drug_name}</td>
                    <td className="py-2 text-sm text-ink-2">{m.dosage} · {m.frequency}</td>
                    <td className="py-2 text-sm text-ink-2">{m.start_date ? fmtDate(m.start_date) : '—'}</td>
                    <td className="py-2 text-sm text-ink-2">{m.prescriber_name ?? '—'}</td>
                  </tr>))}</tbody></table>}
          </Section>
        </div>

        {/* RIGHT: 1 col */}
        <div>
          <Section title="This patient's alerts"><AlertsPanel patientId={pid} /></Section>

          <Section title={v ? `Latest vitals · ${fmtDate(v.recorded_at)}` : 'Latest vitals'}>
            {vitals.isLoading ? <Spinner size="sm" /> : !v ? <p className="text-sm text-ink-3">None recorded.</p> :
              <div className="grid grid-cols-2 gap-3">
                {[['BP', v.bp_systolic && v.bp_diastolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—', v.flag_high_bp || v.flag_low_bp],
                  ['HR', v.heart_rate ?? '—', false],
                  ['SpO₂', v.oxygen_saturation ? `${v.oxygen_saturation}%` : '—', v.flag_low_o2],
                  ['Temp', v.temperature ? `${v.temperature}°F` : '—', false],
                  ['Weight', v.weight_lbs ? `${v.weight_lbs} lb` : '—', false],
                  ['Pain', v.pain_scale != null ? `${v.pain_scale}/10` : '—', false]].map(([l, val, flag]) => (
                  <div key={l as string}><div className="text-[11px] text-ink-3 uppercase">{l}</div>
                    <div className={`text-sm font-medium ${flag ? 'text-red font-semibold' : ''}`}>{val}</div></div>))}
              </div>}
          </Section>

          <Section title="Frequency orders">
            {(orders.data ?? []).filter((o) => o.status === 'active').length === 0
              ? <p className="text-sm text-ink-3">No active orders.</p>
              : (orders.data ?? []).filter((o) => o.status === 'active').map((o) => (
                <div key={o.id} className="border border-surface-border rounded-lg p-2.5 mb-2 text-sm">
                  <strong>{o.discipline} {o.visits_min}{o.visits_max !== o.visits_min ? `-${o.visits_max}` : ''}w{o.duration_weeks}</strong>
                  <div className="text-ink-3 text-xs mt-0.5">Started {fmtDate(o.start_date)}</div>
                </div>))}
          </Section>

          <Section title="Contacts" action={
            <button onClick={() => setContactOpen(true)}
              className="text-forest text-xs normal-case tracking-normal font-semibold">+ Add</button>}>
            {contacts.isLoading ? <Spinner size="sm" /> :
              (contacts.data ?? []).length === 0 ? <p className="text-sm text-ink-3">None on file.</p> :
              <div className="space-y-2">{(contacts.data ?? []).map((c) => (
                <div key={c.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.full_name}</span>
                    <Badge variant="gray">{c.role.replace(/_/g, ' ')}</Badge>
                    {c.legal_warning && <Badge variant="amber">no doc on file</Badge>}
                  </div>
                  <div className="text-ink-3 text-xs">{[c.relationship, c.phone].filter(Boolean).join(' · ')}</div>
                </div>))}</div>}
          </Section>
        </div>
      </div>

      {codeOpen && <CodeStatusModal patientId={pid} onClose={() => setCodeOpen(false)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ['patient-chart', pid] });
          qc.invalidateQueries({ queryKey: ['clinical-alerts', pid] }); }} />}
      {contactOpen && <ContactModal patientId={pid} onClose={() => setContactOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['contacts', pid] })} />}
    </div>
  );
}

/* ── Code status input ─────────────────────────────────────────────────────── */
function CodeStatusModal({ patientId, onClose, onSaved }:
  { patientId: string; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('full_code');
  const [source, setSource] = useState('polst_most');
  const [verifiedOn, setVerifiedOn] = useState('');
  const mut = useMutation({
    mutationFn: () => clinicalService.setCodeStatus(patientId,
      { code_status: code, source, verified_on: verifiedOn || undefined }),
    onSuccess: () => { toast.success('Code status saved'); onSaved(); onClose(); },
    onError: (e: any) => toast.error(e?.message ?? 'Could not save'),
  });
  return (
    <Modal open onClose={onClose} title="Set code status" subtitle="Documented directive of record">
      <div className="space-y-3">
        <div><label className="form-label">Code status</label>
          <select className="form-select" value={code} onChange={(e) => setCode(e.target.value)}>
            {Object.entries(CODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
        <div><label className="form-label">Source</label>
          <select className="form-select" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="polst_most">POLST / MOST</option>
            <option value="living_will">Living will</option>
            <option value="verbal_patient">Verbal — patient</option>
            <option value="verbal_surrogate">Verbal — surrogate</option>
            <option value="chart_review">Chart review</option>
            <option value="other">Other</option>
          </select></div>
        <div><label className="form-label">Verified on (optional — defaults to today)</label>
          <input type="date" className="form-input" value={verifiedOn} onChange={(e) => setVerifiedOn(e.target.value)} /></div>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>Save</Button>
      </ModalFooter>
    </Modal>
  );
}

/* ── Contact input ─────────────────────────────────────────────────────────── */
function ContactModal({ patientId, onClose, onSaved }:
  { patientId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    role: 'emergency', full_name: '', relationship: '', phone: '', email: '', doc_on_file: false,
  });
  const set = (k: string, val: any) => setForm((f) => ({ ...f, [k]: val }));
  const mut = useMutation({
    mutationFn: () => clinicalService.addContact(patientId, form as any),
    onSuccess: (res: any) => {
      if (res?.legal_warning) toast('POA/guardian with no document on file', { icon: '⚠️', duration: 7000 });
      toast.success('Contact added'); onSaved(); onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not add contact'),
  });
  return (
    <Modal open onClose={onClose} title="Add contact" subtitle="Next of kin, POA, guardian, emergency">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="form-label">Role</label>
            <select className="form-select" value={form.role} onChange={(e) => set('role', e.target.value)}>
              <option value="emergency">Emergency</option>
              <option value="next_of_kin">Next of kin</option>
              <option value="poa_healthcare">POA — healthcare</option>
              <option value="poa_financial">POA — financial</option>
              <option value="guardian">Guardian</option>
              <option value="other">Other</option>
            </select></div>
          <div><label className="form-label">Relationship</label>
            <input className="form-input" value={form.relationship} onChange={(e) => set('relationship', e.target.value)} /></div>
        </div>
        <div><label className="form-label">Full name</label>
          <input className="form-input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="form-label">Phone</label>
            <input className="form-input" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div><label className="form-label">Email</label>
            <input className="form-input" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.doc_on_file} onChange={(e) => set('doc_on_file', e.target.checked)} />
          Legal document on file
        </label>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending || !form.full_name}>Add</Button>
      </ModalFooter>
    </Modal>
  );
}

export default Facesheet;
