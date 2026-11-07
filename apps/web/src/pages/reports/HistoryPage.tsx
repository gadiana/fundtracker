import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History, Printer, Search, Sheet } from 'lucide-react';
import { FUND_REQUEST_STATUSES, FUND_REQUEST_STATUS_LABELS, type ReportDoc } from '@sft/shared';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, cx } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime, formatMoney, yearLevelLabel } from '../../lib/format';
import { downloadCsv } from '../../lib/report';
import { REQUEST_STATUS_TONE } from '../requests/RequestsPage';

export interface HistoryOptions {
  canSeeCollections: boolean;
  canSeeUsage: boolean;
  yearLevelCount: number;
  programs: { id: string; code: string }[];
  sections: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  funds: { id: string; name: string }[];
}

interface CollectionItem {
  id: string;
  transactionNo: string;
  receivedAt: string;
  studentName: string;
  studentNumber: string;
  courseYearSection: string;
  amount: number;
  balanceAfter: number;
  status: 'posted' | 'voided';
  processedByName: string;
  voidReason: string | null;
}

interface UsageItem {
  id: string;
  requestNo: string;
  requestorName: string;
  requestorDesignation: string;
  fundName: string;
  purpose: string;
  amount: number;
  fundUsed: number | null;
  submittedAt: string;
  useAt: string;
  approvedAt: string | null;
  approvedByName: string | null;
  receiptSubmittedAt: string | null;
  receiptApprovedAt: string | null;
  receiptApprovedByName: string | null;
  status: keyof typeof REQUEST_STATUS_TONE;
  statusLabel: string;
  archived: boolean;
}

const PAGE_SIZE = 50;

export function useHistoryOptions() {
  const { ay } = useAuth();
  return useQuery({ queryKey: ['history-options', ay?.id], queryFn: () => api<HistoryOptions>('/history/options') });
}

const FILTER_KEYS = {
  collections: ['from', 'to', 'q', 'programId', 'yearLevel', 'sectionId', 'status', 'processedById'],
  usage: ['from', 'to', 'q', 'fundId', 'status'],
} as const;

export function HistoryPage() {
  const options = useHistoryOptions();
  const [params, setParams] = useSearchParams();
  if (options.isLoading) {
    return (
      <div className="py-10 text-center">
        <Spinner />
      </div>
    );
  }
  if (options.error || !options.data) return <Alert>{describeError(options.error)}</Alert>;
  const o = options.data;
  const tabs = [...(o.canSeeCollections ? [{ key: 'collections', label: 'Collection history' }] : []), ...(o.canSeeUsage ? [{ key: 'usage', label: 'Use-of-fund history' }] : [])] as {
    key: 'collections' | 'usage';
    label: string;
  }[];
  if (tabs.length === 0) {
    return (
      <>
        <PageHeader title="Transaction history" />
        <Card>
          <EmptyState icon={History} title="Nothing here for your position" body="Collection history is for positions that collect payments; use-of-fund history is for the adviser, approvers and requestors." />
        </Card>
      </>
    );
  }
  const tab = tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0]!.key;

  return (
    <>
      <PageHeader title="Transaction history" description="Every payment and every use of funds in this academic year. Names are as they were at the time." />
      {tabs.length > 1 && (
        <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setParams({ tab: t.key })}
              className={cx('shrink-0 rounded-md px-3 py-1.5 text-sm font-medium', tab === t.key ? 'bg-white shadow-sm' : 'text-slate-600 hover:text-slate-900')}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {tab === 'collections' ? <CollectionHistory options={o} /> : <UsageHistory options={o} />}
    </>
  );
}

/** Filters live in the URL, so a filtered list can be shared or reopened. */
function useFilters(kind: keyof typeof FILTER_KEYS) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(FILTER_KEYS[kind].map((k) => [k, params.get(k) ?? ''])) as Record<string, string>;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };
  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };
  const query = new URLSearchParams(Object.entries(values).filter(([, v]) => v));
  return { values, set, page, setPage, query };
}

