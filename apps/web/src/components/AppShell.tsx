import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Banknote,
  CalendarRange,
  Check,
  FileText,
  HandCoins,
  GraduationCap,
  History,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Printer,
  ReceiptText,
  ScrollText,
  Settings as SettingsIcon,
  Sun,
  UserCircle,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { Permission } from '@sft/shared';
import { api, describeError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canRunSetup } from '../lib/setup';
import { ACCENTS, useTheme, type ThemeMode } from '../lib/theme';
import { NoAccess } from '../pages/NoAccess';
import { useRequestCounts } from '../pages/requests/RequestsPage';
import { Avatar } from './Avatar';
import { NotificationBell } from './notifications';
import { PageHeader, Select, Spinner, cx } from './ui';
import { lockScroll } from '../lib/scrollLock';

// rarely needed, so loaded only when shown
const CopyWizard = lazy(async () => ({ default: (await import('./CopyWizard')).CopyWizard }));
const TwoFactorCard = lazy(async () => ({ default: (await import('./TwoFactorCard')).TwoFactorCard }));

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
}

const NAV: { label?: string; items: NavItem[] }[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Money',
    items: [
      { to: '/collection', label: 'Collection', icon: Banknote, permission: 'collect' },
      { to: '/funds', label: 'Funds', icon: Wallet, permission: 'view_funds' },
      { to: '/requests', label: 'Fund requests', icon: FileText },
      { to: '/liquidations', label: 'Liquidations', icon: ReceiptText },
      { to: '/reimbursements', label: 'Reimbursements', icon: HandCoins },
    ],
  },
  {
    label: 'Records',
    items: [
      { to: '/students', label: 'Students', icon: GraduationCap, permission: 'collect' },
      { to: '/history', label: 'Transaction history', icon: History },
      { to: '/reports', label: 'Reports', icon: Printer },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users', icon: Users, permission: 'manage' },
      { to: '/academic-years', label: 'Academic years', icon: CalendarRange, permission: 'manage' },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, permission: 'manage' },
      { to: '/audit', label: 'Activity log', icon: ScrollText, permission: 'manage' },
      { to: '/activity', label: 'Sign-in activity', icon: Activity, permission: 'manage' },
    ],
  },
];

/** Pages anyone signed in can open, even without access to the selected AY. */
const ALWAYS_OPEN = ['/notifications', '/profile'];

