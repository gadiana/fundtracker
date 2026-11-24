import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, UserPlus, Users } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { api, ApiError, describeError, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { AdviserRow } from '../../lib/types';
import { useAdminAys } from './SystemLogPage';

const STATUS_TONE = { active: 'green', deactivated: 'gray', pending: 'amber', rejected: 'red' } as const;

/** Superadmin: the advisers of every academic year. An AY can have more than one. */
export function AdvisersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const advisers = useQuery({ queryKey: ['admin', 'advisers'], queryFn: () => api<{ items: AdviserRow[] }>('/admin/advisers') });
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<{ kind: 'deactivate' | 'reactivate'; row: AdviserRow } | null>(null);

  async function run() {
    if (!action) return;
    try {
      await api(`/admin/advisers/${action.row.membershipId}/${action.kind}`, { method: 'POST' });
    } catch (err) {
      throw new Error(describeError(err));
    }
    await queryClient.invalidateQueries({ queryKey: ['admin', 'advisers'] });
    toast(`${action.row.name} was ${action.kind === 'deactivate' ? 'deactivated' : 'reactivated'}.`);
  }

  return (
    <>
      <PageHeader
        title="Advisers"
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus className="size-4" aria-hidden /> Add adviser
          </Button>
        }
      />
      <Card>
        {advisers.isLoading ? (
          <div className="p-8 text-center">
            <Spinner />
          </div>
        ) : advisers.error ? (
          <div className="p-4">
            <Alert>{errorMessage(advisers.error)}</Alert>
          </div>
        ) : !advisers.data?.items.length ? (
          <EmptyState icon={Users} title="No advisers yet" body="Add the first adviser of an academic year." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {advisers.data.items.map((a) => (
              <li key={a.membershipId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {a.name} <span className="text-sm font-normal text-slate-500">· AY {a.academicYear.label}</span>
                  </p>
                  <p className="truncate text-sm text-slate-500">{a.email}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                    {a.mustChangePassword && (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <KeyRound className="size-3.5" aria-hidden /> Hasn't set their own password yet
                      </span>
                    )}
                    <span>{a.lastLoginAt ? `Last signed in ${formatDateTime(a.lastLoginAt)}` : 'Never signed in'}</span>
                  </div>
                </div>
                {a.status === 'active' ? (
                  <Button size="sm" variant="danger" onClick={() => setAction({ kind: 'deactivate', row: a })}>
                    Deactivate
                  </Button>
                ) : a.status === 'deactivated' ? (
                  <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'reactivate', row: a })}>
                    Reactivate
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {adding && <AddAdviserDialog onClose={() => setAdding(false)} />}
      {action && (
        <ConfirmDialog
          open
          title={`${action.kind === 'deactivate' ? 'Deactivate' : 'Reactivate'} ${action.row.name}?`}
          description={
            action.kind === 'deactivate'
              ? `They lose access to AY ${action.row.academicYear.label}. Their records stay.`
              : `They get their adviser access to AY ${action.row.academicYear.label} back.`
          }
          confirmLabel={action.kind === 'deactivate' ? 'Deactivate' : 'Reactivate'}
          tone={action.kind === 'deactivate' ? 'danger' : 'primary'}
          onConfirm={run}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}

function AddAdviserDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const ays = useAdminAys();
  const defaultAy = ays.data?.items.find((a) => a.isCurrent)?.id ?? ays.data?.items[0]?.id ?? '';
  const [form, setForm] = useState({ firstName: '', middleName: '', lastName: '', email: '', password: '', academicYearId: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<AdviserRow & { newAccount: boolean }>('/admin/advisers', {
        method: 'POST',
        body: { ...form, academicYearId: form.academicYearId || defaultAy, password: form.password || undefined },
      });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'advisers'] });
      toast(
        res.newAccount
          ? `${res.name} is now an adviser. Give them the starting password; they'll set their own when they first sign in.`
          : `${res.name} already had an account and is now an adviser of AY ${res.academicYear.label}. They keep their own password.`,
      );
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="md"
      title="Add adviser"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-adviser" loading={busy}>
            Add adviser
          </Button>
        </>
      }
    >
      <form id="add-adviser" onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" htmlFor="ad-first" error={errors.firstName}>
            <Input id="ad-first" value={form.firstName} onChange={set('firstName')} required />
          </Field>
          <Field label="Last name" htmlFor="ad-last" error={errors.lastName}>
            <Input id="ad-last" value={form.lastName} onChange={set('lastName')} required />
          </Field>
        </div>
        <Field label="Middle name" htmlFor="ad-middle" optional>
          <Input id="ad-middle" value={form.middleName} onChange={set('middleName')} />
        </Field>
        <Field label="Email" htmlFor="ad-email" error={errors.email}>
          <Input id="ad-email" type="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Starting password" htmlFor="ad-pass" hint="They must change it the first time they sign in. Not needed if they already have an account." error={errors.password}>
          <Input id="ad-pass" type="text" autoComplete="off" value={form.password} onChange={set('password')} />
        </Field>
        <Field label="Academic year" htmlFor="ad-ay">
          <Select id="ad-ay" value={form.academicYearId || defaultAy} onChange={set('academicYearId')}>
            {ays.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                AY {a.label}
                {a.isCurrent ? ' · current' : ''}
              </option>
            ))}
          </Select>
        </Field>
        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  );
}
