import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Download, FileDown, Mail, Printer, Wallet } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ReceiptCard } from '../components/ReceiptCard';
import { useToast } from '../components/Toast';
import { Alert, Button, Field, Input, Spinner } from '../components/ui';
import { api, describeError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { printImages } from '../lib/print';
import { downloadReceiptPdf, downloadReceiptPng, receiptPng } from '../lib/receiptExport';
import type { Receipt } from '../lib/types';

export function ReceiptPage() {
  const { id } = useParams();
  const { ay, can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const card = useRef<HTMLDivElement>(null);
  const key = ['payments', ay?.id, id];
  const receipt = useQuery({ queryKey: key, queryFn: () => api<Receipt>(`/payments/${id}`) });
  const [emailing, setEmailing] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState<'png' | 'pdf' | 'print' | null>(null);
  const [exportError, setExportError] = useState('');

  if (receipt.isLoading) {
    return (
      <div className="py-10 text-center">
        <Spinner />
      </div>
    );
  }
  if (receipt.error || !receipt.data) return <Alert>{describeError(receipt.error)}</Alert>;
  const r = receipt.data;

  async function exporting(kind: 'png' | 'pdf' | 'print', work: () => Promise<void>) {
    setBusy(kind);
    setExportError('');
    try {
      await work();
    } catch (err) {
      setExportError(`Couldn’t create the receipt file: ${describeError(err)}`);
    } finally {
      setBusy(null);
    }
  }

  const downloadPng = () => exporting('png', () => downloadReceiptPng(card.current!, r.transactionNo));
  const downloadPdf = () => exporting('pdf', () => downloadReceiptPdf(card.current!, r.transactionNo));

  // printed at about the width of a phone screen, like the on-screen receipt
  const print = () => exporting('print', async () => printImages([await receiptPng(card.current!)], { title: `Receipt ${r.transactionNo}`, width: '100mm' }));

  async function sendEmail() {
    try {
      const res = await api<{ to: string }>(`/payments/${r.id}/email`, { method: 'POST', body: { to: emailTo.trim() || undefined } });
      toast(`Receipt sent to ${res.to}.`);
      setEmailTo('');
    } catch (err) {
      throw new Error(describeError(err));
    }
  }

  async function voidPayment(reason: string) {
    try {
      await api(`/payments/${r.id}/void`, { method: 'POST', body: { reason } });
    } catch (err) {
      throw new Error(describeError(err));
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ['students', ay?.id] }),
      queryClient.invalidateQueries({ queryKey: ['funds', ay?.id] }),
    ]);
    toast(`Payment ${r.transactionNo} voided.`);
  }

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to={`/students/${r.student.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="size-4" aria-hidden /> {r.student.name}
        </Link>
        <Link to="/collection" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          <Wallet className="size-4" aria-hidden /> Record another payment
        </Link>
      </div>

      {r.voided && (
        <Alert tone="error" className="no-print mx-auto mb-4 max-w-sm" title="This payment was voided">
          {formatDateTime(r.voided.at)} by {r.voided.byName}: “{r.voided.reason}”. Its amounts were reversed in the fund ledger.
        </Alert>
      )}

      <ReceiptCard ref={card} receipt={r} />

      <div className="no-print mx-auto mt-5 grid max-w-sm grid-cols-2 gap-2">
        <Button variant="secondary" onClick={downloadPng} loading={busy === 'png'}>
          <Download className="size-4" aria-hidden /> Image
        </Button>
        <Button variant="secondary" onClick={downloadPdf} loading={busy === 'pdf'}>
          <FileDown className="size-4" aria-hidden /> PDF
        </Button>
        <Button variant="secondary" onClick={print} loading={busy === 'print'}>
          <Printer className="size-4" aria-hidden /> Print
        </Button>
        <Button variant="secondary" onClick={() => setEmailing(true)}>
          <Mail className="size-4" aria-hidden /> Email
        </Button>
        {can('manage') && r.status === 'posted' && ay?.status === 'open' && (
          <Button variant="ghost" className="col-span-2 text-red-700" onClick={() => setVoiding(true)}>
            <Ban className="size-4" aria-hidden /> Void this payment
          </Button>
        )}
      </div>
      {exportError && (
        <Alert className="no-print mx-auto mt-3 max-w-sm">{exportError}</Alert>
      )}

      <ConfirmDialog
        open={emailing}
        title="Email this receipt?"
        description="Sent to the student’s email unless you enter another."
        confirmLabel="Send"
        onConfirm={sendEmail}
        onClose={() => setEmailing(false)}
      >
        <Field label="Send to another address" htmlFor="receipt-email" optional>
          <Input id="receipt-email" type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="student@example.com" />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={voiding}
        title={`Void payment ${r.transactionNo}?`}
        description="It stays on record as voided and its amounts are reversed. This can’t be undone."
        confirmLabel="Void payment"
        tone="danger"
        commentLabel="Reason"
        commentRequired
        onConfirm={voidPayment}
        onClose={() => setVoiding(false)}
      />
    </>
  );
}
