import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, History, RefreshCw } from 'lucide-react';
import { api, describeError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMoney } from '../lib/format';
import type { PaymentRow } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { QrImage } from './QrImage';
import { useToast } from './Toast';
import { Badge, Button, Card, Spinner } from './ui';

export function StudentPaymentsCard({ studentId }: { studentId: string }) {
  const { ay } = useAuth();
  const payments = useQuery({
    queryKey: ['students', ay?.id, 'payments', studentId],
    queryFn: () => api<{ items: PaymentRow[] }>(`/payments?studentId=${studentId}&pageSize=50`),
  });
  return (
    <Card>
      <h2 className="flex items-center gap-2 border-b border-slate-200 px-5 py-3 font-semibold">
        <History className="size-4" aria-hidden /> Payments
      </h2>
      {payments.isLoading ? (
        <div className="p-4 text-center">
          <Spinner />
        </div>
      ) : !payments.data?.items.length ? (
        <p className="px-5 py-4 text-sm text-slate-500">No payments yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {payments.data.items.map((p) => (
            <li key={p.id}>
              <Link to={`/receipts/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block font-mono text-sm">{p.transactionNo}</span>
                  <span className="block text-xs text-slate-500">
                    {formatDateTime(p.receivedAt)} · {p.processedByName}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {p.status === 'voided' && <Badge tone="red">Voided</Badge>}
                  <span className={p.status === 'voided' ? 'tabular-nums text-slate-400 line-through' : 'tabular-nums font-medium'}>{formatMoney(p.amount)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The student's status QR, with a link to the public page and a way to replace a leaked or lost code. */
export function StudentQrPanel({
  studentId,
  name,
  qr,
  canRotate,
}: {
  studentId: string;
  name: string;
  qr: { token: string; verifyPath: string };
  canRotate: boolean;
}) {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rotating, setRotating] = useState(false);
  const url = `${window.location.origin}${qr.verifyPath}`;

  async function rotate() {
    try {
      await api(`/students/${studentId}/qr/rotate`, { method: 'POST' });
    } catch (err) {
      throw new Error(describeError(err));
    }
    await queryClient.invalidateQueries({ queryKey: ['students', ay?.id, 'profile', studentId] });
    toast('A new QR code was issued. Old receipts’ QR codes no longer work.');
  }

  return (
    <>
      <QrImage value={url} label={`Status QR for ${name}`} className="mx-auto size-48" />
      <p className="mt-3 text-xs text-slate-500">
        Printed on every receipt. It opens a private status page (name and Cleared / Has Balance). It never contains the student number.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={qr.verifyPath} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50">
          <ExternalLink className="size-4" aria-hidden /> Status page
        </a>
        {canRotate && (
          <Button size="sm" variant="ghost" onClick={() => setRotating(true)}>
            <RefreshCw className="size-4" aria-hidden /> Replace QR
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={rotating}
        title="Replace this student’s QR code?"
        description="The QR on earlier receipts stops working."
        confirmLabel="Replace QR"
        tone="danger"
        onConfirm={rotate}
        onClose={() => setRotating(false)}
      />
    </>
  );
}
