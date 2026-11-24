import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Archive, FilePlus2, Inbox, Lock } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner, cx } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney } from '../../lib/format';
import type { FundRequestRow, FundRequestStatus } from '../../lib/types';

export const REQUEST_STATUS_TONE: Record<FundRequestStatus, 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'brand'> = {
  pending: 'amber',
  approved: 'blue',
  rejected: 'red',
  receipt_submitted: 'brand',
  settlement_due: 'amber',
  revision_requested: 'amber',
  cleared: 'green',
  canceled: 'gray',
};

/** How many requests and receipts wait for this user's decision (the tab badge and the menu). */
export function useRequestCounts() {
  const { ay, isActiveMember } = useAuth();
  return useQuery({
    queryKey: ['fund-requests', ay?.id, 'counts'],
    queryFn: () => api<{ toApprove: number }>('/fund-requests/counts', { background: true }),
    refetchInterval: 60_000,
    enabled: Boolean(ay) && isActiveMember,
  });
}

export function RequestsPage() {
  const { ay, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const toApprove = useRequestCounts().data?.toApprove ?? 0;
  const tabs = [
    ...(can('file_requests') ? [{ key: 'mine', label: 'My requests', count: 0 }] : []),
    { key: 'inbox', label: 'To approve', count: toApprove },
    ...(can('manage') ? [{ key: 'all', label: 'All requests', count: 0 }] : []),
    ...(can('file_requests') || can('manage') ? [{ key: 'archived', label: 'Archived', count: 0 }] : []),
  ];
  const scope = tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0]!.key;
  const list = useQuery({
    queryKey: ['fund-requests', ay?.id, scope],
    queryFn: () => api<{ items: FundRequestRow[] }>(`/fund-requests?scope=${scope}`),
  });

  return (
    <>
      <PageHeader
        title="Fund requests"
        
        actions={
          can('file_requests') &&
          ay?.status === 'open' && (
            <Link to="/requests/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
              <FilePlus2 className="size-4" aria-hidden /> New request
            </Link>
          )
        }
      />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={scope === t.key}
            onClick={() => setParams({ tab: t.key })}
            className={cx(
              'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
              scope === t.key ? 'bg-white shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white" aria-label={`${t.count} waiting`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <Card>
        {list.isLoading ? (
          <div className="p-8 text-center">
            <Spinner />
          </div>
        ) : list.error ? (
          <div className="p-4">
            <Alert>{describeError(list.error)}</Alert>
          </div>
        ) : !list.data?.items.length ? (
          <EmptyState
            icon={scope === 'archived' ? Archive : Inbox}
            title={scope === 'inbox' ? 'Nothing waiting for you' : scope === 'archived' ? 'No archived requests' : 'No requests yet'}
            body={
              scope === 'inbox'
                ? 'Requests and receipts that need your approval appear here.'
                : scope === 'archived'
                  ? 'Cleared, rejected or canceled requests that were archived appear here.'
                  : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data.items.map((r) => (
              <li key={r.id}>
                <Link to={`/requests/${r.id}`} className="grid gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">{r.requestNo}</span>
                      <span className="font-medium">{r.fundName}</span>
                      {r.isConfidential && <Lock className="size-3.5 text-slate-400" aria-label="Confidential" />}
                      <Badge tone={REQUEST_STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
                      {r.needsMyAction && <Badge tone="red">Needs your decision</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-600">{r.purpose}</p>
                    <p className="text-xs text-slate-500">
                      {r.requestorName} ({r.requestorDesignation}) · filed {formatDate(r.submittedAt)} · use on {formatDate(r.useAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{formatMoney(r.amount)}</p>
                    {r.fundUsed !== null && <p className="text-xs text-slate-500">used {formatMoney(r.fundUsed)}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
