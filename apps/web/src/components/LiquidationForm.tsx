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
  payee: string;
  receiptNo: string;
  receiptDate: string;
  items: ItemDraft[];
  files: AttachedFile[];
}

/** A cost that came without a receipt (gas, fare, ...): just what it was and how much. */
interface OtherDraft {
  key: number;
  description: string;
  cost: number | null;
}

let nextKey = 1;
const todayInManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const emptyItem = (): ItemDraft => ({ key: nextKey++, description: '', quantity: '1', unitCost: null });
const emptyReceipt = (): ReceiptDraft => ({ key: nextKey++, usedFor: '', payee: '', receiptNo: '', receiptDate: todayInManila(), items: [emptyItem()], files: [] });
const emptyOther = (): OtherDraft => ({ key: nextKey++, description: '', cost: null });

/** A revision starts from what was sent last time, files included. */
const receiptsFrom = (receipts: LiquidationReceiptEntry[]): ReceiptDraft[] =>
  receipts
    .filter((r) => r.hasReceipt)
    .map((r) => ({
      key: nextKey++,
      usedFor: r.usedFor,
      payee: r.payee ?? '',
      receiptNo: r.receiptNo ?? '',
      receiptDate: r.receiptDate,
      items: r.items.map((i) => ({ key: nextKey++, description: i.description, quantity: String(i.quantity), unitCost: i.unitCost })),
      files: r.attachments,
    }));
const othersFrom = (receipts: LiquidationReceiptEntry[]): OtherDraft[] =>
  receipts.filter((r) => !r.hasReceipt).flatMap((r) => r.items.map((i) => ({ key: nextKey++, description: i.description, cost: i.amount })));

const qty = (i: ItemDraft) => (/^\d+$/.test(i.quantity.trim()) ? Number(i.quantity) : NaN);
const itemAmount = (i: ItemDraft) => (Number.isFinite(qty(i)) && i.unitCost ? qty(i) * i.unitCost : 0);
const receiptTotal = (r: ReceiptDraft) => r.items.reduce((s, i) => s + itemAmount(i), 0);

