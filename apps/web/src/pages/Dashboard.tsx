import { lazy, Suspense, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, FileText, Lock, MailWarning, UserPlus, Users } from 'lucide-react';
import { Alert, Badge, Card, PageHeader, Select, Spinner, cx } from '../components/ui';
import { api, describeError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMoney } from '../lib/format';
import { useRequestCounts } from './requests/RequestsPage';

// charts load separately, so the rest of the app doesn't wait for the chart library
const DashboardCharts = lazy(() => import('./DashboardCharts'));

interface Group {
  label: string;
  due: number;
  collected: number;
  outstanding: number;
}

export interface DashboardData {
  range: '30d' | '90d' | '12m' | 'all';
  unit: 'day' | 'month';
  restrictedHidden: boolean;
  totals: { due: number; collected: number; outstanding: number; used: number; balance: number; reserved: number; available: number };
  clearance: { cleared: number; hasBalance: number; total: number };
  pending: { pendingStudents: number | null; needsConfirmation: number | null; pendingMembers: number | null; failedEmails: number | null };
  funds: { id: string; name: string; isConfidential: boolean; isActive: boolean; due: number; collected: number; outstanding: number; used: number; balance: number; reserved: number; available: number }[];
  collectionsOverTime: { period: string; amount: number; payments: number }[];
  byProgram: Group[];
  byYear: Group[];
  bySection: Group[];
  usageByFund: { name: string; used: number }[];
  recentPayments: { id: string; transactionNo: string; receivedAt: string; studentName: string; amount: number; status: 'posted' | 'voided' }[];
}

const RANGES = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
  { value: 'all', label: 'Whole academic year' },
] as const;

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: 'brand' | 'amber' | 'rose' | 'green' }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={cx(
          'mt-1 text-2xl font-semibold tabular-nums tracking-tight',
          tone === 'brand' && 'text-brand-700',
          tone === 'amber' && 'text-amber-700',
          tone === 'rose' && 'text-rose-700',
          tone === 'green' && 'text-emerald-700',
        )}
      >
        {value}
      </p>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}

function PendingLink({ to, icon: Icon, label, count }: { to: string; icon: typeof Users; label: string; count: number }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50">
      <Icon className={cx('size-4 shrink-0', count ? 'text-amber-600' : 'text-slate-400')} aria-hidden />
      <span className="flex-1 text-sm">{label}</span>
      <span className={cx('rounded-full px-2 text-sm font-semibold tabular-nums', count ? 'bg-amber-100 text-amber-800' : 'text-slate-400')}>{count}</span>
      <ArrowRight className="size-4 text-slate-300" aria-hidden />
    </Link>
  );
}

