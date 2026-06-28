'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Pencil, Clock } from 'lucide-react';
import { Button, Badge, EmptyState, PageLoader, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { pharmService, patientService } from '@/services';
import { fmtDate, PHARM_STAGE_LABEL, cn } from '@/utils';
import { useAuthStore } from '@/store/auth.store';
import type { PharmStage } from '@/types';

const STAGES: PharmStage[] = ['prescribed','verified','dispensed','in_transit','delivered'];
const STAGE_COLOR: Record<PharmStage, string> = {
  prescribed:'bg-blue-ghost border-blue-pale', verified:'bg-purple-ghost border-purple-pale',
  dispensed:'bg-amber-ghost border-amber-pale', in_transit:'bg-teal-ghost border-teal-pale',
  delivered:'bg-forest-ghost border-forest-pale', cancelled:'bg-surface-2 border-surface-border',
};

export default function PharmOrdersPage() {
  const qc = useQueryClient();
  const canEdit = useAuthStore(s => s.hasPermission('pharm_orders:advance'));
  const [addOpen, setAddOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<any | null>(null);
  const { register, handleSubmit, reset } = useForm();
  const { register: re, handleSubmit: he, reset: resetEdit } = useForm();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['pharm-orders'],
    queryFn:  () => pharmService.list(),
    refetchInterval: 60000, // refresh each minute so auto-progression shows
  });

  const { data: patients } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => pharmService.create(body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['pharm-orders'] }); toast.success('Order placed ✓'); setAddOpen(false); reset(); },
    onError:    (e: any) => toast.error(e?.message || 'Failed to place order.'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => pharmService.update(id, body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['pharm-orders'] }); toast.success('Order updated ✓'); setEditOrder(null); },
    onError:    (e: any) => toast.error(e?.message || 'Failed to update order.'),
  });

  useEffect(() => {
    if (editOrder) {
      resetEdit({
        drug_name:         editOrder.drug_name,
        quantity:          editOrder.quantity,
        pharmacy_name:     editOrder.pharmacy_name,
        pharmacy_phone:    editOrder.pharmacy_phone,
        expected_delivery: editOrder.expected_delivery?.slice(0, 10),
        is_urgent:         editOrder.is_urgent,
        stage:             editOrder.stage,
      });
    }
  }, [editOrder, resetEdit]);

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Pharmaceutical Orders</h1>
          <p className="page-subtitle">Orders advance automatically from prescription through delivery</p>
        </div>
        <Gated permission="pharm_orders:create">
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>New Order</Button>
        </Gated>
      </div>

      <div className="card mb-5">
        <div className="card-header">
          <div className="text-sm font-bold">Order Pipeline</div>
          <div className="flex items-center gap-1.5 text-xs text-ink-3">
            <Clock size={12} /> Auto-advancing
          </div>
        </div>
        {isLoading ? <PageLoader /> : (
          <div className="p-4 overflow-x-auto">
            <div className="flex gap-0 min-w-[700px]">
              {STAGES.filter(s => s !== 'cancelled').map(stage => {
                const items = orders.filter(o => o.stage === stage);
                return (
                  <div key={stage} className="pipeline-col">
                    <div className="flex items-center justify-between py-3 mb-2">
                      <span className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest">{PHARM_STAGE_LABEL[stage]}</span>
                      <span className="text-[10px] bg-surface-2 text-ink-3 font-bold px-2 py-0.5 rounded-full">{items.length}</span>
                    </div>
                    {items.map(o => (
                      <div key={o.id} className={cn('pipeline-card border transition-shadow', STAGE_COLOR[o.stage], canEdit && 'cursor-pointer hover:shadow-sm')}
                        onClick={canEdit ? () => setEditOrder(o) : undefined}>
                        {o.is_urgent && <Badge variant="red" className="text-[10px] mb-1">Urgent</Badge>}
                        <div className="flex items-start justify-between gap-1">
                          <div className="text-sm font-bold">{o.drug_name}</div>
                          {canEdit && <Pencil size={11} className="text-ink-4 flex-shrink-0 mt-0.5" />}
                        </div>
                        <div className="text-xs text-ink-3 mt-0.5">{o.first_name} {o.last_name}</div>
                        <div className="text-xs text-ink-3">{o.quantity}</div>
                      </div>
                    ))}
                    {items.length === 0 && <div className="text-xs text-ink-4 py-4 text-center">Empty</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Create modal */}
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

      {/* Edit modal */}
      {editOrder && (
        <Modal open={!!editOrder} onClose={() => setEditOrder(null)}
          title={`Edit Order — ${editOrder.first_name} ${editOrder.last_name}`}
          footer={<ModalFooter><Button variant="secondary" onClick={() => setEditOrder(null)}>Cancel</Button>
            <Button variant="primary" loading={updateMut.isPending} onClick={he(d => updateMut.mutate({ id: editOrder.id, body: d }))}>Save Changes</Button></ModalFooter>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="form-label">Drug Name</label><input className="form-input" {...re('drug_name')} /></div>
              <div><label className="form-label">Quantity</label><input className="form-input" {...re('quantity')} /></div>
              <div><label className="form-label">Pharmacy Name</label><input className="form-input" {...re('pharmacy_name')} /></div>
              <div><label className="form-label">Pharmacy Phone</label><input className="form-input" {...re('pharmacy_phone')} /></div>
              <div><label className="form-label">Expected Delivery</label><input type="date" className="form-input" {...re('expected_delivery')} /></div>
              <div><label className="form-label">Stage</label>
                <select className="form-select" {...re('stage')}>
                  {STAGES.map(s => <option key={s} value={s}>{PHARM_STAGE_LABEL[s]}</option>)}
                  <option value="cancelled">Cancelled</option>
                </select></div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="edit_urgent" {...re('is_urgent')} className="w-4 h-4" />
              <label htmlFor="edit_urgent" className="text-sm font-medium text-ink">Mark as urgent</label>
            </div>
            <p className="text-xs text-ink-3 bg-bg p-2.5 rounded border border-surface-border">
              Note: orders advance through stages automatically over time. Manually setting a stage here will hold until the next auto-progression catches up.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
