import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FileUploader } from '../../components/FileUploader';
import { MoneyInput } from '../../components/MoneyInput';
import { useToast } from '../../components/Toast';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '../../components/ui';
import { api, ApiError, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney } from '../../lib/format';
import type { AttachedFile, FundRequestDetail, FundRequestOptions } from '../../lib/types';

/** Today's date as yyyy-mm-dd in Philippine time, the same day the API checks against. */
const todayInManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const LABELS ={ fundId: 'Fund', amount: 'Amount', purpose: 'Purpose', useAt: 'Date of use', attachmentIds: 'Attachments' };

export function NewRequestPage() {
  const { ay } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const options = useQuery({ queryKey: ['fund-request-options', ay?.id], queryFn: () => api<FundRequestOptions>('/fund-requests/options') });
  const [fundId, setFundId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [purpose, setPurpose] = useState('');
  const [useAt, setUseAt] = useState('');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  if (options.isLoading) {
    return (
      <div className="py-10 text-center">
        <Spinner />
      </div>
    );
  }
  if (options.error || !options.data) return <Alert>{describeError(options.error)}</Alert>;
  const o = options.data;
  if (!o.canFile) return <Alert tone="warning">Your position can’t file fund requests. The adviser decides which positions can.</Alert>;

  const fund = o.funds.find((f) => f.id === fundId);
  const overAvailable = fund && amount !== null && amount > fund.available;
  // yyyy-mm-dd strings compare correctly as text
  const today = todayInManila();
  const pastDate = Boolean(useAt) && useAt < today;
  const ready =
    fund && amount !== null && amount > 0 && !overAvailable && purpose.trim().length >= 3 && useAt && !pastDate && (!o.requireRequestAttachment || files.length > 0);

  async function submit() {
    try {
      const created = await api<FundRequestDetail>('/fund-requests', {
        method: 'POST',
        // a plain date means noon Philippine time, so it never shifts to another day
        body: { fundId, amount, purpose, useAt: `${useAt}T12:00:00+08:00`, attachmentIds: files.map((f) => f.id) },
      });
      await queryClient.invalidateQueries({ queryKey: ['fund-requests', ay?.id] });
      toast(`${created.requestNo} submitted for approval.`);
      navigate(`/requests/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      throw new Error(describeError(err, LABELS));
    }
  }

  return (
    <>
      <Link to="/requests" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Fund requests
      </Link>
      <PageHeader title="New fund request" description="Approvers review it; the fund isn’t charged until your liquidation receipt is approved." />
      <Card className="max-w-2xl space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="req-name">
            <Input id="req-name" value={o.requestor.name} readOnly disabled />
          </Field>
          <Field label="Designation" htmlFor="req-designation">
            <Input id="req-designation" value={o.requestor.designation ?? ''} readOnly disabled />
          </Field>
        </div>
        <Field label="Fund" htmlFor="req-fund" error={errors.fundId}>
          <Select id="req-fund" value={fundId} onChange={(e) => setFundId(e.target.value)}>
            <option value="">Choose a fund…</option>
            {o.funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} — {formatMoney(f.available)} free to request
              </option>
            ))}
          </Select>
        </Field>
        {fund && fund.committed > 0 && (
          <p className="-mt-3 text-xs text-slate-500">
            Balance {formatMoney(fund.balance)} − reserved for approved requests {formatMoney(fund.committed)} = <span className="font-medium">{formatMoney(fund.available)}</span> free to request
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount to use" htmlFor="req-amount" error={overAvailable ? `More than the ${formatMoney(fund!.available)} free to request` : errors.amount}>
            <MoneyInput id="req-amount" value={amount} onChange={setAmount} invalid={Boolean(overAvailable)} />
          </Field>
          <Field label="Date of use" htmlFor="req-date" error={pastDate ? 'Choose today or a later date.' : errors.useAt}>
            <Input id="req-date" type="date" min={today} value={useAt} onChange={(e) => setUseAt(e.target.value)} invalid={pastDate} />
          </Field>
        </div>
        <Field label="Purpose" htmlFor="req-purpose" error={errors.purpose}>
          <Textarea id="req-purpose" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Printing of the October issue" />
        </Field>
        <Field
          label="Attachment: the approved request document"
          htmlFor="req-files"
          optional={!o.requireRequestAttachment}
          hint={o.requireRequestAttachment ? 'Required: a photo or PDF of the physically approved request.' : undefined}
        >
          <FileUploader files={files} onChange={setFiles} allowedMime={o.uploadAllowedMime} maxBytes={o.uploadMaxBytes} />
        </Field>
        <div className="flex justify-end">
          <Button onClick={() => setConfirming(true)} disabled={!ready || ay?.status === 'closed'}>
            Submit request
          </Button>
        </div>
      </Card>
      <ConfirmDialog
        open={confirming}
        title="Send this request for approval?"
        description={
          ready && (
            <p>
              {formatMoney(amount)} from {fund.name}, to be used on {formatDate(`${useAt}T12:00:00+08:00`)}, with {files.length} attachment(s).
            </p>
          )
        }
        confirmLabel="Send request"
        onConfirm={submit}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