function AySwitcher() {
  const { me, ay, switchAy } = useAuth();
  if (!me || !ay) return null;
  return (
    <label className="block">
      <span className="sr-only">Academic year</span>
      <Select value={ay.id} onChange={(e) => switchAy(e.target.value)} className="h-9 w-full text-sm font-medium">
        {me.academicYears.map((a) => (
          <option key={a.id} value={a.id}>
            AY {a.label}
            {a.isCurrent ? ' · current' : ''}
            {a.status === 'closed' ? ' · closed' : ''}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** The signed-in person: picture, name and position, with Profile and Log out. */
function UserMenu() {
  const { me, ay, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!me) return null;
  const position = ay?.membership?.status === 'active' ? ay.membership.position : null;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center rounded-full ring-offset-2 hover:ring-2 hover:ring-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-label={`Account menu for ${me.user.name}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Avatar name={me.user.name} url={me.user.avatarUrl} size="sm" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl bg-surface shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Avatar name={me.user.name} url={me.user.avatarUrl} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{me.user.name}</p>
              <p className="truncate text-xs text-slate-500">{position ?? me.user.email}</p>
            </div>
          </div>
          <AppearancePicker />
          <div className="border-t border-slate-100 p-1">
            <Link role="menuitem" to="/profile" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-100">
              <UserCircle className="size-4 text-slate-500" aria-hidden /> Profile
            </Link>
            <button
              role="menuitem"
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
            >
              <LogOut className="size-4 text-slate-500" aria-hidden /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'Auto', icon: Monitor },
];

/** Light, dark or the device's setting, and the accent color. Saved in this browser. */
function AppearancePicker() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="space-y-2.5 px-4 py-3">
      <p className="text-xs font-medium text-slate-500">Appearance</p>
      <div role="radiogroup" aria-label="Light or dark" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={theme.mode === id}
            onClick={() => setTheme({ mode: id })}
            className={cx(
              'flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
              theme.mode === id ? 'bg-surface text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
            )}
          >
            <Icon className="size-3.5" aria-hidden /> {label}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-2">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={theme.accent === a.id}
            aria-label={a.label}
            title={a.label}
            onClick={() => setTheme({ accent: a.id })}
            className={cx(
              'grid size-6 place-items-center rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110',
              theme.accent === a.id && 'ring-2 ring-slate-400',
            )}
            style={{ backgroundColor: a.swatch }}
          >
            {theme.accent === a.id && <Check className="size-3.5 text-white" aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppShell() {
  const { me, ay, isActiveMember, can } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // the setup wizard opens by itself once per AY that still needs setting up
  const [wizardDismissed, setWizardDismissed] = useState<string[]>([]);
  const [wizardRequested, setWizardRequested] = useState(false);
  const location = useLocation();

  const unread = useQuery({
    queryKey: ['notifications', ay?.id, 'unread'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count', { background: true }),
    refetchInterval: 60_000,
    enabled: Boolean(ay),
  });

  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // while the phone menu is open: the page behind doesn't scroll, and Escape closes it
  useEffect(() => {
    if (!drawerOpen) return;
    const unlock = lockScroll();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      unlock();
      document.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  const groups = [
    ...NAV.map((g) => ({ ...g, items: isActiveMember ? g.items.filter((i) => !i.permission || can(i.permission)) : [] })),
  ].filter((g) => g.items.length);
  const showPage = isActiveMember || ALWAYS_OPEN.includes(location.pathname);
  // an AY that requires two-factor sign-in shows only the setup until it's done (the API refuses the rest)
  const needsTwoFactor = Boolean(ay?.membership && ay.twoFactorMode === 'required' && !me?.user.twoFactorEnabled);
  const unreadCount = unread.data?.count ?? 0;
  const counts = useRequestCounts().data;
  // the red number beside a menu item: what waits for this user there
  const badges: Record<string, number> = {
    '/requests': counts?.requests ?? 0,
    '/liquidations': (counts?.liquidations ?? 0) + (counts?.toLiquidate ?? 0),
    '/reimbursements': counts?.reimbursements ?? 0,
  };
  const setupAvailable = canRunSetup(me, ay);
  const showWizard = Boolean(ay) && setupAvailable && (wizardRequested || !wizardDismissed.includes(ay!.id));
  const closeWizard = () => {
    if (ay) setWizardDismissed((list) => [...list, ay.id]);
    setWizardRequested(false);
  };

  const brand = (
    <Link to="/" className="flex min-w-0 items-center gap-2.5">
      {ay?.logoUrl ? (
        <img src={ay.logoUrl} alt="" className="size-9 shrink-0 rounded-lg object-contain" />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600 font-bold text-white">{(ay?.orgAbbr || ay?.orgName || 'F').slice(0, 1)}</span>
      )}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold text-slate-900">{ay?.orgName || 'Fund Tracker'}</span>
        <span className="block truncate text-xs text-slate-500">Fund Tracker</span>
      </span>
    </Link>
  );

  const navigation = (
    <nav aria-label="Main" className="space-y-5">
      {groups.map((g) => (
        <div key={g.label ?? 'top'}>
          {g.label && <p className="mb-1 px-3 text-xs font-medium text-slate-400">{g.label}</p>}
          <ul className="space-y-0.5">
            {g.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )
                  }
                >
                  <Icon className="size-4.5 shrink-0" aria-hidden />
                  <span className="flex-1">{label}</span>
                  {(badges[to] ?? 0) > 0 && (
                    <span className="min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white" aria-label={`${badges[to]} waiting`}>
                      {badges[to]}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const sidebar = (
    <>
      <div className="px-1">{brand}</div>
      <div className="mt-4 px-1">
        <AySwitcher />
      </div>
      <div className="no-scrollbar mt-6 min-h-0 flex-1 overflow-y-auto">{navigation}</div>
    </>
  );

  return (
    <div className="min-h-dvh md:pl-64 print:pl-0">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-surface p-4 md:flex">{sidebar}</aside>

      {/* phone menu: always in the page so it can slide in and out */}
      <div className={cx('no-print fixed inset-0 z-40 md:hidden', !drawerOpen && 'pointer-events-none')} inert={!drawerOpen} aria-hidden={!drawerOpen}>
        <div
          className={cx('absolute inset-0 bg-black/40 transition-opacity duration-300 ease-out motion-reduce:transition-none', drawerOpen ? 'opacity-100' : 'opacity-0')}
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={cx(
            'absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface p-4 shadow-xl will-change-transform',
            'transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
            drawerOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <button type="button" onClick={() => setDrawerOpen(false)} className="absolute right-3 top-4 rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close menu">
            <X className="size-5" />
          </button>
          {sidebar}
        </div>
      </div>

      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <button type="button" onClick={() => setDrawerOpen(true)} className="-ml-1 rounded-md p-1.5 text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1 md:hidden">{brand}</div>
          <div className="hidden flex-1 md:block" />
          <NotificationBell unreadCount={unreadCount} />
          <UserMenu />
        </div>
      </header>

      {ay?.status === 'closed' && (
        <div className="border-b border-amber-200 bg-amber-50">
          <p className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm text-amber-900">
            <Lock className="size-4 shrink-0" aria-hidden />
            AY {ay.label} is closed and read-only.
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
      <PageHeader title="Set up two-factor sign-in" description={`Required for AY ${label}.`} />
      <Suspense fallback={<Spinner />}>
        <TwoFactorCard />
      </Suspense>
    </div>
  );
}
