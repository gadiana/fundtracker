import { useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, cx } from '../components/ui';
import { formatMoney } from '../lib/format';
import type { DashboardData } from './Dashboard';

const COLORS = { collected: '#4f46e5', outstanding: '#f59e0b', used: '#e11d48', grid: '#e2e8f0', axis: '#64748b' };

/** ₱1.2k, ₱35k, ₱1.4M: short enough for an axis. */
const compactPeso = (centavos: number) =>
  `₱${new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(centavos / 100)}`;

const moneyTooltip = (value: number | string) => formatMoney(Number(value));

function ChartCard({ title, description, children, actions }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="text-xs text-slate-500">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

function periodLabel(period: string, unit: 'day' | 'month') {
  const d = new Date(`${period}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', ...(unit === 'day' ? { month: 'short', day: 'numeric' } : { month: 'short', year: '2-digit' }) }).format(d);
}

export default function DashboardCharts({ data }: { data: DashboardData }) {
  const [by, setBy] = useState<'byProgram' | 'byYear' | 'bySection'>('byProgram');
  const groups = data[by];
  const overTime = data.collectionsOverTime.map((p) => ({ ...p, label: periodLabel(p.period, data.unit) }));
  const hasCollections = overTime.some((p) => p.amount > 0);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="xl:col-span-2">
        <ChartCard title="Collections over time" description={data.unit === 'day' ? 'Per day' : 'Per month'}>
          {hasCollections ? (
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={overTime} margin={{ left: 0, right: 8, top: 4 }}>
                  <defs>
                    <linearGradient id="collected-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.collected} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={COLORS.collected} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.axis }} minTickGap={24} />
                  <YAxis tickFormatter={compactPeso} tick={{ fontSize: 11, fill: COLORS.axis }} width={56} />
                  <Tooltip formatter={(v, name) => (name === 'Collected' ? moneyTooltip(v as number) : v)} labelClassName="text-xs" />
                  <Area type="monotone" dataKey="amount" name="Collected" stroke={COLORS.collected} fill="url(#collected-fill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-slate-500">No payments in this period.</p>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Per fund" description="Collected and still to collect">
        {data.funds.length ? (
          <div style={{ height: Math.max(160, data.funds.length * 44) }}>
            <ResponsiveContainer>
              <BarChart data={data.funds} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke={COLORS.grid} horizontal={false} />
                <XAxis type="number" tickFormatter={compactPeso} tick={{ fontSize: 11, fill: COLORS.axis }} />
                <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11, fill: COLORS.axis }} />
                <Tooltip formatter={moneyTooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="collected" name="Collected" stackId="a" fill={COLORS.collected} />
                <Bar dataKey="outstanding" name="Still to collect" stackId="a" fill={COLORS.outstanding} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-slate-500">No funds yet.</p>
        )}
      </ChartCard>

      <ChartCard
        title="By course, year and section"
        description="Charged to active students"
        actions={
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs" role="tablist">
            {(
              [
                ['byProgram', 'Program'],
                ['byYear', 'Year'],
                ['bySection', 'Section'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={by === k}
                onClick={() => setBy(k)}
                className={cx('rounded-md px-2 py-1 font-medium', by === k ? 'bg-white shadow-sm' : 'text-slate-600')}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {groups.length ? (
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={groups} margin={{ left: 0, right: 8 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.axis }} interval={0} angle={groups.length > 6 ? -30 : 0} textAnchor={groups.length > 6 ? 'end' : 'middle'} height={groups.length > 6 ? 56 : 30} />
                <YAxis tickFormatter={compactPeso} tick={{ fontSize: 11, fill: COLORS.axis }} width={56} />
                <Tooltip formatter={moneyTooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="collected" name="Collected" stackId="a" fill={COLORS.collected} />
                <Bar dataKey="outstanding" name="Still to collect" stackId="a" fill={COLORS.outstanding} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-slate-500">No charges yet.</p>
        )}
      </ChartCard>

      <div className="xl:col-span-2">
        <ChartCard title="Usage by fund" description="Approved liquidation receipts (the amount actually used)">
          {data.usageByFund.length ? (
            <div style={{ height: Math.max(140, data.usageByFund.length * 40) }}>
              <ResponsiveContainer>
                <BarChart data={data.usageByFund} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke={COLORS.grid} horizontal={false} />
                  <XAxis type="number" tickFormatter={compactPeso} tick={{ fontSize: 11, fill: COLORS.axis }} />
                  <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11, fill: COLORS.axis }} />
                  <Tooltip formatter={moneyTooltip} />
                  <Bar dataKey="used" name="Used" fill={COLORS.used} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">No money has been used yet.</p>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
