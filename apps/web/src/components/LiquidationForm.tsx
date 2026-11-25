import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { entryTotal, type LiquidationCreateInput } from '@sft/shared';
import { formatMoney } from '../lib/format';
import type { AttachedFile, LiquidationReceiptEntry } from '../lib/types';
import { FileUploader } from './FileUploader';
import { MoneyInput } from './MoneyInput';
import { Button, Field, Input, Textarea, cx } from './ui';

interface ItemDraft {
  key: number;
  description: string;
  quantity: string;
  unitCost: number | null;
}

interface ReceiptDraft {
  key: number;
  usedFor: string;
  /** false for gas, fares and other expenses that come without an official receipt */
  hasReceipt: boolean;
  payee: string;
  receiptNo: string;
  receiptDate: string;
  items: ItemDraft[];
  files: AttachedFile[];
}

let nextKey = 1;
const todayInManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const emptyItem = (): ItemDraft => ({ key: nextKey++, description: '', quantity: '1', unitCost: null });
const emptyReceipt = (): ReceiptDraft => ({ key: nextKey++, usedFor: '', hasReceipt: true, payee: '', receiptNo: '', receiptDate: todayInManila(), items: [emptyItem()], files: [] });

/** A revision starts from the receipts sent last time, files included. */
const fromPrevious = (receipts: LiquidationReceiptEntry[]): ReceiptDraft[] =>
  receipts.map((r) => ({
    key: nextKey++,
    usedFor: r.usedFor,
    hasReceipt: r.hasReceipt,
    payee: r.payee ?? '',
    receiptNo: r.receiptNo ?? '',
    receiptDate: r.receiptDate,
    items: r.items.map((i) => ({ key: nextKey++, description: i.description, quantity: String(i.quantity), unitCost: i.unitCost })),
    files: r.attachments,
  }));

const qty = (i: ItemDraft) => (/^\d+$/.test(i.quantity.trim()) ? Number(i.quantity) : NaN);
const itemAmount = (i: ItemDraft) => (Number.isFinite(qty(i)) && i.unitCost ? qty(i) * i.unitCost : 0);
const receiptTotal = (r: ReceiptDraft) => r.items.reduce((s, i) => s + itemAmount(i), 0);

/** What still stops the liquidation from being submitted, in words. */
function problemsOf(receipts: ReceiptDraft[], needFiles: boolean, today: string) {
  const out: string[] = [];
  receipts.forEach((r, n) => {
    const ref = `R-${n + 1}`;
    if (r.usedFor.trim().length < 2) out.push(`${ref}: say what it was used for.`);
    if (!r.receiptDate) out.push(`${ref}: choose the date.`);
    else if (r.receiptDate > today) out.push(`${ref}: the date can't be in the future.`);
    r.items.forEach((i, k) => {
      if (!i.description.trim() || !(qty(i) >= 1) || !i.unitCost || i.unitCost <= 0) out.push(`${ref}, item ${k + 1}: fill in the item, quantity and unit cost.`);
    });
    if (needFiles && r.hasReceipt && r.files.length === 0) out.push(`${ref}: add a photo or PDF of the receipt.`);
  });
  return out;
}

