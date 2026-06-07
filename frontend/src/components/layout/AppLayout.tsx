'use client';

import { type ReactNode, useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, Home, ClipboardList, HeartPulse,
  Pill, RefreshCcw, Factory, GitMerge, CreditCard,
  CheckCircle, MessageSquare, FileText, Search, MapPin,
  LogOut, Bell, ChevronDown, User, Shield, Lock,
} from 'lucide-react';
import { cn, ROLE_DISPLAY } from '@/utils';
import { useAuthStore } from '@/store/auth.store';
import { Avatar, Badge, Spinner } from '@/components/ui';
import { notificationService, patientService } from '@/services';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { Permission } from '@/types';

// ── Nav Item Definition ───────────────────────────────────────
interface NavItem {
  label:       string;
  href:        string;
  icon:        ReactNode;
  permission?: Permission;
  badge?:      string | number;
  section?:    string;
}

const NAV_ITEMS: NavItem[] = [
  // Overview
  { section: 'Overview', label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard size={15} /> },
  // Clinical
  { section: 'Clinical', label: 'Patients',    href: '/patients',   icon: <Users size={15} />,         permission: 'patients:view' },
  { section: 'Clinical', label: 'Home Visits', href: '/visits',     icon: <Home size={15} />,          permission: 'visits:view'   },
  { section: 'Clinical', label: 'Patient Map', href: '/map',        icon: <MapPin size={15} />,        permission: 'patients:view' },
  { section: 'Clinical', label: 'Care Plans',  href: '/care-plans', icon: <ClipboardList size={15} />, permission: 'care_plans:view' },
  { section: 'Clinical', label: 'Vitals',      href: '/vitals',     icon: <HeartPulse size={15} />,    permission: 'vitals:view'   },
  // Pharmacy
  { section: 'Pharmacy', label: 'Medications',     href: '/medications',  icon: <Pill size={15} />,        permission: 'medications:view' },
  { section: 'Pharmacy', label: 'Reconciliation',  href: '/reconciliation',icon: <RefreshCcw size={15} />, permission: 'medications:reconcile' },
  { section: 'Pharmacy', label: 'Pharm. Orders',   href: '/pharm-orders', icon: <Factory size={15} />,     permission: 'pharm_orders:view' },
  // Operations
  { section: 'Operations', label: 'Referrals',  href: '/referrals',   icon: <GitMerge size={15} />,   permission: 'referrals:view' },
  { section: 'Operations', label: 'Billing',    href: '/billing',     icon: <CreditCard size={15} />, permission: 'billing:view'   },
  { section: 'Operations', label: 'Eligibility',href: '/eligibility', icon: <CheckCircle size={15} />,permission: 'eligibility:check' },
  { section: 'Operations', label: 'Messages',   href: '/messages',    icon: <MessageSquare size={15} />,permission: 'messages:view' },
  // Compliance
  { section: 'Compliance', label: 'OASIS',       href: '/oasis',       icon: <FileText size={15} />,  permission: 'oasis:view'   },
  { section: 'Compliance', label: 'Audit Log',   href: '/audit',       icon: <Search size={15} />,    permission: 'audit:view'   },
  { section: 'Compliance', label: 'Staff',       href: '/staff',       icon: <User size={15} />,      permission: 'staff:view'   },
];

