import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Banknote, Bell, History, Printer, FileText, CalendarRange, GraduationCap, Wallet, LayoutDashboard, Lock, LogOut, Menu, ScrollText, Settings as SettingsIcon, UserCircle, Users, X } from 'lucide-react';
import type { Permission } from '@sft/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { NoAccess } from '../pages/NoAccess';
import { useRequestCounts } from '../pages/requests/RequestsPage';
import { canRunSetup } from '../lib/setup';
import { NotificationBell } from './notifications';
import { PageHeader, Select, Spinner, cx } from './ui';

// rarely needed, so loaded only when shown
const CopyWizard = lazy(async () => ({ default: (await import('./CopyWizard')).CopyWizard }));
const TwoFactorCard = lazy(async () => ({ default: (await import('./TwoFactorCard')).TwoFactorCard }));

interface NavItem {
  to: string;
  label: string;
  icon: typeof Bell;
  permission?: Permission;
  /** Reachable without access to the selected AY. */
  always?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/collection', label: 'Collection', icon: Banknote, permission: 'collect' },
  { to: '/funds', label: 'Funds', icon: Wallet },
  { to: '/requests', label: 'Fund requests', icon: FileText },
  { to: '/students', label: 'Students', icon: GraduationCap, permission: 'collect' },
  { to: '/history', label: 'Transaction history', icon: History },
  { to: '/reports', label: 'Reports', icon: Printer },
  { to: '/users', label: 'User management', icon: Users, permission: 'manage' },
  { to: '/academic-years', label: 'Academic years', icon: CalendarRange, permission: 'manage' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, permission: 'manage' },
  { to: '/audit', label: 'Audit log', icon: ScrollText, permission: 'manage' },
  { to: '/notifications', label: 'Notifications', icon: Bell, always: true },
  { to: '/profile', label: 'Profile', icon: UserCircle, always: true },
];

function AySwitcher({ className }: { className?: string }) {
  const { me, ay, switchAy } = useAuth();
  if (!me || !ay) return null;
  return (
    <label className={cx('block', className)}>
      <span className="sr-only">Academic year</span>
      <Select value={ay.id} onChange={(e) => switchAy(e.target.value)} className="h-9 min-w-36 text-sm font-medium">
        {me.academicYears.map((a) => (
          <option key={a.id} value={a.id}>
            AY {a.label}
            {a.isCurrent ? ' (current)' : ''}
            {a.status === 'closed' ? ' · closed' : ''}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function AppShell() {
  const { me, ay, isActiveMember, can, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // the setup wizard opens by itself once per AY that still needs setting up
  const [wizardDismissed, setWizardDismissed] = useState<string[]>([]);
  const [wizardRequested, setWizardRequested] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const unread = useQuery({
    queryKey: ['notifications', ay?.id, 'unread'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count', { background: true }),
    refetchInterval: 60_000,
    enabled: Boolean(ay),
  });

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const items = NAV.filter((item) => (item.permission ? can(item.permission) : isActiveMember || item.always));
  const currentItem = NAV.find((n) => n.to === location.pathname);
  const showPage = isActiveMember || currentItem?.always;
  // an AY that requires two-factor sign-in shows only the setup until it's done (the API refuses the rest)
  const needsTwoFactor = Boolean(ay?.membership && ay.twoFactorMode === 'required' && !me?.user.twoFactorEnabled);
  const unreadCount = unread.data?.count ?? 0;
  const toApprove = useRequestCounts().data?.toApprove ?? 0;
  const setupAvailable = canRunSetup(me, ay);
  const showWizard = Boolean(ay) && setupAvailable && (wizardRequested || !wizardDismissed.includes(ay!.id));
  const closeWizard = () => {
    if (ay) setWizardDismissed((list) => [...list, ay.id]);
    setWizardRequested(false);
  };

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const navList = (
    <nav className="space-y-1" aria-label="Main">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100',
            )
          }
        >
          <Icon className="size-4.5 shrink-0" aria-hidden />
          <span className="flex-1">{label}</span>
          {to === '/notifications' && unreadCount > 0 && (
            <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">{unreadCount}</span>
          )}
          {to === '/requests' && toApprove > 0 && (
            <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white" aria-label={`${toApprove} to approve`}>
              {toApprove}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex min-w-0 items-center gap-2.5">
      {ay?.logoUrl ? (
        <img src={ay.logoUrl} alt="" className="size-9 shrink-0 rounded-lg object-contain" />
      ) : (
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600 font-bold text-white">
          {(ay?.orgAbbr || ay?.orgName || 'F').slice(0, 1)}
        </div>
      )}
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold text-slate-900">{ay?.orgName || 'Fund Tracker'}</p>
        <p className="truncate text-xs text-slate-500">Fund Tracker</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh md:pl-64 print:pl-0">
      {/* desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <div className="mb-6 px-1">{brand}</div>
        {navList}
        <div className="mt-auto border-t border-slate-200 pt-4">
          <p className="truncate px-3 text-sm font-medium text-slate-900">{me?.user.name}</p>
          <p className="truncate px-3 text-xs text-slate-500">{ay?.membership?.status === 'active' ? ay.membership.position : 'No access'}</p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="size-4.5" aria-hidden /> Log out
          </button>
        </div>
      </aside>

      {/* mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white p-4 shadow-xl">
            <div className="mb-6 flex items-center justify-between gap-2">
              {brand}
              <button type="button" onClick={() => setDrawerOpen(false)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            {navList}
            <div className="mt-auto border-t border-slate-200 pt-4">
              <p className="truncate px-3 text-sm font-medium">{me?.user.name}</p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                <LogOut className="size-4.5" aria-hidden /> Log out
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 rounded-md p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1 md:hidden">{brand}</div>
          <div className="hidden flex-1 md:block" />
          <AySwitcher />
          <NotificationBell unreadCount={unreadCount} />
        </div>
      </header>

      {ay?.status === 'closed' && (
        <div className="border-b border-amber-200 bg-amber-50">
          <p className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm text-amber-900">
            <Lock className="size-4 shrink-0" aria-hidden />
            AY {ay.label} is closed. Everything is read-only.
          </p>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {needsTwoFactor ? (
          <TwoFactorRequired label={ay!.label} />
        ) : showPage ? (
          <Outlet />
        ) : (
          <NoAccess onSetup={setupAvailable ? () => setWizardRequested(true) : undefined} />
        )}
      </main>

      {showWizard && ay && (
        <Suspense fallback={null}>
          <CopyWizard key={ay.id} open target={ay} onClose={closeWizard} />
        </Suspense>
      )}
    </div>
  );
}

function TwoFactorRequired({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Set up two-factor sign-in" description={`AY ${label} requires it for every member. It takes a minute with an authenticator app on your phone.`} />
      <Suspense fallback={<Spinner />}>
        <TwoFactorCard />
      </Suspense>
    </div>
  );
}
