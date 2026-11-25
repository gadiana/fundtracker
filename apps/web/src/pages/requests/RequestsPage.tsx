import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Archive, FilePlus2, Inbox, Lock, type LucideIcon } from 'lucide-react';
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

/** How many requests and liquidations wait for this user (the tab badges and the menu). */
export function useRequestCounts() {
  const { ay, isActiveMember } = useAuth();
  return useQuery({
    queryKey: ['fund-requests', ay?.id, 'counts'],
    queryFn: () =>
      api<{ toApprove: number; requests: number; liquidations: number; reimbursements: number; toLiquidate: number }>('/fund-requests/counts', { background: true }),
    refetchInterval: 60_000,
    enabled: Boolean(ay) && isActiveMember,
  });
}

export function RequestsPage() {
  const { ay, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const toApprove = useRequestCounts().data?.requests ?? 0;
  const tabs = [
    ...(can('file_requests') ? [{ key: 'mine', label: 'My requests', count: 0 }] : []),
    { key: 'inbox', label: 'To approve', count: toApprove },
    ...(can('manage') ? [{ key: 'all', label: 'All requests', count: 0 }] : []),
    ...(can('file_requests') || can('manage') ? [{ key: 'archived', label: 'Archived', count: 0 }] : []),
  ];
  const scope = tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0]!.key;
  // receipts waiting for review are on the Liquidations page
  const list = useQuery({
    queryKey: ['fund-requests', ay?.id, scope],
    queryFn: () => api<{ items: FundRequestRow[] }>(`/fund-requests?scope=${scope}${scope === 'inbox' ? '&stage=request' : ''}`),
  });

  return (
    <>
      <PageHeader
        title="Fund requests"
        actions={
          can('file_requests') &&
          ay?.status === 'open' && (
            <Link to="/requests/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
              <FilePlus2 className="size-4" aria-hidden /> Request funds
            </Link>
          )
        }
      />
      <Tabs tabs={tabs} current={scope} onChange={(tab) => setParams({ tab })} />
      <RequestList
        list={list}
        to={(r) => `/requests/${r.id}`}
        emptyIcon={scope === 'archived' ? Archive : Inbox}
        emptyTitle={scope === 'inbox' ? 'Nothing waiting for you' : scope === 'archived' ? 'No archived requests' : 'No requests yet'}
        emptyBody={
          scope === 'inbox'
            ? 'Requests that need your approval appear here. Receipts to review are under Liquidations.'
            : scope === 'archived'
              ? 'Cleared, rejected or canceled requests that were archived appear here.'
              : undefined
        }
      />
    </>
  );
}

export function Tabs({ tabs, current, onChange }: { tabs: { key: string; label: string; count: number }[]; current: string; onChange: (key: string) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={current === t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
            current === t.key ? 'bg-surface shadow-sm' : 'text-slate-600 hover:text-slate-900',
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
  );
}

export function RequestList({
  list,
  to,
  emptyIcon,
  emptyTitle,
  emptyBody,
  hint,
  action,
}: {
  list: { isLoading: boolean; error: unknown; data?: { items: FundRequestRow[] } };
  to: (r: FundRequestRow) => string;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyBody?: string;
  /** an extra badge for a row, e.g. that it still needs a liquidation */
  hint?: (r: FundRequestRow) => string | { text: string; tone: 'amber' | 'green' } | null;
  /** a button beside the row, e.g. "Mark as reimbursed" */
  action?: (r: FundRequestRow) => ReactNode;
}) {
  const badge = (r: FundRequestRow) => {
    const h = hint?.(r);
    if (!h) return null;
    const { text, tone } = typeof h === 'string' ? { text: h, tone: 'amber' as const } : h;
    return <Badge tone={tone}>{text}</Badge>;
  };
  return (
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
        <EmptyState icon={emptyIcon} title={emptyTitle} body={emptyBody} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.data.items.map((r) => (
            <li key={r.id} className="flex flex-col sm:flex-row sm:items-center">
              <Link to={to(r)} className="grid min-w-0 flex-1 gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{r.requestNo}</span>
                    <span className="font-medium">{r.fundName}</span>
                    {r.isConfidential && <Lock className="size-3.5 text-slate-400" aria-label="Confidential" />}
                    <Badge tone={REQUEST_STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
                    {r.needsMyAction && <Badge tone="red">Needs your decision</Badge>}
                    {badge(r)}
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
              {action?.(r) && <div className="px-4 pb-3 sm:py-3 sm:pl-0">{action(r)}</div>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
