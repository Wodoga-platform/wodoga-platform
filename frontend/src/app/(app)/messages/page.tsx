'use client';
/** Wodoga — Secure Messages Page (with reply/threading) */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Plus, Lock, Reply, ChevronDown, ChevronUp } from 'lucide-react';
import { Button, Badge, EmptyState } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { messageService, staffService } from '@/services';
import { fmtRelative, cn } from '@/utils';

export default function MessagesPage() {
  const qc = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [threadExpanded, setThreadExpanded] = useState(true);
  const { register, handleSubmit, reset, setValue } = useForm();

  // Pre-fill state for replies
  const [replyTo, setReplyTo] = useState<any>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', 'inbox'],
    queryFn:  () => messageService.inbox(),
    refetchInterval: 30_000,
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['staff'],
    queryFn:  () => staffService.list(),
  });

  // Load thread when a message is selected
  const { data: thread = [] } = useQuery({
    queryKey: ['messages', 'thread', selected?.id],
    queryFn:  () => messageService.thread(selected.id),
    enabled:  !!selected,
  });

  const sendMut = useMutation({
    mutationFn: (body: any) => messageService.send(body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      toast.success('Message sent securely ✓');
      setComposeOpen(false);
      setReplyTo(null);
      reset();
    },
  });

  const readMut = useMutation({
    mutationFn: (id: string) => messageService.markRead(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['messages'] }),
  });

  const unreadCount = messages.filter((m: any) => !m.is_read).length;

  const openCompose = () => {
    setReplyTo(null);
    reset({ recipient_id: '', subject: '', body: '', parent_message_id: '' });
    setComposeOpen(true);
  };

  const openReply = (msg: any) => {
    setReplyTo(msg);
    const subj = msg.subject?.startsWith('Re: ') ? msg.subject : `Re: ${msg.subject}`;
    reset({
      recipient_id: msg.sender_id,
      subject: subj,
      body: '',
      parent_message_id: msg.id,
    });
    setComposeOpen(true);
  };

  // Only show latest message per thread root in the inbox list
  const threadRoots = new Map<string, any>();
  for (const m of messages) {
    const rootKey = m.parent_message_id || m.id;
    const existing = threadRoots.get(rootKey);
    if (!existing || new Date(m.created_at) > new Date(existing.created_at)) {
      threadRoots.set(rootKey, m);
    }
  }
  const inboxMessages = Array.from(threadRoots.values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Secure Messaging</h1>
          <p className="page-subtitle">HIPAA-conscious encrypted internal communications — all messages audit-logged</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={openCompose}>New Message</Button>
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
        {inboxMessages.length === 0 ? <EmptyState icon="💬" title="No messages" description="Your inbox is empty." /> : (
          <div>
            {inboxMessages.map((m: any) => (
              <div key={m.id}
                className={cn('flex gap-3 px-5 py-4 border-b border-surface-borderLt cursor-pointer hover:bg-bg transition-colors last:border-0',
                  selected?.id === m.id && 'bg-forest-ghost/30')}
                onClick={() => { setSelected(m); setThreadExpanded(true); !m.is_read && readMut.mutate(m.id); }}>
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

      {/* ── Selected message detail + thread ── */}
      {selected && (
        <div className="card mt-4">
          <div className="card-header">
            <div>
              <div className="text-sm font-bold">{selected.subject}</div>
              <div className="text-xs text-ink-3 mt-0.5">From: {selected.sender_name} · {fmtRelative(selected.created_at)}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="xs" variant="secondary" icon={<Reply size={12} />}
                onClick={() => openReply(selected)}>
                Reply
              </Button>
              <button onClick={() => setSelected(null)} className="text-ink-3 hover:text-ink text-xs">✕ Close</button>
            </div>
          </div>
          <div className="p-5 text-sm leading-relaxed whitespace-pre-wrap">{selected.body}</div>

          {/* Thread history */}
          {thread.length > 1 && (
            <div className="border-t border-surface-borderLt">
              <button
                className="w-full flex items-center justify-between px-5 py-3 text-xs font-semibold text-ink-3 hover:bg-bg transition-colors"
                onClick={() => setThreadExpanded(!threadExpanded)}>
                <span>Conversation ({thread.length} messages)</span>
                {threadExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {threadExpanded && (
                <div className="px-5 pb-4 space-y-3">
                  {thread
                    .filter((t: any) => t.id !== selected.id)
                    .map((t: any) => (
                    <div key={t.id} className="pl-4 border-l-2 border-forest-pale">
                      <div className="flex items-center gap-2 text-xs text-ink-3">
                        <strong className="text-ink-2">{t.sender_name}</strong>
                        <span>·</span>
                        <span>{fmtRelative(t.created_at)}</span>
                      </div>
                      <div className="text-sm mt-1 text-ink-2 whitespace-pre-wrap">{t.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Compose / Reply modal ── */}
      <Modal open={composeOpen} onClose={() => { setComposeOpen(false); setReplyTo(null); reset(); }}
        title={replyTo ? `Reply to ${replyTo.sender_name}` : 'New Secure Message'}
        footer={<ModalFooter><Button variant="secondary" onClick={() => { setComposeOpen(false); setReplyTo(null); reset(); }}>Cancel</Button>
          <Button variant="primary" loading={sendMut.isPending} onClick={handleSubmit((d: any) => sendMut.mutate(d))}>Send Securely 🔒</Button></ModalFooter>}>
        <div className="space-y-3">
          {replyTo ? (
            <div className="p-3 bg-bg rounded border border-surface-borderLt text-xs text-ink-3">
              <div className="font-semibold text-ink-2 mb-1">Replying to {replyTo.sender_name}:</div>
              <div className="line-clamp-3">{replyTo.body}</div>
            </div>
          ) : (
            <div><label className="form-label">To *</label>
              <select className="form-select" {...register('recipient_id', { required: true })}>
                <option value="">Select recipient...</option>
                {staff.map((s: any) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name} ({s.role})</option>)}
              </select></div>
          )}
          <input type="hidden" {...register('parent_message_id')} />
          {replyTo && <input type="hidden" {...register('recipient_id')} />}
          <div><label className="form-label">Subject {!replyTo && '*'}</label>
            <input className="form-input" {...register('subject', { required: !replyTo })}
              readOnly={!!replyTo} /></div>
          <div><label className="form-label">Message</label>
            <textarea className="form-textarea min-h-[120px]" {...register('body')}
              placeholder={replyTo ? 'Write your reply...' : ''} autoFocus={!!replyTo} /></div>
          <div className="flex items-center gap-2 p-3 bg-forest-ghost rounded border border-forest-pale text-xs text-forest">
            <Lock size={12} /><span>This message is encrypted and logged in the HIPAA audit trail.</span>
          </div>
        </div>
      </Modal>
    </>
  );
}
