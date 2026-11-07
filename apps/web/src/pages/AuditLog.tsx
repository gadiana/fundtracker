import { useState, type ChangeEvent } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ChevronDown, ScrollText } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, humanize } from '../lib/format';
import type { AuditEntry } from '../lib/types';

const PAGE_SIZE = 25;

const ACTION_TONE: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'gray'> = {
  approve: 'green',
  reactivate: 'green',
  reject: 'red',
  delete: 'red',
  void: 'red',
  deactivate: 'amber',
  cancel: 'amber',
  login_failed: 'amber',
  settings_change: 'blue',
};

export function AuditLogPage() {
  const { ay } = useAuth();
  const [filters, setFilters] = useState({ action: '', entityType: '', q: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const options = useQuery({
    queryKey: ['audit', ay?.id, 'filters'],
    queryFn: () => api<{ actions: string[]; entityTypes: string[] }>('/audit/filters'),
  });

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.action) query.set('action', filters.action);
  if (filters.entityType) query.set('entityType', filters.entityType);
  if (filters.q) query.set('q', filters.q);
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

  return (
    <>
      <PageHeader title="Audit log" description={`Every create, update, approval, rejection, void, delete and settings change in AY ${ay?.label}.`} />

      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Action" htmlFor="f-action">
          <Select id="f-action" value={filters.action} onChange={update('action')}>
            <option value="">All actions</option>
            {options.data?.actions.map((a) => (
              <option key={a} value={a}>
                {humanize(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Record type" htmlFor="f-entity">
          <Select id="f-entity" value={filters.entityType} onChange={update('entityType')}>
            <option value="">All types</option>
            {options.data?.entityTypes.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
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
          <EmptyState icon={ScrollText} title="No matching entries" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {log.data?.items.map((entry) => {
              const isOpen = expanded === entry.id;
              const hasData = entry.before != null || entry.after != null;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
                    onClick={() => setExpanded(isOpen ? null : entry.id)}
                    disabled={!hasData}
                    aria-expanded={hasData ? isOpen : undefined}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={ACTION_TONE[entry.action] ?? 'gray'}>{humanize(entry.action)}</Badge>
                        <span className="text-sm text-slate-700">{humanize(entry.entityType)}</span>
                        {(entry.after as { selfApproved?: boolean } | null)?.selfApproved && <Badge tone="amber">Self-approved</Badge>}
                      </div>
                      <p className="mt-1 text-sm">
                        <span className="font-medium text-slate-900">{entry.actorName}</span>
                        {entry.actorDesignation && <span className="text-slate-500"> · {entry.actorDesignation}</span>}
                      </p>
                      <p className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</p>
                    </div>
                    {hasData && <ChevronDown className={cx('mt-1 size-4 shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')} aria-hidden />}
                  </button>
                  {isOpen && (
                    <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
                      <JsonBlock label="Before" value={entry.before} />
                      <JsonBlock label="After" value={entry.after} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {log.data && log.data.total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page} of {totalPages} · {log.data.total} entries
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
      )}
    </>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-slate-200">
        {value == null ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
