'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, parseISO, isToday } from 'date-fns';
import Link from 'next/link';
import {
  patientService, visitService, medicationService,
  billingService, vitalsService, referralService,
} from '@/services';
import { useAuthStore } from '@/store/auth.store';
import {
  StatCard, Badge, Avatar, Alert, EmptyState, PageLoader, Button,
} from '@/components/ui';
import { fmtTime, fmtDate, VISIT_TYPE_LABEL, cn } from '@/utils';

export default function DashboardPage() {
  const { user } = useAuthStore();

  // ── Data fetches ─────────────────────────────────────────
  const { data: patientsData, isLoading: pLoading } = useQuery({
    queryKey: ['patients', 'list'],
    queryFn:  () => patientService.list({ per_page: 5 }),
  });

  const { data: visitsData } = useQuery({
    queryKey: ['visits', 'today'],
    queryFn:  () => visitService.list({
      visit_date: format(new Date(), 'yyyy-MM-dd'),
      per_page: 50,
    }),
  });

  const { data: meds } = useQuery({
    queryKey: ['medications', 'low-refills'],
    queryFn:  () => medicationService.list({ low_refills: true }),
  });

  const { data: billingSummary } = useQuery({
    queryKey: ['billing', 'summary'],
    queryFn:  () => billingService.summary(),
  });

  const { data: vitalsAlerts } = useQuery({
    queryKey: ['vitals', 'alerts'],
    queryFn:  () => vitalsService.alerts(1),
  });

  const { data: referrals } = useQuery({
    queryKey: ['referrals', 'new'],
    queryFn:  () => referralService.list('new_lead'),
  });

  const { data: overdueVisits } = useQuery({
    queryKey: ['visits', 'overdue'],
    queryFn:  () => visitService.overdue(),
  });

  // ── Derived values ────────────────────────────────────────
  const todayVisits    = visitsData?.data  || [];
  const completedToday = todayVisits.filter(v => v.status === 'completed').length;
  const scheduledToday = todayVisits.filter(v => v.status === 'scheduled').length;
  const totalPatients  = patientsData?.pagination.total || 0;
  const activeRx       = meds?.length || 0;
  const pendingClaims  = billingSummary?.pending_count || 0;

  // Visit activity chart — last 7 days
  const chartData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d    = subDays(new Date(), 6 - i);
      const key  = format(d, 'yyyy-MM-dd');
      const count = todayVisits.filter(v => v.visit_date === key).length;
      return { day: format(d, 'EEE'), date: key, count, isToday: format(d,'yyyy-MM-dd') === format(new Date(),'yyyy-MM-dd') };
    });
    const max = Math.max(...days.map(d => d.count), 1);
    return days.map(d => ({ ...d, pct: Math.max((d.count / max) * 100, 6) }));
  }, [todayVisits]);

  // Pending actions
  const pendingActions = useMemo(() => {
    const actions = [];
    const missingSoap = todayVisits.filter(v => v.status === 'completed' && !v.has_soap_note).length;
    if (missingSoap)            actions.push({ icon: '📝', text: `${missingSoap} completed visit(s) missing SOAP notes`, href: '/visits' });
    if (billingSummary?.denied_count) actions.push({ icon: '❌', text: `${billingSummary.denied_count} denied claim(s) — resubmission needed`, href: '/billing' });
    if (meds?.filter(m => m.refills_remaining === 0).length) actions.push({ icon: '💊', text: 'Medications with 0 refills need authorization', href: '/medications' });
    if (referrals?.length)      actions.push({ icon: '🔗', text: `${referrals.length} new referral(s) need contact`, href: '/referrals' });
    return actions;
  }, [todayVisits, billingSummary, meds, referrals]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  if (pLoading) return <PageLoader />;

  return (
    <>
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">
            {greeting()}, {user?.first_name} 👋
          </h1>
          <p className="page-subtitle">
            {format(new Date(), 'EEEE, MMMM d, yyyy')} · {user?.role && user.role.replace('_', ' ')}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/patients">
            <Button variant="secondary" size="sm">+ Intake Form</Button>
          </Link>
          <Link href="/patients">
            <Button variant="primary" size="sm">+ New Patient</Button>
          </Link>
        </div>
      </div>

      {/* ── Alert Banner ── */}
      {overdueVisits && overdueVisits.length > 0 && (
        <div className="card mb-5 border-l-4" style={{ borderLeftColor: 'var(--red, #b91c1c)' }}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <strong className="text-sm" style={{ color: 'var(--red, #b91c1c)' }}>
                ⚠ {overdueVisits.length} patient{overdueVisits.length === 1 ? '' : 's'} not seen — overdue visits
              </strong>
              <Link href="/visits" className="text-xs font-bold underline text-ink-2">View all visits →</Link>
            </div>
            <div className="space-y-1.5">
              {overdueVisits.slice(0, 5).map((v: any) => (
                <Link key={v.id} href={`/patients/${v.patient_id}`}
                  className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-bg transition-colors">
                  <span className="font-medium">{v.first_name} {v.last_name}</span>
                  <span className="text-xs text-ink-3">
                    {v.caregiver_name || 'Unassigned'} · scheduled {fmtDate(v.visit_date)}
                  </span>
                  <Badge variant={v.days_overdue >= 7 ? 'red' : v.days_overdue >= 3 ? 'amber' : 'gray'}>
                    {v.days_overdue} day{v.days_overdue === 1 ? '' : 's'} overdue
                  </Badge>
                </Link>
              ))}
              {overdueVisits.length > 5 && (
                <div className="text-xs text-ink-3 px-2 pt-1">+ {overdueVisits.length - 5} more</div>
              )}
            </div>
          </div>
        </div>
      )}

      {vitalsAlerts && vitalsAlerts.length > 0 && (
        <Alert type="error" className="mb-5">
          <strong>⚠ {vitalsAlerts.length} vital alert(s) today</strong> — patients with readings outside
          normal range. <Link href="/vitals" className="font-bold underline">Review now →</Link>
        </Alert>
      )}

      {meds && meds.filter(m => m.refills_remaining === 0).length > 0 && (
        <Alert type="warning" className="mb-5">
          <strong>{meds.filter(m => m.refills_remaining === 0).length} prescription(s)</strong> have
          0 refills remaining — physician authorization needed.{' '}
          <Link href="/medications" className="font-bold underline">View →</Link>
        </Alert>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-4 gap-3.5 mb-6">
        <StatCard
          label="Total Patients"
          value={totalPatients}
          foot="Active records"
          footUp
          icon="👥"
          accent="green"
        />
        <StatCard
          label="Visits Today"
          value={todayVisits.length}
          foot={`${completedToday} done · ${scheduledToday} pending`}
          icon="🏠"
          accent="blue"
        />
        <StatCard
          label="Active Rx"
          value={activeRx}
          foot={`${meds?.filter(m => m.refills_remaining <= 1).length || 0} need refill`}
          icon="💊"
          accent="purple"
        />
        <StatCard
          label="Pending Claims"
          value={pendingClaims}
          foot={`$${(billingSummary?.total_billed || 0).toLocaleString()} total billed`}
          icon="💳"
          accent="amber"
        />
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-2 gap-5 mb-5">

        {/* Today's visits */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="text-sm font-bold">Today's Visits</div>
              <div className="text-xs text-ink-3 mt-0.5">{format(new Date(), 'EEEE, MMMM d')}</div>
            </div>
            <Link href="/visits">
              <Button size="xs" variant="ghost">View all →</Button>
            </Link>
          </div>

          {todayVisits.length === 0 ? (
            <EmptyState icon="🏠" title="No visits today" description="Schedule a visit to get started." />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {todayVisits.slice(0, 6).map(v => (
                  <tr key={v.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Avatar firstName={v.patient_first} lastName={v.patient_last} size="sm" />
                        <span className="font-medium">{v.patient_first} {v.patient_last}</span>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-ink-3">{fmtTime(v.visit_time)}</td>
                    <td className="text-xs">{VISIT_TYPE_LABEL[v.visit_type] || v.visit_type}</td>
                    <td>
                      <Badge variant={
                        v.status === 'completed' ? 'green' :
                        v.status === 'scheduled' ? 'blue'  :
                        v.status === 'in_progress' ? 'amber' : 'gray'
                      }>
                        {v.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td>
                      {v.status === 'scheduled' && (
                        <Link href={`/visits/${v.id}`}>
                          <Button size="xs" variant="primary">Document</Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          {/* Visit chart */}
          <div className="card">
            <div className="card-header">
              <div className="text-sm font-bold">Visit Activity</div>
              <div className="text-xs text-ink-3">Last 7 days</div>
            </div>
            <div className="p-4 pt-3">
              <div className="flex items-end gap-1.5 h-20">
                {chartData.map(d => (
                  <div
                    key={d.date}
                    className={cn(
                      'flex-1 rounded-t transition-all duration-300 cursor-default',
                      d.isToday ? 'bg-forest' : 'bg-forest-pale hover:bg-forest-light',
                    )}
                    style={{ height: `${d.pct}%` }}
                    title={`${d.count} visit${d.count !== 1 ? 's' : ''}`}
                  />
                ))}
              </div>
              <div className="flex gap-1.5 mt-1.5">
                {chartData.map(d => (
                  <div
                    key={d.date}
                    className={cn(
                      'flex-1 text-center text-[10px]',
                      d.isToday ? 'text-forest font-bold' : 'text-ink-4',
                    )}
                  >
                    {d.day}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Pending actions */}
          <div className="card">
            <div className="card-header">
              <div className="text-sm font-bold">Pending Actions</div>
            </div>
            <div className="px-5">
              {pendingActions.length === 0 ? (
                <div className="py-5 text-center text-sm text-ink-3">✅ No pending actions</div>
              ) : (
                pendingActions.map((a, i) => (
                  <Link key={i} href={a.href}>
                    <div className="flex items-center gap-3 py-3 border-b border-surface-borderLt
                                    last:border-b-0 hover:bg-bg -mx-5 px-5 transition-colors cursor-pointer">
                      <span className="text-lg">{a.icon}</span>
                      <span className="flex-1 text-sm font-medium">{a.text}</span>
                      <span className="text-ink-3 text-sm">→</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent patients ── */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="text-sm font-bold">Recent Patients</div>
            <div className="text-xs text-ink-3 mt-0.5">{totalPatients} total records</div>
          </div>
          <Link href="/patients">
            <Button variant="primary" size="sm">View all patients →</Button>
          </Link>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Diagnosis</th>
              <th>Insurance</th>
              <th>Caregiver</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(patientsData?.data || []).map(p => (
              <tr key={p.id}>
                <td>
                  <div className="flex items-center gap-2.5">
                    <Avatar firstName={p.first_name} lastName={p.last_name} seed={p.id} size="sm" />
                    <div>
                      <div className="font-semibold">{p.first_name} {p.last_name}</div>
                      <div className="text-xs text-ink-3">{p.phone}</div>
                    </div>
                  </div>
                </td>
                <td className="text-xs max-w-[160px] truncate">{p.primary_diagnosis || '—'}</td>
                <td className="text-xs">{p.insurance_primary?.provider || '—'}</td>
                <td className="text-xs">{p.caregiver_name || <span className="text-ink-4">Unassigned</span>}</td>
                <td>
                  <Badge variant={p.status === 'active' ? 'green' : 'gray'}>
                    {p.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
