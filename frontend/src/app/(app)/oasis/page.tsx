'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { Button, Badge, EmptyState, PageLoader } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { oasisService, patientService } from '@/services';
import { fmtDate } from '@/utils';
import type { OASISType } from '@/types';

const OASIS_TYPES: { value: OASISType; label: string; desc: string }[] = [
  { value: 'SOC', label: 'Start of Care (SOC)',       desc: 'Required at admission' },
  { value: 'ROC', label: 'Resumption of Care (ROC)',  desc: 'After inpatient stay' },
  { value: 'FU',  label: 'Follow-Up (FU)',            desc: '60-day recertification' },
  { value: 'TRN', label: 'Transfer (TRN)',             desc: 'Transfer to inpatient' },
  { value: 'DC',  label: 'Discharge (DC)',             desc: 'End of care episode' },
];

export default function OASISPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const { register, handleSubmit, reset } = useForm();

  const { data: assessments = [], isLoading } = useQuery({
    queryKey: ['oasis'],
    queryFn:  () => oasisService.list(),
  });

  const { data: patients } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const createMut = useMutation({
    mutationFn: (body: any) => oasisService.create(body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['oasis'] }); toast.success('OASIS assessment submitted ✓'); setAddOpen(false); reset(); },
    onError:    () => toast.error('Failed to submit assessment.'),
  });

  const TYPE_BADGE: Record<OASISType, string> = { SOC:'green', ROC:'blue', FU:'amber', TRN:'purple', DC:'gray' } as any;

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">OASIS Assessments</h1>
          <p className="page-subtitle">Medicare-required OASIS-E assessments — Start of Care, Follow-Up, Discharge, and Transfer</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>New Assessment</Button>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-5">
        {OASIS_TYPES.map(t => {
          const count = assessments.filter(a => a.assessment_type === t.value).length;
          return (
            <div key={t.value} className="card p-4 text-center">
              <div className="text-2xl font-display font-semibold">{count}</div>
              <div className="text-xs font-bold mt-1">{t.value}</div>
              <div className="text-[10px] text-ink-3 mt-0.5">{t.label.split('(')[0].trim()}</div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-header"><div className="text-sm font-bold">All Assessments</div></div>
        {isLoading ? <PageLoader /> : assessments.length === 0 ? (
          <EmptyState icon="📋" title="No assessments submitted" description="Submit a Start of Care assessment for new Medicare patients." />
        ) : (
          <table className="data-table">
            <thead><tr><th>Patient</th><th>Type</th><th>Date</th><th>Clinician</th><th>Status</th></tr></thead>
            <tbody>
              {assessments.map(a => (
                <tr key={a.id}>
                  <td className="font-semibold text-sm">{a.first_name} {a.last_name}</td>
                  <td><Badge variant={(TYPE_BADGE[a.assessment_type] as any) || 'gray'}>{a.assessment_type} — {OASIS_TYPES.find(t => t.value === a.assessment_type)?.label.split('(')[0].trim()}</Badge></td>
                  <td className="text-sm">{fmtDate(a.assessment_date)}</td>
                  <td className="text-xs text-ink-3">{a.conducted_by_name || '—'}</td>
                  <td><Badge variant={a.status === 'submitted' || a.status === 'accepted' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}>{a.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={addOpen} onClose={() => { setAddOpen(false); reset(); }} title="New OASIS Assessment"
        subtitle="Medicare requires OASIS-E at key clinical events"
        footer={<ModalFooter><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={createMut.isPending} onClick={handleSubmit(d => createMut.mutate(d))}>Submit Assessment</Button></ModalFooter>}>
        <div className="space-y-3">
          <div><label className="form-label">Patient *</label>
            <select className="form-select" {...register('patient_id', { required: true })}>
              <option value="">Select patient...</option>
              {patients?.data.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="form-label">Assessment Type *</label>
              <select className="form-select" {...register('assessment_type', { required: true })}>
                {OASIS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select></div>
            <div><label className="form-label">Assessment Date *</label><input type="date" className="form-input" {...register('assessment_date', { required: true })} /></div>
          </div>
          <div className="section-title mt-2">Key OASIS Items</div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="form-label">M1032 — Hosp. Risk</label>
              <select className="form-select" {...register('m1032_hospitalization_risk')}>
                <option value="">Select</option>
                <option value="0">0 — No risk</option><option value="1">1 — Low risk</option>
                <option value="2">2 — Moderate risk</option><option value="3">3 — High risk</option>
              </select></div>
            <div><label className="form-label">M1800 — Grooming</label>
              <select className="form-select" {...register('m1800_grooming')}>
                <option value="">Select</option>
                <option value="0">0 — Independent</option><option value="1">1 — Minimal assist</option>
                <option value="2">2 — Moderate assist</option><option value="3">3 — Total dependent</option>
              </select></div>
            <div><label className="form-label">M2020 — Oral Meds</label>
              <select className="form-select" {...register('m2020_oral_medications')}>
                <option value="">Select</option>
                <option value="0">0 — Independent</option><option value="1">1 — Needs reminder</option>
                <option value="2">2 — Needs assistance</option><option value="NA">NA — No oral meds</option>
              </select></div>
          </div>
          <div><label className="form-label">Clinical Notes</label><textarea className="form-textarea" rows={3} {...register('clinical_notes')} /></div>
        </div>
      </Modal>
    </>
  );
}
