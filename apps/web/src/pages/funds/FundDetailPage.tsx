import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Printer, Scale } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { describeSync, FundEditorModal } from '../../components/FundEditorModal';
import { MoneyInput } from '../../components/MoneyInput';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Field, Spinner, Textarea, cx } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, formatMoney } from '../../lib/format';
import type { Fund, LedgerEntry } from '../../lib/types';
import { useStudentMeta } from '../students/StudentsPage';
import { FundBadges, fundAppliesTo } from './FundsPage';

const ENTRY: Record<LedgerEntry['entryType'], { label: string; tone: 'green' | 'red' | 'blue' | 'amber' | 'gray' }> = {
  collection: { label: 'Collection', tone: 'green' },
  usage: { label: 'Fund use', tone: 'red' },
  carry_over: { label: 'Carry-over', tone: 'blue' },
  adjustment: { label: 'Adjustment', tone: 'amber' },
  void: { label: 'Void', tone: 'gray' },
};

export function FundDetailPage() {
  const { id } = useParams();
  const { ay, can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const meta = useStudentMeta();
  const fund = useQuery({ queryKey: ['funds', ay?.id, id], queryFn: () => api<Fund>(`/funds/${id}`) });
  const ledger = useQuery({ queryKey: ['funds', ay?.id, id, 'ledger'], queryFn: () => api<{ items: LedgerEntry[]; balance: number }>(`/funds/${id}/ledger`) });
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustment, setAdjustment] = useState<{ amount: number | null; reason: string }>({ amount: null, reason: '' });
  const canManage = can('manage') && ay?.status === 'open';

  if (fund.isLoading) {
    return (
      <div className="py-10 text-center">
        <Spinner />
      </div>
    );
  }
  if (fund.error || !fund.data) return <Alert>{describeError(fund.error)}</Alert>;
  const f = fund.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['funds', ay?.id] });

  async function toggleActive() {
    try {
      const res = await api<{ charges: { added: number; reactivated: number; cancelled: number; keptWithPayments: number } }>(
        `/funds/${f.id}/${f.isActive ? 'deactivate' : 'reactivate'}`,
        { method: 'POST' },
      );
      await refresh();
      toast(`${f.name} ${f.isActive ? 'deactivated' : 'reactivated'}: ${describeSync(res.charges)}.`);
    } catch (err) {
      throw new Error(describeError(err));
    }
  }

  async function addAdjustment() {
    try {
      await api(`/funds/${f.id}/adjustments`, { method: 'POST', body: { amount: adjustment.amount, reason: adjustment.reason } });
    } catch (err) {
      throw new Error(describeError(err));
    }
    setAdjustment({ amount: null, reason: '' });
    await refresh();
    toast('Adjustment recorded.');
  }

  const s = f.stats;
  const entries = [...(ledger.data?.items ?? [])].reverse();

  return (
    <>
      <Link to="/funds" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Funds
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{f.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatMoney(f.amountPerStudent)} per student · {fundAppliesTo(f)} · priority #{f.priority}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <FundBadges f={f} />
            {f.amountLocked && <Badge>Amount locked</Badge>}
          </div>
          {f.notes && <p className="mt-2 max-w-2xl text-sm text-slate-600">{f.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {can('collect') && (
            <a
              href={`/print/report/fund?fundId=${f.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-medium hover:bg-slate-50"
            >
              <Printer className="size-4" aria-hidden /> Report
            </a>
          )}
          {canManage && (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={!meta.data}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
              <Button variant="secondary" onClick={() => setAdjusting(true)}>
                <Scale className="size-4" aria-hidden /> Adjustment
              </Button>
              <Button variant="ghost" onClick={() => setToggling(true)}>
                {f.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className={cx('mb-6 grid gap-3 sm:grid-cols-2', s.committed > 0 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
        <Stat label="Students charged" value={String(s.students)} sub={`${s.paidCount} paid · ${s.partialCount} partial · ${s.unpaidCount} unpaid`} />
        <Stat label="Collected from students" value={formatMoney(s.collected)} sub={`of ${formatMoney(s.totalDue)} charged`} />
        <Stat label="Balance" value={formatMoney(s.balance)} sub="Money in the fund now: collected, minus what was used, plus adjustments" strong />
        {/* the same as the balance unless approved requests are holding money */}
        {s.committed > 0 && (
          <Stat label="Free to request" value={formatMoney(s.available)} sub={`${formatMoney(s.committed)} of the balance is reserved for approved requests not yet liquidated`} />
        )}
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold">Ledger</h2>
          <span className="text-sm text-slate-500">Newest first · entries are never edited or deleted</span>
        </div>
        {ledger.isLoading ? (
          <div className="p-6 text-center">
            <Spinner />
          </div>
        ) : entries.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No entries yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={ENTRY[e.entryType].tone}>{ENTRY[e.entryType].label}</Badge>
                    <span className="text-sm text-slate-800">{e.label}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDateTime(e.createdAt)} · {e.createdByName}
                    {e.createdByDesignation ? ` (${e.createdByDesignation})` : ''}
                    {e.studentName ? ` · ${e.studentName}` : ''}
                  </p>
                </div>
                <div className="flex gap-6 text-right text-sm tabular-nums sm:w-56 sm:justify-end">
                  <span className={cx('font-medium', e.amount < 0 ? 'text-red-700' : 'text-emerald-700')}>
                    {e.amount < 0 ? '−' : '+'}
                    {formatMoney(Math.abs(e.amount))}
                  </span>
                  <span className="text-slate-500">{formatMoney(e.balanceAfter)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && meta.data && (
        <FundEditorModal
          meta={meta.data}
          fund={f}
          onClose={() => setEditing(false)}
          onSaved={async (saved, charges) => {
            setEditing(false);
            await refresh();
            toast(`${saved.name} saved: ${describeSync(charges)}.`);
          }}
        />
      )}
      <ConfirmDialog
        open={toggling}
        title={f.isActive ? `Deactivate ${f.name}?` : `Reactivate ${f.name}?`}
        description={
          f.isActive
            ? 'Its unpaid charges are removed from every student. Only possible while nobody has paid into it.'
            : 'Every student it applies to is charged again.'
        }
        confirmLabel={f.isActive ? 'Deactivate' : 'Reactivate'}
        tone={f.isActive ? 'danger' : 'primary'}
        onConfirm={toggleActive}
        onClose={() => setToggling(false)}
      />
      <ConfirmDialog
        open={adjusting}
        title={`Record an adjustment to ${f.name}`}
        description="A correction in the ledger. Use a minus sign to reduce the balance."
        confirmLabel="Record adjustment"
        confirmDisabled={!adjustment.amount || adjustment.reason.trim().length < 5}
        onConfirm={addAdjustment}
        onClose={() => setAdjusting(false)}
      >
        <div className="space-y-3">
          <Field label="Amount (₱, negative to reduce)" htmlFor="adj-amount">
            <MoneyInput id="adj-amount" allowNegative value={adjustment.amount} onChange={(amount) => setAdjustment({ ...adjustment, amount })} />
          </Field>
          <Field label="Reason" htmlFor="adj-reason" hint="Shown in the ledger and the audit log.">
            <Textarea id="adj-reason" rows={2} value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} />
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub: string; strong?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cx('mt-1 text-lg tabular-nums', strong ? 'font-bold text-slate-900' : 'font-semibold')}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
    </Card>
  );
}
