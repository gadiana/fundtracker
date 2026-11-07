// The wording of every email lives in the notification catalog (@sft/shared, editable per AY).
// This file only builds the receipt itself, which goes under the editable message.
import { escapeHtml } from '@sft/shared';

export interface ReceiptEmailData {
  studentName: string;
  transactionNo: string;
  academicYear: string;
  amount: string;
  dateTime: string;
  processedBy: string;
  lines: { fund: string; amount: string; remaining: string }[];
  balanceAfter: string;
  cleared: boolean;
  qrMessage: string;
  footer: string;
  verifyUrl: string;
  voided: boolean;
}

/** The digital receipt for an email. The status QR is attached and shown inline as cid:status-qr. */
export function receiptBlock(r: ReceiptEmailData) {
  const cell = 'padding:6px 0;border-bottom:1px solid #e2e8f0';
  const rows = r.lines
    .map(
      (l) =>
        `<tr><td style="${cell}">${escapeHtml(l.fund)}</td><td style="${cell};text-align:right">${escapeHtml(l.amount)}</td><td style="${cell};text-align:right;color:#64748b">${escapeHtml(l.remaining)} left</td></tr>`,
    )
    .join('');
  const status = r.cleared
    ? '<span style="color:#047857;font-weight:600">Cleared</span>'
    : `<span style="color:#b91c1c;font-weight:600">Remaining balance: ${escapeHtml(r.balanceAfter)}</span>`;
  const html = `<div style="margin-top:20px;padding:16px;border:1px solid #e2e8f0;border-radius:12px">
    <p style="margin:0 0 4px;font-size:13px;color:#64748b">${r.voided ? 'VOIDED receipt' : 'Payment received'}</p>
    <p style="margin:0 0 8px;font-size:28px;font-weight:700">${escapeHtml(r.amount)}</p>
    <p style="margin:0 0 12px">${escapeHtml(r.studentName)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
    <p style="margin:12px 0">${status}</p>
    <div style="text-align:center;margin:20px 0"><img src="cid:status-qr" alt="Status QR" width="160" height="160" /><p style="margin:6px 0 0;font-size:13px;color:#475569">${escapeHtml(r.qrMessage)}</p></div>
    <p style="margin:0;font-size:13px;color:#475569">Processed by: ${escapeHtml(r.processedBy)}</p>
    <p style="margin:12px 0 0;font-size:12px;color:#64748b">Transaction no. ${escapeHtml(r.transactionNo)}<br>AY. ${escapeHtml(r.academicYear)}<br>${escapeHtml(r.dateTime)}</p>
    ${r.footer ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b">${escapeHtml(r.footer)}</p>` : ''}
  </div>`;
  const text = [
    r.voided ? 'VOIDED receipt' : 'Payment received',
    `${r.amount} from ${r.studentName}`,
    ...r.lines.map((l) => `- ${l.fund}: ${l.amount} (${l.remaining} left)`),
    r.cleared ? 'Status: Cleared' : `Remaining balance: ${r.balanceAfter}`,
    `${r.qrMessage}: ${r.verifyUrl}`,
    `Processed by: ${r.processedBy}`,
    `Transaction no. ${r.transactionNo} · AY. ${r.academicYear} · ${r.dateTime}`,
  ].join('\n');
  return { html, text };
}
