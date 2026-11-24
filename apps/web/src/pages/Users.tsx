import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailWarning, Users as UsersIcon } from 'lucide-react';
import type { MembershipStatus } from '@sft/shared';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader, Select, Spinner, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import type { Designation, Member } from '../lib/types';

const TABS: { key: MembershipStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'active', label: 'Active' },
  { key: 'deactivated', label: 'Deactivated' },
  { key: 'rejected', label: 'Rejected' },
];

type ActionKind = 'approve' | 'reject' | 'position' | 'deactivate' | 'reactivate' | 'remove';

interface PendingAction {
  kind: ActionKind;
  member: Member;
}

const STATUS_TONE = { pending: 'amber', active: 'green', deactivated: 'gray', rejected: 'red' } as const;

export function UsersPage() {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'pending') as MembershipStatus;
  const [action, setAction] = useState<PendingAction | null>(null);
  const [designationId, setDesignationId] = useState('');
  const readOnly = ay?.status === 'closed';

  const summary = useQuery({
    queryKey: ['members', ay?.id, 'summary'],
    queryFn: () => api<Record<MembershipStatus, number>>('/members/summary'),
  });
  const list = useQuery({
    queryKey: ['members', ay?.id, tab],
    queryFn: () => api<{ items: Member[] }>(`/members?status=${tab}`),
  });
  const designations = useQuery({
    queryKey: ['designations', ay?.id],
    queryFn: () => api<{ items: Designation[] }>('/designations'),
  });
  const activeDesignations = designations.data?.items.filter((d) => d.isActive) ?? [];

  function open(kind: ActionKind, member: Member) {
    setDesignationId(kind === 'position' ? (member.designation?.id ?? '') : '');
    setAction({ kind, member });
  }

  async function run(comment: string) {
    if (!action) return;
    const { kind, member } = action;
    const base = `/members/${member.id}`;
    if (kind === 'approve') await api(`${base}/approve`, { method: 'POST', body: { designationId } });
    if (kind === 'reject') await api(`${base}/reject`, { method: 'POST', body: { comment } });
    if (kind === 'position') await api(base, { method: 'PATCH', body: { designationId } });
    if (kind === 'deactivate') await api(`${base}/deactivate`, { method: 'POST', body: { reason: comment } });
    if (kind === 'reactivate') await api(`${base}/reactivate`, { method: 'POST' });
    if (kind === 'remove') await api(base, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: ['members', ay?.id] });
    toast(DONE_MESSAGES[kind](member.user.name));
  }

  const dialog = action ? DIALOGS[action.kind](action.member) : null;
  const needsPosition = action?.kind === 'approve' || action?.kind === 'position';

  return (
    <>
      <PageHeader title="User management" />

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Account status">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams({ tab: t.key })}
            className={cx(
              'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {t.label}
            {summary.data && summary.data[t.key] > 0 && (
              <span className={cx('rounded-full px-1.5 text-xs', t.key === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700')}>
                {summary.data[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      <Card>
        {list.isLoading ? (
          <div className="p-8 text-center">
            <Spinner />
          </div>
        ) : list.error ? (
          <div className="p-4">
            <Alert>{errorMessage(list.error)}</Alert>
          </div>
        ) : list.data?.items.length === 0 ? (
          <EmptyState icon={UsersIcon} title={`No ${tab} accounts`} body={tab === 'pending' ? 'New signups appear here for your approval.' : undefined} />
        ) : (
          <>
            {/* phones: cards */}
            <ul className="divide-y divide-slate-200 md:hidden">
              {list.data?.items.map((m) => (
                <li key={m.id} className="space-y-3 p-4">
                  <MemberIdentity member={m} />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                    {m.position && <Badge tone="brand">{m.position}</Badge>}
                    <span>{formatDateTime(m.status === 'pending' ? m.requestedAt : (m.decidedAt ?? m.requestedAt))}</span>
                  </div>
                  {m.decisionNote && <p className="text-xs text-slate-500">Note: {m.decisionNote}</p>}
                  <MemberActions member={m} readOnly={readOnly} onAction={open} />
                </li>
              ))}
            </ul>

            {/* tablets and up: table */}
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Position</th>
                  <th className="px-4 py-3 font-medium">{tab === 'pending' ? 'Requested' : 'Decided'}</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data?.items.map((m) => (
                  <tr key={m.id} className="align-top">
                    <td className="px-4 py-3">
                      <MemberIdentity member={m} />
                    </td>
                    <td className="px-4 py-3">{m.position ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDateTime(m.status === 'pending' ? m.requestedAt : (m.decidedAt ?? m.requestedAt))}
                      {m.decidedByName && m.status !== 'pending' && <p className="text-xs text-slate-400">by {m.decidedByName}</p>}
                      {m.decisionNote && <p className="text-xs text-slate-500">Note: {m.decisionNote}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <MemberActions member={m} readOnly={readOnly} onAction={open} className="justify-end" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      {dialog && action && (
        <ConfirmDialog
          open
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          tone={dialog.tone}
          commentLabel={dialog.commentLabel}
          confirmDisabled={needsPosition && !designationId}
          onConfirm={run}
          onClose={() => setAction(null)}
        >
          {needsPosition && (
            <Field
              label="Position"
              htmlFor="designation"
              hint="Permissions come from the position (Settings → Positions)."
            >
              <Select id="designation" value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
                <option value="">Choose a position…</option>
                {activeDesignations.map((d) => {
                  const holders = d.activeMembers ?? 0;
                  // their own current position doesn't count against them
                  const full = d.maxMembers !== null && holders >= d.maxMembers && d.id !== action.member.designation?.id;
                  return (
                    <option key={d.id} value={d.id} disabled={full}>
                      {d.name}
                      {full ? ' (full)' : d.maxMembers !== null ? ` (${holders} of ${d.maxMembers})` : ''}
                    </option>
                  );
                })}
              </Select>
            </Field>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

function MemberIdentity({ member }: { member: Member }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={member.user.name} url={member.user.avatarUrl} size="md" />
      <div className="min-w-0">
        <p className="font-medium text-slate-900">
          {member.user.name}
          {member.isSelf && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
        </p>
        <p className="truncate text-sm text-slate-500">{member.user.email}</p>
        {!member.user.emailVerified && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700">
            <MailWarning className="size-3.5" aria-hidden /> Email not verified yet
          </p>
        )}
      </div>
    </div>
  );
}

function MemberActions({
  member,
  readOnly,
  onAction,
  className,
}: {
  member: Member;
  readOnly: boolean;
  onAction: (kind: ActionKind, member: Member) => void;
  className?: string;
}) {
  if (readOnly || member.isSelf || member.role === 'adviser') return null;
  const btn = (kind: ActionKind, label: string, variant: 'primary' | 'secondary' | 'danger' = 'secondary') => (
    <Button key={kind} size="sm" variant={variant} onClick={() => onAction(kind, member)}>
      {label}
    </Button>
  );
  const buttons = {
    pending: [btn('approve', 'Approve', 'primary'), btn('reject', 'Reject'), btn('remove', 'Remove', 'danger')],
    active: [btn('position', 'Change position'), btn('deactivate', 'Deactivate', 'danger')],
    deactivated: [btn('reactivate', 'Reactivate')],
    rejected: [btn('remove', 'Remove', 'danger')],
  }[member.status];
  return <div className={cx('flex flex-wrap gap-2', className)}>{buttons}</div>;
}

interface DialogCopy {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  commentLabel?: string;
}

const DIALOGS: Record<ActionKind, (m: Member) => DialogCopy> = {
  approve: (m) => ({
    title: `Approve ${m.user.name}?`,
    description: 'Choose their position. They will be notified by email.',
    confirmLabel: 'Approve',
  }),
  reject: (m) => ({
    title: `Reject ${m.user.name}?`,
    description: 'They will be told by email. They can ask again later.',
    confirmLabel: 'Reject',
    tone: 'danger',
    commentLabel: 'Comment to the applicant',
  }),
  position: (m) => ({
    title: `Change ${m.user.name}'s position?`,
    description: 'Their permissions change immediately. Past records keep the position they had at the time.',
    confirmLabel: 'Save position',
  }),
  deactivate: (m) => ({
    title: `Deactivate ${m.user.name}?`,
    description: 'They lose access to this academic year. Their history stays. You can reactivate them later.',
    confirmLabel: 'Deactivate',
    tone: 'danger',
    commentLabel: 'Reason',
  }),
  reactivate: (m) => ({
    title: `Reactivate ${m.user.name}?`,
    description: 'They get their access to this academic year back, with the same position.',
    confirmLabel: 'Reactivate',
  }),
  remove: (m) => ({
    title: `Permanently remove ${m.user.name}?`,
    description: 'This deletes the account. It is only possible because they were never approved. This cannot be undone.',
    confirmLabel: 'Remove account',
    tone: 'danger',
  }),
};

const DONE_MESSAGES: Record<ActionKind, (name: string) => string> = {
  approve: (n) => `${n} was approved.`,
  reject: (n) => `${n} was rejected.`,
  position: (n) => `${n}'s position was updated.`,
  deactivate: (n) => `${n} was deactivated.`,
  reactivate: (n) => `${n} was reactivated.`,
  remove: (n) => `${n}'s account was removed.`,
};
