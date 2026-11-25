import { useState, type ChangeEvent } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, humanize } from '../lib/format';
import { useAuth } from '../lib/auth';
import type { AuditEntry } from '../lib/types';

const PAGE_SIZE = 25;

const ACTION_TONE: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'gray'> = {
  create: 'blue',
  approve: 'green',
  reactivate: 'green',
  reject: 'red',
  delete: 'red',
  void: 'red',
  deactivate: 'amber',
  cancel: 'amber',
  login_failed: 'amber',
};

/** Plain names for the filters. */
const ACTION_LABEL: Record<string, string> = {
  create: 'Added',
  update: 'Edited',
  delete: 'Removed',
  approve: 'Approved',
  reject: 'Rejected',
  deactivate: 'Deactivated',
  reactivate: 'Reactivated',
  void: 'Voided',
  cancel: 'Canceled',
  archive: 'Archived',
  unarchive: 'Unarchived',
  login: 'Signed in',
  login_failed: 'Failed sign-in',
  logout: 'Signed out',
  signup: 'Signed up',
  settings_change: 'Changed settings',
  request_access: 'Asked to join',
  password_change: 'Changed password',
  password_reset: 'Reset password',
  verify_email: 'Confirmed email',
};

const TYPE_LABEL: Record<string, string> = {
  user: 'Accounts and sign-ins',
  user_session: 'Sign-in safety',
  user_ay_role: 'Staff access',
  two_factor: 'Two-factor sign-in',
  approver: 'Approvers',
  program: 'Programs',
  section: 'Sections',
  designation: 'Positions',
  designation_order: 'Position order',
  settings: 'Settings',
  academic_year: 'Academic years',
  ay_setup: 'Year setup',
  student: 'Students',
  student_import: 'Student imports',
  enrollment_link: 'Enrollment links',
  fund: 'Funds',
  fund_priority: 'Fund order',
  fund_adjustment: 'Fund adjustments',
  payment: 'Payments',
  receipt_email: 'Emailed receipts',
  email_retry: 'Emails sent again',
  fund_request: 'Fund requests',
  liquidation_receipt: 'Liquidations',
};

const actionLabel = (a: string) => ACTION_LABEL[a] ?? humanize(a);
const typeLabel = (t: string) => TYPE_LABEL[t] ?? humanize(t);

/** Adviser: everything that happened in the academic year, each as a plain sentence. */
export function AuditLogPage() {
  const { ay } = useAuth();
  const [filters, setFilters] = useState({ action: '', entityType: '', q: '', from: '', to: '' });
  const [page, setPage] = useState(1);

  const options = useQuery({ queryKey: ['audit', ay?.id, 'filters'], queryFn: () => api<{ actions: string[]; entityTypes: string[] }>('/audit/filters') });

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  for (const k of ['action', 'entityType', 'q'] as const) if (filters[k]) query.set(k, filters[k]);
  // dates are inclusive whole days in Philippine time
  if (filters.from) query.set('from', `${filters.from}T00:00:00+08:00`);
  if (filters.to) query.set('to', `${filters.to}T23:59:59.999+08:00`);

  const log = useQuery({
    queryKey: ['audit', ay?.id, query.toString()],
    queryFn: () => api<{ total: number; items: AuditEntry[] }>(`/audit?${query}`),
    placeholderData: keepPreviousData,
  });

  const update = (key: keyof typeof filters) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };
  const totalPages = Math.max(1, Math.ceil((log.data?.total ?? 0) / PAGE_SIZE));
  const byLabel = (label: (v: string) => string) => (a: string, b: string) => label(a).localeCompare(label(b));

  return (
    <>
      <PageHeader title="Activity log" description="Everything done in this academic year, newest first." />

      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="What was done" htmlFor="f-action">
          <Select id="f-action" value={filters.action} onChange={update('action')}>
            <option value="">Everything</option>
            {[...(options.data?.actions ?? [])].sort(byLabel(actionLabel)).map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="About" htmlFor="f-entity">
          <Select id="f-entity" value={filters.entityType} onChange={update('entityType')}>
            <option value="">Anything</option>
            {[...(options.data?.entityTypes ?? [])].sort(byLabel(typeLabel)).map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Done by" htmlFor="f-q">
          <Input id="f-q" placeholder="Name" value={filters.q} onChange={update('q')} />
        </Field>
        <Field label="From" htmlFor="f-from">
          <Input id="f-from" type="date" value={filters.from} onChange={update('from')} />
        </Field>
        <Field label="To" htmlFor="f-to">
          <Input id="f-to" type="date" value={filters.to} onChange={update('to')} />
        </Field>
      </Card>

      <Card>
        {log.isLoading ? (
          <div className="p-8 text-center">
            <Spinner />
          </div>
        ) : log.error ? (
          <div className="p-4">
            <Alert>{errorMessage(log.error)}</Alert>
          </div>
        ) : log.data?.items.length === 0 ? (
          <EmptyState icon={ScrollText} title="Nothing found" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {log.data?.items.map((entry) => (
              <li key={entry.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <p className="min-w-0 flex-1 text-sm font-medium text-slate-900">{entry.summary}</p>
                  <Badge tone={ACTION_TONE[entry.action] ?? 'gray'}>{typeLabel(entry.entityType)}</Badge>
                </div>
                {entry.details.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 border-l-2 border-slate-200 pl-3 text-sm text-slate-600">
                    {entry.details.map((d, i) => (
                      <li key={i} className="break-words">
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-xs text-slate-500">
                  {formatDateTime(entry.createdAt)}
                  {entry.actorDesignation && ` · ${entry.actorDesignation}`}
                  {entry.device && ` · ${entry.device}`}
                  {entry.ipAddress && <span title="Internet address the change came from"> · {entry.ipAddress}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Pager page={page} totalPages={totalPages} total={log.data?.total ?? 0} pageSize={PAGE_SIZE} setPage={setPage} />
    </>
  );
}

export function Pager({ page, totalPages, total, pageSize, setPage }: { page: number; totalPages: number; total: number; pageSize: number; setPage: (fn: (p: number) => number) => void }) {
  if (total <= pageSize) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>
        Page {page} of {totalPages} · {total} entries
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
