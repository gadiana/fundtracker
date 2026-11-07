import { Lock, Receipt } from 'lucide-react';
import { formatMoney } from '../lib/format';
import type { StudentAccount } from '../lib/types';
import { Badge, Card, cx } from './ui';

const STATUS = {
  paid: { label: 'Paid', tone: 'green' as const },
  partial: { label: 'Partial', tone: 'amber' as const },
  unpaid: { label: 'Unpaid', tone: 'red' as const },
};

export function ClearanceBadge({ cleared, hasCharges = true }: { cleared: boolean; hasCharges?: boolean }) {
  if (!hasCharges) return <Badge>No charges</Badge>;
  return cleared ? <Badge tone="green">Cleared</Badge> : <Badge tone="red">Has balance</Badge>;
}

/** One line per fund the student is charged, in priority order. Confidential funds may show as “Restricted fund”. */
export function ChargesCard({ account, needsConfirmation }: { account: StudentAccount; needsConfirmation?: boolean }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Receipt className="size-4" aria-hidden /> Charges
        </h2>
        {account.charges.length > 0 && <ClearanceBadge cleared={account.isCleared} />}
      </div>
      {account.charges.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">
          {needsConfirmation
            ? 'Charges are added once the course, year and section are confirmed.'
            : 'No charges. Charges appear when a fund applies to this student’s year level and program.'}
        </p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-5 py-2 text-left font-medium">Fund</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Paid</th>
                <th className="px-5 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {account.charges.map((c) => (
                <tr key={c.chargeId}>
                  <td className="px-5 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {c.restricted && <Lock className="size-3.5 text-slate-400" aria-label="Confidential" />}
                      <span className={cx(c.restricted && 'italic text-slate-600')}>{c.fundName}</span>
                      <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                      {!c.isMandatory && <Badge>optional</Badge>}
                    </div>
                    <span className="text-xs text-slate-500 sm:hidden">{formatMoney(c.amountDue)}</span>
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">{formatMoney(c.amountDue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(c.amountPaid)}</td>
                  <td className={cx('px-5 py-2.5 text-right tabular-nums', c.balance > 0 && 'font-medium')}>{formatMoney(c.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 font-semibold">
              <tr>
                <td className="px-5 py-2.5">Total</td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">{formatMoney(account.totals.due)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(account.totals.paid)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(account.totals.balance)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="px-5 py-3 text-xs text-slate-500">Cleared means every mandatory fund is fully paid. Payments are recorded on the Collection page.</p>
        </>
      )}
    </Card>
  );
}
