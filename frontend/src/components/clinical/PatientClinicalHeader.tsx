'use client';
/**
 * Wodoga Platform — Patient chart header banners.
 * Path: frontend/src/components/clinical/PatientClinicalHeader.tsx
 *
 * Renders the safety-critical facts a clinician must see before acting:
 *   • code status (or a loud "not documented" if missing)
 *   • an active hold banner
 *   • payer chip
 * Uses the app's design tokens, so it themes correctly incl. dark mode.
 *
 * Usage inside the patient detail page:
 *   <PatientClinicalHeader patientId={p.id}
 *      codeStatus={p.code_status} payerType={p.payer_type} />
 */

import { useQuery } from '@tanstack/react-query';
import { PauseCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui';
import { clinicalService } from '@/services/clinical';

const CODE_LABEL: Record<string, string> = {
  full_code: 'Full Code', dnr: 'DNR', dni: 'DNI',
  dnr_dni: 'DNR / DNI', comfort_care: 'Comfort Care',
};
const PAYER_LABEL: Record<string, string> = {
  medicare: 'Medicare', medicare_advantage: 'Medicare Advantage',
  medicaid: 'Medicaid', commercial: 'Commercial', private_pay: 'Private Pay',
  va_champva: 'VA / CHAMPVA', workers_comp: "Workers' Comp", other: 'Other',
};

export function PatientClinicalHeader({
  patientId, codeStatus, payerType,
}: {
  patientId: string;
  codeStatus?: string | null;
  payerType?: string | null;
}) {
  const { data: holds } = useQuery({
    queryKey: ['patient-holds', patientId],
    queryFn: () => clinicalService.listHolds(patientId),
  });
  const activeHold = holds?.find((h) => h.active);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Code status — missing is a deficiency, shown loudly */}
      {codeStatus ? (
        <span className="inline-flex items-center gap-1.5 rounded border
                         border-surface-border bg-surface px-2.5 py-1 text-sm font-medium text-ink">
          <ShieldCheck className="h-4 w-4 text-forest" />
          {CODE_LABEL[codeStatus] ?? codeStatus}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded border
                         border-red/30 bg-red-pale px-2.5 py-1 text-sm font-semibold text-red">
          <ShieldAlert className="h-4 w-4" />
          Code status not documented
        </span>
      )}

      {/* Active hold */}
      {activeHold && (
        <span className="inline-flex items-center gap-1.5 rounded border
                         border-amber/30 bg-amber-pale px-2.5 py-1 text-sm font-semibold text-amber">
          <PauseCircle className="h-4 w-4" />
          On hold — {activeHold.hold_type.replace(/_/g, ' ')}
          {activeHold.expected_return ? ` · back ${activeHold.expected_return}` : ''}
        </span>
      )}

      {/* Payer */}
      {payerType && <Badge variant="blue">{PAYER_LABEL[payerType] ?? payerType}</Badge>}
    </div>
  );
}

export default PatientClinicalHeader;
