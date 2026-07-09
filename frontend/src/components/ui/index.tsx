/**
 * Wodoga Platform — Core UI Components
 * Badge, Button, Spinner, EmptyState, Avatar, StatCard
 */

import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Inbox, Info, type LucideIcon } from 'lucide-react';
import { cn, type BadgeVariant, initials, avatarColor } from '@/utils';

// ════════════════════════════════════════════════════════════
// BADGE
// ════════════════════════════════════════════════════════════
const BADGE_STYLES: Record<BadgeVariant, string> = {
  green:  'bg-forest-pale  text-forest',
  blue:   'bg-blue-pale    text-blue',
  amber:  'bg-amber-pale   text-amber',
  red:    'bg-red-pale     text-red',
  purple: 'bg-purple-pale  text-purple',
  teal:   'bg-teal-pale    text-teal',
  gray:   'bg-surface-2    text-ink-2',
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = 'gray', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold',
        BADGE_STYLES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ════════════════════════════════════════════════════════════
// BUTTON
// ════════════════════════════════════════════════════════════
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'amber' | 'ghost';
type BtnSize    = 'xs' | 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?:    BtnSize;
  loading?: boolean;
  icon?:    ReactNode;
}

const BTN_BASE = 'inline-flex items-center justify-center gap-1.5 font-semibold font-sans transition-all duration-150 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

const BTN_VARIANTS: Record<BtnVariant, string> = {
  primary:   'bg-forest text-white shadow-sm hover:bg-forest-mid active:bg-forest -translate-y-0 hover:-translate-y-px',
  secondary: 'bg-surface text-ink border border-surface-border shadow-xs hover:bg-surface-2',
  danger:    'bg-red-ghost text-red border border-red-pale hover:bg-red-pale',
  amber:     'bg-amber-ghost text-amber border border-amber-pale hover:bg-amber-pale',
  ghost:     'text-ink-2 hover:bg-surface-2 hover:text-ink',
};

const BTN_SIZES: Record<BtnSize, string> = {
  xs: 'text-[11px] px-2.5 py-1',
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2.5',
};

