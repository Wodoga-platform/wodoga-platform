'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Button, Badge, EmptyState, PageLoader } from '@/components/ui';
import { notificationService } from '@/services';
import { fmtRelative, cn } from '@/utils';
import type { NotificationPriority } from '@/types';

const PRIORITY_COLOR: Record<NotificationPriority, string> = {
  critical: 'bg-red-pale text-red',
  high:     'bg-amber-pale text-amber',
  normal:   'bg-blue-pale text-blue',
  low:      'bg-surface-2 text-ink-3',
};

export default function NotificationsPage() {
  const qc = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications', 'all'],
    queryFn:  () => notificationService.list(),
    refetchInterval: 30_000,
  });

  const markAllMut = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['notifications'] }); toast.success('All marked as read'); },
  });

  const markOneMut = useMutation({
    mutationFn: (id: string) => notificationService.markRead(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = notifications.filter(n => !n.is_read).length;

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">Clinical alerts, operational updates, and system events</p>
        </div>
        {unread > 0 && (
          <Button variant="secondary" size="sm" loading={markAllMut.isPending} onClick={() => markAllMut.mutate()}>
            Mark all read ({unread})
          </Button>
        )}
      </div>

      <div className="card">
        {isLoading ? <PageLoader /> : notifications.length === 0 ? (
          <EmptyState icon="🔔" title="All caught up" description="No notifications to show." />
        ) : (
          <div>
            {notifications.map(n => (
              <div key={n.id}
                className={cn('flex gap-3 px-5 py-4 border-b border-surface-borderLt last:border-0 cursor-pointer hover:bg-bg transition-colors',
                  !n.is_read && 'bg-forest-ghost/20')}
                onClick={() => !n.is_read && markOneMut.mutate(n.id)}>
                <div className="mt-1.5 flex-shrink-0">
                  {!n.is_read
                    ? <div className="w-2 h-2 rounded-full bg-forest" />
                    : <div className="w-2 h-2 rounded-full border border-surface-border" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <span className={cn('text-sm', !n.is_read ? 'font-bold' : 'font-medium')}>{n.title}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', PRIORITY_COLOR[n.priority])}>
                        {n.priority}
                      </span>
                      <span className="text-xs text-ink-4 font-mono">{fmtRelative(n.created_at)}</span>
                    </div>
                  </div>
                  <div className="text-xs text-ink-3 mt-0.5">{n.body}</div>
                  {(n.patient_first || n.patient_last) && (
                    <div className="text-xs text-forest mt-1">Patient: {n.patient_first} {n.patient_last}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
