import { useEffect, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GripVertical, Lock, Plus, Wallet } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { describeSync, FundEditorModal } from '../../components/FundEditorModal';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner, cx } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatMoney } from '../../lib/format';
import type { Fund } from '../../lib/types';
import { useStudentMeta } from '../students/StudentsPage';

export const fundAppliesTo = (f: Fund) =>
  `${f.yearLevels.length ? `Year ${f.yearLevels.join(', ')}` : 'No year levels'} · ${f.allPrograms ? 'all programs' : f.programs.map((p) => p.code).join(', ')}`;

export function FundBadges({ f }: { f: Fund }) {
  return (
    <>
      {!f.isActive && <Badge>Deactivated</Badge>}
      {f.isMandatory ? <Badge tone="brand">Mandatory</Badge> : <Badge>Optional</Badge>}
      {f.isConfidential && (
        <Badge tone="amber">
          <Lock className="mr-1 size-3" aria-hidden /> Confidential
        </Badge>
      )}
    </>
  );
}

export function FundsPage() {
  const { ay, can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['funds', ay?.id];
  const list = useQuery({ queryKey: key, queryFn: () => api<{ items: Fund[]; canManage: boolean; canSeeConfidential: boolean }>('/funds') });
  const meta = useStudentMeta();
  const canManage = can('manage') && ay?.status === 'open';

  const [order, setOrder] = useState<Fund[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (list.data) setOrder(list.data.items);
  }, [list.data]);

  const serverOrder = list.data?.items.map((f) => f.id).join() ?? '';
  const orderChanged = order.map((f) => f.id).join() !== serverOrder;
  const hiddenConfidential = list.data && !list.data.canSeeConfidential;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setOrder(next);
  };
  const onDragOver = (e: DragEvent, overId: string) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;
    move(
      order.findIndex((f) => f.id === dragId),
      order.findIndex((f) => f.id === overId),
    );
  };

  async function saveOrder() {
    try {
      await api('/funds/reorder', { method: 'POST', body: { ids: order.map((f) => f.id) } });
    } catch (err) {
      throw new Error(describeError(err));
    }
    await queryClient.invalidateQueries({ queryKey: key });
    toast('Priority order saved.');
  }

  const totals = order.reduce(
    (t, f) => ({ due: t.due + f.stats.totalDue, collected: t.collected + f.stats.collected, balance: t.balance + f.stats.balance }),
    { due: 0, collected: 0, balance: 0 },
  );

  return (
    <>
      <PageHeader
        title="Funds"
        
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)} disabled={!meta.data}>
              <Plus className="size-4" aria-hidden /> New fund
            </Button>
          )
        }
      />

      {list.isLoading ? (
        <div className="py-10 text-center">
          <Spinner />
        </div>
      ) : list.error ? (
        <Alert>{describeError(list.error)}</Alert>
      ) : order.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="No funds yet"
            body={canManage ? 'Create a fund (e.g. Student Fee ₱500) and every student it applies to is charged.' : 'The adviser hasn’t created any funds yet.'}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs text-slate-500">Total charged</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(totals.due)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-slate-500">Collected from students</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(totals.collected)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-slate-500">Total balance</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(totals.balance)}</p>
            </Card>
          </div>
          {hiddenConfidential && <p className="mb-3 text-xs text-slate-500">Confidential funds are not shown to your position.</p>}

          {canManage && order.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
              <span>Priority order: payments fill funds from the top. Drag a fund (or use the arrows) to change it.</span>
              {orderChanged && (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOrder(list.data!.items)}>
                    Undo
                  </Button>
                  <Button size="sm" onClick={() => setSavingOrder(true)}>
                    Save order
                  </Button>
                </div>
              )}
            </div>
          )}

          <ol className="space-y-2">
            {order.map((f, i) => (
              <li
                key={f.id}
                draggable={canManage}
                onDragStart={() => setDragId(f.id)}
                onDragOver={(e) => onDragOver(e, f.id)}
                onDragEnd={() => setDragId(null)}
                className={cx('rounded-xl border border-slate-200 bg-surface shadow-sm', dragId === f.id && 'opacity-50 ring-2 ring-brand-500')}
              >
                <div className="flex items-stretch">
                  {canManage && (
                    <div className="flex flex-col items-center justify-center gap-1 border-r border-slate-100 px-2 text-slate-400">
                      <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${f.name} up`} className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30">
                        <ArrowUp className="size-4" />
                      </button>
                      <GripVertical className="hidden size-4 cursor-grab sm:block" aria-hidden />
                      <button
                        type="button"
                        onClick={() => move(i, i + 1)}
                        disabled={i === order.length - 1}
                        aria-label={`Move ${f.name} down`}
                        className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30"
                      >
                        <ArrowDown className="size-4" />
                      </button>
                    </div>
                  )}
                  <Link to={`/funds/${f.id}`} className="grid flex-1 gap-3 p-4 hover:bg-slate-50 sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-400">#{i + 1}</span>
                        <span className="font-semibold text-slate-900">{f.name}</span>
                        <span className="tabular-nums text-slate-600">{formatMoney(f.amountPerStudent)}</span>
                        <FundBadges f={f} />
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {fundAppliesTo(f)} · {f.stats.students} student{f.stats.students === 1 ? '' : 's'} charged
                      </p>
                    </div>
                    <dl className={cx('grid gap-4 text-right text-sm', f.stats.committed > 0 ? 'grid-cols-3 sm:min-w-96' : 'grid-cols-2 sm:min-w-60')}>
                      <div>
                        <dt className="text-xs text-slate-500">Collected</dt>
                        <dd className="tabular-nums">{formatMoney(f.stats.collected)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Balance</dt>
                        <dd className="tabular-nums font-medium">{formatMoney(f.stats.balance)}</dd>
                      </div>
                      {/* only differs from the balance while approved requests hold money */}
                      {f.stats.committed > 0 && (
                        <div>
                          <dt className="text-xs text-slate-500">Free to request</dt>
                          <dd className="tabular-nums">{formatMoney(f.stats.available)}</dd>
                          <dd className="text-xs text-slate-500">{formatMoney(f.stats.committed)} reserved</dd>
                        </div>
                      )}
                    </dl>
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}

      {creating && meta.data && (
        <FundEditorModal
          meta={meta.data}
          onClose={() => setCreating(false)}
          onSaved={async (fund, charges) => {
            setCreating(false);
            await queryClient.invalidateQueries({ queryKey: key });
            toast(`${fund.name} created: ${describeSync(charges)}.`);
          }}
        />
      )}
      <ConfirmDialog
        open={savingOrder}
        title="Save the new priority order?"
        description={
          <ol className="list-decimal pl-5">
            {order.map((f) => (
              <li key={f.id}>{f.name}</li>
            ))}
          </ol>
        }
        confirmLabel="Save order"
        onConfirm={saveOrder}
        onClose={() => setSavingOrder(false)}
      />
    </>
  );
}
