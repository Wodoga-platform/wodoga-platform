'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Button, Badge, EmptyState, PageLoader, Alert } from '@/components/ui';
import { medicationService, patientService } from '@/services';

export default function ReconciliationPage() {
  const [selectedPatient, setSelectedPatient] = useState('');
  const [result, setResult] = useState<any>(null);

  const { data: patients, isLoading } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const reconMut = useMutation({
    mutationFn: (patientId: string) => medicationService.reconcile(patientId),
    onSuccess: (data) => {
      setResult(data);
      if (data.conflicts_found > 0) {
        toast.error(`${data.conflicts_found} conflict(s) detected — review required`);
      } else {
        toast.success('No conflicts found ✓');
      }
    },
    onError: () => toast.error('Reconciliation failed. Please try again.'),
  });

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Medication Reconciliation</h1>
          <p className="page-subtitle">
            Review patient medications for dangerous interactions and conflicts
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        <div className="card">
          <div className="card-header">
            <div className="text-sm font-bold">Run Reconciliation</div>
          </div>
          <div className="card-body space-y-4">
            <div>
              <label className="form-label">Select Patient *</label>
              {isLoading ? (
                <PageLoader />
              ) : (
                <select
                  className="form-select"
                  value={selectedPatient}
                  onChange={e => {
                    setSelectedPatient(e.target.value);
                    setResult(null);
                  }}
                >
                  <option value="">Select a patient...</option>
                  {patients?.data.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <Button
              variant="primary"
              className="w-full justify-center"
              loading={reconMut.isPending}
              disabled={!selectedPatient}
              onClick={() => reconMut.mutate(selectedPatient)}
            >
              🔍 Run Reconciliation
            </Button>

            <div className="p-3 bg-blue-ghost rounded border border-blue-pale text-xs text-blue">
              ℹ Reconciliation checks for dangerous drug interactions,
              duplicate drug classes, and contraindicated combinations
              across all active medications.
            </div>
          </div>
        </div>

        <div>
          {result ? (
            <div className="card">
              <div className="card-header">
                <div className="text-sm font-bold">Results</div>
                <Badge variant={result.conflicts_found > 0 ? 'red' : 'green'}>
                  {result.conflicts_found > 0
                    ? `${result.conflicts_found} conflict(s) found`
                    : 'No conflicts'}
                </Badge>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="text-center p-3 bg-bg rounded border border-surface-border">
                    <div className="text-2xl font-bold font-display text-forest">
                      {result.medications_reviewed}
                    </div>
                    <div className="text-xs text-ink-3 uppercase tracking-wide mt-1">
                      Medications Reviewed
                    </div>
                  </div>
                  <div className="text-center p-3 bg-bg rounded border border-surface-border">
                    <div className={`text-2xl font-bold font-display ${
                      result.conflicts_found > 0 ? 'text-red' : 'text-forest'
                    }`}>
                      {result.conflicts_found}
                    </div>
                    <div className="text-xs text-ink-3 uppercase tracking-wide mt-1">
                      Conflicts Found
                    </div>
                  </div>
                </div>

                {result.conflicts.length > 0 ? (
                  <div className="space-y-2">
                    <div className="section-title">Conflicts Detected</div>
                    {result.conflicts.map((c: any, i: number) => (
                      <div
                        key={i}
                        className="p-3 bg-red-ghost border border-red-pale rounded"
                      >
                        <div className="text-xs font-bold text-red mb-1">
                          ⚠ {c.drugs.join(' + ')}
                        </div>
                        <div className="text-xs text-ink-2">{c.warn}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <div className="text-4xl mb-2">✅</div>
                    <div className="text-sm font-bold text-forest">
                      All medications clear
                    </div>
                    <div className="text-xs text-ink-3 mt-1">
                      No dangerous interactions detected
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card flex items-center justify-center min-h-[280px]">
              <EmptyState
                icon="🔍"
                title="Select a patient"
                description="Choose a patient and run reconciliation to check for medication conflicts"
              />
            </div>
          )}
        </div>
      </div>

      {result && result.medications.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="text-sm font-bold">
              Medications Reviewed — {result.medications.length} active
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Medication</th>
                <th>Dosage</th>
                <th>Route</th>
                <th>Frequency</th>
                <th>Prescriber</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.medications.map((m: any) => (
                <tr key={m.id}>
                  <td className="font-semibold">{m.drug_name}</td>
                  <td className="text-xs">{m.dosage}</td>
                  <td className="text-xs">{m.route}</td>
                  <td className="text-xs">{m.frequency}</td>
                  <td className="text-xs">{m.prescriber_name || '—'}</td>
                  <td>
                    <Badge variant="green">Active</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
