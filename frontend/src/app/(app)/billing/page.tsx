'use client';
/**
 * Wodoga — Billing Page
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { CheckCircle2, Clock, CreditCard, Plus, XCircle } from 'lucide-react';
import { Button, Badge, StatCard, EmptyState, PageLoader, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { billingService, patientService } from '@/services';
import { fmtDate, fmtCurrency, CLAIM_STATUS_BADGE } from '@/utils';

export default function BillingPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'list', page],
    queryFn:  () => billingService.list({ page }),
  });

  const { data: summary } = useQuery({
    queryKey: ['billing', 'summary'],
    queryFn:  () => billingService.summary(),
  });

  const { data: patients } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const { register, handleSubmit, reset } = useForm();
  const createMut = useMutation({
    mutationFn: (body: any) => billingService.submit(body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['billing'] }); toast.success('Claim submitted ✓'); setCreateOpen(false); reset(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => billingService.updateStatus(id, status),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['billing'] }); toast.success('Status updated'); },
  });

  const STATUS_CYCLE: Record<string, string> = {
    submitted: 'pending', pending: 'approved', approved: 'paid',
    denied: 'appealed', appealed: 'submitted',
  };

  const claims    = data?.data       || [];
  const pagination = data?.pagination;

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div><h1 className="page-title">Billing & Claims</h1><p className="page-subtitle">Insurance claims, payments, and revenue cycle management</p></div>
        <Gated permission="billing:create">
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setCreateOpen(true)}>New Claim</Button>
        </Gated>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-6">
        <StatCard label="Pending" value={summary?.pending_count || 0} icon={Clock} accent="amber" />
        <StatCard label="Approved" value={summary?.approved_count || 0} icon={CheckCircle2} accent="green" />
        <StatCard label="Denied" value={summary?.denied_count || 0} icon={XCircle} accent="red" />
      </div>

      <div className="card">
        <div className="card-header"><div className="text-sm font-bold">All Claims</div></div>
        {isLoading ? <PageLoader /> : claims.length === 0 ? <EmptyState icon={CreditCard} title="No claims submitted" /> : (
          <table className="data-table">
            <thead><tr><th>Patient</th><th>Claim #</th><th>Service</th><th>Amount</th><th>Insurance</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {claims.map(c => {
                const sb = CLAIM_STATUS_BADGE[c.status] || { label: c.status, variant: 'gray' as const };
                return (
                  <tr key={c.id}>
                    <td className="font-medium text-sm">{c.first_name} {c.last_name}</td>
                    <td className="font-mono text-xs text-ink-3">{c.claim_number}</td>
                    <td className="text-xs">{c.service_type} {c.cpt_code && <span className="text-ink-4">({c.cpt_code})</span>}</td>
                    <td className="font-bold">{fmtCurrency(c.amount_billed)}</td>
                    <td className="text-xs">{c.insurance_provider}</td>
                    <td className="text-xs">{fmtDate(c.service_date)}</td>
                    <td><Badge variant={sb.variant}>{sb.label}</Badge></td>
                    <td>
                      {STATUS_CYCLE[c.status] && (
                        <Gated permission="billing:update">
                          <Button size="xs" variant="secondary"
                            onClick={() => updateMut.mutate({ id: c.id, status: STATUS_CYCLE[c.status] })}>
                            → {STATUS_CYCLE[c.status]}
                          </Button>
                        </Gated>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-surface-border text-xs text-ink-3">
            <span>Page {pagination.page} of {pagination.pages}</span>
            <div className="flex gap-1.5">
              <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
              <Button size="xs" variant="secondary" disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}>Next →</Button>
            </div>
          </div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => { setCreateOpen(false); reset(); }} title="Submit Insurance Claim"
        footer={<ModalFooter><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={createMut.isPending} onClick={handleSubmit(d => createMut.mutate(d))}>Submit Claim</Button></ModalFooter>}>
        <div className="space-y-3">
          <div><label className="form-label">Patient *</label>
            <select className="form-select" {...register('patient_id', { required: true })}>
              <option value="">Select patient...</option>
              {patients?.data.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="form-label">Service Type *</label><input className="form-input" placeholder="Home Health Visit" {...register('service_type', { required: true })} /></div>
            <div><label className="form-label">Amount ($) *</label><input type="number" step="0.01" className="form-input" {...register('amount_billed', { required: true })} /></div>
            <div><label className="form-label">Insurance Provider</label><input className="form-input" placeholder="Medicare..." {...register('insurance_provider')} /></div>
            <div><label className="form-label">Service Date</label><input type="date" className="form-input" {...register('service_date')} /></div>
          </div>
          <div><label className="form-label">CPT Code</label><input className="form-input" placeholder="G0299..." {...register('cpt_code')} /></div>
        </div>
      </Modal>
    </>
  );
}
