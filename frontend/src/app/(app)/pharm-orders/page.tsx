'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, ArrowRight } from 'lucide-react';
import { Button, Badge, EmptyState, PageLoader } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { pharmService, patientService } from '@/services';
import { fmtDate, PHARM_STAGE_LABEL, cn } from '@/utils';
import type { PharmStage } from '@/types';

const STAGES: PharmStage[] = ['prescribed','verified','dispensed','in_transit','delivered'];
const STAGE_COLOR: Record<PharmStage, string> = {
  prescribed:'bg-blue-ghost border-blue-pale', verified:'bg-purple-ghost border-purple-pale',
  dispensed:'bg-amber-ghost border-amber-pale', in_transit:'bg-teal-ghost border-teal-pale',
  delivered:'bg-forest-ghost border-forest-pale', cancelled:'bg-surface-2 border-surface-border',
};

export default function PharmOrdersPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const { register, handleSubmit, reset } = useForm();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['pharm-orders'],
    queryFn:  () => pharmService.list(),
  });

  const { data: patients } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => pharmService.create(body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['pharm-orders'] }); toast.success('Order placed ✓'); setAddOpen(false); reset(); },
  });

  const advanceMut = useMutation({
    mutationFn: (id: string) => pharmService.advance(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['pharm-orders'] }); toast.success('Order advanced ✓'); },
  });

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div><h1 className="page-title">Pharmaceutical Orders</h1><p className="page-subtitle">Track medication orders from prescription through delivery</p></div>
        <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>New Order</Button>
      </div>

      <div className="card mb-5">
        <div className="card-header"><div className="text-sm font-bold">Order Pipeline</div></div>
        <div className="p-4 overflow-x-auto">
          <div className="flex gap-0 min-w-[700px]">
            {STAGES.filter(s => s !== 'cancelled').map((stage, si) => {
              const items = orders.filter(o => o.stage === stage);
              return (
                <div key={stage} className="pipeline-col">
                  <div className="flex items-center justify-between py-3 mb-2">
                    <span className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest">{PHARM_STAGE_LABEL[stage]}</span>
                    <span className="text-[10px] bg-surface-2 text-ink-3 font-bold px-2 py-0.5 rounded-full">{items.length}</span>
                  </div>
                  {items.map(o => (
                    <div key={o.id} className={cn('pipeline-card border', STAGE_COLOR[o.stage])}>
                      {o.is_urgent && <Badge variant="red" className="text-[10px] mb-1">Urgent</Badge>}
                      <div className="text-sm font-bold">{o.drug_name}</div>
                      <div className="text-xs text-ink-3 mt-0.5">{o.first_name} {o.last_name}</div>
                      <div className="text-xs text-ink-3">{o.quantity}</div>
                      {si < STAGES.length - 2 && (
                        <Button size="xs" variant="secondary" className="w-full mt-2 justify-center"
                          icon={<ArrowRight size={11} />} onClick={() => advanceMut.mutate(o.id)}>
                          {PHARM_STAGE_LABEL[STAGES[si+1]]}
                        </Button>
                      )}
                    </div>
                  ))}
                  {items.length === 0 && <div className="text-xs text-ink-4 py-4 text-center">Empty</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Modal open={addOpen} onClose={() => { setAddOpen(false); reset(); }} title="New Pharmaceutical Order"
        footer={<ModalFooter><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={createMut.isPending} onClick={handleSubmit(d => createMut.mutate(d))}>Place Order</Button></ModalFooter>}>
        <div className="space-y-3">
          <div><label className="form-label">Patient *</label>
            <select className="form-select" {...register('patient_id', { required: true })}>
              <option value="">Select patient...</option>
              {patients?.data.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="form-label">Drug Name *</label><input className="form-input" {...register('drug_name', { required: true })} /></div>
            <div><label className="form-label">Quantity</label><input className="form-input" placeholder="30 tablets" {...register('quantity')} /></div>
            <div><label className="form-label">Pharmacy Name</label><input className="form-input" {...register('pharmacy_name')} /></div>
            <div><label className="form-label">Expected Delivery</label><input type="date" className="form-input" {...register('expected_delivery')} /></div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="urgent" {...register('is_urgent')} className="w-4 h-4" />
            <label htmlFor="urgent" className="text-sm font-medium text-ink">Mark as urgent</label>
          </div>
        </div>
      </Modal>
    </>
  );
}