export function Button({
  variant = 'secondary',
  size    = 'md',
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(BTN_BASE, BTN_VARIANTS[variant], BTN_SIZES[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner size="xs" /> : icon}
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════
// SPINNER
// ════════════════════════════════════════════════════════════
interface SpinnerProps { size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string; }

const SPINNER_SIZE = { xs: 'w-3 h-3', sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-7 h-7' };

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin', SPINNER_SIZE[size], className)}
      fill="none" viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path fill="currentColor" className="opacity-75"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ════════════════════════════════════════════════════════════
// EMPTY STATE
// ════════════════════════════════════════════════════════════
interface EmptyStateProps {
  icon?:        LucideIcon;
  title:        string;
  description?: string;
  action?:      ReactNode;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-6">
      <div className="flex justify-center mb-3">
        <Icon size={28} className="text-ink-4" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="text-sm font-semibold text-ink-2 mb-1">{title}</div>
      {description && <p className="text-xs text-ink-3 mb-4 max-w-xs mx-auto leading-relaxed">{description}</p>}
      {action}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// AVATAR
// ════════════════════════════════════════════════════════════
interface AvatarProps {
  firstName?: string | null;
  lastName?:  string | null;
  seed?:      string;
  size?:      'sm' | 'md' | 'lg' | 'xl';
  square?:    boolean;
  className?: string;
}

const AVATAR_SIZE = {
  sm: 'w-7 h-7 text-[11px]',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-14 h-14 text-lg',
};

export function Avatar({ firstName, lastName, seed, size = 'md', square, className }: AvatarProps) {
  const key   = seed || `${firstName}${lastName}` || 'U';
  const color = avatarColor(key);
  const text  = initials(firstName, lastName) || '?';

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center font-extrabold text-white flex-shrink-0',
        AVATAR_SIZE[size],
        square ? 'rounded-lg' : 'rounded-full',
        className,
      )}
      style={{ background: color }}
    >
      {text}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// STAT CARD
// ════════════════════════════════════════════════════════════
type StatAccent = 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'teal';

interface StatCardProps {
  label:    string;
  value:    string | number;
  foot?:    string;
  footUp?:  boolean;
  icon?:    LucideIcon;
  accent?:  StatAccent;
}

const STAT_ACCENT_BAR: Record<StatAccent, string> = {
  green:  'from-forest to-forest-light',
  blue:   'from-blue to-blue-mid',
  amber:  'from-amber to-amber-mid',
  red:    'from-red to-red-mid',
  purple: 'from-purple to-purple-mid',
  teal:   'from-teal to-teal-mid',
};

const STAT_ICON_BG: Record<StatAccent, string> = {
  green:  'bg-forest-pale',
  blue:   'bg-blue-ghost',
  amber:  'bg-amber-ghost',
  red:    'bg-red-ghost',
  purple: 'bg-purple-ghost',
  teal:   'bg-teal-ghost',
};

export function StatCard({ label, value, foot, footUp, icon: Icon, accent = 'green' }: StatCardProps) {
  return (
    <div className="card relative overflow-hidden">
      {/* Top accent bar */}
      <div className={cn('absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r', STAT_ACCENT_BAR[accent])} />
      <div className="p-5 pt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide">{label}</div>
          {Icon && (
            <div className={cn('w-9 h-9 rounded-md flex items-center justify-center', STAT_ICON_BG[accent])}>
              <Icon size={17} strokeWidth={2} aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="font-display text-[34px] font-semibold text-ink leading-none tracking-tight tabular">
          {value}
        </div>
        {foot && (
          <div className={cn('text-xs mt-1.5 font-medium', footUp ? 'text-forest-light' : 'text-ink-3')}>
            {footUp ? '↑ ' : ''}{foot}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// INFO FIELD (patient detail display)
// ════════════════════════════════════════════════════════════
export function InfoField({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-sm font-medium text-ink">{value || <span className="text-ink-4">—</span>}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// LOADING PAGE
// ════════════════════════════════════════════════════════════
export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <Spinner size="lg" className="text-forest mx-auto mb-3" />
        <div className="text-sm text-ink-3">Loading...</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ALERT BANNER
// ════════════════════════════════════════════════════════════
type AlertType = 'success' | 'warning' | 'error' | 'info';

const ALERT_STYLES: Record<AlertType, string> = {
  success: 'bg-forest-ghost border-forest-pale text-forest',
  warning: 'bg-amber-ghost  border-amber-pale  text-amber',
  error:   'bg-red-ghost    border-red-pale    text-red',
  info:    'bg-blue-ghost   border-blue-pale   text-blue',
};

const ALERT_ICONS: Record<AlertType, LucideIcon> = {
  success: CheckCircle2, warning: AlertTriangle, error: AlertCircle, info: Info,
};

export function Alert({
  type = 'info',
  children,
  className,
}: {
  type?: AlertType;
  children: ReactNode;
  className?: string;
}) {
  const Icon = ALERT_ICONS[type];
  return (
    <div role={type === 'error' ? 'alert' : 'status'}
         className={cn('flex gap-2.5 p-3 rounded border text-sm mb-3 items-start', ALERT_STYLES[type], className)}>
      <Icon size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// GATED
// Render children only if the current user has the required permission(s).
// Use this to hide buttons, links, or sections that lead to actions the
// user cannot perform. This is a UX affordance, NOT a security control —
// the backend still enforces every action via require_permissions().
//
//   <Gated permission="patients:create">
//     <Button>Add Patient</Button>
//   </Gated>
//
//   <Gated anyOf={['billing:create', 'billing:update']}>
//     <Button>Edit Claim</Button>
//   </Gated>
//
// Pass `fallback` to render an alternative (e.g. a disabled button with a
// tooltip). Defaults to rendering nothing.
// ════════════════════════════════════════════════════════════
import type { Permission } from '@/types';
import { useAuthStore } from '@/store/auth.store';

interface GatedProps {
  permission?: Permission;
  anyOf?: Permission[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function Gated({ permission, anyOf, children, fallback = null }: GatedProps) {
  const hasPermission    = useAuthStore(s => s.hasPermission);
  const hasAnyPermission = useAuthStore(s => s.hasAnyPermission);

  const allowed = permission
    ? hasPermission(permission)
    : anyOf
    ? hasAnyPermission(...anyOf)
    : true; // No constraint provided — render unchanged (developer error guard)

  return <>{allowed ? children : fallback}</>;
}
