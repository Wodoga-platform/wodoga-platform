'use client';
/** Wodoga — Eligibility Page */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Button, Badge, EmptyState } from '@/components/ui';
import { eligibilityService, patientService } from '@/services';
import { fmtDate, fmtDateTime, ELIGIBILITY_BADGE } from '@/utils';

export default function EligibilityPage() {
  const [result, setResult] = useState<any>(null);
  const { register, handleSubmit } = useForm();

  const { data: patients } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
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

  const resultVariant = result ? ELIGIBILITY_BADGE[result.result as keyof typeof ELIGIBILITY_BADGE] : null;

  return (
    <>
      <div className="mb-6"><h1 className="page-title">Insurance Eligibility</h1><p className="page-subtitle">Verify patient coverage before visits to prevent denied claims</p></div>
      <div className="grid grid-cols-2 gap-5 mb-5">
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
            <Button variant="primary" className="w-full justify-center" loading={checkMut.isPending}
              onClick={handleSubmit(d => checkMut.mutate(d))}>🔍 Check Eligibility</Button>
          </div>
        </div>
        <div>
          {result && resultVariant ? (
            <div className={`card p-6 text-center border-2 ${
              result.result === 'eligible' ? 'border-forest-light bg-forest-ghost' :
              result.result === 'not_eligible' ? 'border-red bg-red-ghost' : 'border-amber bg-amber-ghost'}`}>
              <div className="text-4xl mb-3">{result.result === 'eligible' ? '✅' : result.result === 'not_eligible' ? '❌' : '⏳'}</div>
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
              <EmptyState icon="✅" title="Run a check" description="Select a patient and verify their insurance eligibility" />
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-header"><div className="text-sm font-bold">Recent Eligibility Checks</div></div>
        {!history?.length ? <EmptyState icon="🔍" title="No checks run yet" /> : (
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
    </>
  );
}
