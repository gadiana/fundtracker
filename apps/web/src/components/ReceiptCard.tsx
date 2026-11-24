import { forwardRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { formatMoney } from '../lib/format';
import type { Receipt } from '../lib/types';
import { QrImage } from './QrImage';
import { cx } from './ui';

function receiptDateTime(r: Receipt) {
  return new Intl.DateTimeFormat('en-PH', { timeZone: r.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.receivedAt));
}

/** The GCash-style digital receipt. It is a student-facing document: confidential funds show as "Restricted fee". */
export const ReceiptCard = forwardRef<HTMLDivElement, { receipt: Receipt }>(function ReceiptCard({ receipt: r }, ref) {
  const voided = r.status === 'voided';
  return (
    <div ref={ref} className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl bg-white text-slate-900 shadow-lg ring-1 ring-slate-200">
      <div className="bg-brand-600 px-5 pb-10 pt-5 text-white">
        <div className="flex items-center gap-3">
          {r.org.logoUrl ? (
            <img src={r.org.logoUrl} alt="" className="size-10 rounded-lg bg-white object-contain p-0.5" />
          ) : (
            <div className="grid size-10 place-items-center rounded-lg bg-white/20 font-bold">{(r.org.abbr || r.org.name || 'F').slice(0, 1)}</div>
          )}
          <div className="min-w-0 leading-tight">
            <p className="truncate font-semibold">{r.org.name || 'Fund Tracker'}</p>
            <p className="truncate text-xs text-white/80">{[r.org.college, r.org.school].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      </div>

      <div className="-mt-6 px-5">
        <div className="rounded-xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-100">
          <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="size-4" aria-hidden /> Payment received
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{formatMoney(r.amount)}</p>
          <p className="mt-1 font-medium">{r.student.name}</p>
          <p className="text-xs text-slate-500">{r.student.courseYearSection}</p>
        </div>
      </div>

      <div className="px-5 py-4">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-dashed divide-slate-200">
            {r.allocations.map((a, i) => (
              <tr key={i}>
                <td className="py-1.5 pr-2">{a.fundName}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(a.amount)}</td>
                <td className="py-1.5 pl-2 text-right text-xs tabular-nums text-slate-500">{formatMoney(a.remainingOnFund)} left</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={cx('mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-sm', r.clearedAfter ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')}>
          <span>{r.clearedAfter ? 'Status after this payment' : 'Remaining balance'}</span>
          <span className="font-semibold tabular-nums">{r.clearedAfter ? 'Cleared' : formatMoney(r.balanceAfter)}</span>
        </div>

        <div className="mt-4 flex flex-col items-center">
          <QrImage value={r.qrUrl} label="Student status QR code" className="size-36" />
          <p className="mt-2 text-center text-xs font-medium text-slate-600">{r.qrMessage}</p>
        </div>

        <p className="mt-4 text-sm">
          <span className="text-slate-500">Processed by:</span> {r.processedByName}
          {r.processedByDesignation && <span className="text-slate-500"> ({r.processedByDesignation})</span>}
        </p>
        {r.notes && <p className="mt-1 text-xs text-slate-500">Note: {r.notes}</p>}

        <div className="mt-4 flex items-end justify-between gap-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <div className="space-y-0.5">
            <p>
              Transaction no. <span className="font-mono font-medium text-slate-800">{r.transactionNo}</span>
            </p>
            <p>AY. {r.academicYear.replace('-', ' - ')}</p>
            <p>{receiptDateTime(r)}</p>
          </div>
        </div>
        {r.footer && <p className="mt-3 text-center text-xs text-slate-500">{r.footer}</p>}
      </div>

      {voided && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="-rotate-12 rounded-lg border-4 border-red-600 px-4 py-1 text-4xl font-black tracking-widest text-red-600/80">VOID</span>
        </div>
      )}
    </div>
  );
});
