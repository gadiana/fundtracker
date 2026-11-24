import QRCode from 'qrcode';
import { formatCentavos } from '@sft/shared';
import type { Actor } from '../../lib/audit';
import { receiptBlock } from '../../lib/emails';
import { sendEvent } from '../../lib/events';
import { receiptFor } from './service';

type Receipt = Awaited<ReturnType<typeof receiptFor>>;

/**
 * Emails the digital receipt with its status QR. Staff asking for it always sends it; after a
 * payment it is sent automatically only if the AY turned that on.
 */
export async function emailReceipt(receipt: Receipt, ayId: string, to: string, actor: Actor, { automatic = false } = {}) {
  const dateTime = new Intl.DateTimeFormat('en-PH', { timeZone: receipt.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(receipt.receivedAt);
  const qrPng = await QRCode.toBuffer(receipt.qrUrl, { width: 320, margin: 1 });
  const block = receiptBlock({
    studentName: receipt.student.name,
    transactionNo: receipt.transactionNo,
    academicYear: receipt.academicYear,
    amount: formatCentavos(receipt.amount),
    dateTime,
    processedBy: receipt.processedByName,
    lines: receipt.allocations.map((a) => ({ fund: a.fundName, amount: formatCentavos(a.amount), remaining: formatCentavos(a.remainingOnFund) })),
    balanceAfter: formatCentavos(receipt.balanceAfter),
    cleared: receipt.clearedAfter,
    qrMessage: receipt.qrMessage,
    footer: receipt.footer,
    verifyUrl: receipt.qrUrl,
    voided: receipt.status === 'voided',
  });
  const { emailed } = await sendEvent('payment.receipt', {
    ayId,
    to: [{ email: to, name: receipt.student.name }],
    vars: { studentName: receipt.student.name, transactionNo: receipt.transactionNo, amount: formatCentavos(receipt.amount) },
    attachments: [{ filename: 'status-qr.png', content: qrPng, cid: 'status-qr', contentType: 'image/png' }],
    extra: () => block,
    entityType: 'payment',
    entityId: receipt.id,
    requestedBy: actor,
    forceEmail: !automatic,
  });
  return emailed > 0;
}
