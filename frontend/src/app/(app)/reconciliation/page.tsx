'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowUpCircle, CheckCircle, Pill, RefreshCcw, RefreshCw } from 'lucide-react';
import { Button, Badge, EmptyState, Alert, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { medicationService, patientService } from '@/services';
import type { ReconciliationResult } from '@/types';

export default function ReconciliationPage() {
  const [patientId, setPatientId] = useState('');
  const [result,    setResult]    = useState<ReconciliationResult | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveAction, setResolveAction] = useState<'reviewed' | 'escalated'>('reviewed');
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolved, setResolved] = useState(false);

  const { data: patients, isLoading: pLoading } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const recoMut = useMutation({
    mutationFn: (pid: string) => medicationService.reconcile(pid),
    onSuccess: (res) => {
      setResult(res);
      setResolved(false);
      if (res.conflicts_found === 0) {
        toast.success('No conflicts found ✓');
      } else {
        toast.error(`${res.conflicts_found} conflict(s) detected`);
      }
    },
    onError: () => toast.error('Reconciliation failed. Please try again.'),
  });

  const resolveMut = useMutation({
    mutationFn: () => medicationService.resolveReconciliation(result!.reconciliation_id, {
      status: resolveAction,
      resolution_notes: resolveNotes,
    }),
    onSuccess: () => {
      toast.success(resolveAction === 'reviewed' ? 'Marked as reviewed ✓' : 'Escalated to prescriber ✓');
      setResolveOpen(false);
      setResolveNotes('');
      setResolved(true);
    },
    onError: () => toast.error('Could not save. Please try again.'),
  });

  const openResolve = (action: 'reviewed' | 'escalated') => {
    setResolveAction(action);
    setResolveOpen(true);
  };

  const selectedPatient = patients?.data.find(p => p.id === patientId);

  return (
    <>
      <div className="mb-6">
        <h1 className="page-title">Medication Reconciliation</h1>
        <p className="page-subtitle">Detect drug interactions and review active prescriptions</p>
      </div>

      {/* Patient Selector */}
      <div className="card p-5 mb-5">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="form-label">Select Patient</label>
            {pLoading ? (
              <div className="form-input text-ink-3 text-sm">Loading patients...</div>
            ) : (
              <select
                className="form-select"
                value={patientId}
                onChange={e => { setPatientId(e.target.value); setResult(null); }}
              >
                <option value="">Choose a patient to review...</option>
                {patients?.data.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name}
                    {p.primary_diagnosis ? ` — ${p.primary_diagnosis}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Gated permission="medications:reconcile">
            <Button
              variant="primary"
              icon={<RefreshCw size={14} />}
              disabled={!patientId}
              loading={recoMut.isPending}
              onClick={() => patientId && recoMut.mutate(patientId)}
            >
              Run Reconciliation
            </Button>
          </Gated>
        </div>
      </div>

      {/* Running state */}
      {recoMut.isPending && (
        <div className="card p-8 flex items-center justify-center gap-3 text-ink-3">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm font-medium">Analysing medication list...</span>
        </div>
      )}

      {/* Results */}
      {result && !recoMut.isPending && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
            <div className="card p-4 text-center">
              <div className="text-2xl font-bold text-ink">{result.medications_reviewed}</div>
              <div className="text-xs text-ink-3 mt-1 font-medium">Medications Reviewed</div>
            </div>
            <div className="card p-4 text-center">
              <div className={`text-2xl font-bold ${result.conflicts_found > 0 ? 'text-red' : 'text-forest'}`}>
                {result.conflicts_found}
              </div>
              <div className="text-xs text-ink-3 mt-1 font-medium">
                {result.conflicts_found > 0 ? 'Conflicts Detected' : 'No Conflicts'}
              </div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-sm font-bold text-ink">
                {selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : '—'}
              </div>
              <div className="text-xs text-ink-3 mt-1 font-medium">Patient Reviewed</div>
            </div>
          </div>

          {/* Conflicts */}
          {result.conflicts_found > 0 ? (
            <div className="card mb-5">
              <div className="card-header">
                <div className="card-title flex items-center gap-2" style={{ color: 'var(--red)' }}>
                  <AlertTriangle size={15} />
                  {result.conflicts_found} Conflict{result.conflicts_found > 1 ? 's' : ''} — Physician Review Required
                </div>
              </div>
              <div className="p-4 space-y-3">
                {result.conflicts.map((c, i) => (
                  <div key={i} className="flex gap-3 p-3 rounded border" style={{ background: 'var(--red-pale)', borderColor: 'var(--red-pale)' }}>
                    <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--red)' }} />
                    <div>
                      <div className="text-xs font-bold mb-1" style={{ color: 'var(--red)' }}>
                        {c.drugs.join(' + ')}
                      </div>
                      <div className="text-sm text-ink-2">{c.warn}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Alert type="success" className="mb-5">
              No drug interactions detected for the current active medication list.
            </Alert>
          )}

          {/* Resolution actions */}
          {resolved ? (
            <Alert type="success" className="mb-5">
              ✓ This reconciliation has been recorded in the patient's audit trail.
            </Alert>
          ) : (
            <div className="card mb-5 p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-sm font-bold">Clinical Review</div>
                  <div className="text-xs text-ink-3 mt-0.5">
                    Document your review. Mark as reviewed if addressed, or escalate if it needs prescriber/pharmacist attention.
                  </div>
                </div>
                <div className="flex gap-2">
                  <Gated permission="medications:reconcile">
                    <Button variant="secondary" size="sm" icon={<CheckCircle size={14} />}
                      onClick={() => openResolve('reviewed')}>
                      Mark Reviewed
                    </Button>
                  </Gated>
                  <Gated permission="medications:reconcile">
                    <Button variant="primary" size="sm" icon={<ArrowUpCircle size={14} />}
                      onClick={() => openResolve('escalated')}>
                      Escalate
                    </Button>
                  </Gated>
                </div>
              </div>
            </div>
          )}

          {/* Medication table */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                Active Medications — {selectedPatient?.first_name} {selectedPatient?.last_name}
              </div>
            </div>
            {result.medications.length === 0 ? (
              <EmptyState icon={Pill} title="No active medications" />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Medication</th>
                    <th>Dosage</th>
                    <th>Route</th>
                    <th>Frequency</th>
                    <th>Prescriber</th>
                    <th>Refills</th>
                  </tr>
                </thead>
                <tbody>
                  {result.medications.map(m => {
                    const flagged = result.conflicts.some(c =>
                      c.drugs.some(d => m.drug_name?.toLowerCase().includes(d.toLowerCase()))
                    );
                    return (
                      <tr key={m.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            {flagged && <AlertTriangle size={12} style={{ color: 'var(--red)' }} />}
                            <span className="font-semibold text-sm">{m.drug_name}</span>
                            {m.brand_name && <span className="text-xs text-ink-3">({m.brand_name})</span>}
                          </div>
                        </td>
                        <td className="text-sm">{m.dosage}</td>
                        <td className="text-sm capitalize">{m.route}</td>
                        <td className="text-sm">{m.frequency}</td>
                        <td className="text-sm text-ink-2">{m.prescriber_name || '—'}</td>
                        <td>
                          <Badge variant={m.refills_remaining === 0 ? 'red' : m.refills_remaining <= 1 ? 'amber' : 'green'}>
                            {m.refills_remaining} left
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {!result && !recoMut.isPending && (
        <div className="card">
          <EmptyState
            icon={RefreshCcw}
            title="Select a patient to begin"
            description="Choose a patient above and click Run Reconciliation to check for drug interactions."
          />
        </div>
      )}

      {/* Resolution modal */}
      <Modal open={resolveOpen} onClose={() => setResolveOpen(false)}
        title={resolveAction === 'reviewed' ? 'Mark as Reviewed' : 'Escalate Reconciliation'}
        subtitle={resolveAction === 'reviewed'
          ? 'Confirm you have reviewed these medications and any conflicts'
          : 'Flag this for prescriber or pharmacist attention'}
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => setResolveOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={resolveMut.isPending}
              onClick={() => resolveMut.mutate()}>
              {resolveAction === 'reviewed' ? 'Confirm Review' : 'Escalate'}
            </Button>
          </ModalFooter>
        }>
        <div className="space-y-3">
          <div>
            <label className="form-label">
              {resolveAction === 'reviewed' ? 'Resolution Notes' : 'Reason for Escalation'}
              {resolveAction === 'escalated' && ' *'}
            </label>
            <textarea className="form-textarea min-h-[100px]"
              placeholder={resolveAction === 'reviewed'
                ? 'e.g. Reviewed with patient, no changes needed. Conflicts assessed as clinically acceptable.'
                : 'e.g. Warfarin + aspirin combination needs prescriber review before continuing.'}
              value={resolveNotes}
              onChange={e => setResolveNotes(e.target.value)} />
          </div>
          <div className="text-xs text-ink-3 bg-bg rounded p-3 border border-surface-borderLt">
            This action is recorded in the patient's permanent audit trail with your name and timestamp.
          </div>
        </div>
      </Modal>
    </>
  );
}
