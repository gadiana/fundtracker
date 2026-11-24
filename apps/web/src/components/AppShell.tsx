import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Banknote,
  Building2,
  CalendarRange,
  FileText,
  GraduationCap,
  History,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Printer,
  ScrollText,
  Settings as SettingsIcon,
  UserCircle,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { Permission } from '@sft/shared';
import { api, describeError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canRunSetup } from '../lib/setup';
import { NoAccess } from '../pages/NoAccess';
import { useRequestCounts } from '../pages/requests/RequestsPage';
import { Avatar } from './Avatar';
import { NotificationBell } from './notifications';
import { useToast } from './Toast';
import { Alert, Button, Field, Input, PageHeader, Select, Spinner, cx } from './ui';

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
    ],
  },
];

/** The superadmin's menu: oversight of the whole system, not any one academic year. */
const SUPERADMIN_NAV: { label?: string; items: NavItem[] }[] = [
  {
    label: 'Superadmin',
    items: [
      { to: '/admin/activity', label: 'Activity', icon: Activity },
      { to: '/admin/advisers', label: 'Advisers', icon: UserCog },
      { to: '/admin/organization', label: 'Organization', icon: Building2 },
      { to: '/admin/logs', label: 'System log', icon: ScrollText },
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
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Avatar name={me.user.name} url={me.user.avatarUrl} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{me.user.name}</p>
              <p className="truncate text-xs text-slate-500">{position ?? me.user.email}</p>
            </div>
          </div>
          <div className="p-1">
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

  const isSuperadmin = Boolean(me?.user.isSuperadmin);
  const groups = [
    ...(isSuperadmin ? SUPERADMIN_NAV : []),
    ...NAV.map((g) => ({ ...g, items: isActiveMember ? g.items.filter((i) => !i.permission || can(i.permission)) : [] })),
  ].filter((g) => g.items.length);
  const showPage = isActiveMember || ALWAYS_OPEN.includes(location.pathname) || (isSuperadmin && location.pathname.startsWith('/admin/'));
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
                  {to === '/requests' && toApprove > 0 && (
                    <span className="min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white" aria-label={`${toApprove} to approve`}>
                      {toApprove}
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
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto">{navigation}</div>
    </>
  );

  return (
    <div className="min-h-dvh md:pl-64 print:pl-0">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white p-4 md:flex">{sidebar}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white p-4 shadow-xl">
            <button type="button" onClick={() => setDrawerOpen(false)} className="absolute right-3 top-4 rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
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
        {me?.user.mustChangePassword ? (
          <ChangePasswordRequired />
        ) : isSuperadmin && !isActiveMember && location.pathname === '/' ? (
          <Navigate to="/admin/activity" replace />
        ) : needsTwoFactor ? (
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

/** The superadmin gave this account a starting password: nothing else opens until it's replaced. */
function ChangePasswordRequired() {
  const { refreshMe } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setError('The new passwords don’t match.');
    setBusy(true);
    setError('');
    try {
      await api('/me/password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      await refreshMe();
      toast('Your password is set. Welcome!');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Set your own password" description="You were given a starting password. Choose your own before you continue." />
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Field label="Starting password" htmlFor="cp-current">
          <Input id="cp-current" type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} required />
        </Field>
        <Field label="New password" htmlFor="cp-new">
          <Input id="cp-new" type="password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} required />
        </Field>
        <Field label="New password again" htmlFor="cp-confirm">
          <Input id="cp-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        </Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" loading={busy}>
          Save password
        </Button>
      </form>
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
