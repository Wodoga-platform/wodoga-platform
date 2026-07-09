'use client';
/** Wodoga — Staff Management Page */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { User, UserPlus } from 'lucide-react';
import { Button, Badge, Avatar, EmptyState, PageLoader, Gated } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { staffService } from '@/services';
import { fmtDateTime, ROLE_DISPLAY, ROLE_COLOR, cn } from '@/utils';
import type { UserRole } from '@/types';

export default function StaffPage() {
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const { register, handleSubmit, reset } = useForm();

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn:  () => staffService.list(),
  });

  const inviteMut = useMutation({
    mutationFn: (body: any) => staffService.invite(body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['staff'] }); toast.success('Staff member invited ✓'); setInviteOpen(false); reset(); },
    onError:    (err: any) => toast.error(err?.message || 'Failed to invite staff.'),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => staffService.deactivate(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['staff'] }); toast.success('Staff deactivated and sessions revoked.'); },
  });

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div><h1 className="page-title">Staff Management</h1><p className="page-subtitle">Manage employees, roles, and access credentials</p></div>
        <Gated permission="staff:manage">
          <Button variant="primary" size="sm" icon={<UserPlus size={13} />} onClick={() => setInviteOpen(true)}>Invite Staff</Button>
        </Gated>
      </div>

      <div className="card">
        <div className="card-header"><div className="text-sm font-bold">All Staff Members</div><div className="text-xs text-ink-3">{staff.length} members</div></div>
        {isLoading ? <PageLoader /> : staff.length === 0 ? <EmptyState icon={User} title="No staff added" /> : (
          <table className="data-table">
            <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>License</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
            <tbody>
              {staff.map(s => (
                <tr key={s.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar firstName={s.first_name} lastName={s.last_name} seed={s.id} size="sm" />
                      <div><div className="font-semibold text-sm">{s.first_name} {s.last_name}</div>
                        {s.phone && <div className="text-xs text-ink-3">{s.phone}</div>}</div>
                    </div>
                  </td>
                  <td><span className={cn('text-[11px] font-bold px-2 py-0.5 rounded', ROLE_COLOR[s.role as UserRole])}>{ROLE_DISPLAY[s.role as UserRole] || s.role}</span></td>
                  <td className="text-xs">{s.email}</td>
                  <td className="text-xs text-ink-3">{s.license_number || '—'} {s.license_type && `(${s.license_type})`}</td>
                  <td><Badge variant={s.is_active ? 'green' : 'gray'}>{s.is_active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="text-xs text-ink-3">{s.last_login_at ? fmtDateTime(s.last_login_at) : 'Never'}</td>
                  <td>
                    {s.is_active && (
                      <Gated permission="staff:manage">
                        <Button size="xs" variant="danger"
                          onClick={() => confirm(`Deactivate ${s.first_name} ${s.last_name} and revoke all sessions?`) && deactivateMut.mutate(s.id)}>
                          Deactivate
                        </Button>
                      </Gated>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={inviteOpen} onClose={() => { setInviteOpen(false); reset(); }} title="Invite Staff Member" size="sm"
        footer={<ModalFooter><Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={inviteMut.isPending} onClick={handleSubmit(d => inviteMut.mutate(d))}>Send Invitation</Button></ModalFooter>}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="form-label">First Name *</label><input className="form-input" {...register('first_name', { required: true })} /></div>
            <div><label className="form-label">Last Name *</label><input className="form-input" {...register('last_name', { required: true })} /></div>
          </div>
          <div><label className="form-label">Email *</label><input type="email" className="form-input" {...register('email', { required: true })} /></div>
          <div><label className="form-label">Role *</label>
            <select className="form-select" {...register('role', { required: true })}>
              <option value="">Select role...</option>
              {(['admin','provider','pharmacy_staff','biller','viewer','caregiver'] as UserRole[]).map(r =>
                <option key={r} value={r}>{ROLE_DISPLAY[r]}</option>)}
            </select></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="form-label">Phone</label><input className="form-input" {...register('phone')} /></div>
            <div><label className="form-label">License #</label><input className="form-input" {...register('license_number')} /></div>
          </div>
        </div>
      </Modal>
    </>
  );
}