export function DashboardPage() {
  const { me, ay, membership, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const range = RANGES.find((r) => r.value === params.get('range'))?.value ?? '90d';
  const dash = useQuery({
    queryKey: ['dashboard', ay?.id, range],
    queryFn: () => api<DashboardData>(`/dashboard?range=${range}`),
    placeholderData: keepPreviousData,
  });
  const toApprove = useRequestCounts().data?.toApprove ?? 0;
  const d = dash.data;
  const pct = d && d.clearance.total ? Math.round((d.clearance.cleared / d.clearance.total) * 100) : 0;
  const collectedPct = d && d.totals.due ? Math.round((d.totals.collected / d.totals.due) * 100) : 0;

  return (
    <>
      <PageHeader
        title={`Hello, ${me?.user.firstName}`}
        description={`${ay?.orgName || 'Fund Tracker'} · AY ${ay?.label} · ${membership?.position ?? ''}`}
        actions={
          <Select aria-label="Period for the chart" value={range} onChange={(e) => setParams({ range: e.target.value })} className="w-48">
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        }
      />
      {ay?.status === 'closed' && (
        <Alert tone="warning" className="mb-4">
          AY {ay.label} is closed: these figures are final.
        </Alert>
      )}

      {dash.isLoading ? (
        <div className="py-16 text-center">
          <Spinner />
        </div>
      ) : dash.error || !d ? (
        <Alert>{describeError(dash.error)}</Alert>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Collected" value={formatMoney(d.totals.collected)} tone="brand" sub={`${collectedPct}% of ${formatMoney(d.totals.due)} charged`} />
            <Tile label="Still to collect" value={formatMoney(d.totals.outstanding)} tone="amber" sub="From active students" />
            <Tile label="Used" value={formatMoney(d.totals.used)} tone="rose" sub="Approved liquidation receipts" />
            <Tile
              label="Balance"
              value={formatMoney(d.totals.balance)}
              sub={d.totals.reserved > 0 ? `${formatMoney(d.totals.available)} free to request · ${formatMoney(d.totals.reserved)} reserved` : 'In all funds now'}
            />
            <Card className="col-span-2 p-4 lg:col-span-1">
              <p className="text-xs font-medium text-slate-500">Students cleared</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-emerald-700">
                {d.clearance.cleared}
                <span className="text-base font-normal text-slate-400"> / {d.clearance.total}</span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-red-100" role="img" aria-label={`${pct}% cleared`}>
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-500">{d.clearance.hasBalance} with balance</p>
            </Card>
          </div>
          {d.restrictedHidden && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
              <Lock className="size-3.5" aria-hidden /> Money figures leave out restricted funds, which your position can’t see. Student clearance includes them.
            </p>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Suspense
                fallback={
                  <Card className="grid h-64 place-items-center">
                    <Spinner label="Loading charts" />
                  </Card>
                }
              >
                <DashboardCharts data={d} />
              </Suspense>
            </div>
            <div className="space-y-4">
              <Card className="p-2">
                <h2 className="px-3 pb-1 pt-2 font-semibold">Waiting for you</h2>
                <PendingLink to="/requests?tab=inbox" icon={FileText} label="Requests and receipts to approve" count={toApprove} />
                {d.pending.pendingStudents !== null && <PendingLink to="/students?tab=pending" icon={UserPlus} label="Self-enrollments to approve" count={d.pending.pendingStudents} />}
                {d.pending.needsConfirmation !== null && (
                  <PendingLink to="/students?tab=confirm" icon={AlertTriangle} label="Students to confirm (course/year/section)" count={d.pending.needsConfirmation} />
                )}
                {d.pending.pendingMembers !== null && <PendingLink to="/users?tab=pending" icon={Users} label="Accounts waiting for approval" count={d.pending.pendingMembers} />}
                {d.pending.failedEmails !== null && d.pending.failedEmails > 0 && (
                  <PendingLink to="/settings?section=email" icon={MailWarning} label="Emails that failed" count={d.pending.failedEmails} />
                )}
              </Card>

              {can('collect') && (
                <Card>
                  <div className="flex items-center justify-between px-4 pt-4">
                    <h2 className="font-semibold">Latest payments</h2>
                    <Link to="/history" className="text-xs font-medium text-brand-700 hover:underline">
                      All history
                    </Link>
                  </div>
                  {d.recentPayments.length === 0 ? (
                    <p className="p-4 text-sm text-slate-500">No payments yet.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 px-1 py-2">
                      {d.recentPayments.map((p) => (
                        <li key={p.id}>
                          <Link to={`/receipts/${p.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{p.studentName}</span>
                              <span className="block text-xs text-slate-500">{formatDateTime(p.receivedAt)}</span>
                            </span>
                            <span className={cx('text-sm font-semibold tabular-nums', p.status === 'voided' && 'text-slate-400 line-through')}>{formatMoney(p.amount)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          </div>

          <Card className="mt-6">
            <h2 className="px-4 pt-4 font-semibold">Funds</h2>
            {d.funds.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No funds yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Fund</th>
                      <th className="px-2 py-2 text-right font-medium">Charged</th>
                      <th className="px-2 py-2 text-right font-medium">Collected</th>
                      <th className="px-2 py-2 text-right font-medium">Still to collect</th>
                      <th className="px-2 py-2 text-right font-medium">Used</th>
                      <th className="px-4 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.funds.map((f) => (
                      <tr key={f.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <Link to={`/funds/${f.id}`} className="font-medium text-brand-700 hover:underline">
                            {f.name}
                          </Link>
                          {f.isConfidential && <Lock className="ml-1 inline size-3.5 text-slate-400" aria-label="Confidential" />}
                          {!f.isActive && <Badge className="ml-2">Inactive</Badge>}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatMoney(f.due)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatMoney(f.collected)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatMoney(f.outstanding)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatMoney(f.used)}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums">
                          {formatMoney(f.balance)}
                          {f.reserved > 0 && <span className="block text-xs font-normal text-slate-500">{formatMoney(f.available)} free to request</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-200 font-semibold">
                    <tr>
                      <td className="px-4 py-2">Total</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(d.totals.due)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(d.totals.collected)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(d.totals.outstanding)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(d.totals.used)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(d.totals.balance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          {d.clearance.total > 0 && d.clearance.hasBalance === 0 && (
            <p className="mt-4 flex items-center gap-1.5 text-sm text-emerald-700">
              <CheckCircle2 className="size-4" aria-hidden /> Every active student is cleared.
            </p>
          )}
        </>
      )}
    </>
  );
}
