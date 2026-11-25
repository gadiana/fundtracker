import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  CheckCheck,
  FileCheck,
  Globe,
  GraduationCap,
  Mail,
  Paperclip,
  Printer,
  QrCode,
  Receipt,
  Shield,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Alert, PageHeader, Select, Spinner, cx } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import type { Settings } from '../../lib/types';
import { ReadOnlyContext } from './form';
import { EmailNotificationsSection } from './notifications';
import {
  ApprovalsSection,
  CollectionSection,
  FilesSection,
  FundUsageSection,
  LocaleSection,
  PositionsSection,
  PrivacySection,
  PublicPageSection,
  ReceiptsSection,
  ReportsSection,
  SecuritySection,
  StructureSection,
} from './sections';

const SECTIONS = [
  { id: 'structure', label: 'Year levels, programs & sections', icon: GraduationCap, Component: StructureSection },
  { id: 'positions', label: 'Positions & permissions', icon: BadgeCheck, Component: PositionsSection },
  { id: 'collection', label: 'Collection', icon: Wallet, Component: CollectionSection },
  { id: 'approvals', label: 'Approvals', icon: CheckCheck, Component: ApprovalsSection },
  { id: 'receipts', label: 'Receipts', icon: Receipt, Component: ReceiptsSection },
  { id: 'fund-usage', label: 'Fund usage', icon: FileCheck, Component: FundUsageSection },
  { id: 'public-page', label: 'Public QR page', icon: QrCode, Component: PublicPageSection },
  { id: 'reports', label: 'Reports', icon: Printer, Component: ReportsSection },
  { id: 'email', label: 'Email & notifications', icon: Mail, Component: EmailNotificationsSection },
  { id: 'security', label: 'Security', icon: Shield, Component: SecuritySection },
  { id: 'files', label: 'Files', icon: Paperclip, Component: FilesSection },
  { id: 'locale', label: 'Locale', icon: Globe, Component: LocaleSection },
  { id: 'privacy', label: 'Data privacy', icon: ShieldCheck, Component: PrivacySection },
] as const;

export function SettingsPage() {
  const { ay } = useAuth();
  const [params, setParams] = useSearchParams();
  const active = SECTIONS.find((s) => s.id === params.get('section')) ?? SECTIONS[0];
  const settings = useQuery({ queryKey: ['settings', ay?.id], queryFn: () => api<Settings>('/settings') });
  const readOnly = ay?.status === 'closed';
  const go = (id: string) => setParams({ section: id });

  return (
    <ReadOnlyContext.Provider value={readOnly}>
      <PageHeader
        title="Settings"
        description={
          <>
            For AY {ay?.label} only. Every change is recorded.
            {settings.data?.updatedByName && (
              <span className="text-slate-400">
                {' '}
                Last changed by {settings.data.updatedByName}, {formatDateTime(settings.data.updatedAt)}.
              </span>
            )}
          </>
        }
      />

      {readOnly && (
        <Alert tone="warning" className="mb-4">
          AY {ay?.label} is closed, so its settings are read-only.
        </Alert>
      )}

      <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-6">
        <label className="mb-4 block lg:hidden">
          <span className="sr-only">Settings section</span>
          <Select value={active.id} onChange={(e) => go(e.target.value)}>
            {SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <nav className="hidden lg:block" aria-label="Settings sections">
          <ul className="sticky top-20 space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => go(id)}
                  aria-current={active.id === id ? 'page' : undefined}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm',
                    active.id === id ? 'bg-surface font-medium text-brand-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-surface/70',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          {settings.isLoading ? (
            <div className="py-10 text-center">
              <Spinner />
            </div>
          ) : settings.error ? (
            <Alert>{errorMessage(settings.error)}</Alert>
          ) : settings.data ? (
            <active.Component settings={settings.data} />
          ) : null}
        </div>
      </div>
    </ReadOnlyContext.Provider>
  );
}
