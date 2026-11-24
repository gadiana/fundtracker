import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Download, FileDown, QrCode, XCircle } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ReceiptCard } from '../components/ReceiptCard';
import { Alert, Badge, Button, EmptyState, Select, Spinner, cx } from '../components/ui';
import { api, describeError } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { downloadReceiptPdf, downloadReceiptPng } from '../lib/receiptExport';
import type { Receipt, VerifyResult, VerifyYear } from '../lib/types';

/**
 * Public: what scanning a receipt QR shows. Name and Cleared / Has Balance for the chosen
 * academic year (or all of them), plus the extras the adviser enabled: what's paid per fund and
 * the payment history with each digital receipt.
 */
export function VerifyPage() {
  const { token } = useParams();
  const [params, setParams] = useSearchParams();
  const ay = params.get('ay') ?? '';
  const result = useQuery({
    queryKey: ['verify', token, ay],
    queryFn: () => api<VerifyResult>(`/public/verify/${token}${ay ? `?ay=${encodeURIComponent(ay)}` : ''}`),
    retry: false,
    placeholderData: keepPreviousData,
  });
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const r = result.data;
  const all = r?.selected === 'all';
  const single = !all ? r?.years[0] : undefined;
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
                <p className="text-xs text-slate-500">Payment status</p>
              </div>
            </div>

            <label htmlFor="verify-ay" className="mb-1 block text-xs font-medium text-slate-600">
              Academic year
            </label>
            <Select
              id="verify-ay"
              className="mb-4"
              value={r.selected}
              onChange={(e) => setParams(e.target.value ? { ay: e.target.value } : {}, { replace: true })}
            >
              {r.academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  AY {y.label}
                </option>
              ))}
              {r.academicYears.length > 1 && <option value="all">All academic years</option>}
            </Select>

            <div className={cx('rounded-2xl p-6 text-center text-white shadow-lg transition-opacity', cleared ? 'bg-emerald-600' : 'bg-red-600', result.isFetching && 'opacity-70')}>
              {cleared ? <CheckCircle2 className="mx-auto size-14" aria-hidden /> : <XCircle className="mx-auto size-14" aria-hidden />}
              <p className="mt-3 text-xl font-semibold">{r.name}</p>
              {single?.courseYearSection && <p className="text-sm text-white/85">{single.courseYearSection}</p>}
              <p className="mt-4 text-3xl font-black uppercase tracking-wide">{cleared ? 'Cleared' : 'Has Balance'}</p>
              <p className="mt-1 text-sm text-white/85">{all ? 'All academic years' : `AY ${single?.academicYear}`}</p>
            </div>

            {r.years.map((y) => (
              <YearDetails key={y.academicYearId} year={y} showHeading={all} onOpenReceipt={setReceiptId} />
            ))}

            <p className="mt-4 text-center text-xs text-slate-500">Checked {formatDateTime(r.checkedAt)}</p>
          </>
        )}
        <p className="mt-6 text-center">
          <Link to="/scan" className="text-sm font-medium text-brand-700 hover:underline">
            Scan another QR
          </Link>
        </p>
      </div>
      {receiptId && token && <ReceiptDialog token={token} paymentId={receiptId} onClose={() => setReceiptId(null)} />}
    </div>
  );
}

function YearDetails({ year: y, showHeading, onOpenReceipt }: { year: VerifyYear; showHeading: boolean; onOpenReceipt: (id: string) => void }) {
  const hasExtras = Boolean(y.breakdown?.length || y.transactions);
  if (!showHeading && !hasExtras) return null;
  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {showHeading && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">
            AY {y.academicYear}
            {y.courseYearSection && <span className="ml-2 text-sm font-normal text-slate-500">{y.courseYearSection}</span>}
          </h2>
          <Badge tone={y.status === 'cleared' ? 'green' : 'red'}>{y.status === 'cleared' ? 'Cleared' : 'Has balance'}</Badge>
        </div>
      )}

      {y.breakdown && y.breakdown.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Paid and not yet paid</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {y.breakdown.map((b) => (
              <li key={b.fund} className="flex items-center justify-between gap-3 py-2">
                <span className={cx(b.restricted && 'italic text-slate-600')}>{b.fund}</span>
                <span className="text-right tabular-nums">
                  {b.balance === 0 ? <span className="font-medium text-emerald-700">Paid</span> : <span className="font-medium text-red-700">{formatMoney(b.balance)} left</span>}
                  <span className="block text-xs text-slate-500">
                    {formatMoney(b.paid)} of {formatMoney(b.amountDue)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {y.totals && (
            <dl className="mt-1 space-y-0.5 border-t border-slate-200 pt-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Total paid</dt>
                <dd className="tabular-nums">{formatMoney(y.totals.paid)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Total remaining</dt>
                <dd className="tabular-nums">{formatMoney(y.totals.balance)}</dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {y.transactions && (
        <div className={cx(Boolean(y.breakdown?.length) && 'mt-4 border-t border-slate-200 pt-3')}>
          <p className="mb-1 text-sm font-medium text-slate-700">Payments</p>
          {y.transactions.length === 0 ? (
            <p className="py-2 text-sm text-slate-500">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {y.transactions.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onOpenReceipt(t.id)}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cx('font-semibold tabular-nums', t.status === 'voided' && 'text-slate-400 line-through')}>{formatMoney(t.amount)}</span>
                        {t.status === 'voided' && <Badge tone="red">Void</Badge>}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{t.funds.join(', ')}</span>
                      <span className="block text-xs text-slate-500">
                        {formatDateTime(t.receivedAt)} · <span className="font-mono">{t.transactionNo}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center text-xs font-medium text-brand-700">
                      Receipt <ChevronRight className="size-4" aria-hidden />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ReceiptDialog({ token, paymentId, onClose }: { token: string; paymentId: string; onClose: () => void }) {
  const receipt = useQuery({ queryKey: ['verify-receipt', token, paymentId], queryFn: () => api<Receipt>(`/public/verify/${token}/receipts/${paymentId}`) });
  const card = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'png' | 'pdf' | null>(null);
  const [error, setError] = useState('');
  const r = receipt.data;

  async function exporting(kind: 'png' | 'pdf') {
    if (!r || !card.current) return;
    setBusy(kind);
    setError('');
    try {
      await (kind === 'png' ? downloadReceiptPng : downloadReceiptPdf)(card.current, r.transactionNo);
    } catch (err) {
      setError(`Couldn’t create the file: ${describeError(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      size="md"
      title={r ? `Receipt ${r.transactionNo}` : 'Receipt'}
      onClose={onClose}
      footer={
        r && (
          <>
            <Button variant="secondary" onClick={() => exporting('png')} loading={busy === 'png'}>
              <Download className="size-4" aria-hidden /> Image
            </Button>
            <Button variant="secondary" onClick={() => exporting('pdf')} loading={busy === 'pdf'}>
              <FileDown className="size-4" aria-hidden /> PDF
            </Button>
          </>
        )
      }
    >
      {receipt.isLoading ? (
        <div className="py-16 text-center">
          <Spinner />
        </div>
      ) : receipt.error || !r ? (
        <Alert>{describeError(receipt.error)}</Alert>
      ) : (
        <div className="bg-slate-50 py-2">
          <ReceiptCard ref={card} receipt={r} />
        </div>
      )}
      {error && <Alert className="mt-3">{error}</Alert>}
    </Modal>
  );
}
