import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowLeft, Check, ExternalLink, Lock, Paperclip, X } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FileUploader } from '../../components/FileUploader';
import { MoneyInput } from '../../components/MoneyInput';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Spinner, Textarea, cx } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import type { ApproverProgress, AttachedFile, FundRequestOptions, FundRequestView, Liquidation } from '../../lib/types';
import { REQUEST_STATUS_TONE } from './RequestsPage';

type Action = 'approve' | 'reject' | 'cancel' | 'submitReceipt' | 'approveReceipt' | 'revision' | 'archive' | 'unarchive';

export function RequestDetailPage() {
  const { id } = useParams();
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['fund-requests', ay?.id, 'detail', id];
  const view = useQuery({ queryKey: key, queryFn: () => api<FundRequestView>(`/fund-requests/${id}`) });
  const options = useQuery({ queryKey: ['fund-request-options', ay?.id], queryFn: () => api<FundRequestOptions>('/fund-requests/options') });
  const [action, setAction] = useState<Action | null>(null);
  const [fundUsed, setFundUsed] = useState<number | null>(null);
  const [remarks, setRemarks] = useState('');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [acceptOver, setAcceptOver] = useState(false);

  if (view.isLoading) {
    return (
      <div className="py-10 text-center">
        <Spinner />
      </div>
    );
  }
  if (view.error || !view.data) return <Alert>{describeError(view.error)}</Alert>;
  const { request: r, viewer, approvals, fund } = view.data;
  const latest = r.liquidations.at(-1);
  const needAttachment = options.data?.requireLiquidationAttachment ?? true;

  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ['fund-requests', ay?.id] }), queryClient.invalidateQueries({ queryKey: ['funds', ay?.id] })]);

  async function run(comment: string) {
    const base = `/fund-requests/${r.id}`;
    try {
      if (action === 'approve') {
        const res = await api<{ final: boolean }>(`${base}/approve`, { method: 'POST' });
        toast(res.final ? `${r.requestNo} approved.` : 'Your approval was recorded. Waiting for the other approvers.');
      }
      if (action === 'reject') await api(`${base}/reject`, { method: 'POST', body: { comment } });
      if (action === 'cancel') await api(`${base}/cancel`, { method: 'POST', body: { reason: comment } });
      if (action === 'submitReceipt') {
        await api(`${base}/liquidations`, { method: 'POST', body: { fundUsed, remarks: remarks || null, attachmentIds: files.map((f) => f.id) } });
        setFundUsed(null);
        setRemarks('');
        setFiles([]);
        toast('Receipt submitted for review.');
      }
      if (action === 'approveReceipt') {
        const res = await api<{ final: boolean }>(`${base}/liquidations/${latest!.id}/approve`, { method: 'POST', body: { acceptOverAmount: acceptOver || undefined } });
        toast(res.final ? `${r.requestNo} cleared. ${formatMoney(latest!.fundUsed)} was deducted from ${r.fund.name}.` : 'Your approval was recorded.');
      }
      if (action === 'revision') await api(`${base}/liquidations/${latest!.id}/revision`, { method: 'POST', body: { message: comment } });
      if (action === 'archive') {
        await api(`${base}/archive`, { method: 'POST' });
        toast(`${r.requestNo} archived. Find it under Fund requests → Archived.`);
      }
      if (action === 'unarchive') {
        await api(`${base}/unarchive`, { method: 'POST' });
        toast(`${r.requestNo} is back in the request lists.`);
      }
    } catch (err) {
      throw new Error(describeError(err));
    }
    await refresh();
  }

  const over = latest ? latest.fundUsed > latest.approvedAmount : false;
  const selfNote = viewer.isRequestor ? ' You filed this request, so your approval is recorded as self-approved.' : '';
  const dialogs: Record<Action, { title: string; description: ReactNode; confirmLabel: string; tone?: 'danger'; commentLabel?: string; commentRequired?: boolean; disabled?: boolean }> = {
    approve: {
      title: `Approve ${r.requestNo}?`,
      description: `${formatMoney(r.amount)} from ${r.fund.name} is reserved (${formatMoney(fund.available)} free to request now). Nothing is deducted until the receipt is approved.${selfNote}`,
      confirmLabel: 'Approve',
    },
    reject: { title: `Reject ${r.requestNo}?`, description: 'The requestor is notified by email.', confirmLabel: 'Reject', tone: 'danger', commentLabel: 'Comment to the requestor' },
    cancel: {
      title: `Cancel ${r.requestNo}?`,
      description: 'The reserved amount becomes available again. The requestor can no longer submit a receipt for it.',
      confirmLabel: 'Cancel request',
      tone: 'danger',
      commentLabel: 'Reason',
      commentRequired: true,
    },
    submitReceipt: {
      title: 'Submit this liquidation receipt?',
      description:
        fundUsed !== null
          ? `Fund used: ${formatMoney(fundUsed)} of the ${formatMoney(r.amount)} approved${fundUsed > r.amount ? ' — more than approved, so an approver must accept it' : ''}.`
          : '',
      confirmLabel: 'Submit receipt',
    },
    approveReceipt: {
      title: `Approve the receipt for ${r.requestNo}?`,
      description: latest
        ? `${formatMoney(latest.fundUsed)} (the amount actually used, not the amount requested) will be deducted from ${r.fund.name}, and the request is cleared.${selfNote}`
        : '',
      confirmLabel: 'Approve and deduct',
      disabled: over && !acceptOver,
    },
    revision: {
      title: 'Send the receipt back for revision?',
      description: 'The requestor edits it and submits again.',
      confirmLabel: 'Request revision',
      commentLabel: 'Message to the requestor',
    },
    archive: {
      title: `Archive ${r.requestNo}?`,
      description: 'It leaves the request lists for everyone and moves to Fund requests → Archived. Nothing is deleted, and you can bring it back any time.',
      confirmLabel: 'Archive',
    },
    unarchive: { title: `Bring ${r.requestNo} back?`, description: 'It appears in the request lists again.', confirmLabel: 'Unarchive' },
  };
  const d = action ? dialogs[action] : null;

  return (
    <>
      <Link to="/requests" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Fund requests
      </Link>

      {/* actions on top, as approvers expect */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{r.requestNo}</h1>
            <Badge tone={REQUEST_STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
            {r.selfApproved && <Badge tone="amber">Self-approved</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {formatMoney(r.amount)} from {r.fund.name}
            {r.fund.isConfidential && <Lock className="ml-1 inline size-3.5" aria-label="Confidential" />}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewer.canDecide && (
            <>
              <Button onClick={() => setAction('approve')}>
                <Check className="size-4" aria-hidden /> Confirm
              </Button>
              <Button variant="danger" onClick={() => setAction('reject')}>
                <X className="size-4" aria-hidden /> Reject
              </Button>
            </>
          )}
          {viewer.canReviewReceipt && (
            <>
              <Button
                onClick={() => {
                  setAcceptOver(false);
                  setAction('approveReceipt');
                }}
              >
                <Check className="size-4" aria-hidden /> Approve receipt
              </Button>
              <Button variant="secondary" onClick={() => setAction('revision')}>
                Request revision
              </Button>
            </>
          )}
          {viewer.canCancel && (
            <Button variant="ghost" onClick={() => setAction('cancel')}>
              Cancel request
            </Button>
          )}
          {viewer.canArchive && (
            <Button variant="secondary" onClick={() => setAction('archive')}>
              <Archive className="size-4" aria-hidden /> Archive
            </Button>
          )}
          {viewer.canUnarchive && (
            <Button variant="secondary" onClick={() => setAction('unarchive')}>
              <ArchiveRestore className="size-4" aria-hidden /> Unarchive
            </Button>
          )}
        </div>
      </div>

      {r.archivedAt && (
        <Alert tone="info" className="mb-4">
          Archived {formatDateTime(r.archivedAt)} by {r.archivedByName}. It is kept on record but hidden from the request lists.
        </Alert>
      )}

      {viewer.noApprovers && r.status === 'pending' && (
        <Alert tone="warning" className="mb-4">
          Nobody else can approve this request. Add an approver in Settings → Approvals.
        </Alert>
      )}
      {r.status === 'rejected' && (
        <Alert tone="error" className="mb-4" title={`Rejected by ${r.rejectedByName}`}>
          {r.rejectionComment ?? 'No comment.'}
        </Alert>
      )}
      {r.status === 'canceled' && (
        <Alert tone="warning" className="mb-4" title={`Canceled by ${r.canceledByName}`}>
          {r.cancelReason}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Request</h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Requestor">{r.requestorName}</Item>
              <Item label="Designation">{r.requestorDesignation}</Item>
              <Item label="Fund">{r.fund.name}</Item>
              <Item label="Amount">{formatMoney(r.amount)}</Item>
              <Item label="Date of use">{formatDate(r.useAt)}</Item>
              <Item label="Filed">{formatDateTime(r.submittedAt)}</Item>
              <Item label="Purpose" wide>
                {r.purpose}
              </Item>
              {r.approvedAt && <Item label="Approved">{`${formatDateTime(r.approvedAt)} by ${r.approvedByName}${r.selfApproved ? ' (self-approved)' : ''}`}</Item>}
              {r.clearedAt && <Item label="Cleared">{formatDateTime(r.clearedAt)}</Item>}
            </dl>
            <AttachmentLink requestId={r.id} set="request" files={r.attachments} label="Approved request document" />
          </Card>

          {r.liquidations.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">Liquidation receipts</h2>
              <ol className="space-y-4">
                {[...r.liquidations].reverse().map((l) => (
                  <LiquidationItem key={l.id} requestId={r.id} l={l} />
                ))}
              </ol>
            </Card>
          )}

          {viewer.canSubmitReceipt && (
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="font-semibold">{r.status === 'revision_requested' ? 'Revise the liquidation receipt' : 'Submit the liquidation receipt'}</h2>
                {latest?.revisionMessage && r.status === 'revision_requested' && (
                  <Alert tone="warning" className="mt-2" title={`Message from ${latest.revisionRequestedByName}`}>
                    {latest.revisionMessage}
                  </Alert>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Approved request" htmlFor="liq-request">
                  <a
                    id="liq-request"
                    href={`/requests/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center gap-1.5 font-mono text-sm text-brand-700 hover:underline"
                  >
                    {r.requestNo} <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </Field>
                <Field label="Approved amount" htmlFor="liq-approved">
                  <Input id="liq-approved" value={formatMoney(r.amount)} readOnly disabled />
                </Field>
                <Field
                  label="Fund used"
                  htmlFor="liq-used"
                  hint={fundUsed !== null && fundUsed > r.amount ? 'More than approved: an approver must accept it.' : 'What was actually spent, e.g. 2500.60'}
                >
                  <MoneyInput id="liq-used" value={fundUsed} onChange={setFundUsed} />
                </Field>
              </div>
              <Field label="Remarks" htmlFor="liq-remarks" optional>
                <Textarea id="liq-remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
              <Field label="Official receipt" htmlFor="liq-files" optional={!needAttachment}>
                <FileUploader
                  files={files}
                  onChange={setFiles}
                  allowedMime={options.data?.uploadAllowedMime ?? ['image/jpeg', 'image/png', 'application/pdf']}
                  maxBytes={options.data?.uploadMaxBytes ?? 10 * 1024 * 1024}
                  label="Add photos or PDFs of the receipt"
                />
              </Field>
              <div className="flex justify-end">
                <Button onClick={() => setAction('submitReceipt')} disabled={!fundUsed || (needAttachment && files.length === 0)}>
                  Submit receipt
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Approvals</h2>
            <p className="mb-2 text-xs text-slate-500">{r.approvalRule === 'all_required' ? 'Every approver must approve.' : 'One approval is enough.'}</p>
            <ApprovalList items={approvals.request} />
            {approvals.liquidation.length > 0 && (
              <>
                <h3 className="mb-2 mt-4 text-sm font-medium">Latest receipt</h3>
                <ApprovalList items={approvals.liquidation} />
              </>
            )}
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="mb-2 font-semibold">{r.fund.name}</h2>
            <dl className="space-y-1">
              <div className={cx('flex justify-between', fund.committed === 0 && 'font-medium')}>
                <dt className={cx(fund.committed > 0 && 'text-slate-500')}>Balance</dt>
                <dd className="tabular-nums">{formatMoney(fund.balance)}</dd>
              </div>
              {/* only shown while approved requests hold part of the balance */}
              {fund.committed > 0 && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Reserved for approved requests</dt>
                    <dd className="tabular-nums">− {formatMoney(fund.committed)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-1 font-medium">
                    <dt>Free to request</dt>
                    <dd className="tabular-nums">{formatMoney(fund.available)}</dd>
                  </div>
                </>
              )}
            </dl>
          </Card>
        </div>
      </div>

      {d && (
        <ConfirmDialog
          open
          title={d.title}
          description={d.description}
          confirmLabel={d.confirmLabel}
          tone={d.tone}
          commentLabel={d.commentLabel}
          commentRequired={d.commentRequired}
          confirmDisabled={d.disabled}
          onConfirm={run}
          onClose={() => setAction(null)}
        >
          {action === 'approveReceipt' && over && latest && (
            <Alert tone="warning">
              <p>
                {formatMoney(latest.fundUsed)} was used, {formatMoney(latest.fundUsed - latest.approvedAmount)} more than approved.
              </p>
              <div className="mt-2">
                <Checkbox checked={acceptOver} onChange={setAcceptOver} label="I accept the higher amount" />
              </div>
            </Alert>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

function Item({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx(wide && 'sm:col-span-2')}>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line">{children}</dd>
    </div>
  );
}

function AttachmentLink({ requestId, set, files, label }: { requestId: string; set: string; files: AttachedFile[]; label: string }) {
  if (!files.length) return <p className="mt-4 text-sm text-slate-400">No attachment.</p>;
  return (
    <a
      href={`/requests/${requestId}/files/${set}`}
      target="_blank"
      rel="noreferrer"
      className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
    >
      <Paperclip className="size-4" aria-hidden /> {label} ({files.length}) <ExternalLink className="size-3.5 text-slate-400" aria-hidden />
    </a>
  );
}

const LIQ_STATUS = {
  submitted: { label: 'Waiting for review', tone: 'brand' as const },
  revision_requested: { label: 'Revision requested', tone: 'amber' as const },
  approved: { label: 'Approved', tone: 'green' as const },
};

function LiquidationItem({ requestId, l }: { requestId: string; l: Liquidation }) {
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Version {l.version}</span>
        <Badge tone={LIQ_STATUS[l.status].tone}>{LIQ_STATUS[l.status].label}</Badge>
        {l.overApproved && <Badge tone="red">{l.overApprovedAccepted ? 'Over approved amount (accepted)' : 'Over approved amount'}</Badge>}
        {l.selfApproved && <Badge tone="amber">Self-approved</Badge>}
      </div>
      <p className="mt-1 text-sm">
        Fund used <span className="font-semibold tabular-nums">{formatMoney(l.fundUsed)}</span> of {formatMoney(l.approvedAmount)} approved
      </p>
      {l.remarks && <p className="mt-1 text-sm text-slate-600">{l.remarks}</p>}
      <p className="mt-1 text-xs text-slate-500">
        Submitted {formatDateTime(l.submittedAt)} by {l.submittedByName}
        {l.approvedAt && ` · approved ${formatDateTime(l.approvedAt)} by ${l.approvedByName}`}
        {l.revisionRequestedAt && ` · sent back ${formatDateTime(l.revisionRequestedAt)} by ${l.revisionRequestedByName}`}
      </p>
      {l.revisionMessage && <p className="mt-1 text-sm text-amber-800">“{l.revisionMessage}”</p>}
      <AttachmentLink requestId={requestId} set={l.id} files={l.attachments} label="Receipt" />
    </li>
  );
}

function ApprovalList({ items }: { items: ApproverProgress[] }) {
  if (!items.length) return <p className="text-sm text-slate-500">No approvers.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((a) => (
        <li key={a.name} className="flex items-center justify-between gap-2">
          <span>
            {a.name} <span className="text-slate-500">({a.designation}{a.isRequestor && ', requestor'})</span>
          </span>
          {a.decision === 'approved' ? (
            <Badge tone={a.isRequestor ? 'amber' : 'green'}>{a.isRequestor ? 'Self-approved' : 'Approved'}</Badge>
          ) : a.decision === 'rejected' ? (
            <Badge tone="red">Rejected</Badge>
          ) : a.decision === 'revision_requested' ? (
            <Badge tone="amber">Revision</Badge>
          ) : (
            <Badge>Waiting</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}
