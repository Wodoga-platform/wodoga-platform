'use client';
/**
 * Wodoga Platform — Clinical Alerts panel.
 * Path: frontend/src/components/clinical/AlertsPanel.tsx
 *
 * Drop onto the dashboard:  <AlertsPanel />
 * Or scope to one patient:  <AlertsPanel patientId={id} />
 *
 * Uses react-query + the shared UI primitives, matching the existing pages.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, CalendarClock, HeartPulse, PauseCircle, ShieldAlert, Inbox,
} from 'lucide-react';
import { Badge, Spinner, EmptyState } from '@/components/ui';
import { clinicalService, type ClinicalAlert, type AlertSeverity } from '@/services/clinical';

const SEVERITY_BADGE: Record<AlertSeverity, string> = {
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
  const { data, isLoading, isError } = useQuery({
    queryKey: ['clinical-alerts', patientId ?? 'agency'],
    queryFn: () => clinicalService.alerts(patientId),
    refetchInterval: 5 * 60 * 1000, // recompute every 5 min (compute-on-read)
  });

  if (isLoading) return <div className="flex justify-center p-8"><Spinner /></div>;
  if (isError) return <p className="text-sm text-red-600 p-4">Couldn’t load alerts.</p>;
  if (!data || data.count === 0)
    return <EmptyState icon={Inbox} title="No open alerts"
             description="Frequency, documents, and code-status checks are all clear." />;

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap mb-3">
        {(['high', 'medium', 'low', 'info'] as AlertSeverity[])
          .filter((s) => data.counts_by_severity[s] > 0)
          .map((s) => (
            <Badge key={s} variant={SEVERITY_BADGE[s] as any}>
              {data.counts_by_severity[s]} {s}
            </Badge>
          ))}
      </div>
      {data.alerts.map((a: ClinicalAlert, i: number) => {
        const Icon = KIND_ICON[a.kind] ?? AlertTriangle;
        return (
          <button
            key={i}
            onClick={() => a.patient_id && router.push(`/patients/${a.patient_id}`)}
            className="w-full text-left flex items-start gap-3 rounded-lg border
                       border-gray-200 bg-white p-3 hover:bg-gray-50 transition"
          >
            <Icon className="h-5 w-5 mt-0.5 shrink-0 text-gray-500" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant={SEVERITY_BADGE[a.severity] as any}>{a.severity}</Badge>
                {a.patient_name && a.patient_name !== 'Agency-level' && (
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {a.patient_name}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-700 mt-0.5">{a.title}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default AlertsPanel;
