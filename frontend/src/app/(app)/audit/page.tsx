'use client';
/** Wodoga — Audit Log Page */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button, Badge, EmptyState, PageLoader } from '@/components/ui';
import { auditService } from '@/services';
import { fmtDateTime, ROLE_COLOR, cn } from '@/utils';
import type { UserRole } from '@/types';

export default function AuditPage() {
  const [page, setPage]       = useState(1);
  const [action, setAction]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]   = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, action, dateFrom, dateTo],
    queryFn:  () => auditService.list({ page, per_page: 50, action: action || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined }),
    placeholderData: (prev) => prev,
  });

  const logs       = data?.data       || [];
  const pagination = data?.pagination;

  const ACTION_COLORS: Record<string, string> = {
    LOGIN_SUCCESS: 'bg-forest-pale text-forest',
    LOGOUT:        'bg-blue-pale text-blue',
    LOGIN_FAILED:  'bg-red-pale text-red',
    PATIENT_VIEWED:'bg-purple-pale text-purple',
    PATIENT_CREATED:'bg-teal-pale text-teal',
    PATIENT_DELETED:'bg-red-pale text-red',
    SOAP_NOTE_CREATED: 'bg-amber-pale text-amber',
    EXPORT: 'bg-amber-pale text-amber',
  };

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Tamper-proof record of every system action — HIPAA required · {data?.pagination.total || 0} events total</p>
        </div>
        <Button variant="secondary" size="sm" icon={<Download size={13} />}>Export CSV</Button>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="text-sm font-bold">System Events</div>
          <div className="flex gap-2">
            <select className="form-select py-1.5 text-xs w-40" value={action} onChange={e => { setAction(e.target.value); setPage(1); }}>
              <option value="">All Actions</option>
              {['LOGIN_SUCCESS','LOGIN_FAILED','LOGOUT','PATIENT_VIEWED','PATIENT_CREATED','PATIENT_UPDATED','PATIENT_DELETED','SOAP_NOTE_CREATED','MEDICATION_PRESCRIBED','CLAIM_SUBMITTED','EXPORT','AUDIT_LOG_VIEWED'].map(a =>
                <option key={a} value={a}>{a}</option>)}
            </select>
            <input type="date" className="form-input py-1.5 text-xs w-34" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span className="text-ink-3 text-xs self-center">to</span>
            <input type="date" className="form-input py-1.5 text-xs w-34" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>

        {isLoading ? <PageLoader /> : logs.length === 0 ? <EmptyState icon="🔍" title="No events found" /> : (
          <table className="data-table">
            <thead><tr><th>Timestamp</th><th>User</th><th>Role</th><th>Action</th><th>Detail</th><th>IP</th><th>Result</th></tr></thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="text-xs">
                  <td className="font-mono text-ink-3 whitespace-nowrap">{fmtDateTime(log.created_at)}</td>
                  <td className="font-medium">{log.user_name || 'System'}</td>
                  <td>
                    {log.user_role && (
                      <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded', ROLE_COLOR[log.user_role as UserRole] || 'bg-surface-2 text-ink-2')}>
                        {log.user_role}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded', ACTION_COLORS[log.action] || 'bg-blue-pale text-blue')}>
                      {log.action}
                    </span>
                  </td>
                  <td className="max-w-[280px] text-ink-2 truncate">{log.description}</td>
                  <td className="font-mono text-ink-4">{log.ip_address || '—'}</td>
                  <td><Badge variant={log.success ? 'green' : 'red'}>{log.success ? '✓ OK' : '✗ Fail'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-surface-border text-xs text-ink-3">
            <span>Page {pagination.page} of {pagination.pages} · {pagination.total} total events</span>
            <div className="flex gap-1.5">
              <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
              <Button size="xs" variant="secondary" disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}>Next →</Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
