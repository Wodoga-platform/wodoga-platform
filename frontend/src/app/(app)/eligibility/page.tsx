'use client';
/** Wodoga — Eligibility Page */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { CheckCircle2, ClipboardList, Clock, Plus, Search, XCircle } from 'lucide-react';
import { Button, Badge, EmptyState, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { eligibilityService, patientService, staffService } from '@/services';
import { fmtDate, fmtDateTime, ELIGIBILITY_BADGE } from '@/utils';

export default function EligibilityPage() {
  const qc = useQueryClient();
  const [result, setResult] = useState<any>(null);
  const [contractOpen, setContractOpen] = useState(false);
  const { register, handleSubmit } = useForm();
  const { register: regContract, handleSubmit: submitContract, reset: resetContract } = useForm();

  const { data: patients } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const { data: providers } = useQuery({
    queryKey: ['staff', 'providers'],
    queryFn:  () => staffService.list('provider'),
  });

  const { data: contracts } = useQuery({
    queryKey: ['eligibility', 'contracts'],
    queryFn:  () => eligibilityService.listContracts(),
  });

  const { data: history, refetch } = useQuery({
    queryKey: ['eligibility', 'history'],
    queryFn:  () => eligibilityService.history(),
  });

  const checkMut = useMutation({
    mutationFn: (body: any) => eligibilityService.check(body),
    onSuccess: (data) => {
      setResult(data);
      refetch();
      toast.success(`Eligibility check complete: ${data.result}`);
    },
    onError: () => toast.error('Eligibility check failed.'),
  });

  const contractMut = useMutation({
    mutationFn: (body: any) => eligibilityService.addContract(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eligibility', 'contracts'] });
      toast.success('Insurance contract saved ✓');
      setContractOpen(false);
      resetContract();
    },
    onError: () => toast.error('Could not save contract.'),
  });

  const resultVariant = result ? ELIGIBILITY_BADGE[result.result as keyof typeof ELIGIBILITY_BADGE] : null;

  const simulationBanner = result?.is_simulated ? (
    <div className="mb-4 rounded-md border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
      ⚠ DEMO MODE — This result is SIMULATED, not a real insurance
      verification. Do not rely on it for scheduling or billing.
    </div>
  ) : null;

  return (
    <>
      <div className="mb-6"><h1 className="page-title">Insurance Eligibility</h1><p className="page-subtitle">Verify patient coverage before visits to prevent denied claims</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
        <div className="card">
          <div className="card-header"><div className="text-sm font-bold">Verify Eligibility</div></div>
          <div className="card-body space-y-3">
            <div><label className="form-label">Patient</label>
              <select className="form-select" {...register('patient_id')}>
                <option value="">Select patient...</option>
                {patients?.data.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
              </select></div>
            <div><label className="form-label">Insurance Provider *</label><input className="form-input" placeholder="Medicare, Blue Cross..." {...register('insurance_provider', { required: true })} /></div>
            <div><label className="form-label">Member ID *</label><input className="form-input" placeholder="MCR-000000" {...register('member_id', { required: true })} /></div>
            <div><label className="form-label">Service Date</label><input type="date" className="form-input" {...register('service_date')} /></div>
            <Gated permission="eligibility:check">
              <Button variant="primary" className="w-full justify-center" loading={checkMut.isPending}
                onClick={handleSubmit(d => checkMut.mutate(d))}>Check Eligibility</Button>
            </Gated>
          </div>
        </div>
        <div>
          {simulationBanner}
          {result && resultVariant ? (
            <div className={`card p-6 text-center border-2 ${
              result.result === 'eligible' ? 'border-forest-light bg-forest-ghost' :
              result.result === 'not_eligible' ? 'border-red bg-red-ghost' : 'border-amber bg-amber-ghost'}`}>
              <div className="flex justify-center mb-3">{result.result === 'eligible' ? <CheckCircle2 size={36} className="text-forest" /> : result.result === 'not_eligible' ? <XCircle size={36} className="text-red" /> : <Clock size={36} className="text-amber" />}</div>
              <div className="font-display text-2xl font-semibold mb-2">{resultVariant.label}</div>
              <div className="text-sm text-ink-2 space-y-1">
                <div>Insurance: <strong>{result.insurance_provider}</strong></div>
                <div>Member ID: <strong>{result.member_id}</strong></div>
                {result.copay_amount && <div>Copay: <strong>${result.copay_amount}</strong></div>}
                {result.deductible_remaining && <div>Deductible remaining: <strong>${result.deductible_remaining}</strong></div>}
              </div>
              {result.result === 'not_eligible' && (
                <div className="mt-4 p-3 bg-red-pale rounded text-red text-sm font-semibold">
                  ⚠ Do not schedule service until coverage is confirmed
                </div>
              )}
            </div>
          ) : (
            <div className="card flex items-center justify-center h-full min-h-[280px]">
              <EmptyState icon={CheckCircle2} title="Run a check" description="Select a patient and verify their insurance eligibility" />
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-header"><div className="text-sm font-bold">Recent Eligibility Checks</div></div>
        {!history?.length ? <EmptyState icon={Search} title="No checks run yet" /> : (
          <table className="data-table"><thead><tr><th>Patient</th><th>Insurance</th><th>Member ID</th><th>Checked</th><th>Result</th></tr></thead>
          <tbody>{history.map(e => {
            const eb = ELIGIBILITY_BADGE[e.result];
            return <tr key={e.id}><td className="font-medium">{e.patient_name || '—'}</td><td>{e.insurance_provider}</td>
              <td className="font-mono text-xs">{e.member_id}</td>
              <td className="text-xs text-ink-3">{fmtDateTime(e.checked_at)}</td>
              <td><Badge variant={eb?.variant || 'gray'}>{eb?.label || e.result}</Badge></td></tr>;
          })}</tbody></table>
        )}
      </div>

      {/* ── Provider Insurance Contracts ── */}
      <div className="card mt-5">
        <div className="card-header">
          <div>
            <div className="text-sm font-bold">Provider Insurance Contracts</div>
            <div className="text-xs text-ink-3 mt-0.5">Which insurance plans each provider accepts — used for billing and eligibility</div>
          </div>
          <Gated permission="staff:manage">
            <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setContractOpen(true)}>Add Contract</Button>
          </Gated>
        </div>
        {!contracts?.length ? (
          <EmptyState icon={ClipboardList} title="No contracts yet" description="Add which insurance plans your providers are contracted with." />
        ) : (
          <table className="data-table">
            <thead><tr><th>Provider</th><th>Insurance</th><th>Plan</th><th>Type</th><th>Payer ID</th><th>New Patients</th></tr></thead>
            <tbody>
              {contracts.map(c => (
                <tr key={c.id}>
                  <td className="font-medium">{c.provider_name || '—'}</td>
                  <td>{c.insurance_provider}</td>
                  <td className="text-ink-2">{c.plan_name || '—'}</td>
                  <td>{c.plan_type ? <Badge variant="gray">{c.plan_type}</Badge> : '—'}</td>
                  <td className="font-mono text-xs">{c.payer_id || '—'}</td>
                  <td>{c.is_accepting_new
                    ? <Badge variant="green">Accepting</Badge>
                    : <Badge variant="gray">Closed</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Contract Modal */}
      <Modal open={contractOpen} onClose={() => { setContractOpen(false); resetContract(); }}
        title="Add Insurance Contract"
        subtitle="Record which insurance plan a provider accepts"
        footer={
          <ModalFooter>
            <Button variant="secondary" onClick={() => { setContractOpen(false); resetContract(); }}>Cancel</Button>
            <Button variant="primary" loading={contractMut.isPending}
              onClick={submitContract((d: any) => contractMut.mutate(d))}>Save Contract</Button>
          </ModalFooter>
        }>
        <div className="space-y-3">
          <div>
            <label className="form-label">Provider *</label>
            <select className="form-select" {...regContract('provider_id', { required: true })}>
              <option value="">Select provider...</option>
              {providers?.map((s: any) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Insurance Provider *</label>
            <input className="form-input" placeholder="Medicare, Blue Cross Blue Shield..." {...regContract('insurance_provider', { required: true })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label">Plan Name</label>
              <input className="form-input" placeholder="e.g. PPO Gold" {...regContract('plan_name')} />
            </div>
            <div>
              <label className="form-label">Plan Type</label>
              <select className="form-select" {...regContract('plan_type')}>
                <option value="">—</option>
                {['HMO','PPO','EPO','POS','HDHP','Medicare','Medicaid','other'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Payer ID</label>
            <input className="form-input" placeholder="Electronic payer ID for claims" {...regContract('payer_id')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label">Contract Start</label>
              <input type="date" className="form-input" {...regContract('contract_start')} />
            </div>
            <div>
              <label className="form-label">Contract End</label>
              <input type="date" className="form-input" {...regContract('contract_end')} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" defaultChecked {...regContract('is_accepting_new')} />
            Accepting new patients under this plan
          </label>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} {...regContract('notes')} />
          </div>
        </div>
      </Modal>
    </>
  );
}
