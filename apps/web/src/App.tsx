import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Link, Navigate, RouterProvider, useLocation } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import type { Permission } from '@sft/shared';
import { AppShell } from './components/AppShell';
import { Card, EmptyState, FullPageSpinner, Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/Login';

/** Pages load when first opened, so the first visit (often a student scanning a QR) downloads little. */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  const Lazy = lazy<ComponentType>(async () => ({ default: (await load())[name] }));
  return function Page() {
    return (
      <Suspense
        fallback={
          <div className="grid min-h-[50vh] place-items-center">
            <Spinner />
          </div>
        }
      >
        <Lazy />
      </Suspense>
    );
  };
}

const AcademicYearsPage = page(() => import('./pages/AcademicYears'), 'AcademicYearsPage');
const AuditLogPage = page(() => import('./pages/AuditLog'), 'AuditLogPage');
const CollectionPage = page(() => import('./pages/CollectionPage'), 'CollectionPage');
const SignInActivityPage = page(() => import('./pages/SignInActivity'), 'SignInActivityPage');
const DashboardPage = page(() => import('./pages/Dashboard'), 'DashboardPage');
const EnrollPage = page(() => import('./pages/Enroll'), 'EnrollPage');
const FundDetailPage = page(() => import('./pages/funds/FundDetailPage'), 'FundDetailPage');
const FundsPage = page(() => import('./pages/funds/FundsPage'), 'FundsPage');
const ForgotPasswordPage = page(() => import('./pages/EmailLinks'), 'ForgotPasswordPage');
const ResetPasswordPage = page(() => import('./pages/EmailLinks'), 'ResetPasswordPage');
const VerifyEmailPage = page(() => import('./pages/EmailLinks'), 'VerifyEmailPage');
const NotificationsPage = page(() => import('./pages/Notifications'), 'NotificationsPage');
const ProfilePage = page(() => import('./pages/Profile'), 'ProfilePage');
const ReceiptPage = page(() => import('./pages/ReceiptPage'), 'ReceiptPage');
const HistoryPage = page(() => import('./pages/reports/HistoryPage'), 'HistoryPage');
const ReportPrintPage = page(() => import('./pages/reports/ReportPrintPage'), 'ReportPrintPage');
const ReportsPage = page(() => import('./pages/reports/ReportsPage'), 'ReportsPage');
const AttachmentViewerPage = page(() => import('./pages/requests/AttachmentViewerPage'), 'AttachmentViewerPage');
const LiquidationDetailPage = page(() => import('./pages/requests/RequestDetailPage'), 'LiquidationDetailPage');
const LiquidationsPage = page(() => import('./pages/requests/LiquidationsPage'), 'LiquidationsPage');
const ReimbursementsPage = page(() => import('./pages/requests/ReimbursementsPage'), 'ReimbursementsPage');
const NewRequestPage = page(() => import('./pages/requests/NewRequestPage'), 'NewRequestPage');
const RequestDetailPage = page(() => import('./pages/requests/RequestDetailPage'), 'RequestDetailPage');
const RequestsPage = page(() => import('./pages/requests/RequestsPage'), 'RequestsPage');
const ScanPage = page(() => import('./pages/Scan'), 'ScanPage');
const SettingsPage = page(() => import('./pages/settings/SettingsPage'), 'SettingsPage');
const SignupPage = page(() => import('./pages/Signup'), 'SignupPage');
const UsersPage = page(() => import('./pages/Users'), 'UsersPage');
const VerifyPage = page(() => import('./pages/VerifyPage'), 'VerifyPage');
const EnrollmentLinksPage = page(() => import('./pages/students/EnrollmentLinksPage'), 'EnrollmentLinksPage');
const ImportPage = page(() => import('./pages/students/ImportPage'), 'ImportPage');
const StudentProfilePage = page(() => import('./pages/students/StudentProfilePage'), 'StudentProfilePage');
const StudentsPage = page(() => import('./pages/students/StudentsPage'), 'StudentsPage');

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (me) return <Navigate to="/" replace />;
  return children;
}

/** The UI hides what you can't use; the API enforces it regardless. */
function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" body={permission === 'manage' ? 'Only the adviser can open it.' : 'Your position doesn’t include this. Ask the adviser if you need it.'} />
      </Card>
    );
  }
  return children;
}

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <div className="text-center">
        <p className="text-sm font-medium text-brand-700">404</p>
        <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
        <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Go home
        </Link>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <GuestOnly><LoginPage /></GuestOnly> },
  { path: '/signup', element: <GuestOnly><SignupPage /></GuestOnly> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/scan', element: <ScanPage /> },
  { path: '/enroll/:token', element: <EnrollPage /> },
  { path: '/verify/:token', element: <VerifyPage /> },
  { path: '/requests/:id/files/:set', element: <RequireAuth><AttachmentViewerPage /></RequireAuth> },
  { path: '/print/report/:kind', element: <RequireAuth><ReportPrintPage /></RequireAuth> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'collection', element: <RequirePermission permission="collect"><CollectionPage /></RequirePermission> },
      { path: 'receipts/:id', element: <RequirePermission permission="collect"><ReceiptPage /></RequirePermission> },
      { path: 'requests', element: <RequestsPage /> },
      { path: 'requests/new', element: <RequirePermission permission="file_requests"><NewRequestPage /></RequirePermission> },
      { path: 'requests/:id', element: <RequestDetailPage /> },
      { path: 'liquidations', element: <LiquidationsPage /> },
      { path: 'liquidations/:id', element: <LiquidationDetailPage /> },
      { path: 'reimbursements', element: <ReimbursementsPage /> },
      { path: 'funds', element: <RequirePermission permission="view_funds"><FundsPage /></RequirePermission> },
      { path: 'funds/:id', element: <RequirePermission permission="view_funds"><FundDetailPage /></RequirePermission> },
      { path: 'students', element: <RequirePermission permission="collect"><StudentsPage /></RequirePermission> },
      { path: 'students/import', element: <RequirePermission permission="collect"><ImportPage /></RequirePermission> },
      { path: 'students/enrollment', element: <RequirePermission permission="collect"><EnrollmentLinksPage /></RequirePermission> },
      { path: 'students/:id', element: <RequirePermission permission="collect"><StudentProfilePage /></RequirePermission> },
      { path: 'users', element: <RequirePermission permission="manage"><UsersPage /></RequirePermission> },
      { path: 'academic-years', element: <RequirePermission permission="manage"><AcademicYearsPage /></RequirePermission> },
      { path: 'settings', element: <RequirePermission permission="manage"><SettingsPage /></RequirePermission> },
      { path: 'audit', element: <RequirePermission permission="manage"><AuditLogPage /></RequirePermission> },
      { path: 'activity', element: <RequirePermission permission="manage"><SignInActivityPage /></RequirePermission> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'profile', element: <ProfilePage /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
