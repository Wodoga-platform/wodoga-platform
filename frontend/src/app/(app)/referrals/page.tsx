'use client';
/** Wodoga — Referrals Page */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, ArrowRight } from 'lucide-react';
import { Button, Badge, EmptyState, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { referralService } from '@/services';
import { fmtDate, REFERRAL_STAGE_LABEL, cn } from '@/utils';
import type { ReferralStage } from '@/types';

const STAGES: ReferralStage[] = ['new_lead','contacted','evaluating','insurance_check','admitted'];
const STAGE_COLOR: Record<ReferralStage, string> = {
  new_lead: 'bg-blue-ghost border-blue-pale',
  contacted: 'bg-amber-ghost border-amber-pale',
  evaluating: 'bg-purple-ghost border-purple-pale',
  insurance_check: 'bg-teal-ghost border-teal-pale',
  admitted: 'bg-forest-ghost border-forest-pale',
  declined: 'bg-red-ghost border-red-pale',
  lost: 'bg-surface-2 border-surface-border',
};

export default function ReferralsPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { register, handleSubmit, reset } = useForm();

  const { data: referrals = [] } = useQuery({
    queryKey: ['referrals'],
    queryFn:  () => referralService.list(),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => referralService.create(body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['referrals'] }); toast.success('Referral created ✓'); setCreateOpen(false); reset(); },
  });

  const advanceMut = useMutation({
    mutationFn: (id: string) => referralService.advance(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['referrals'] }); toast.success('Referral advanced ✓'); },
  });

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div><h1 className="page-title">Referral Management</h1><p className="page-subtitle">Track incoming referrals from source through admission</p></div>
        <Gated permission="referrals:create">
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setCreateOpen(true)}>New Referral</Button>
        </Gated>
      </div>

      {/* Pipeline */}
      <div className="card mb-5">
        <div className="card-header"><div className="text-sm font-bold">Referral Pipeline</div></div>
        <div className="p-4 overflow-x-auto">
          <div className="flex gap-0 min-w-[800px]">
            {STAGES.map((stage, si) => {
              const items = referrals.filter(r => r.stage === stage);
              return (
                <div key={stage} className="pipeline-col">
                  <div className="flex items-center justify-between py-3 mb-2">
                    <span className="text-[10px] font-extrabold text-ink-3 uppercase tracking-widest">
                      {REFERRAL_STAGE_LABEL[stage]}
                    </span>
                    <span className="text-[10px] bg-surface-2 text-ink-3 font-bold px-2 py-0.5 rounded-full">{items.length}</span>
                  </div>
                  {items.map(r => (
                    <div key={r.id} className={cn('pipeline-card border', STAGE_COLOR[r.stage])}>
                      <div className="text-sm font-bold mb-1">{r.first_name} {r.last_name}</div>
                      <div className="text-xs text-ink-3 space-y-0.5">
                        <div>{r.referral_source || 'Unknown source'}</div>
                        {r.diagnosis && <div className="truncate">{r.diagnosis}</div>}
                        {r.insurance_provider && <div>{r.insurance_provider}</div>}
                      </div>
                      {r.urgency !== 'routine' && (
                        <Badge variant={r.urgency === 'emergent' ? 'red' : 'amber'} className="mt-2 text-[10px]">
                          {r.urgency}
                        </Badge>
                      )}
                      {si < STAGES.length - 1 && (
                        <Gated permission="referrals:advance">
                          <Button size="xs" variant="secondary" className="w-full mt-2 justify-center"
                            icon={<ArrowRight size={11} />}
                            onClick={() => advanceMut.mutate(r.id)}>
                            {REFERRAL_STAGE_LABEL[STAGES[si + 1]]}
                          </Button>
                        </Gated>
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

      <Modal open={createOpen} onClose={() => { setCreateOpen(false); reset(); }} title="New Referral"
        footer={<ModalFooter><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={createMut.isPending} onClick={handleSubmit(d => createMut.mutate(d))}>Create Referral</Button></ModalFooter>}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="form-label">First Name *</label><input className="form-input" {...register('first_name', { required: true })} /></div>
            <div><label className="form-label">Last Name *</label><input className="form-input" {...register('last_name', { required: true })} /></div>
            <div><label className="form-label">Date of Birth</label><input type="date" className="form-input" {...register('date_of_birth')} /></div>
            <div><label className="form-label">Referral Source</label><input className="form-input" placeholder="Hospital, Physician..." {...register('referral_source')} /></div>
            <div><label className="form-label">Phone</label><input className="form-input" {...register('phone')} /></div>
            <div><label className="form-label">Diagnosis</label><input className="form-input" {...register('diagnosis')} /></div>
            <div><label className="form-label">Insurance</label><input className="form-input" {...register('insurance_provider')} /></div>
          </div>
          <div><label className="form-label">Urgency</label>
            <select className="form-select" {...register('urgency')}>
              <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergent">Emergent</option>
            </select></div>
          <div><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} {...register('notes')} /></div>
        </div>
      </Modal>
    </>
  );
}
