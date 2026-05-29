/**
 * Wodoga Platform — Utilities
 * Formatting, class name merging, and permission helpers.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, isToday, isTomorrow, parseISO } from 'date-fns';
import type { Permission, UserRole, PatientStatus, ClaimStatus,
              ReferralStage, PharmStage, EligibilityResult, FallRisk } from '@/types';

// ── Class Name Merge ─────────────────────────────────────────
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ── Date Formatters ───────────────────────────────────────────
export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = dateStr.includes('T') ? parseISO(dateStr) : parseISO(dateStr + 'T00:00:00');
    return format(d, 'MMM d, yyyy');
  } catch { return dateStr; }
}

export function fmtDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try { return format(parseISO(dateStr), 'MMM d, h:mm a'); } catch { return dateStr; }
}

export function fmtTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '—';
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
  } catch { return timeStr; }
}

export function fmtRelative(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try { return formatDistanceToNow(parseISO(dateStr), { addSuffix: true }); } catch { return dateStr; }
}

export function fmtVisitDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = parseISO(dateStr + 'T00:00:00');
    if (isToday(d))    return 'Today';
    if (isTomorrow(d)) return 'Tomorrow';
    return format(d, 'EEE, MMM d');
  } catch { return dateStr; }
}

export function calcAge(dobStr: string | null | undefined): string {
  if (!dobStr) return '';
  try {
    const dob  = parseISO(dobStr + 'T00:00:00');
    const now  = new Date();
    let   age  = now.getFullYear() - dob.getFullYear();
    const m    = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return `${age}y`;
  } catch { return ''; }
}

// ── Currency ──────────────────────────────────────────────────
export function fmtCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// ── Initials ──────────────────────────────────────────────────
export function initials(firstName?: string | null, lastName?: string | null): string {
  return ((firstName?.[0] ?? '') + (lastName?.[0] ?? '')).toUpperCase();
}

// ── Avatar Color ──────────────────────────────────────────────
const AVATAR_COLORS = [
  '#1B4332', '#1e3a8a', '#6d28d9', '#92400e',
  '#991b1b', '#134e4a', '#374151', '#7c3aed',
];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash &= hash;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── Status Labels & Colors ────────────────────────────────────
export const PATIENT_STATUS_BADGE: Record<PatientStatus, { label: string; variant: BadgeVariant }> = {
  active:      { label: 'Active',      variant: 'green'  },
  discharged:  { label: 'Discharged',  variant: 'gray'   },
  on_hold:     { label: 'On Hold',     variant: 'amber'  },
  deceased:    { label: 'Deceased',    variant: 'red'    },
  transferred: { label: 'Transferred', variant: 'blue'   },
};

export const CLAIM_STATUS_BADGE: Record<ClaimStatus, { label: string; variant: BadgeVariant }> = {
  draft:       { label: 'Draft',       variant: 'gray'   },
  submitted:   { label: 'Submitted',   variant: 'blue'   },
  pending:     { label: 'Pending',     variant: 'amber'  },
  approved:    { label: 'Approved',    variant: 'green'  },
  denied:      { label: 'Denied',      variant: 'red'    },
  appealed:    { label: 'Appealed',    variant: 'purple' },
  paid:        { label: 'Paid',        variant: 'teal'   },
  written_off: { label: 'Written Off', variant: 'gray'   },
};

export const REFERRAL_STAGE_LABEL: Record<ReferralStage, string> = {
  new_lead:         'New Lead',
  contacted:        'Contacted',
  evaluating:       'Evaluating',
  insurance_check:  'Insurance Check',
  admitted:         'Admitted',
  declined:         'Declined',
  lost:             'Lost',
};

export const PHARM_STAGE_LABEL: Record<PharmStage, string> = {
  prescribed: 'Prescribed',
  verified:   'Verified',
  dispensed:  'Dispensed',
  in_transit: 'In Transit',
  delivered:  'Delivered',
  cancelled:  'Cancelled',
};

export const ELIGIBILITY_BADGE: Record<EligibilityResult, { label: string; variant: BadgeVariant }> = {
  eligible:       { label: 'Eligible',        variant: 'green'  },
  not_eligible:   { label: 'Not Eligible',    variant: 'red'    },
  pending_review: { label: 'Pending Review',  variant: 'amber'  },
  error:          { label: 'Error',           variant: 'red'    },
};

export const FALL_RISK_BADGE: Record<FallRisk, { label: string; variant: BadgeVariant }> = {
  low:      { label: 'Low Risk',      variant: 'green' },
  moderate: { label: 'Moderate Risk', variant: 'amber' },
  high:     { label: 'High Risk',     variant: 'red'   },
};

export const VISIT_TYPE_LABEL: Record<string, string> = {
  wellness_check:            'Wellness Check',
  medication_administration: 'Medication Administration',
  wound_care:                'Wound Care',
  physical_therapy:          'Physical Therapy',
  occupational_therapy:      'Occupational Therapy',
  post_surgery_care:         'Post-Surgery Care',
  chronic_disease_management:'Chronic Disease Management',
  hospice_support:           'Hospice Support',
  other:                     'Other',
};

export type BadgeVariant = 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'teal' | 'gray';

// ── Role Display ──────────────────────────────────────────────
export const ROLE_DISPLAY: Record<UserRole, string> = {
  admin:          'Administrator',
  provider:       'Provider',
  pharmacy_staff: 'Pharmacy Staff',
  biller:         'Biller',
  viewer:         'Viewer',
  caregiver:      'Caregiver',
  patient:        'Patient',
};

export const ROLE_COLOR: Record<UserRole, string> = {
  admin:          'bg-amber-pale  text-amber',
  provider:       'bg-blue-pale   text-blue',
  pharmacy_staff: 'bg-purple-pale text-purple',
  biller:         'bg-forest-pale text-forest',
  viewer:         'bg-surface-2   text-ink-2',
  caregiver:      'bg-red-pale    text-red',
  patient:        'bg-teal-pale   text-teal',
};

// ── BP Status ─────────────────────────────────────────────────
export function bpStatus(sys: number | null, dia: number | null): {
  label: string; variant: BadgeVariant;
} {
  if (!sys || !dia) return { label: '—', variant: 'gray' };
  if (sys < 120 && dia < 80)  return { label: 'Normal',   variant: 'green' };
  if (sys < 130 && dia < 80)  return { label: 'Elevated', variant: 'amber' };
  if (sys < 140 || dia < 90)  return { label: 'High S1',  variant: 'amber' };
  return { label: 'High S2', variant: 'red' };
}

// ── Truncate ──────────────────────────────────────────────────
export function truncate(str: string | null | undefined, length = 60): string {
  if (!str) return '—';
  return str.length > length ? str.slice(0, length) + '…' : str;
}

// ── Plural ────────────────────────────────────────────────────
export function plural(n: number, word: string, suffix = 's'): string {
  return `${n} ${word}${n !== 1 ? suffix : ''}`;
}
