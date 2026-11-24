import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, RotateCcw, Search, Wallet } from 'lucide-react';
import { allocateByPriority, allocationProblems, totalBalance, type Allocation } from '@sft/shared';
import { ClearanceBadge } from '../components/ChargesCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ConfirmPlacementDialog } from '../components/ConfirmPlacementDialog';
import { MoneyInput } from '../components/MoneyInput';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Spinner, Textarea, cx } from '../components/ui';
import { api, describeError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney } from '../lib/format';
import type { PaymentOptions, Receipt, Student, StudentProfile } from '../lib/types';
import { uuid } from '../lib/uuid';
import { cys, useStudentMeta } from './students/StudentsPage';

const MODE_HELP: Record<PaymentOptions['allocationMode'], string> = {
  hybrid: 'Filled in fund priority order. You can change the split; it must add up to the amount paid.',
  priority_only: 'Filled in fund priority order (set by the adviser). It can’t be changed here.',
  staff_chooses: 'Enter how much goes to each fund. It must add up to the amount paid.',
};

export function CollectionPage() {
  const { ay } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('student');
  const [search, setSearch] = useState('');
  const results = useQuery({
    queryKey: ['students', ay?.id, 'collection-search', search.trim()],
    queryFn: () => api<{ items: Student[] }>(`/students?status=active&pageSize=8&q=${encodeURIComponent(search.trim())}`),
    enabled: search.trim().length >= 2,
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Collection" />
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Find a student</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input className="pl-9" placeholder="Student name or number" value={search} autoFocus onChange={(e) => setSearch(e.target.value)} />
          </label>
          {search.trim().length >= 2 && (
            <Card>
              {results.isLoading ? (
                <div className="p-4 text-center">
                  <Spinner />
                </div>
              ) : results.data?.items.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No active student matches “{search}”.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {results.data?.items.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setParams({ student: s.id });
                          setSearch('');
                        }}
                        className={cx('w-full px-4 py-3 text-left hover:bg-slate-50', s.id === selectedId && 'bg-brand-50')}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{s.name}</span>
                          <span className="font-mono text-xs text-slate-500">{s.studentNumber}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                          {cys(s)}
                          {s.needsProfileConfirmation && <Badge tone="blue">Confirm course/year</Badge>}
                          {s.clearance && s.clearance.totalDue > 0 && <ClearanceBadge cleared={s.clearance.isCleared} />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        {selectedId ? <PaymentPanel key={selectedId} studentId={selectedId} /> : (
          <Card>
            <EmptyState icon={Wallet} title="Find a student to record a payment" body="Search by name or student number." />
          </Card>
        )}
      </div>
    </>
  );
}

function PaymentPanel({ studentId }: { studentId: string }) {
  const toast = useToast();
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const meta = useStudentMeta();
  const options = useQuery({ queryKey: ['payment-options', ay?.id], queryFn: () => api<PaymentOptions>('/payments/options') });
  const profile = useQuery({ queryKey: ['students', ay?.id, 'profile', studentId], queryFn: () => api<StudentProfile>(`/students/${studentId}`) });

  const [amount, setAmount] = useState<number | null>(null);
  const [split, setSplit] = useState<Record<string, number | null>>({});
  const [edited, setEdited] = useState(false);
  const [notes, setNotes] = useState('');
  const [key, setKey] = useState(uuid);
  const [confirming, setConfirming] = useState(false);
  const [placing, setPlacing] = useState(false);

  const student = profile.data?.student;
  const owed = useMemo(
    () => (profile.data?.account.charges ?? []).filter((c) => c.balance > 0).map((c) => ({ ...c, chargeId: c.chargeId, priority: c.priority, balance: c.balance })),
    [profile.data],
  );
  const mode = options.data?.allocationMode ?? 'hybrid';
  const allowPartial = options.data?.allowPartialPayments ?? true;

  // promoted students: confirm their course/year/section before anything else
  useEffect(() => {
    if (student?.needsProfileConfirmation && student.status === 'active') setPlacing(true);
  }, [student?.needsProfileConfirmation, student?.status]);

  // pre-fill the split in priority order until staff change it themselves
  useEffect(() => {
    if (mode === 'staff_chooses' || (mode === 'hybrid' && edited)) return;
    const auto = amount ? allocateByPriority(owed, amount, allowPartial) : [];
    setSplit(Object.fromEntries(owed.map((c) => [c.chargeId, auto.find((a) => a.chargeId === c.chargeId)?.amount ?? null])));
  }, [amount, owed, mode, allowPartial, edited]);

  if (profile.isLoading || options.isLoading) {
    return (
      <Card className="p-8 text-center">
        <Spinner />
      </Card>
    );
  }
  if (profile.error || !profile.data || !student) return <Alert>{describeError(profile.error)}</Alert>;

  const allocations: Allocation[] = Object.entries(split)
    .filter(([, v]) => v && v > 0)
    .map(([chargeId, v]) => ({ chargeId, amount: v! }));
  const balance = totalBalance(owed);
  const problems = amount === null ? [] : allocationProblems(owed, amount, allocations, allowPartial);
  const ready = amount !== null && problems.length === 0 && !student.needsProfileConfirmation;
  const nameOf = (chargeId: string) => owed.find((c) => c.chargeId === chargeId)?.fundName ?? '';

  async function record() {
    try {
      const res = await api<{ receipt: Receipt; emailedTo: string | null }>('/payments', {
        method: 'POST',
        body: { idempotencyKey: key, studentId, amount, allocations: mode === 'priority_only' ? undefined : allocations, notes: notes || null },
      });
      setKey(uuid());
      await queryClient.invalidateQueries({ queryKey: ['students', ay?.id] });
      await queryClient.invalidateQueries({ queryKey: ['funds', ay?.id] });
      if (res.emailedTo) toast(`Receipt emailed to ${res.emailedTo}.`);
      navigate(`/receipts/${res.receipt.id}`);
    } catch (err) {
      throw new Error(describeError(err));
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{student.name}</h2>
          <p className="text-sm text-slate-500">
            <span className="font-mono">{student.studentNumber}</span> · {cys(student)}
          </p>
        </div>
        {profile.data.account.charges.length > 0 && <ClearanceBadge cleared={profile.data.account.isCleared} />}
      </div>

      {student.needsProfileConfirmation ? (
        <Alert tone="info" className="mt-4" title="Confirm before collecting">
          <p>Confirm this student’s course, year and section first. Their charges are created when you confirm.</p>
          <Button size="sm" className="mt-2" onClick={() => setPlacing(true)} disabled={!meta.data}>
            Confirm course/year/section
          </Button>
        </Alert>
      ) : balance === 0 ? (
        <Alert tone="success" className="mt-4">
          {profile.data.account.charges.length ? 'Nothing left to pay. This student is fully paid.' : 'This student has no charges.'}
        </Alert>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Amount received" htmlFor="pay-amount" hint={`Remaining balance: ${formatMoney(balance)}. Overpayment isn’t allowed.`}>
              <MoneyInput id="pay-amount" value={amount} onChange={setAmount} />
            </Field>
            <Button variant="secondary" className="sm:mb-6" onClick={() => setAmount(balance)}>
              Full balance
            </Button>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">Split across funds</p>
              {mode === 'hybrid' && edited && (
                <Button size="sm" variant="ghost" onClick={() => setEdited(false)}>
                  <RotateCcw className="size-3.5" aria-hidden /> Fill by priority
                </Button>
              )}
            </div>
            <p className="mb-3 text-xs text-slate-500">
              {MODE_HELP[mode]}
              {!allowPartial && ' Partial payments are off: each fund must be paid in full.'}
            </p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {owed.map((c) => (
                <li key={c.chargeId} className="grid grid-cols-[1fr_9rem] items-center gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      {c.restricted && <Lock className="size-3.5 text-slate-400" aria-label="Confidential" />}
                      <span className={cx('truncate', c.restricted && 'italic')}>{c.fundName}</span>
                      {!c.isMandatory && <Badge>optional</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatMoney(c.balance)} left of {formatMoney(c.amountDue)}
                    </p>
                  </div>
                  <MoneyInput
                    id={`split-${c.chargeId}`}
                    ariaLabel={`Amount for ${c.fundName}`}
                    value={split[c.chargeId] ?? null}
                    disabled={mode === 'priority_only'}
                    onChange={(v) => {
                      setEdited(true);
                      setSplit((prev) => ({ ...prev, [c.chargeId]: v }));
                    }}
                  />
                </li>
              ))}
            </ul>
            {amount !== null && (
              <p className="mt-2 text-right text-sm text-slate-600">
                Split total: <span className="font-medium tabular-nums">{formatMoney(allocations.reduce((s, a) => s + a.amount, 0))}</span> of{' '}
                <span className="tabular-nums">{formatMoney(amount)}</span>
              </p>
            )}
          </div>

          {problems.length > 0 && (
            <Alert>
              <ul className="list-disc pl-4">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          )}

          <Field label="Note" htmlFor="pay-notes" optional>
            <Textarea id="pay-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. paid in coins" />
          </Field>

          <div className="flex justify-end">
            <Button size="lg" onClick={() => setConfirming(true)} disabled={!ready || ay?.status === 'closed'}>
              Record payment
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Record ${amount ? formatMoney(amount) : ''} from ${student.name}?`}
        description={
          <div className="space-y-2">
            <ul className="space-y-1">
              {allocations.map((a) => (
                <li key={a.chargeId} className="flex justify-between gap-4">
                  <span>{nameOf(a.chargeId)}</span>
                  <span className="tabular-nums">{formatMoney(a.amount)}</span>
                </li>
              ))}
            </ul>
            <p>Remaining balance after this: {formatMoney(balance - (amount ?? 0))}.</p>
            <p className="text-xs text-slate-500">Payments can’t be edited. Only the adviser can void one.</p>
          </div>
        }
        confirmLabel="Record payment"
        onConfirm={record}
        onClose={() => setConfirming(false)}
      />
      {placing && meta.data && (
        <ConfirmPlacementDialog
          student={student}
          meta={meta.data}
          onClose={() => setPlacing(false)}
          onConfirmed={async () => {
            setPlacing(false);
            await queryClient.invalidateQueries({ queryKey: ['students', ay?.id] });
          }}
        />
      )}
    </Card>
  );
}
