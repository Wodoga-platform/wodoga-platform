'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, X } from 'lucide-react';
import { Button, Badge, EmptyState, PageLoader, Alert, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { vitalsService, patientService } from '@/services';
import { fmtDateTime, cn } from '@/utils';

export default function VitalsPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const { register, handleSubmit, reset } = useForm();

  const { data: alerts = [] } = useQuery({
    queryKey: ['vitals', 'alerts'],
    queryFn:  () => vitalsService.alerts(7),
  });

  const { data: patients } = useQuery({
    queryKey: ['patients', 'list-simple'],
    queryFn:  () => patientService.list({ per_page: 100 }),
  });

  const dismissMut = useMutation({
    mutationFn: (id: string) => vitalsService.acknowledge(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['vitals', 'alerts'] }); toast.success('Alert dismissed ✓'); },
    onError:    () => toast.error('Failed to dismiss alert.'),
  });

  const addMut = useMutation({
    mutationFn: (body: any) => vitalsService.record(body),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['vitals'] });
      toast.success('Vitals recorded' + (data.alerts?.length ? ` ⚠ ${data.alerts.length} alert(s) generated` : ' ✓'));
      setAddOpen(false); reset();
    },
    onError: () => toast.error('Failed to record vitals.'),
  });

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div><h1 className="page-title">Vital Signs</h1><p className="page-subtitle">Record and monitor patient vitals — alerts auto-generated on abnormal readings</p></div>
        <Gated permission="vitals:create">
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>Record Vitals</Button>
        </Gated>
      </div>

      {alerts.length > 0 && (
        <Alert type="error" className="mb-5">
          <strong>{alerts.length} vitals alert(s)</strong> in the last 7 days require clinical review.
        </Alert>
      )}

      <div className="card">
        <div className="card-header"><div className="text-sm font-bold">Recent Alerts (7 days)</div><div className="text-xs text-ink-3">{alerts.length} flagged readings</div></div>
        {alerts.length === 0 ? <EmptyState icon="💚" title="No alerts" description="All vitals readings are within normal range." /> : (
          <table className="data-table">
            <thead><tr><th>Patient</th><th>Recorded</th><th>BP</th><th>O₂ Sat</th><th>Heart Rate</th><th>Glucose</th><th>Temp</th><th>Flags</th><th></th></tr></thead>
            <tbody>
              {alerts.map(v => (
                <tr key={v.id}>
                  <td className="font-semibold text-sm">{(v as any).first_name} {(v as any).last_name}</td>
                  <td className="text-xs text-ink-3">{fmtDateTime(v.recorded_at)}</td>
                  <td className={cn('text-sm font-medium', v.flag_high_bp || v.flag_low_bp ? 'text-red font-bold' : '')}>
                    {v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—'}
                  </td>
                  <td className={cn('text-sm font-medium', v.flag_low_o2 ? 'text-red font-bold' : '')}>
                    {v.oxygen_saturation ? `${v.oxygen_saturation}%` : '—'}
                  </td>
                  <td className="text-sm">{v.heart_rate || '—'}</td>
                  <td className={cn('text-sm', v.flag_high_glucose || v.flag_low_glucose ? 'text-red font-bold' : '')}>{v.blood_glucose || '—'}</td>
                  <td className={cn('text-sm', v.flag_high_temp ? 'text-red font-bold' : '')}>{v.temperature ? `${v.temperature}°F` : '—'}</td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      {v.flag_low_o2     && <Badge variant="red" className="text-[10px]">Low O₂</Badge>}
                      {v.flag_high_bp    && <Badge variant="red" className="text-[10px]">High BP</Badge>}
                      {v.flag_low_bp     && <Badge variant="amber" className="text-[10px]">Low BP</Badge>}
                      {v.flag_high_glucose && <Badge variant="red" className="text-[10px]">High Gluc</Badge>}
                      {v.flag_low_glucose  && <Badge variant="amber" className="text-[10px]">Low Gluc</Badge>}
                      {v.flag_high_temp  && <Badge variant="amber" className="text-[10px]">High Temp</Badge>}
                    </div>
                  </td>
                  <td>
                    <button
                      onClick={() => dismissMut.mutate(v.id)}
                      disabled={dismissMut.isPending}
                      title="Dismiss alert"
                      className="flex items-center gap-1 text-xs text-ink-3 hover:text-red transition-colors font-medium"
                    >
                      <X size={13} /> Dismiss
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={addOpen} onClose={() => { setAddOpen(false); reset(); }} title="Record Vital Signs" size="lg"
        footer={<ModalFooter><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={addMut.isPending} onClick={handleSubmit(d => addMut.mutate(d))}>Save Vitals</Button></ModalFooter>}>
        <div className="space-y-4">
          <div><label className="form-label">Patient *</label>
            <select className="form-select" {...register('patient_id', { required: true })}>
              <option value="">Select patient...</option>
              {patients?.data.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
            </select></div>
          <div className="section-title">Cardiovascular</div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="form-label">BP Systolic</label><input type="number" className="form-input" placeholder="120" {...register('bp_systolic')} /></div>
            <div><label className="form-label">BP Diastolic</label><input type="number" className="form-input" placeholder="80" {...register('bp_diastolic')} /></div>
            <div><label className="form-label">Heart Rate</label><input type="number" className="form-input" placeholder="72" {...register('heart_rate')} /></div>
          </div>
          <div className="section-title">Respiratory</div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="form-label">O₂ Saturation (%)</label><input type="number" className="form-input" placeholder="98" min="50" max="100" {...register('oxygen_saturation')} /></div>
            <div><label className="form-label">Resp. Rate</label><input type="number" className="form-input" placeholder="16" {...register('respiratory_rate')} /></div>
            <div><label className="form-label">Temperature (°F)</label><input type="number" step="0.1" className="form-input" placeholder="98.6" {...register('temperature')} /></div>
          </div>
          <div className="section-title">Other Measurements</div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="form-label">Weight (lbs)</label><input type="number" step="0.1" className="form-input" {...register('weight_lbs')} /></div>
            <div><label className="form-label">Blood Glucose</label><input type="number" className="form-input" {...register('blood_glucose')} /></div>
            <div><label className="form-label">Pain Scale (0–10)</label><input type="number" min="0" max="10" className="form-input" {...register('pain_scale')} /></div>
          </div>
          <div><label className="form-label">Notes</label><textarea className="form-textarea" rows={2} {...register('notes')} /></div>
        </div>
      </Modal>
    </>
  );
}
