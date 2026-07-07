'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, AlertTriangle } from 'lucide-react';
import { Button, Badge, EmptyState, PageLoader, Alert, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { medicationService, patientService } from '@/services';
import { cn } from '@/utils';

// A single clinical safety alert as returned by the backend prescribe endpoint.
interface SafetyAlert {
  severity: 'critical' | 'high' | 'moderate' | 'info';
  type: 'allergy' | 'interaction' | 'duplicate_therapy';
  message: string;
  trigger?: string | null;
}

export default function MedicationsPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [recoPatient, setRecoPatient] = useState('');
  const [recoResult, setRecoResult] = useState<any>(null);
  const { register, handleSubmit, reset, getValues } = useForm();

  // Clinical safety alert state. When the backend blocks a prescription with
  // a 409 safety_alert, we capture the alerts + attempted prescription here
  // and show the override dialog. The clinician must type a reason to proceed.
  const [safetyAlerts, setSafetyAlerts] = useState<SafetyAlert[] | null>(null);
  const [pendingRx, setPendingRx] = useState<any>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  const { data: meds = [], isLoading } = useQuery({
    queryKey: ['medications'],
    queryFn:  () => medicationService.list(),
  });

  const { data: patients } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const addMut = useMutation({
    mutationFn: (body: any) => medicationService.prescribe(body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['medications'] });
      toast.success('Prescription created');
      setAddOpen(false);
      reset();
      setSafetyAlerts(null);
      setPendingRx(null);
      setOverrideReason('');
      setReasonError('');
    },
    onError: (e: any) => {
      // The backend returns a 409 with error === 'safety_alert' and an
      // `alerts` array when a prescription triggers a clinical safety
      // concern (e.g. a documented allergy). Surface that as a dedicated,
      // unmissable dialog rather than a generic toast.
      if (e?.error === 'safety_alert' && Array.isArray(e?.alerts)) {
        setSafetyAlerts(e.alerts as SafetyAlert[]);
        setPendingRx(pendingRx ?? getValues());
        setOverrideReason('');
        setReasonError('');
        return;
      }
      toast.error(e?.message || 'Failed to prescribe.');
    },
  });

  const confirmOverride = () => {
    if (!overrideReason.trim()) {
      setReasonError('A clinical reason is required to override this safety alert.');
      return;
    }
    setReasonError('');
    addMut.mutate({
      ...pendingRx,
      safety_override: true,
      safety_override_reason: overrideReason.trim(),
    } as any);
  };

  const submitPrescription = (values: any) => {
    setPendingRx(values);
    addMut.mutate(values);
  };

  const recoMut = useMutation({
    mutationFn: (pid: string) => medicationService.reconcile(pid),
    onSuccess:  (data) => { setRecoResult(data); toast.success('Reconciliation complete'); },
    onError:    () => toast.error('Reconciliation failed.'),
  });

  const lowRefills = meds.filter(m => m.refills_remaining <= 1);
  const hasCritical = !!safetyAlerts?.some(a => a.severity === 'critical');

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Medications</h1>
          <p className="page-subtitle">Prescriptions, refills, and medication reconciliation</p>
        </div>
        <Gated permission="medications:prescribe">
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>Prescribe</Button>
        </Gated>
      </div>

      {lowRefills.length > 0 && (
        <Alert type="warning" className="mb-4">
          {lowRefills.length} medication(s) low on refills — review needed.
        </Alert>
      )}

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 card">
          <div className="card-header"><div className="text-sm font-bold">Active Medications</div></div>
          {isLoading ? <PageLoader /> : meds.length === 0 ? (
            <EmptyState icon="💊" title="No medications" description="Prescribed medications will appear here." />
          ) : (
            <table className="data-table">
              <thead><tr><th>Drug</th><th>Dosage</th><th>Frequency</th><th>Refills</th><th>Prescriber</th></tr></thead>
              <tbody>
                {meds.map(m => (
                  <tr key={m.id}>
                    <td className="font-semibold">{m.drug_name}{m.brand_name ? <span className="text-ink-4"> ({m.brand_name})</span> : null}</td>
                    <td>{m.dosage}{m.dosage_unit || ''}</td>
                    <td>{m.frequency}</td>
                    <td>{m.refills_remaining <= 1 ? <Badge variant="amber">{m.refills_remaining}</Badge> : m.refills_remaining}</td>
                    <td className="text-ink-3">{m.prescriber_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-header"><div className="text-sm font-bold">Reconciliation</div></div>
          <Gated permission="medications:reconcile">
            <div className="p-3 border-b border-surface-border flex gap-2 items-center">
              <select
                className="form-select py-1.5 text-xs flex-1"
                value={recoPatient}
                onChange={(e) => setRecoPatient(e.target.value)}
                aria-label="Select patient for reconciliation"
              >
                <option value="">Select patient…</option>
                {patients?.data.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
              </select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!recoPatient}
                loading={recoMut.isPending}
                onClick={() => recoPatient && recoMut.mutate(recoPatient)}
              >
                Run
              </Button>
            </div>
          </Gated>
          {recoResult ? (
            <div className="p-4">
              <div className="text-center mb-4">
                <div className="text-3xl font-display font-semibold">{recoResult.medications_reviewed}</div>
                <div className="text-xs text-ink-3">medications reviewed</div>
              </div>
              {recoResult.conflicts_found > 0 ? (
                <div>
                  <div className="text-xs font-bold text-red mb-2 flex items-center gap-1">
                    <AlertTriangle size={12} /> {recoResult.conflicts_found} potential issue(s) flagged
                  </div>
                  {recoResult.conflicts.map((c: any, i: number) => (
                    <div key={i} className="p-2.5 bg-red-ghost rounded border border-red-pale text-xs text-red mb-2">
                      {c.warn}
                    </div>
                  ))}
                  <p className="text-[11px] text-ink-4 mt-2 leading-snug">
                    Preliminary automated review only. Not a substitute for clinical judgment —
                    verify all interactions manually.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-surface-2 rounded border border-surface-border">
                  <div className="text-xs font-semibold text-ink-2 mb-1">
                    Automated interaction checking not yet enabled
                  </div>
                  <p className="text-[11px] text-ink-4 leading-snug">
                    This review does not yet check against a clinical drug-interaction
                    database. Please verify drug interactions manually.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon="🔍" title="Select a patient" description="Run reconciliation to review the medication list" />
          )}
        </div>
      </div>

      {/* Prescribe modal */}
      <Modal open={addOpen} onClose={() => { setAddOpen(false); reset(); }} title="Prescribe Medication"
        footer={<ModalFooter><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={addMut.isPending && !safetyAlerts} onClick={handleSubmit(submitPrescription)}>Create Prescription</Button></ModalFooter>}>
        <div className="space-y-3">
          <div><label className="form-label">Patient *</label>
            <select className="form-select" {...register('patient_id', { required: true })}>
              <option value="">Select patient...</option>
              {patients?.data.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="form-label">Drug Name *</label><input className="form-input" placeholder="Lisinopril" {...register('drug_name', { required: true })} /></div>
            <div><label className="form-label">Dosage *</label><input className="form-input" placeholder="10mg" {...register('dosage', { required: true })} /></div>
            <div><label className="form-label">Route</label>
              <select className="form-select" {...register('route')}>
                <option value="oral">Oral</option><option value="topical">Topical</option>
                <option value="injection">Injection</option><option value="inhalation">Inhalation</option>
              </select></div>
            <div><label className="form-label">Frequency *</label><input className="form-input" placeholder="Once daily" {...register('frequency', { required: true })} /></div>
            <div><label className="form-label">Refills</label><input type="number" min="0" className="form-input" defaultValue={0} {...register('refills_remaining')} /></div>
            <div><label className="form-label">Start Date</label><input type="date" className="form-input" {...register('start_date')} /></div>
          </div>
          <div><label className="form-label">Prescriber Name</label><input className="form-input" {...register('prescriber_name')} /></div>
          <div><label className="form-label">Instructions</label><textarea className="form-textarea" rows={2} {...register('instructions')} /></div>
        </div>
      </Modal>

      {/* Clinical Safety Alert dialog — life-safety surface */}
      <SafetyAlertDialog
        alerts={safetyAlerts}
        hasCritical={hasCritical}
        overrideReason={overrideReason}
        reasonError={reasonError}
        pending={addMut.isPending}
        onReasonChange={(v) => { setOverrideReason(v); if (reasonError) setReasonError(''); }}
        onCancel={() => { setSafetyAlerts(null); setPendingRx(null); setOverrideReason(''); setReasonError(''); }}
        onOverride={confirmOverride}
      />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// SAFETY ALERT DIALOG
// A dedicated, accessible, interruptive dialog for clinical safety alerts.
// ════════════════════════════════════════════════════════════════════
function SafetyAlertDialog({
  alerts, hasCritical, overrideReason, reasonError, pending,
  onReasonChange, onCancel, onOverride,
}: {
  alerts: SafetyAlert[] | null;
  hasCritical: boolean;
  overrideReason: string;
  reasonError: string;
  pending: boolean;
  onReasonChange: (v: string) => void;
  onCancel: () => void;
  onOverride: () => void;
}) {
  if (!alerts || alerts.length === 0) return null;

  const severityStyles: Record<string, string> = {
    critical: 'bg-red-ghost border-red text-red',
    high:     'bg-amber-ghost border-amber text-amber',
    moderate: 'bg-amber-ghost border-amber-pale text-amber',
    info:     'bg-surface-2 border-surface-border text-ink-2',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="safety-alert-title"
      aria-describedby="safety-alert-body"
    >
      <div className="bg-surface rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-surface-border flex items-start gap-3">
          <AlertTriangle size={24} className="text-red flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h2 id="safety-alert-title" className="text-lg font-bold text-ink">
              {hasCritical ? 'Clinical Safety Alert' : 'Prescription Advisory'}
            </h2>
            <p className="text-sm text-ink-3 mt-0.5">
              {hasCritical
                ? 'This prescription may endanger the patient. Review before proceeding.'
                : 'Please review the following before prescribing.'}
            </p>
          </div>
        </div>

        <div id="safety-alert-body" className="p-5 space-y-3" aria-live="assertive">
          {alerts.map((a, i) => (
            <div key={i} className={cn('rounded border p-3', severityStyles[a.severity] || severityStyles.info)}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/40">
                  {a.severity}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                  {a.type.replace('_', ' ')}
                </span>
              </div>
              <p className="text-sm font-medium leading-snug">{a.message}</p>
            </div>
          ))}

          {hasCritical && (
            <div className="pt-2">
              <label htmlFor="override-reason" className="form-label">
                Clinical reason for override <span className="text-red">*</span>
              </label>
              <textarea
                id="override-reason"
                className="form-textarea"
                rows={3}
                placeholder="Document the clinical justification for prescribing despite this alert…"
                value={overrideReason}
                onChange={(e) => onReasonChange(e.target.value)}
                aria-invalid={!!reasonError}
                aria-describedby={reasonError ? 'override-reason-error' : undefined}
              />
              {reasonError && (
                <p id="override-reason-error" className="text-xs text-red mt-1" role="alert">
                  {reasonError}
                </p>
              )}
              <p className="text-[11px] text-ink-4 mt-1 leading-snug">
                This justification is recorded in the patient's audit trail with your name and the time.
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-surface-border flex justify-end gap-2">
          <Button variant="primary" onClick={onCancel} autoFocus>
            Cancel — do not prescribe
          </Button>
          {hasCritical ? (
            <Button
              className="bg-red text-white hover:bg-red/90"
              loading={pending}
              onClick={onOverride}
            >
              Override & Prescribe
            </Button>
          ) : (
            <Button variant="secondary" loading={pending} onClick={onOverride}>
              Acknowledge & Prescribe
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

