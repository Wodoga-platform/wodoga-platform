'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Pencil } from 'lucide-react';
import { Button, Badge, EmptyState, PageLoader, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { carePlanService, patientService } from '@/services';
import { fmtDate, truncate } from '@/utils';

export default function CarePlansPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<any | null>(null);
  const { register, handleSubmit, reset } = useForm();
  const { register: re, handleSubmit: he, reset: resetEdit } = useForm();

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['care-plans'],
    queryFn:  () => carePlanService.list(),
  });

  const { data: patients } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => carePlanService.create(body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['care-plans'] }); toast.success('Care plan created ✓'); setAddOpen(false); reset(); },
    onError:    (e: any) => toast.error(e?.message || 'Failed to create care plan.'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => carePlanService.update(id, body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['care-plans'] }); toast.success('Care plan updated ✓'); setEditPlan(null); },
    onError:    (e: any) => toast.error(e?.message || 'Failed to update care plan.'),
  });

  // Pre-fill the edit form when a plan is selected
  useEffect(() => {
    if (editPlan) {
      resetEdit({
        primary_diagnosis:  editPlan.primary_diagnosis,
        ordering_physician: editPlan.ordering_physician,
        start_date:         editPlan.start_date?.slice(0, 10),
        review_date:        editPlan.review_date?.slice(0, 10),
        visit_frequency:    editPlan.visit_frequency,
        duration:           editPlan.duration,
        goals:              editPlan.goals,
        interventions:      editPlan.interventions,
        expected_outcomes:  editPlan.expected_outcomes,
        status:             editPlan.status,
      });
    }
  }, [editPlan, resetEdit]);

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div><h1 className="page-title">Care Plans</h1><p className="page-subtitle">Physician-approved care plans linked to active patients</p></div>
        <Gated permission="care_plans:create">
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>New Care Plan</Button>
        </Gated>
      </div>

      <div className="card">
        <div className="card-header"><div className="text-sm font-bold">Active Care Plans</div><div className="text-xs text-ink-3">{plans.length} plans</div></div>
        {isLoading ? <PageLoader /> : plans.length === 0 ? <EmptyState icon="📋" title="No care plans" description="Create a care plan for an active patient." /> : (
          <table className="data-table">
            <thead><tr><th>Patient</th><th>Diagnosis</th><th>Physician</th><th>Start</th><th>Frequency</th><th>Review Date</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.id}>
                  <td className="font-semibold text-sm">{p.first_name} {p.last_name}</td>
                  <td className="text-sm max-w-[180px]">{truncate(p.primary_diagnosis, 40)}</td>
                  <td className="text-sm text-ink-2">{p.ordering_physician}</td>
                  <td className="text-xs text-ink-3">{fmtDate(p.start_date)}</td>
                  <td className="text-xs">{p.visit_frequency}</td>
                  <td className="text-xs text-ink-3">{p.review_date ? fmtDate(p.review_date) : '—'}</td>
                  <td><Badge variant={p.status === 'active' ? 'green' : 'gray'}>{p.status}</Badge></td>
                  <td>
                    <Gated permission="care_plans:create">
                      <Button size="xs" variant="secondary" icon={<Pencil size={11} />} onClick={() => setEditPlan(p)}>Edit</Button>
                    </Gated>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create modal */}
      <Modal open={addOpen} onClose={() => { setAddOpen(false); reset(); }} title="New Care Plan" size="lg"
        footer={<ModalFooter><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={createMut.isPending} onClick={handleSubmit(d => createMut.mutate(d))}>Create Care Plan</Button></ModalFooter>}>
        <div className="space-y-3">
          <div><label className="form-label">Patient *</label>
            <select className="form-select" {...register('patient_id', { required: true })}>
              <option value="">Select patient...</option>
              {patients?.data.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="form-label">Primary Diagnosis *</label><input className="form-input" {...register('primary_diagnosis', { required: true })} /></div>
            <div><label className="form-label">Ordering Physician *</label><input className="form-input" {...register('ordering_physician', { required: true })} /></div>
            <div><label className="form-label">Start Date *</label><input type="date" className="form-input" {...register('start_date', { required: true })} /></div>
            <div><label className="form-label">Review Date</label><input type="date" className="form-input" {...register('review_date')} /></div>
            <div><label className="form-label">Visit Frequency *</label><input className="form-input" placeholder="3x/week" {...register('visit_frequency', { required: true })} /></div>
            <div><label className="form-label">Duration</label><input className="form-input" placeholder="60 days" {...register('duration')} /></div>
          </div>
          <div><label className="form-label">Goals</label><textarea className="form-textarea" rows={3} placeholder="Patient goals and expected outcomes..." {...register('goals')} /></div>
          <div><label className="form-label">Interventions</label><textarea className="form-textarea" rows={3} placeholder="Nursing interventions and treatments..." {...register('interventions')} /></div>
          <div><label className="form-label">Expected Outcomes</label><textarea className="form-textarea" rows={2} {...register('expected_outcomes')} /></div>
        </div>
      </Modal>

      {/* Edit modal */}
      {editPlan && (
        <Modal open={!!editPlan} onClose={() => setEditPlan(null)}
          title={`Edit Care Plan — ${editPlan.first_name} ${editPlan.last_name}`} size="lg"
          footer={<ModalFooter><Button variant="secondary" onClick={() => setEditPlan(null)}>Cancel</Button>
            <Button variant="primary" loading={updateMut.isPending} onClick={he(d => updateMut.mutate({ id: editPlan.id, body: d }))}>Save Changes</Button></ModalFooter>}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="form-label">Primary Diagnosis</label><input className="form-input" {...re('primary_diagnosis')} /></div>
              <div><label className="form-label">Ordering Physician</label><input className="form-input" {...re('ordering_physician')} /></div>
              <div><label className="form-label">Start Date</label><input type="date" className="form-input" {...re('start_date')} /></div>
              <div><label className="form-label">Review Date</label><input type="date" className="form-input" {...re('review_date')} /></div>
              <div><label className="form-label">Visit Frequency</label><input className="form-input" {...re('visit_frequency')} /></div>
              <div><label className="form-label">Duration</label><input className="form-input" {...re('duration')} /></div>
              <div><label className="form-label">Status</label>
                <select className="form-select" {...re('status')}>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="on_hold">On Hold</option>
                  <option value="discontinued">Discontinued</option>
                </select></div>
            </div>
            <div><label className="form-label">Goals</label><textarea className="form-textarea" rows={3} {...re('goals')} /></div>
            <div><label className="form-label">Interventions</label><textarea className="form-textarea" rows={3} {...re('interventions')} /></div>
            <div><label className="form-label">Expected Outcomes</label><textarea className="form-textarea" rows={2} {...re('expected_outcomes')} /></div>
          </div>
        </Modal>
      )}
    </>
  );
}