// ════════════════════════════════════════════════════════════
// APP LAYOUT
// ════════════════════════════════════════════════════════════
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, signOut, hasPermission } = useAuthStore();
  const router   = useRouter();
  const pathname = usePathname();

  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Live patient search for the global search bar
  const { data: searchResults } = useQuery({
    queryKey: ['global-search', searchQ],
    queryFn:  () => patientService.list({ search: searchQ, per_page: 6 }),
    enabled:  searchQ.trim().length >= 2,
  });

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
  }, [isAuthenticated, router]);

  // Notifications
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn:  () => notificationService.list(),
    refetchInterval: 30_000,
    enabled:  isAuthenticated,
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const handleSignOut = async () => {
    signOut();
    router.replace('/login');
  };

  if (!isAuthenticated || !user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" className="text-forest" />
      </div>
    );
  }

  // Filter nav items by role permission
  const visibleItems = NAV_ITEMS.filter(item =>
    !item.permission || hasPermission(item.permission)
  );

  // Group nav items by section
  const sections = [...new Set(visibleItems.map(i => i.section))];

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── TOPBAR ── */}
      <header className="h-[58px] bg-forest flex items-center px-0 sticky top-0 z-40 shadow-lg flex-shrink-0">
        {/* Logo */}
        <div className="w-[220px] min-w-[220px] flex items-center gap-2.5 px-5 border-r border-white/10 h-full">
          <div className="w-[30px] h-[30px] bg-gradient-to-br from-forest-light to-forest-mid
                          rounded-lg flex items-center justify-center text-[15px] shadow-md">
            🌿
          </div>
          <span className="font-display text-[19px] font-bold text-white tracking-tight">Wodoga</span>
        </div>

        {/* Search */}
        <div className="flex-1 px-5">
          <div className="relative w-[360px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              placeholder="Search patients..."
              value={searchQ}
              onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={e => {
                if (e.key === 'Enter' && searchResults?.data?.[0]) {
                  router.push(`/patients/${searchResults.data[0].id}`);
                  setSearchQ(''); setSearchOpen(false);
                }
              }}
              className="w-full bg-white/10 border border-white/15 rounded text-white
                         text-sm placeholder:text-white/40 pl-8 pr-3 py-1.5
                         focus:outline-none focus:bg-white/15 focus:border-white/30 transition-colors"
            />
            {searchOpen && searchQ.trim().length >= 2 && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-lg shadow-xl border border-surface-border overflow-hidden z-50">
                {!searchResults?.data?.length ? (
                  <div className="px-3 py-3 text-sm text-ink-3">No patients found</div>
                ) : (
                  searchResults.data.map(p => (
                    <button
                      key={p.id}
                      onMouseDown={() => {
                        router.push(`/patients/${p.id}`);
                        setSearchQ(''); setSearchOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-forest-ghost text-left transition-colors border-b border-surface-borderLt last:border-0"
                    >
                      <Avatar firstName={p.first_name} lastName={p.last_name} seed={p.id} size="sm" />
                      <div>
                        <div className="text-sm font-semibold text-ink">{p.first_name} {p.last_name}</div>
                        <div className="text-xs text-ink-3">{p.primary_diagnosis || p.phone || 'Patient record'}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 pr-5">
          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setNotifOpen(v => !v)}
              className="w-9 h-9 flex items-center justify-center rounded bg-white/8 border border-white/12
                         text-white/80 hover:bg-white/15 transition-colors relative"
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-red rounded-full border-2 border-forest" />
              )}
            </button>

            {/* Notification dropdown */}
            {notifOpen && (
              <div className="absolute right-0 top-11 w-80 bg-surface border border-surface-border
                              rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in">
                <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
                  <span className="text-sm font-bold">Notifications</span>
                  {unreadCount > 0 && (
                    <Badge variant="red">{unreadCount} unread</Badge>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="p-5 text-center text-sm text-ink-3">All caught up ✓</div>
                  ) : (
                    notifications.slice(0, 8).map(n => (
                      <div key={n.id} className={cn(
                        'px-4 py-3 border-b border-surface-borderLt text-sm',
                        'hover:bg-bg cursor-pointer transition-colors',
                        !n.is_read && 'bg-forest-ghost/30',
                      )}>
                        <div className="font-semibold text-ink flex items-start gap-2">
                          {!n.is_read && <div className="w-1.5 h-1.5 rounded-full bg-forest mt-1.5 flex-shrink-0" />}
                          <span className={!n.is_read ? '' : 'ml-3.5'}>{n.title}</span>
                        </div>
                        <div className="text-ink-3 text-xs mt-0.5 ml-3.5">{n.body}</div>
                      </div>
                    ))
                  )}
                </div>
                <div className="px-4 py-2.5 border-t border-surface-border">
                  <Link href="/notifications" className="text-xs text-forest font-semibold hover:underline"
                        onClick={() => setNotifOpen(false)}>
                    View all notifications →
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* User */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/8 border border-white/12
                          rounded cursor-pointer hover:bg-white/14 transition-colors">
            <Avatar firstName={user.first_name} lastName={user.last_name} size="sm" />
            <div className="leading-tight">
              <div className="text-xs font-semibold text-white">{user.first_name} {user.last_name}</div>
              <div className="text-[10px] text-white/45 uppercase tracking-wide">
                {ROLE_DISPLAY[user.role]}
              </div>
            </div>
          </div>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red/15 border border-red/25
                       text-red/90 rounded text-xs font-semibold hover:bg-red/25 transition-colors"
          >
            <LogOut size={12} />
            Sign Out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── SIDEBAR ── */}
        <aside className="w-[220px] min-w-[220px] bg-surface border-r border-surface-border
                          flex flex-col overflow-y-auto sticky top-[58px] h-[calc(100vh-58px)]">
          <nav className="py-3 flex-1">
            {sections.map(section => {
              const items = visibleItems.filter(i => i.section === section);
              return (
                <div key={section} className="mb-1">
                  <div className="px-4 pt-3 pb-1 text-[10px] font-extrabold text-ink-4 uppercase tracking-[1.5px]">
                    {section}
                  </div>
                  {items.map(item => {
                    const active = pathname === item.href || pathname.startsWith(item.href + '/');
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2.5 px-4 py-2 text-sm font-medium',
                          'border-l-[3px] transition-all duration-150',
                          active
                            ? 'bg-forest-ghost text-forest border-l-forest font-bold'
                            : 'text-ink-2 border-l-transparent hover:bg-surface-2 hover:text-ink',
                        )}
                      >
                        <span className={cn('flex-shrink-0', active ? 'text-forest' : 'text-ink-3')}>
                          {item.icon}
                        </span>
                        <span className="flex-1">{item.label}</span>
                        {item.badge && (
                          <Badge variant="green" className="text-[10px] px-1.5">
                            {item.badge}
                          </Badge>
                        )}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {/* Sidebar footer */}
          <div className="px-4 py-3 border-t border-surface-border">
            <div className="text-[10px] text-ink-4 font-mono">Wodoga v2.0 · HIPAA Ready</div>
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="flex-1 overflow-y-auto">
          <div className="page-container">
            {children}
          </div>
        </main>
      </div>

      {/* Click-outside for notification panel */}
      {notifOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
      )}
    </div>
  );
}
