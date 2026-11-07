import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, QrCode, XCircle } from 'lucide-react';
import { EmptyState, Spinner, cx } from '../components/ui';
import { api, describeError } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import type { VerifyResult } from '../lib/types';

/** Public: what scanning a receipt QR shows. Name and Cleared / Has Balance, plus any extras the adviser enabled. */
export function VerifyPage() {
  const { token } = useParams();
  const result = useQuery({ queryKey: ['verify', token], queryFn: () => api<VerifyResult>(`/public/verify/${token}`), retry: false });
  const r = result.data;
  const cleared = r?.status === 'cleared';

  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        {result.isLoading ? (
          <div className="py-24 text-center">
            <Spinner />
          </div>
        ) : result.error || !r ? (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <EmptyState icon={QrCode} title="QR code not recognized" body={describeError(result.error)} />
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              {r.org.logoUrl ? (
                <img src={r.org.logoUrl} alt="" className="size-10 rounded-lg object-contain" />
              ) : (
                <div className="grid size-10 place-items-center rounded-lg bg-brand-600 font-bold text-white">{(r.org.name || 'F').slice(0, 1)}</div>
              )}
              <div className="leading-tight">
                <p className="font-semibold">{r.org.name || 'Fund Tracker'}</p>
                <p className="text-xs text-slate-500">Payment status · AY {r.academicYear}</p>
              </div>
            </div>
            <div className={cx('rounded-2xl p-6 text-center text-white shadow-lg', cleared ? 'bg-emerald-600' : 'bg-red-600')}>
              {cleared ? <CheckCircle2 className="mx-auto size-14" aria-hidden /> : <XCircle className="mx-auto size-14" aria-hidden />}
              <p className="mt-3 text-xl font-semibold">{r.name}</p>
              {r.courseYearSection && <p className="text-sm text-white/85">{r.courseYearSection}</p>}
              <p className="mt-4 text-3xl font-black uppercase tracking-wide">{cleared ? 'Cleared' : 'Has Balance'}</p>
            </div>

            {r.breakdown && r.breakdown.length > 0 && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="mb-2 text-sm font-medium text-slate-700">Paid and not yet paid</p>
                <ul className="divide-y divide-slate-100 text-sm">
                  {r.breakdown.map((b) => (
                    <li key={b.fund} className="flex items-center justify-between gap-3 py-2">
                      <span className={cx(b.restricted && 'italic text-slate-600')}>{b.fund}</span>
                      <span className="text-right tabular-nums">
                        {b.balance === 0 ? (
                          <span className="font-medium text-emerald-700">Paid</span>
                        ) : (
                          <span className="font-medium text-red-700">{formatMoney(b.balance)} left</span>
                        )}
                        <span className="block text-xs text-slate-500">
                          {formatMoney(b.paid)} of {formatMoney(b.amountDue)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {r.totals && (
                  <p className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
                    <span>Total remaining</span>
                    <span className="tabular-nums">{formatMoney(r.totals.balance)}</span>
                  </p>
                )}
              </div>
            )}
            <p className="mt-4 text-center text-xs text-slate-500">Checked {formatDateTime(r.checkedAt)}</p>
          </>
        )}
        <p className="mt-6 text-center">
          <Link to="/scan" className="text-sm font-medium text-brand-700 hover:underline">
            Scan another QR
          </Link>
        </p>
      </div>
    </div>
  );
}
