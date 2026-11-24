import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Lock, LockOpen, Star, Wand2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CopyWizard } from '../components/CopyWizard';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import type { AyListItem, Me } from '../lib/types';

type Action = { kind: 'current' | 'close' | 'reopen'; ay: AyListItem };

export function AcademicYearsPage() {
  const { ay: selected, setMe, switchAy } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['ays', selected?.id], queryFn: () => api<{ items: AyListItem[] }>('/ays') });
  const items = list.data?.items ?? [];

  const latest = items.reduce((max, a) => Math.max(max, Number(a.label.slice(0, 4))), 0);
  const [startYear, setStartYear] = useState('');
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [wizardFor, setWizardFor] = useState<AyListItem | null>(null);
  const proposedYear = startYear || String(latest ? latest + 1 : new Date().getFullYear());
  const yearNumber = Number(proposedYear);
  const yearValid = Number.isInteger(yearNumber) && yearNumber >= 2000 && yearNumber <= 2099;

  const refresh = async (me?: Me) => {
    if (me) setMe(me);
    await queryClient.invalidateQueries({ queryKey: ['ays'] });
  };

  async function createAy() {
    const res = await api<{ id: string; label: string; me: Me }>('/ays', { method: 'POST', body: { startYear: yearNumber } });
    await refresh(res.me);
    setStartYear('');
    toast(`AY ${res.label} created. Set it up next.`);
  }

  async function runAction() {
    if (!action) return;
    const path = { current: 'make-current', close: 'close', reopen: 'reopen' }[action.kind];
    const res = await api<{ me: Me }>(`/ays/${action.ay.id}/${path}`, { method: 'POST' });
    await refresh(res.me);
    toast(
      { current: `AY ${action.ay.label} is now the current academic year.`, close: `AY ${action.ay.label} is closed.`, reopen: `AY ${action.ay.label} is open again.` }[
        action.kind
      ],
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (yearValid) setCreating(true);
  };

  const dialog = action && {
    current: {
      title: `Make AY ${action.ay.label} the current academic year?`,
      description: 'New signups and the public pages will use this academic year. Everyone can still switch between years.',
      confirmLabel: 'Make current',
      tone: 'primary' as const,
    },
    close: {
      title: `Close AY ${action.ay.label}?`,
      description: 'Everything in it becomes read-only: no payments, requests, approvals or setting changes. You can reopen it later.',
      confirmLabel: 'Close academic year',
      tone: 'danger' as const,
    },
    reopen: {
      title: `Reopen AY ${action.ay.label}?`,
      description: 'It becomes editable again.',
      confirmLabel: 'Reopen',
      tone: 'primary' as const,
    },
  }[action.kind];

  return (
    <>
      <PageHeader
        title="Academic years"
        description="Each year keeps its own data."
      />

      <Card className="mb-6 p-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="New academic year (starting year)" htmlFor="new-ay" className="sm:w-64" hint={yearValid ? `Creates AY ${yearNumber}-${yearNumber + 1}` : 'Enter a year from 2000 to 2099'}>
            <Input id="new-ay" inputMode="numeric" value={proposedYear} onChange={(e) => setStartYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
          <Button type="submit" disabled={!yearValid} className="sm:mb-6">
            <CalendarPlus className="size-4" aria-hidden /> Create
          </Button>
        </form>
      </Card>

      {list.isLoading ? (
        <div className="py-10 text-center">
          <Spinner />
        </div>
      ) : list.error ? (
        <Alert>{errorMessage(list.error)}</Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((a) => (
            <Card key={a.id} className="flex flex-col p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">AY {a.label}</h2>
                {a.isCurrent && <Badge tone="green">Current</Badge>}
                {a.status === 'closed' && <Badge tone="amber">Closed</Badge>}
                {a.needsSetup && <Badge tone="red">Not set up</Badge>}
                {selected?.id === a.id && <Badge tone="brand">Viewing</Badge>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Adviser</dt>
                <dd className="truncate">{a.adviserName ?? <span className="text-slate-400">None yet</span>}</dd>
                <dt className="text-slate-500">Active members</dt>
                <dd>
                  {a.activeMembers}
                  {a.pendingMembers > 0 && <span className="text-amber-700"> · {a.pendingMembers} pending</span>}
                </dd>
                {a.copiedFrom && (
                  <>
                    <dt className="text-slate-500">Copied from</dt>
                    <dd>
                      AY {a.copiedFrom.label} <span className="text-slate-400">({formatDate(a.copiedFrom.at)})</span>
                    </dd>
                  </>
                )}
                {a.closedAt && (
                  <>
                    <dt className="text-slate-500">Closed</dt>
                    <dd>
                      {formatDate(a.closedAt)} <span className="text-slate-400">by {a.closedByName}</span>
                    </dd>
                  </>
                )}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                {selected?.id !== a.id && (
                  <Button size="sm" variant="secondary" onClick={() => switchAy(a.id)}>
                    Switch to this year
                  </Button>
                )}
                {a.needsSetup && a.status === 'open' && (a.iAmAdviser || !a.adviserName) && (
                  <Button size="sm" onClick={() => setWizardFor(a)}>
                    <Wand2 className="size-4" aria-hidden /> Set up
                  </Button>
                )}
                {!a.isCurrent && a.status === 'open' && !a.needsSetup && (
                  <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'current', ay: a })}>
                    <Star className="size-4" aria-hidden /> Make current
                  </Button>
                )}
                {a.iAmAdviser && a.status === 'open' && !a.isCurrent && (
                  <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'close', ay: a })}>
                    <Lock className="size-4" aria-hidden /> Close
                  </Button>
                )}
                {a.iAmAdviser && a.status === 'closed' && (
                  <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'reopen', ay: a })}>
                    <LockOpen className="size-4" aria-hidden /> Reopen
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={creating}
        title={`Create AY ${yearNumber}-${yearNumber + 1}?`}
        description="It starts empty. You can copy settings and funds from another year next."
        confirmLabel="Create"
        onConfirm={createAy}
        onClose={() => setCreating(false)}
      />
      {dialog && (
        <ConfirmDialog
          open
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          tone={dialog.tone}
          onConfirm={runAction}
          onClose={() => setAction(null)}
        />
      )}
      {wizardFor && (
        <CopyWizard
          open
          target={wizardFor}
          onClose={() => {
            setWizardFor(null);
            void queryClient.invalidateQueries({ queryKey: ['ays'] });
          }}
        />
      )}
    </>
  );
}