function ExportButtons({ kind, query }: { kind: 'collections' | 'fund-usage'; query: URLSearchParams }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`/print/report/${kind}?${query}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50"
      >
        <Printer className="size-4" aria-hidden /> Print / PDF
      </a>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            downloadCsv(await api<ReportDoc>(`/reports/${kind}?${query}`));
          } catch (err) {
            setError(describeError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Sheet className="size-4" aria-hidden /> Export CSV
      </Button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </div>
  );
}

function FilterBar({ children }: { children: ReactNode }) {
  return <Card className="mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">{children}</Card>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  return (
    <form
      className="relative sm:col-span-2"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(draft.trim());
      }}
    >
      <span className="sr-only">Search</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <Input className="pl-9" placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft.trim() !== value && onChange(draft.trim())} />
    </form>
  );
}

function DateRange({ from, to, set }: { from: string; to: string; set: (k: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:col-span-2">
      <label className="text-xs text-slate-500">
        From
        <Input type="date" value={from} max={to || undefined} onChange={(e) => set('from', e.target.value)} />
      </label>
      <label className="text-xs text-slate-500">
        To
        <Input type="date" value={to} min={from || undefined} onChange={(e) => set('to', e.target.value)} />
      </label>
    </div>
  );
}

function Pager({ page, total, setPage }: { page: number; total: number; setPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        Newer
      </Button>
      <span className="text-slate-500">
        Page {page} of {pages} · {total.toLocaleString()} rows
      </span>
      <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
        Older
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CollectionHistory({ options: o }: { options: HistoryOptions }) {
  const { ay } = useAuth();
  const f = useFilters('collections');
  const list = useQuery({
    queryKey: ['history', ay?.id, 'collections', f.query.toString(), f.page],
    queryFn: () =>
      api<{ total: number; totals: { postedCount: number; posted: number; voidedCount: number; voided: number }; items: CollectionItem[] }>(
        `/history/collections?${f.query}&page=${f.page}&pageSize=${PAGE_SIZE}`,
      ),
    placeholderData: keepPreviousData,
  });
  const v = f.values;
  return (
    <>
      <FilterBar>
        <SearchBox value={v.q!} onChange={(x) => f.set('q', x)} placeholder="Transaction no., student name or number" />
        <DateRange from={v.from!} to={v.to!} set={f.set} />
        <Select aria-label="Program" value={v.programId} onChange={(e) => f.set('programId', e.target.value)}>
          <option value="">All programs</option>
          {o.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code}
            </option>
          ))}
        </Select>
        <Select aria-label="Year level" value={v.yearLevel} onChange={(e) => f.set('yearLevel', e.target.value)}>
          <option value="">All years</option>
          {Array.from({ length: o.yearLevelCount }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {yearLevelLabel(n)}
            </option>
          ))}
        </Select>
        <Select aria-label="Section" value={v.sectionId} onChange={(e) => f.set('sectionId', e.target.value)}>
          <option value="">All sections</option>
          {o.sections.map((s) => (
            <option key={s.id} value={s.id}>
              Section {s.name}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Select aria-label="Status" value={v.status} onChange={(e) => f.set('status', e.target.value)}>
            <option value="">Posted and voided</option>
            <option value="posted">Posted</option>
            <option value="voided">Voided</option>
          </Select>
          <Select aria-label="Processed by" value={v.processedById} onChange={(e) => f.set('processedById', e.target.value)}>
            <option value="">All staff</option>
            {o.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        {list.data && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Collected (posted)" value={formatMoney(list.data.totals.posted)} />
            <Stat label="Payments" value={String(list.data.totals.postedCount)} />
            <Stat label="Voided" value={String(list.data.totals.voidedCount)} />
            <Stat label="Voided amount" value={formatMoney(list.data.totals.voided)} />
          </div>
        )}
        <ExportButtons kind="collections" query={f.query} />
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
          <EmptyState icon={History} title="No payments match" />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Transaction no.</th>
                  <th className="px-2 py-2 font-medium">Date and time</th>
                  <th className="px-2 py-2 font-medium">Student</th>
                  <th className="px-2 py-2 font-medium">Course/yr/sec</th>
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                  <th className="px-2 py-2 text-right font-medium">Balance after</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Processed by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data.items.map((p) => (
                  <tr key={p.id} className={cx('hover:bg-slate-50', p.status === 'voided' && 'text-slate-400')}>
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link to={`/receipts/${p.id}`} className="text-brand-700 hover:underline">
                        {p.transactionNo}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{formatDateTime(p.receivedAt)}</td>
                    <td className="px-2 py-2">
                      {p.studentName}
                      <span className="block text-xs text-slate-500">{p.studentNumber}</span>
                    </td>
                    <td className="px-2 py-2">{p.courseYearSection}</td>
                    <td className={cx('px-2 py-2 text-right tabular-nums', p.status === 'voided' && 'line-through')}>{formatMoney(p.amount)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatMoney(p.balanceAfter)}</td>
                    <td className="px-2 py-2">
                      {p.status === 'voided' ? (
                        <Badge tone="red">
                          <span title={p.voidReason ?? undefined}>Voided</span>
                        </Badge>
                      ) : (
                        <Badge tone="green">Posted</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">{p.processedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 md:hidden">
              {list.data.items.map((p) => (
                <li key={p.id}>
                  <Link to={`/receipts/${p.id}`} className="block px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-500">{p.transactionNo}</span>
                      <span className={cx('font-semibold tabular-nums', p.status === 'voided' && 'text-slate-400 line-through')}>{formatMoney(p.amount)}</span>
                    </div>
                    <p className="text-sm font-medium">{p.studentName}</p>
                    <p className="text-xs text-slate-500">
                      {p.courseYearSection} · {formatDateTime(p.receivedAt)} · by {p.processedByName}
                    </p>
                    <p className="text-xs text-slate-500">
                      Balance after {formatMoney(p.balanceAfter)} {p.status === 'voided' && <Badge tone="red">Voided</Badge>}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            <Pager page={f.page} total={list.data.total} setPage={f.setPage} />
          </>
        )}
      </Card>
    </>
  );
}

function UsageHistory({ options: o }: { options: HistoryOptions }) {
  const { ay } = useAuth();
  const f = useFilters('usage');
  const list = useQuery({
    queryKey: ['history', ay?.id, 'usage', f.query.toString(), f.page],
    queryFn: () =>
      api<{ total: number; ownOnly: boolean; totals: { count: number; approved: number; used: number; reserved: number }; items: UsageItem[] }>(
        `/history/fund-usage?${f.query}&page=${f.page}&pageSize=${PAGE_SIZE}`,
      ),
    placeholderData: keepPreviousData,
  });
  const v = f.values;
  const when = (at: string | null, by?: string | null) =>
    at ? (
      <>
        {formatDateTime(at)}
        {by && <span className="block text-xs text-slate-500">{by}</span>}
      </>
    ) : (
      <span className="text-slate-400">—</span>
    );
  return (
    <>
      <FilterBar>
        <SearchBox value={v.q!} onChange={(x) => f.set('q', x)} placeholder="Request no., requestor or purpose" />
        <DateRange from={v.from!} to={v.to!} set={f.set} />
        <Select aria-label="Fund" value={v.fundId} onChange={(e) => f.set('fundId', e.target.value)}>
          <option value="">All funds</option>
          {o.funds.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={v.status} onChange={(e) => f.set('status', e.target.value)}>
          <option value="">All statuses</option>
          {FUND_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FUND_REQUEST_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </FilterBar>

      {list.data?.ownOnly && (
        <Alert tone="info" className="mb-4">
          You see your own requests. The adviser and approvers see everyone’s.
        </Alert>
      )}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        {list.data && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Requests" value={String(list.data.totals.count)} />
            <Stat label="Approved amount" value={formatMoney(list.data.totals.approved)} />
            <Stat label="Used (cleared)" value={formatMoney(list.data.totals.used)} />
            <Stat label="Reserved" value={formatMoney(list.data.totals.reserved)} />
          </div>
        )}
        <ExportButtons kind="fund-usage" query={f.query} />
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
          <EmptyState icon={History} title="No requests match" />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Request</th>
                    <th className="px-2 py-2 font-medium">Requestor</th>
                    <th className="px-2 py-2 text-right font-medium">Amount / used</th>
                    <th className="px-2 py-2 font-medium">Filed</th>
                    <th className="px-2 py-2 font-medium">Date of use</th>
                    <th className="px-2 py-2 font-medium">Approved</th>
                    <th className="px-2 py-2 font-medium">Receipt submitted</th>
                    <th className="px-2 py-2 font-medium">Receipt approved</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {list.data.items.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <Link to={`/requests/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">
                          {r.requestNo}
                        </Link>
                        <span className="block font-medium">{r.fundName}</span>
                        <span className="block max-w-56 truncate text-xs text-slate-500">{r.purpose}</span>
                      </td>
                      <td className="px-2 py-2">
                        {r.requestorName}
                        <span className="block text-xs text-slate-500">{r.requestorDesignation}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                        {formatMoney(r.amount)}
                        {r.fundUsed !== null && <span className="block text-xs text-slate-500">used {formatMoney(r.fundUsed)}</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">{formatDateTime(r.submittedAt)}</td>
                      <td className="whitespace-nowrap px-2 py-2">{formatDate(r.useAt)}</td>
                      <td className="whitespace-nowrap px-2 py-2">{when(r.approvedAt, r.approvedByName)}</td>
                      <td className="whitespace-nowrap px-2 py-2">{when(r.receiptSubmittedAt)}</td>
                      <td className="whitespace-nowrap px-2 py-2">{when(r.receiptApprovedAt, r.receiptApprovedByName)}</td>
                      <td className="px-4 py-2">
                        <Badge tone={REQUEST_STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
                        {r.archived && <span className="block text-xs text-slate-500">archived</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 lg:hidden">
              {list.data.items.map((r) => (
                <li key={r.id}>
                  <Link to={`/requests/${r.id}`} className="block px-4 py-3 hover:bg-slate-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">{r.requestNo}</span>
                      <span className="font-medium">{r.fundName}</span>
                      <Badge tone={REQUEST_STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
                      <span className="ml-auto font-semibold tabular-nums">{formatMoney(r.amount)}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {r.requestorName} ({r.requestorDesignation}) · filed {formatDateTime(r.submittedAt)} · use on {formatDate(r.useAt)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.approvedAt ? `Approved ${formatDateTime(r.approvedAt)} by ${r.approvedByName}` : 'Not approved yet'}
                      {r.receiptApprovedAt && ` · receipt approved ${formatDateTime(r.receiptApprovedAt)}`}
                      {r.fundUsed !== null && ` · used ${formatMoney(r.fundUsed)}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            <Pager page={f.page} total={list.data.total} setPage={f.setPage} />
          </>
        )}
      </Card>
    </>
  );
}
