'use client';
/** Wodoga — Secure Messages Page */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Lock } from 'lucide-react';
import { Button, Badge, EmptyState } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { messageService, staffService } from '@/services';
import { fmtRelative, cn } from '@/utils';

export default function MessagesPage() {
  const qc = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const { register, handleSubmit, reset } = useForm();

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', 'inbox'],
    queryFn:  () => messageService.inbox(),
    refetchInterval: 30_000,
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['staff'],
    queryFn:  () => staffService.list(),
  });

  const sendMut = useMutation({
    mutationFn: (body: any) => messageService.send(body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['messages'] }); toast.success('Message sent securely ✓'); setComposeOpen(false); reset(); },
  });

  const readMut = useMutation({
    mutationFn: (id: string) => messageService.markRead(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['messages'] }),
  });

  const unreadCount = messages.filter(m => !m.is_read).length;

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Secure Messaging</h1>
          <p className="page-subtitle">HIPAA-conscious encrypted internal communications — all messages audit-logged</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setComposeOpen(true)}>New Message</Button>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="text-sm font-bold">Inbox</div>
          <div className="flex items-center gap-2">
            <Lock size={12} className="text-ink-3" />
            <span className="text-xs text-ink-3">End-to-end encrypted</span>
            {unreadCount > 0 && <Badge variant="red">{unreadCount} unread</Badge>}
          </div>
        </div>
        {messages.length === 0 ? <EmptyState icon="💬" title="No messages" description="Your inbox is empty." /> : (
          <div>
            {messages.map(m => (
              <div key={m.id}
                className={cn('flex gap-3 px-5 py-4 border-b border-surface-borderLt cursor-pointer hover:bg-bg transition-colors last:border-0',
                  selected?.id === m.id && 'bg-forest-ghost/30')}
                onClick={() => { setSelected(m); !m.is_read && readMut.mutate(m.id); }}>
                <div className={cn('w-2 h-2 rounded-full mt-1.5 flex-shrink-0 border-1.5',
                  m.is_read ? 'border-surface-border bg-transparent' : 'bg-forest border-forest')} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <span className={cn('text-sm', m.is_read ? 'font-medium' : 'font-bold')}>{m.subject}</span>
                    <span className="text-[11px] text-ink-4 font-mono flex-shrink-0">{fmtRelative(m.created_at)}</span>
                  </div>
                  <div className="text-xs text-ink-3 mt-0.5">From: <strong>{m.sender_name}</strong> → {m.recipient_name}</div>
                  <div className="text-xs text-ink-3 mt-1 line-clamp-2">{(m.body || '').substring(0, 120)}{m.body?.length > 120 ? '...' : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="card mt-4">
          <div className="card-header">
            <div>
              <div className="text-sm font-bold">{selected.subject}</div>
              <div className="text-xs text-ink-3 mt-0.5">From: {selected.sender_name} · {fmtRelative(selected.created_at)}</div>
            </div>
            <button onClick={() => setSelected(null)} className="text-ink-3 hover:text-ink text-xs">✕ Close</button>
          </div>
          <div className="p-5 text-sm leading-relaxed whitespace-pre-wrap">{selected.body}</div>
        </div>
      )}

      <Modal open={composeOpen} onClose={() => { setComposeOpen(false); reset(); }} title="New Secure Message"
        footer={<ModalFooter><Button variant="secondary" onClick={() => setComposeOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={sendMut.isPending} onClick={handleSubmit(d => sendMut.mutate(d))}>Send Securely 🔒</Button></ModalFooter>}>
        <div className="space-y-3">
          <div><label className="form-label">To *</label>
            <select className="form-select" {...register('recipient_id', { required: true })}>
              <option value="">Select recipient...</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.role})</option>)}
            </select></div>
          <div><label className="form-label">Subject *</label><input className="form-input" {...register('subject', { required: true })} /></div>
          <div><label className="form-label">Message</label><textarea className="form-textarea min-h-[120px]" {...register('body')} /></div>
          <div className="flex items-center gap-2 p-3 bg-forest-ghost rounded border border-forest-pale text-xs text-forest">
            <Lock size={12} /><span>This message is encrypted and logged in the HIPAA audit trail.</span>
          </div>
        </div>
      </Modal>
    </>
  );
}