export function LiquidationForm({
  approvedAmount,
  previous,
  needFiles,
  allowedMime,
  maxBytes,
  onSubmit,
}: {
  approvedAmount: number;
  /** the receipts of the version sent back for revision */
  previous?: LiquidationReceiptEntry[];
  needFiles: boolean;
  allowedMime: string[];
  maxBytes: number;
  /** opens the confirmation; the parent sends it */
  onSubmit: (body: LiquidationCreateInput, total: number) => void;
}) {
  const [receipts, setReceipts] = useState<ReceiptDraft[]>(() => (previous?.length ? fromPrevious(previous) : [emptyReceipt()]));
  const [remarks, setRemarks] = useState('');
  const today = todayInManila();
  const total = receipts.reduce((s, r) => s + receiptTotal(r), 0);
  const problems = problemsOf(receipts, needFiles, today);

  const update = (key: number, patch: Partial<ReceiptDraft>) => setReceipts((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const updateItem = (r: ReceiptDraft, key: number, patch: Partial<ItemDraft>) => update(r.key, { items: r.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });

  function submit() {
    const body: LiquidationCreateInput = {
      remarks: remarks.trim() || null,
      receipts: receipts.map((r) => ({
        usedFor: r.usedFor.trim(),
        hasReceipt: r.hasReceipt,
        payee: r.payee.trim() || null,
        receiptNo: (r.hasReceipt && r.receiptNo.trim()) || null,
        receiptDate: r.receiptDate,
        items: r.items.map((i) => ({ description: i.description.trim(), quantity: qty(i), unitCost: i.unitCost ?? 0 })),
        attachmentIds: r.files.map((f) => f.id),
      })),
    };
    // the same arithmetic the server uses
    onSubmit(body, body.receipts.reduce((s, r) => s + entryTotal(r.items), 0));
  }

  return (
    <div className="space-y-4">
      {receipts.map((r, n) => {
        const ref = `R-${n + 1}`;
        return (
          <fieldset key={r.key} className="rounded-xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <legend className="font-medium">
                {r.hasReceipt ? 'Receipt' : 'Expense'} <span className="font-mono">{ref}</span>
              </legend>
              {receipts.length > 1 && (
                <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setReceipts((list) => list.filter((x) => x.key !== r.key))}>
                  <Trash2 className="size-4" aria-hidden /> Remove
                </Button>
              )}
            </div>

            <div role="radiogroup" aria-label={`Does ${ref} have a receipt?`} className="mb-3 inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
              {[
                { value: true, label: 'With receipt' },
                { value: false, label: 'No receipt (gas, fare, …)' },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={r.hasReceipt === o.value}
                  onClick={() => update(r.key, { hasReceipt: o.value })}
                  className={cx(
                    'rounded-md px-3 py-1 transition-colors',
                    r.hasReceipt === o.value ? 'bg-surface font-medium text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {!r.hasReceipt && (
              <p className="mb-3 text-xs text-slate-500">
                For costs that come without an official receipt, like gas, jeepney or tricycle fare, parking or tips. Say clearly what it was for; a photo (a ticket, the pump reading) is welcome but not needed.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Used for" htmlFor={`liq-${r.key}-for`}>
                <Input id={`liq-${r.key}-for`} value={r.usedFor} onChange={(e) => update(r.key, { usedFor: e.target.value })} placeholder={r.hasReceipt ? 'e.g. Booth materials for the fair' : 'e.g. Gas for picking up the shirts'} maxLength={200} />
              </Field>
              <Field label={r.hasReceipt ? 'Store / payee' : 'Paid to'} htmlFor={`liq-${r.key}-payee`} optional>
                <Input id={`liq-${r.key}-payee`} value={r.payee} onChange={(e) => update(r.key, { payee: e.target.value })} maxLength={150} />
              </Field>
              {r.hasReceipt && (
                <Field label="OR / receipt no." htmlFor={`liq-${r.key}-no`} optional>
                  <Input id={`liq-${r.key}-no`} value={r.receiptNo} onChange={(e) => update(r.key, { receiptNo: e.target.value })} maxLength={60} />
                </Field>
              )}
              <Field label={r.hasReceipt ? 'Receipt date' : 'Date spent'} htmlFor={`liq-${r.key}-date`}>
                <Input id={`liq-${r.key}-date`} type="date" max={today} value={r.receiptDate} onChange={(e) => update(r.key, { receiptDate: e.target.value })} />
              </Field>
            </div>

            <div className="mt-4">
              <div className="hidden grid-cols-[1fr_4.5rem_8rem_6.5rem_2rem] gap-2 px-0.5 pb-1 text-xs font-medium text-slate-500 sm:grid">
                <span>Item</span>
                <span>Qty</span>
                <span>Unit cost</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              <ul className="space-y-2">
                {r.items.map((i, k) => (
                  <li key={i.key} className="grid grid-cols-[1fr_4.5rem] gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-[1fr_4.5rem_8rem_6.5rem_2rem] sm:items-center sm:bg-transparent sm:p-0">
                    <Input
                      aria-label={`${ref} item ${k + 1}`}
                      placeholder="e.g. Book"
                      value={i.description}
                      onChange={(e) => updateItem(r, i.key, { description: e.target.value })}
                      maxLength={200}
                    />
                    <Input
                      aria-label={`${ref} item ${k + 1} quantity`}
                      inputMode="numeric"
                      value={i.quantity}
                      onChange={(e) => updateItem(r, i.key, { quantity: e.target.value })}
                      invalid={i.quantity !== '' && !(qty(i) >= 1)}
                    />
                    <MoneyInput id={`liq-${r.key}-${i.key}-cost`} ariaLabel={`${ref} item ${k + 1} unit cost`} value={i.unitCost} onChange={(v) => updateItem(r, i.key, { unitCost: v })} />
                    <span className="self-center text-right text-sm tabular-nums">{formatMoney(itemAmount(i))}</span>
                    <button
                      type="button"
                      onClick={() => update(r.key, { items: r.items.filter((x) => x.key !== i.key) })}
                      disabled={r.items.length === 1}
                      className="col-span-2 justify-self-end rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-700 disabled:invisible sm:col-span-1"
                      aria-label={`Remove ${ref} item ${k + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => update(r.key, { items: [...r.items, emptyItem()] })}>
                <Plus className="size-4" aria-hidden /> Add item
              </Button>
            </div>

            <div className="mt-3">
              <Field label={`Photos or PDF of ${ref}`} htmlFor={`liq-${r.key}-files`} optional={!needFiles || !r.hasReceipt}>
                <FileUploader
                  files={r.files}
                  onChange={(files) => update(r.key, { files })}
                  allowedMime={allowedMime}
                  maxBytes={maxBytes}
                  label={r.hasReceipt ? 'Add photos or a PDF of this receipt' : 'Add a photo, if you have one'}
                />
              </Field>
            </div>

            <p className="mt-3 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
              <span>{ref} total</span>
              <span className="tabular-nums">{formatMoney(receiptTotal(r))}</span>
            </p>
          </fieldset>
        );
      })}

      <Button variant="secondary" onClick={() => setReceipts((list) => [...list, emptyReceipt()])}>
        <Plus className="size-4" aria-hidden /> Add another receipt or expense
      </Button>

      <dl className="space-y-1 rounded-xl bg-slate-50 p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-600">Approved amount</dt>
          <dd className="tabular-nums">{formatMoney(approvedAmount)}</dd>
        </div>
        <div className="flex justify-between font-semibold">
          <dt>Total liquidated ({receipts.length} {receipts.length > 1 ? 'entries' : 'entry'})</dt>
          <dd className="tabular-nums">{formatMoney(total)}</dd>
        </div>
        <div className={cx('flex justify-between border-t border-slate-200 pt-1', total > approvedAmount ? 'font-medium text-red-700' : 'text-slate-600')}>
          <dt>{total > approvedAmount ? 'Over the approved amount' : 'Unused (to return)'}</dt>
          <dd className="tabular-nums">{formatMoney(Math.abs(approvedAmount - total))}</dd>
        </div>
      </dl>

      <Field label="Remarks" htmlFor="liq-remarks" optional>
        <Textarea id="liq-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} />
      </Field>

      <div className="flex flex-col items-end gap-1">
        <Button onClick={submit} disabled={problems.length > 0 || total <= 0}>
          Submit liquidation
        </Button>
        {problems.length > 0 && (
          <p className="text-right text-xs text-slate-500">
            {problems[0]}
            {problems.length > 1 && ` (+${problems.length - 1} more)`}
          </p>
        )}
      </div>
    </div>
  );
}
