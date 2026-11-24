import { useState, type ChangeEvent } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { GraduationCap, ScrollText, Users } from 'lucide-react';
import { Alert, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import type { ActivityEntry } from '../lib/types';
import { Pager } from './admin/SystemLogPage';

const PAGE_SIZE = 25;

/** The adviser's log: who changed which student or staff record, in plain words. */
export function AuditLogPage() {
  const { ay } = useAuth();
  const [filters, setFilters] = useState({ kind: '', q: '', from: '', to: '' });
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.kind) query.set('kind', filters.kind);
  if (filters.q) query.set('q', filters.q);
  if (filters.from) query.set('from', `${filters.from}T00:00:00+08:00`);
  if (filters.to) query.set('to', `${filters.to}T23:59:59.999+08:00`);

  const log = useQuery({
    queryKey: ['audit', ay?.id, query.toString()],
    queryFn: () => api<{ total: number; items: ActivityEntry[] }>(`/audit?${query}`),
    placeholderData: keepPreviousData,
  });
  const update = (key: keyof typeof filters) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };
  const totalPages = Math.max(1, Math.ceil((log.data?.total ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Activity log" />

      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Show" htmlFor="f-kind">
          <Select id="f-kind" value={filters.kind} onChange={update('kind')}>
            <option value="">Students and staff</option>
            <option value="student">Students only</option>
            <option value="staff">Staff only</option>
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
          <EmptyState icon={ScrollText} title="Nothing yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {log.data?.items.map((e) => {
              const Icon = e.kind === 'student' ? GraduationCap : Users;
              return (
                <li key={e.id} className="flex gap-3 px-4 py-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{e.summary}</p>
                    {e.details.length > 0 && (
                      <ul className="mt-0.5 space-y-0.5 text-sm text-slate-600">
                        {e.details.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {e.actorName}
                      {e.actorDesignation && ` (${e.actorDesignation})`} · {formatDateTime(e.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Pager page={page} totalPages={totalPages} total={log.data?.total ?? 0} pageSize={PAGE_SIZE} setPage={setPage} />
    </>
  );
}