/** What still stops the liquidation from being submitted, in words. */
function problemsOf(receipts: ReceiptDraft[], others: OtherDraft[], needFiles: boolean, today: string) {
  const out: string[] = [];
  receipts.forEach((r, n) => {
    const ref = `R-${n + 1}`;
    if (r.usedFor.trim().length < 2) out.push(`${ref}: say what it was used for.`);
    if (!r.receiptDate) out.push(`${ref}: choose the receipt date.`);
    else if (r.receiptDate > today) out.push(`${ref}: the date can't be in the future.`);
    r.items.forEach((i, k) => {
      if (!i.description.trim() || !(qty(i) >= 1) || !i.unitCost || i.unitCost <= 0) out.push(`${ref}, item ${k + 1}: fill in the item, quantity and unit cost.`);
    });
    if (needFiles && r.files.length === 0) out.push(`${ref}: add a photo or PDF of the receipt.`);
  });
  others.forEach((o, k) => {
    if (!o.description.trim() || !o.cost || o.cost <= 0) out.push(`Other expense ${k + 1}: fill in the item and its cost.`);
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
  const [receipts, setReceipts] = useState<ReceiptDraft[]>(() => (previous?.length ? receiptsFrom(previous) : [emptyReceipt()]));
  const [others, setOthers] = useState<OtherDraft[]>(() => (previous ? othersFrom(previous) : []));
  const [remarks, setRemarks] = useState('');
  const today = todayInManila();
  const othersTotal = others.reduce((s, o) => s + (o.cost ?? 0), 0);
  const total = receipts.reduce((s, r) => s + receiptTotal(r), 0) + othersTotal;
  const problems = problemsOf(receipts, others, needFiles, today);

  const update = (key: number, patch: Partial<ReceiptDraft>) => setReceipts((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const updateItem = (r: ReceiptDraft, key: number, patch: Partial<ItemDraft>) => update(r.key, { items: r.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const updateOther = (key: number, patch: Partial<OtherDraft>) => setOthers((list) => list.map((o) => (o.key === key ? { ...o, ...patch } : o)));

  function submit() {
    const body: LiquidationCreateInput = {
      remarks: remarks.trim() || null,
      receipts: [
        ...receipts.map((r) => ({
          usedFor: r.usedFor.trim(),
          payee: r.payee.trim() || null,
          receiptNo: r.receiptNo.trim() || null,
          receiptDate: r.receiptDate,
          items: r.items.map((i) => ({ description: i.description.trim(), quantity: qty(i), unitCost: i.unitCost ?? 0 })),
          attachmentIds: r.files.map((f) => f.id),
        })),
        // the costs without a receipt go together as one last entry
        ...(others.length
          ? [
              {
                usedFor: 'Other expenses (no receipt)',
                hasReceipt: false,
                receiptDate: today,
                items: others.map((o) => ({ description: o.description.trim(), quantity: 1, unitCost: o.cost ?? 0 })),
                attachmentIds: [],
              },
            ]
          : []),
      ],
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
                Receipt <span className="font-mono">{ref}</span>
              </legend>
              {(receipts.length > 1 || others.length > 0) && (
                <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setReceipts((list) => list.filter((x) => x.key !== r.key))}>
                  <Trash2 className="size-4" aria-hidden /> Remove
                </Button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Used for" htmlFor={`liq-${r.key}-for`}>
                <Input id={`liq-${r.key}-for`} value={r.usedFor} onChange={(e) => update(r.key, { usedFor: e.target.value })} placeholder="e.g. Booth materials for the fair" maxLength={200} />
              </Field>
              <Field label="Store / payee" htmlFor={`liq-${r.key}-payee`} optional>
                <Input id={`liq-${r.key}-payee`} value={r.payee} onChange={(e) => update(r.key, { payee: e.target.value })} maxLength={150} />
              </Field>
              <Field label="OR / receipt no." htmlFor={`liq-${r.key}-no`} optional>
                <Input id={`liq-${r.key}-no`} value={r.receiptNo} onChange={(e) => update(r.key, { receiptNo: e.target.value })} maxLength={60} />
              </Field>
              <Field label="Receipt date" htmlFor={`liq-${r.key}-date`}>
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
              <Field label={`Photos or PDF of ${ref}`} htmlFor={`liq-${r.key}-files`} optional={!needFiles}>
                <FileUploader
                  files={r.files}
                  onChange={(files) => update(r.key, { files })}
                  allowedMime={allowedMime}
                  maxBytes={maxBytes}
                  label="Add photos or a PDF of this receipt"
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
        <Plus className="size-4" aria-hidden /> Add another receipt
      </Button>

      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="font-medium">Other expenses (no receipt)</legend>
        {others.length > 0 && (
          <>
            <div className="mt-3 hidden grid-cols-[1fr_8rem_2rem] gap-2 px-0.5 pb-1 text-xs font-medium text-slate-500 sm:grid">
              <span>Item</span>
              <span>Cost</span>
              <span />
            </div>
            <ul className="mt-3 space-y-2 sm:mt-0">
              {others.map((o, k) => (
                <li key={o.key} className="grid grid-cols-[1fr_8rem_2rem] items-center gap-2">
                  <Input aria-label={`Other expense ${k + 1}`} placeholder="e.g. Gas" value={o.description} onChange={(e) => updateOther(o.key, { description: e.target.value })} maxLength={200} />
                  <MoneyInput id={`liq-other-${o.key}`} ariaLabel={`Other expense ${k + 1} cost`} value={o.cost} onChange={(v) => updateOther(o.key, { cost: v })} />
                  <button
                    type="button"
                    onClick={() => setOthers((list) => list.filter((x) => x.key !== o.key))}
                    disabled={others.length === 1 && receipts.length === 0}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-700 disabled:invisible"
                    aria-label={`Remove other expense ${k + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setOthers((list) => [...list, emptyOther()])}>
          <Plus className="size-4" aria-hidden /> Add item
        </Button>
        {others.length > 0 && (
          <p className="mt-3 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
            <span>Other expenses total</span>
            <span className="tabular-nums">{formatMoney(othersTotal)}</span>
          </p>
        )}
      </fieldset>

      <dl className="space-y-1 rounded-xl bg-slate-50 p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-600">Approved amount</dt>
          <dd className="tabular-nums">{formatMoney(approvedAmount)}</dd>
        </div>
        <div className="flex justify-between font-semibold">
          <dt>Total liquidated</dt>
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
