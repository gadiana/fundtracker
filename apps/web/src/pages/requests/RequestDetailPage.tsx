import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowLeft, Check, ExternalLink, FileText, HandCoins, Lock, Paperclip, ReceiptText, X } from 'lucide-react';
import type { LiquidationCreateInput } from '@sft/shared';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FileUploader } from '../../components/FileUploader';
import { LiquidationForm } from '../../components/LiquidationForm';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, RadioCards, Spinner, cx } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import type { ApproverProgress, AttachedFile, FundRequestOptions, FundRequestView, Liquidation, Settlement } from '../../lib/types';
import { REQUEST_STATUS_TONE } from './RequestsPage';

type Action = 'approve' | 'reject' | 'cancel' | 'submitReceipt' | 'approveReceipt' | 'revision' | 'settle' | 'archive' | 'unarchive';

/** Approved requests and their receipts are handled on the Liquidations page. */
const LIQUIDATION_STATUSES = ['approved', 'receipt_submitted', 'revision_requested', 'settlement_due', 'cleared'];

/** The same request, opened from Liquidations: its receipts, their review and the settlement. */
export function LiquidationDetailPage() {
  return <RequestDetailPage mode="liquidation" />;
}

/** One fund request: the request and its approval (mode "request"), or its liquidation. */
export function RequestDetailPage({ mode = 'request' }: { mode?: 'request' | 'liquidation' }) {
  const { id } = useParams();
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['fund-requests', ay?.id, 'detail', id];
  const view = useQuery({ queryKey: key, queryFn: () => api<FundRequestView>(`/fund-requests/${id}`) });
  const options = useQuery({ queryKey: ['fund-request-options', ay?.id], queryFn: () => api<FundRequestOptions>('/fund-requests/options') });
  const [action, setAction] = useState<Action | null>(null);
  const [liquidation, setLiquidation] = useState<{ body: LiquidationCreateInput; total: number } | null>(null);
  const [formKey, setFormKey] = useState(0);
  // when more was used than approved: does the fund reimburse the excess, or does the requestor absorb it?
  const [overChoice, setOverChoice] = useState<'' | 'reimburse' | 'absorb'>('');
  const [proof, setProof] = useState<AttachedFile[]>([]);

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
      if (action === 'submitReceipt' && liquidation) {
        await api(`${base}/liquidations`, { method: 'POST', body: liquidation.body });
        setLiquidation(null);
        setFormKey((k) => k + 1);
        toast('Liquidation submitted for review.');
      }
      if (action === 'approveReceipt') {
        const res = await api<{ final: boolean }>(`${base}/liquidations/${latest!.id}/approve`, { method: 'POST', body: { overAmount: overChoice || undefined } });
        const charged = overChoice === 'absorb' ? latest!.approvedAmount : latest!.fundUsed;
        toast(res.final ? `Receipt approved. ${formatMoney(charged)} was deducted from ${r.fund.name}.` : 'Your approval was recorded.');
      }
      if (action === 'settle') {
        await api(`${base}/settle`, { method: 'POST', body: { note: comment, attachmentId: proof[0]?.id ?? null } });
        toast(`${r.requestNo} is cleared.`);
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
  const under = latest ? latest.fundUsed < latest.approvedAmount : false;
  const settlement = latest?.status === 'approved' ? latest.settlement : null;
  const liquidationMode = mode === 'liquidation';
  const inLiquidation = LIQUIDATION_STATUSES.includes(r.status) || r.liquidations.length > 0;
  const linkButton = 'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium';
  const selfNote = viewer.isRequestor ? ' You filed this request, so your approval is recorded as self-approved.' : '';
  const dialogs: Record<Action, { title: string; description: ReactNode; confirmLabel: string; tone?: 'danger'; commentLabel?: string; commentRequired?: boolean; disabled?: boolean }> = {
    approve: {
      title: `Approve ${r.requestNo}?`,
      description: `${formatMoney(r.amount)} from ${r.fund.name} is reserved${fund ? ` (${formatMoney(fund.available)} free to request now)` : ''}. Nothing is deducted until the receipt is approved.${selfNote}`,
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
      title: 'Submit this liquidation?',
      description: liquidation
        ? `${liquidation.body.receipts.length} receipt${liquidation.body.receipts.length > 1 ? 's' : ''} totalling ${formatMoney(liquidation.total)} of the ${formatMoney(r.amount)} approved${
            liquidation.total > r.amount ? ': more than approved, so an approver must accept it' : ''
          }.`
        : '',
      confirmLabel: 'Submit liquidation',
    },
    approveReceipt: {
      title: `Approve the receipt for ${r.requestNo}?`,
      description: !latest
        ? ''
        : over
          ? `Choose what happens to the amount above the approved ${formatMoney(latest.approvedAmount)}.${selfNote}`
          : under
            ? `${formatMoney(latest.fundUsed)} (the amount actually used) will be deducted from ${r.fund.name}. ${r.requestorName} then returns the change of ${formatMoney(latest.approvedAmount - latest.fundUsed)}, and the request is cleared once the treasurer records it.${selfNote}`
            : `${formatMoney(latest.fundUsed)} will be deducted from ${r.fund.name}, and the request is cleared.${selfNote}`,
      confirmLabel: 'Approve and deduct',
      disabled: over && !overChoice,
    },
    settle: {
      title: settlement?.kind === 'reimburse' ? `Record the reimbursement to ${r.requestorName}?` : `Record the change returned by ${r.requestorName}?`,
      description: settlement
        ? settlement.kind === 'reimburse'
          ? `Confirm that ${formatMoney(settlement.amount)} was paid to ${r.requestorName}. The request is then cleared.`
          : `Confirm that you received ${formatMoney(settlement.amount)} from ${r.requestorName}. The request is then cleared.`
        : '',
      confirmLabel: settlement?.kind === 'reimburse' ? 'Mark as reimbursed' : 'Mark as returned',
      commentLabel: 'Note',
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
      <Link to={liquidationMode ? '/liquidations' : '/requests'} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> {liquidationMode ? 'Liquidations' : 'Fund requests'}
      </Link>

      {/* actions on top, as approvers expect */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{liquidationMode ? `Liquidation · ${r.requestNo}` : r.requestNo}</h1>
            <Badge tone={REQUEST_STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
            {r.selfApproved && <Badge tone="amber">Self-approved</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {formatMoney(r.amount)} from {r.fund.name}
            {r.fund.isConfidential && <Lock className="ml-1 inline size-3.5" aria-label="Confidential" />}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!liquidationMode && inLiquidation && (
            <Link
              to={`/liquidations/${r.id}`}
              className={cx(linkButton, viewer.canSubmitReceipt ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-slate-300 hover:bg-slate-50')}
            >
              <ReceiptText className="size-4" aria-hidden /> {viewer.canSubmitReceipt ? (r.status === 'revision_requested' ? 'Revise liquidation' : 'Liquidate') : 'Liquidation'}
            </Link>
          )}
          {liquidationMode && (
            <Link to={`/requests/${r.id}`} className={cx(linkButton, 'border border-slate-300 hover:bg-slate-50')}>
              <FileText className="size-4" aria-hidden /> View request
            </Link>
          )}
          {!liquidationMode && viewer.canDecide && (
            <>
              <Button onClick={() => setAction('approve')}>
                <Check className="size-4" aria-hidden /> Confirm
              </Button>
              <Button variant="danger" onClick={() => setAction('reject')}>
                <X className="size-4" aria-hidden /> Reject
              </Button>
            </>
          )}
          {liquidationMode && viewer.canReviewReceipt && (
            <>
              <Button
                onClick={() => {
                  setOverChoice('');
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
          {liquidationMode && viewer.canSettle && settlement && (
            <Button
              onClick={() => {
                setProof([]);
                setAction('settle');
              }}
            >
              <HandCoins className="size-4" aria-hidden /> {settlement.kind === 'reimburse' ? 'Mark as reimbursed' : 'Mark as returned'}
            </Button>
          )}
          {!liquidationMode && viewer.canCancel && (
            <Button variant="ghost" onClick={() => setAction('cancel')}>
              Cancel request
            </Button>
          )}
          {!liquidationMode && viewer.canArchive && (
            <Button variant="secondary" onClick={() => setAction('archive')}>
              <Archive className="size-4" aria-hidden /> Archive
            </Button>
          )}
          {!liquidationMode && viewer.canUnarchive && (
            <Button variant="secondary" onClick={() => setAction('unarchive')}>
              <ArchiveRestore className="size-4" aria-hidden /> Unarchive
            </Button>
          )}
        </div>
      </div>

      {r.archivedAt && (
        <Alert tone="info" className="mb-4">
          Archived {formatDateTime(r.archivedAt)} by {r.archivedByName}.
        </Alert>
      )}

      {liquidationMode && !inLiquidation && (
        <Alert tone="info" className="mb-4">
          {r.requestNo} isn't approved, so there is nothing to liquidate.
        </Alert>
      )}

      {!liquidationMode && viewer.noApprovers && r.status === 'pending' && (
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

      {liquidationMode && settlement && <SettlementBanner s={settlement} requestorName={r.requestorName} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">{liquidationMode ? 'Approved request' : 'Request'}</h2>
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

          {liquidationMode && r.liquidations.length > 0 && (
            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Liquidation</h2>
                <a
                  href={`/print/report/liquidation?requestId=${r.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
                >
                  <FileText className="size-4" aria-hidden /> Liquidation report
                </a>
              </div>
              <ol className="space-y-4">
                {[...r.liquidations].reverse().map((l) => (
                  <LiquidationItem key={l.id} requestId={r.id} l={l} />
                ))}
              </ol>
            </Card>
          )}

          {liquidationMode && viewer.canSubmitReceipt && (
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="font-semibold">{r.status === 'revision_requested' ? 'Revise the liquidation' : 'Liquidate'}</h2>
                <p className="mt-0.5 text-sm text-slate-500">Add every official receipt and the items on it.</p>
                {latest?.revisionMessage && r.status === 'revision_requested' && (
                  <Alert tone="warning" className="mt-2" title={`Message from ${latest.revisionRequestedByName}`}>
                    {latest.revisionMessage}
                  </Alert>
                )}
              </div>
              <LiquidationForm
                key={`${latest?.id ?? 'new'}-${formKey}`}
                approvedAmount={r.amount}
                previous={r.status === 'revision_requested' ? latest?.receipts : undefined}
                needFiles={needAttachment}
                allowedMime={options.data?.uploadAllowedMime ?? ['image/jpeg', 'image/png', 'application/pdf']}
                maxBytes={options.data?.uploadMaxBytes ?? 10 * 1024 * 1024}
                onSubmit={(body, total) => {
                  setLiquidation({ body, total });
                  setAction('submitReceipt');
                }}
              />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">{liquidationMode ? 'Receipt approvals' : 'Approvals'}</h2>
            {liquidationMode ? (
              approvals.liquidation.length > 0 ? (
                <ApprovalList items={approvals.liquidation} />
              ) : (
                <p className="text-sm text-slate-500">Shown once receipts are submitted.</p>
              )
            ) : (
              <>
                <p className="mb-2 text-xs text-slate-500">{r.approvalRule === 'all_required' ? 'Every approver must approve.' : 'One approval is enough.'}</p>
                <ApprovalList items={approvals.request} />
              </>
            )}
          </Card>
          {fund && (
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
          )}
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
            <div className="space-y-2">
              <Alert tone="warning">
                {formatMoney(latest.fundUsed)} was used, {formatMoney(latest.fundUsed - latest.approvedAmount)} more than the {formatMoney(latest.approvedAmount)} approved.
              </Alert>
              <RadioCards
                name="over-amount"
                value={overChoice}
                onChange={setOverChoice}
                options={[
                  {
                    value: 'reimburse',
                    label: `Accept ${formatMoney(latest.fundUsed)} and reimburse the excess`,
                    description: `${formatMoney(latest.fundUsed)} is deducted from ${r.fund.name}. The treasurer pays ${r.requestorName} ${formatMoney(latest.fundUsed - latest.approvedAmount)}, and the request is cleared once it is recorded.`,
                  },
                  {
                    value: 'absorb',
                    label: `Charge only the approved ${formatMoney(latest.approvedAmount)}`,
                    description: `Only ${formatMoney(latest.approvedAmount)} is deducted. ${r.requestorName} absorbs the ${formatMoney(latest.fundUsed - latest.approvedAmount)} excess, and the request is cleared now.`,
                  },
                ]}
              />
            </div>
          )}
          {action === 'settle' && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-800">Signed acknowledgment (optional)</p>
              <p className="text-xs text-slate-500">A photo of the slip the receiver signed. It goes on the last page of the liquidation report.</p>
              <FileUploader
                files={proof}
                onChange={setProof}
                max={1}
                allowedMime={options.data?.uploadAllowedMime ?? ['image/jpeg', 'image/png', 'application/pdf']}
                maxBytes={options.data?.uploadMaxBytes ?? 10 * 1024 * 1024}
                label="Add a photo or PDF"
              />
            </div>
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
      <p className="mt-1 text-xs text-slate-500">
        Submitted {formatDateTime(l.submittedAt)} by {l.submittedByName}
        {l.approvedAt && ` · approved ${formatDateTime(l.approvedAt)} by ${l.approvedByName}`}
        {l.revisionRequestedAt && ` · sent back ${formatDateTime(l.revisionRequestedAt)} by ${l.revisionRequestedByName}`}
      </p>
      {l.revisionMessage && <p className="mt-1 text-sm text-amber-800">“{l.revisionMessage}”</p>}

      <ul className="mt-3 space-y-3">
        {l.receipts.map((e) =>
          !e.hasReceipt ? (
            <li key={e.id} className="rounded-lg bg-slate-50 p-3">
              <p className="text-sm font-medium">Other expenses (no receipt)</p>
              <table className="mt-2 w-full table-fixed text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="py-1 text-left font-medium">Item</th>
                    <th scope="col" className="w-28 py-1 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {e.items.map((i, k) => (
                    <tr key={k}>
                      <td className="py-1 pr-2">{i.description}</td>
                      <td className="py-1 text-right tabular-nums">{formatMoney(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-300 font-semibold">
                    <td className="py-1">Other expenses total</td>
                    <td className="py-1 text-right tabular-nums">{formatMoney(e.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </li>
          ) : (
            <li key={e.id} className="rounded-lg bg-slate-50 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium">
                  <span className="font-mono">{e.ref}</span> · {e.usedFor}
                </p>
                <p className="text-xs text-slate-500">{[e.payee, e.receiptNo && `OR ${e.receiptNo}`, formatDate(`${e.receiptDate}T12:00:00+08:00`)].filter(Boolean).join(' · ')}</p>
              </div>
              <table className="mt-2 w-full table-fixed text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="py-1 text-left font-medium">Item</th>
                    <th scope="col" className="w-12 py-1 text-right font-medium">Qty</th>
                    <th scope="col" className="hidden w-28 py-1 text-right font-medium sm:table-cell">Unit cost</th>
                    <th scope="col" className="w-28 py-1 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {e.items.map((i, k) => (
                    <tr key={k}>
                      <td className="py-1 pr-2">{i.description}</td>
                      <td className="py-1 text-right tabular-nums">{i.quantity}</td>
                      <td className="hidden py-1 text-right tabular-nums sm:table-cell">{formatMoney(i.unitCost)}</td>
                      <td className="py-1 text-right tabular-nums">{formatMoney(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-300 font-semibold">
                    <td className="py-1" colSpan={2}>
                      {e.ref} total
                    </td>
                    <td className="hidden sm:table-cell" />
                    <td className="py-1 text-right tabular-nums">{formatMoney(e.total)}</td>
                  </tr>
                </tfoot>
              </table>
              <AttachmentLink requestId={requestId} set={e.id} files={e.attachments} label={`${e.ref} receipt`} />
            </li>
          ),
        )}
      </ul>

      <dl className="mt-3 space-y-0.5 text-sm">
        <div className="flex justify-between font-semibold">
          <dt>Total liquidated</dt>
          <dd className="tabular-nums">{formatMoney(l.fundUsed)}</dd>
        </div>
        <div className="flex justify-between text-slate-600">
          <dt>Approved amount</dt>
          <dd className="tabular-nums">{formatMoney(l.approvedAmount)}</dd>
        </div>
        {l.fundUsed !== l.approvedAmount && (
          <div className={cx('flex justify-between', l.overApproved ? 'font-medium text-red-700' : 'text-slate-600')}>
            <dt>{l.overApproved ? 'Over the approved amount' : 'Unused (change to return)'}</dt>
            <dd className="tabular-nums">{formatMoney(Math.abs(l.approvedAmount - l.fundUsed))}</dd>
          </div>
        )}
        {l.chargedAmount !== null && l.chargedAmount !== l.fundUsed && (
          <div className="flex justify-between text-slate-600">
            <dt>Charged to the fund (the requestor absorbed the excess)</dt>
            <dd className="tabular-nums">{formatMoney(l.chargedAmount)}</dd>
          </div>
        )}
      </dl>
      {l.remarks && <p className="mt-2 text-sm text-slate-600">Remarks: {l.remarks}</p>}
    </li>
  );
}

/** What is still owed between the requestor and the org after the receipt was approved, or how it was settled. */
function SettlementBanner({ s, requestorName }: { s: Settlement; requestorName: string }) {
  const amount = formatMoney(s.amount);
  if (!s.settledAt) {
    return (
      <Alert tone="warning" className="mb-4" title={s.kind === 'reimburse' ? `Reimbursement due: ${amount} to ${requestorName}` : `Change to return: ${amount} from ${requestorName}`}>
        {s.kind === 'reimburse'
          ? `${requestorName} spent more than the cash advance. The treasurer pays them ${amount} and records it here; then the request is cleared.`
          : `${requestorName} spent less than the cash advance and returns ${amount} to the treasurer, who records it here; then the request is cleared.`}
      </Alert>
    );
  }
  const by = `${s.settledByName}${s.settledByDesignation ? ` (${s.settledByDesignation})` : ''}`;
  return (
    <Alert tone="success" className="mb-4" title={s.kind === 'reimburse' ? `${amount} reimbursed to ${requestorName}` : `${amount} change returned by ${requestorName}`}>
      <p>
        {s.kind === 'reimburse' ? 'Paid' : 'Received'} {formatDateTime(s.settledAt)} by {by}.
      </p>
      {s.note && <p className="mt-1">Note: {s.note}</p>}
      {s.file && (
        <a href={s.file.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium underline">
          <Paperclip className="size-3.5" aria-hidden /> Signed acknowledgment
        </a>
      )}
    </Alert>
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
