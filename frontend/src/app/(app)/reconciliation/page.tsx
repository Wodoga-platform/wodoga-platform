'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button, Badge, EmptyState, Alert } from '@/components/ui';
import { medicationService, patientService } from '@/services';
import type { ReconciliationResult } from '@/types';

export default function ReconciliationPage() {
  const [patientId, setPatientId] = useState('');
  const [result,    setResult]    = useState<ReconciliationResult | null>(null);

  const { data: patients, isLoading: pLoading } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const recoMut = useMutation({
    mutationFn: (pid: string) => medicationService.reconcile(pid),
    onSuccess: (res) => {
      setResult(res);
      if (res.conflicts_found === 0) {
        toast.success('No conflicts found ✓');
      } else {
        toast.error(`${res.conflicts_found} conflict(s) detected`);
      }
    },
    onError: () => toast.error('Reconciliation failed. Please try again.'),
  });

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
          <Button
            variant="primary"
            icon={<RefreshCw size={14} />}
            disabled={!patientId}
            loading={recoMut.isPending}
            onClick={() => patientId && recoMut.mutate(patientId)}
          >
            Run Reconciliation
          </Button>
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
          <div className="grid grid-cols-3 gap-4 mb-5">
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

          {/* Medication table */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                Active Medications — {selectedPatient?.first_name} {selectedPatient?.last_name}
              </div>
            </div>
            {result.medications.length === 0 ? (
              <EmptyState icon="💊" title="No active medications" />
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
            icon="🔄"
            title="Select a patient to begin"
            description="Choose a patient above and click Run Reconciliation to check for drug interactions."
          />
        </div>
      )}
    </>
  );
}
