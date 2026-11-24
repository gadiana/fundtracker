import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Monitor, Smartphone, Wifi } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, PageHeader, Select, Spinner, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, timeAgo } from '../lib/format';
import { useAuth } from '../lib/auth';
import type { ActivityReport, VisitRow } from '../lib/types';

const PERIODS = { today: 'Today', '7': 'Last 7 days', '30': 'Last 30 days' } as const;
type Period = keyof typeof PERIODS;

/** Start of the period: midnight today (Philippine time) or N days back. */
function periodStart(p: Period) {
  if (p !== 'today') return new Date(Date.now() - Number(p) * 86_400_000);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${day}T00:00:00+08:00`);
}

export const formatMinutes = (minutes: number) => {
  if (minutes < 1) return 'under a minute';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
};

const isPhone = (device: string) => /iPhone|Android|iPad/.test(device);

function Device({ v }: { v: Pick<VisitRow, 'device' | 'ipAddress'> }) {
  const Icon = isPhone(v.device) ? Smartphone : Monitor;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-4 shrink-0 text-slate-400" aria-hidden />
      <span>
        {v.device}
        {v.ipAddress && <span className="block text-xs text-slate-400">{v.ipAddress}</span>}
      </span>
    </span>
  );
}

/** Adviser: who of the year's people is online, when they came and went, on which device, and for how long. */
export function SignInActivityPage() {
  const { ay } = useAuth();
  const [period, setPeriod] = useState<Period>('7');
  const report = useQuery({
    queryKey: ['audit', ay?.id, 'activity', period],
    queryFn: () => api<ActivityReport>(`/audit/activity?from=${encodeURIComponent(periodStart(period).toISOString())}`, { background: true }),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const r = report.data;

  return (
    <>
      <PageHeader
        title="Sign-in activity"
        actions={
          <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-40">
            {Object.entries(PERIODS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        }
      />
      {report.isLoading ? (
        <div className="py-10 text-center">
          <Spinner />
        </div>
      ) : report.error || !r ? (
        <Alert>{errorMessage(report.error)}</Alert>
      ) : (
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Wifi className="size-4 text-emerald-600" aria-hidden /> Online now <span className="text-sm font-normal text-slate-500">({r.online.length})</span>
            </h2>
            {r.online.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nobody is using the system right now.</p>
            ) : (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {r.online.map((v) => (
                  <li key={v.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
                      {v.name}
                    </p>
                    <p className="text-xs text-slate-500">{v.role}</p>
                    <div className="mt-2 text-slate-700">
                      <Device v={v} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Online since {formatDateTime(v.startedAt)} · {formatMinutes(v.minutes)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="px-5 pt-5 font-semibold">Time in the system</h2>
            <p className="px-5 text-sm text-slate-500">{PERIODS[period]}. Someone counts as offline {r.offlineAfterMinutes} minutes after their last activity.</p>
            {r.people.length === 0 ? (
              <EmptyState icon={Monitor} title="No sign-ins in this period" />
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-y border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2 font-medium">Person</th>
                      <th className="px-3 py-2 text-right font-medium">Hours</th>
                      <th className="px-3 py-2 text-right font-medium">Visits</th>
                      <th className="px-5 py-2 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.people.map((p) => (
                      <tr key={p.userId}>
                        <td className="px-5 py-2">
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-slate-500">{p.role}</p>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMinutes(p.hours * 60)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.visits}</td>
                        <td className="px-5 py-2">{p.online ? <Badge tone="green">Online</Badge> : <span className="text-slate-600">{timeAgo(p.lastSeenAt)}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="px-5 pt-5 font-semibold">Sign-in history</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-2 font-medium">Person</th>
                    <th className="px-3 py-2 font-medium">Device</th>
                    <th className="px-3 py-2 font-medium">Online</th>
                    <th className="px-3 py-2 font-medium">Offline</th>
                    <th className="px-5 py-2 text-right font-medium">Time spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {r.visits.map((v) => (
                    <tr key={v.id} className="align-top">
                      <td className="px-5 py-2">
                        <p className="font-medium">{v.name}</p>
                        <p className="text-xs text-slate-500">{v.role}</p>
                      </td>
                      <td className="px-3 py-2">
                        <Device v={v} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{formatDateTime(v.startedAt)}</td>
                      <td className={cx('whitespace-nowrap px-3 py-2', v.online && 'text-emerald-700')}>{v.endedAt ? formatDateTime(v.endedAt) : 'Still online'}</td>
                      <td className="whitespace-nowrap px-5 py-2 text-right tabular-nums">{formatMinutes(v.minutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
