'use client';
/**
 * Wodoga Platform — Clinical Alerts panel.
 * Path: frontend/src/components/clinical/AlertsPanel.tsx
 *
 * Drop onto the dashboard:  <AlertsPanel />
 * Or scope to one patient:  <AlertsPanel patientId={id} />
 *
 * Uses react-query + the shared UI primitives + the app's design tokens
 * (surface/ink/semantic colors), so it matches the theme and dark mode.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, CalendarClock, HeartPulse, PauseCircle, ShieldAlert, Inbox,
} from 'lucide-react';
import { Badge, Spinner, EmptyState } from '@/components/ui';
import { clinicalService, type ClinicalAlert, type AlertSeverity } from '@/services/clinical';

const SEVERITY_BADGE: Record<AlertSeverity, 'red' | 'amber' | 'blue' | 'gray'> = {
  high: 'red', medium: 'amber', low: 'blue', info: 'gray',
};
const KIND_ICON: Record<string, any> = {
  frequency_shortfall: AlertTriangle,
  frequency_at_risk: AlertTriangle,
  document_expiring: CalendarClock,
  code_status_missing: ShieldAlert,
  code_status_stale: HeartPulse,
  patient_on_hold: PauseCircle,
};

export function AlertsPanel({ patientId }: { patientId?: string }) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['clinical-alerts', patientId ?? 'agency'],
    queryFn: () => clinicalService.alerts(patientId),
    refetchInterval: 5 * 60 * 1000, // recompute every 5 min (compute-on-read)
  });

  if (isLoading) return <div className="flex justify-center p-8"><Spinner /></div>;
  if (isError) return <p className="text-sm text-red p-4">Couldn’t load alerts.</p>;
  if (!data || data.count === 0)
    return <EmptyState icon={Inbox} title="No open alerts"
             description="Frequency, documents, and code-status checks are all clear." />;

  // Agency-wide view defaults to high-severity only to stay quiet; the
  // folder view (patientId set) always shows everything for that patient.
  const agency = !patientId;
  const shown = agency && !showAll
    ? data.alerts.filter((a) => a.severity === 'high')
    : data.alerts;

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap mb-3">
        {(['high', 'medium', 'low', 'info'] as AlertSeverity[])
          .filter((s) => data.counts_by_severity[s] > 0)
          .map((s) => (
            <Badge key={s} variant={SEVERITY_BADGE[s]}>
              {data.counts_by_severity[s]} {s}
            </Badge>
          ))}
        {agency && data.count > shown.length && (
          <button onClick={() => setShowAll(true)}
            className="text-xs text-forest font-semibold ml-auto">
            Show all {data.count}
          </button>)}
        {agency && showAll && (
          <button onClick={() => setShowAll(false)}
            className="text-xs text-ink-3 font-semibold ml-auto">Show high only</button>)}
      </div>
      {shown.map((a: ClinicalAlert, i: number) => {
        const Icon = KIND_ICON[a.kind] ?? AlertTriangle;
        return (
          <button
            key={i}
            onClick={() => a.patient_id && router.push(`/patients/${a.patient_id}`)}
            className="w-full text-left flex items-start gap-3 rounded-lg border
                       border-surface-border bg-surface p-3 hover:bg-bg transition-colors"
          >
            <Icon className="h-5 w-5 mt-0.5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant={SEVERITY_BADGE[a.severity]}>{a.severity}</Badge>
                {a.patient_name && a.patient_name !== 'Agency-level' && (
                  <span className="text-sm font-medium text-ink truncate">
                    {a.patient_name}
                  </span>
                )}
              </div>
              <p className="text-sm text-ink-2 mt-0.5">{a.title}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default AlertsPanel;
