'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, AlertTriangle } from 'lucide-react';
import { Button, Badge, EmptyState, PageLoader, Alert, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { medicationService, patientService } from '@/services';
import { fmtDate, cn } from '@/utils';

export default function MedicationsPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [recoPatient, setRecoPatient] = useState('');
  const [recoResult, setRecoResult] = useState<any>(null);
  const { register, handleSubmit, reset } = useForm();

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
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['medications'] }); toast.success('Prescription created ✓'); setAddOpen(false); reset(); },
    onError:    (e: any) => toast.error(e?.message || 'Failed to prescribe.'),
  });

  const recoMut = useMutation({
    mutationFn: (pid: string) => medicationService.reconcile(pid),
    onSuccess:  (data) => { setRecoResult(data); toast.success('Reconciliation complete'); },
    onError:    () => toast.error('Reconciliation failed.'),
  });

  const lowRefills = meds.filter(m => m.refills_remaining <= 1);

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div><h1 className="page-title">Medications</h1><p className="page-subtitle">Active prescriptions, refill tracking, and medication reconciliation</p></div>
        <Gated permission="medications:prescribe">
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>Prescribe</Button>
        </Gated>
      </div>

      {lowRefills.length > 0 && (
        <Alert type="warning" className="mb-5">
          <strong>{lowRefills.length} prescription(s)</strong> have 1 or fewer refills remaining:{' '}
          {lowRefills.slice(0,3).map(m => m.drug_name).join(', ')}{lowRefills.length > 3 ? ` and ${lowRefills.length-3} more` : ''}.
        </Alert>
      )}

      <div className="grid grid-cols-3 gap-5 mb-5">
        <div className="card col-span-2">
          <div className="card-header">
            <div className="text-sm font-bold">All Active Prescriptions</div>
            <Gated permission="medications:reconcile">
              <div className="flex gap-2 items-center">
                <select className="form-select py-1.5 text-xs w-40"
                  onChange={e => setRecoPatient(e.target.value)} value={recoPatient}>
                  <option value="">Run reconciliation...</option>
                  {patients?.data.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
                </select>
                <Button size="sm" variant="secondary" disabled={!recoPatient}
                  loading={recoMut.isPending}
                  onClick={() => recoPatient && recoMut.mutate(recoPatient)}>
                  Check Conflicts
                </Button>
              </div>
            </Gated>
          </div>
          {isLoading ? <PageLoader /> : meds.length === 0 ? <EmptyState icon="💊" title="No active prescriptions" /> : (
            <table className="data-table">
              <thead><tr><th>Patient</th><th>Medication</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Refills</th><th>Prescriber</th></tr></thead>
              <tbody>
                {meds.map(m => (
                  <tr key={m.id}>
                    <td className="font-medium text-sm">{m.first_name} {m.last_name}</td>
                    <td>
                      <div className="font-semibold text-sm">{m.drug_name}</div>
                      {m.brand_name && <div className="text-xs text-ink-3">{m.brand_name}</div>}
                    </td>
                    <td className="text-sm">{m.dosage}</td>
                    <td className="text-xs text-ink-2">{m.route}</td>
                    <td className="text-xs">{m.frequency}</td>
                    <td>
                      <span className={cn('font-bold text-sm', m.refills_remaining === 0 ? 'text-red' : m.refills_remaining <= 1 ? 'text-amber' : 'text-forest')}>
                        {m.refills_remaining}
                      </span>
                      {m.next_refill_date && <div className="text-xs text-ink-3">{fmtDate(m.next_refill_date)}</div>}
                    </td>
                    <td className="text-xs text-ink-3">{m.prescriber_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-header"><div className="text-sm font-bold">Reconciliation</div></div>
          {recoResult ? (
            <div className="p-4">
              <div className="text-center mb-4">
                <div className="text-3xl font-display font-semibold">{recoResult.medications_reviewed}</div>
                <div className="text-xs text-ink-3">medications reviewed</div>
              </div>
              {recoResult.conflicts_found > 0 ? (
                <div>
                  <div className="text-xs font-bold text-red mb-2 flex items-center gap-1">
                    <AlertTriangle size={12} /> {recoResult.conflicts_found} conflict(s) found
                  </div>
                  {recoResult.conflicts.map((c: any, i: number) => (
                    <div key={i} className="p-2.5 bg-red-ghost rounded border border-red-pale text-xs text-red mb-2">
                      {c.warn}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center p-4 bg-forest-ghost rounded border border-forest-pale">
                  <div className="text-2xl mb-1">✓</div>
                  <div className="text-sm font-semibold text-forest">No conflicts found</div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon="🔍" title="Select a patient" description="Run reconciliation to check for drug interactions" />
          )}
        </div>
      </div>

      <Modal open={addOpen} onClose={() => { setAddOpen(false); reset(); }} title="Prescribe Medication"
        footer={<ModalFooter><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={addMut.isPending} onClick={handleSubmit(d => addMut.mutate(d))}>Create Prescription</Button></ModalFooter>}>
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
    </>
  );
}
