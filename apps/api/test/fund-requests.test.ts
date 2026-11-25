import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AcademicYear } from '@prisma/client';
import { prisma } from '../src/db';
import { sentMail } from '../src/lib/mailer';
import { createProgram } from './fixtures';
import { createAy, expectStatus, oneReceipt, pngBuffer, registerAndLogin, resetDb, type Client } from './helpers';

let ay: AcademicYear;
let adviser: Client;
let president: Client;
let presidentUserId: string;
let collector: Client;
let auditor: Client;
let auditorUserId: string;
let fundId: string;

async function approve(email: string, designationId: string, names: [string, string]) {
  const c = await registerAndLogin(email, undefined, names);
  const pending = (await adviser.get('/members?status=pending')).body.items.find((m: { user: { email: string } }) => m.user.email === email);
  expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId }), 200);
  return { client: c, userId: pending.user.id as string };
}

async function upload(client: Client) {
  return expectStatus(await client.upload('/uploads', pngBuffer(), 'document.png'), 201).body.id as string;
}

/** A calendar date in Philippine time, `days` from today (negative = in the past). */
const manilaDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86_400_000));

async function fileRequest(client: Client, amount: number, extra: Record<string, unknown> = {}) {
  return client.post('/fund-requests', {
    fundId,
    amount,
    purpose: 'Printing of the October issue',
    useAt: `${manilaDate(7)}T12:00:00+08:00`,
    attachmentIds: [await upload(client)],
    ...extra,
  });
}

const balanceOf = async (id: string) => {
  const [b] = await prisma.$queryRaw<{ balance: bigint; committed: bigint; available: bigint }[]>`SELECT balance, committed, available FROM v_fund_balances WHERE fund_id = ${id}::uuid`;
  return { balance: Number(b!.balance), committed: Number(b!.committed), available: Number(b!.available) };
};

beforeEach(async () => {
  await resetDb();
  const created = await createAy(2026);
  ay = created.ay;
  const bsit = await createProgram(ay.id, 'BSIT');
  const auditorPos = await prisma.designation.create({ data: { academicYearId: ay.id, name: 'Auditor', sortOrder: 2 } });
  adviser = await registerAndLogin('adviser@test.ph', undefined, ['Maria', 'Santos']);
  const p = await approve('president@test.ph', created.designations.president.id, ['Paolo', 'Lim']);
  president = p.client;
  presidentUserId = p.userId;
  collector = (await approve('collector@test.ph', created.designations.collector.id, ['Carlo', 'Reyes'])).client;
  const a = await approve('auditor@test.ph', auditorPos.id, ['Ana', 'Cruz']);
  auditor = a.client;
  auditorUserId = a.userId;

  // a fund with ₱1,000.00 collected from two students
  fundId = expectStatus(
    await adviser.post('/funds', { name: 'Student Fee', amountPerStudent: 50_000, isMandatory: true, isConfidential: false, yearLevels: [1], allPrograms: true }),
    201,
  ).body.fund.id;
  for (const n of ['1001', '1002']) {
    const s = expectStatus(await collector.post('/students', { studentNumber: n, firstName: 'S', lastName: n, programId: bsit.id, yearLevel: 1 }), 201).body;
    expectStatus(await collector.post('/payments', { idempotencyKey: randomUUID(), studentId: s.id, amount: 50_000 }), 201);
  }
  sentMail.length = 0;
});

describe('filing fund requests', () => {
  it('lets positions that may file requests submit one, with name and designation filled in', async () => {
    const r = expectStatus(await fileRequest(president, 30_000), 201).body;
    expect(r).toMatchObject({
      requestNo: 'FR-0001',
      status: 'pending',
      requestorName: 'Paolo Lim',
      requestorDesignation: 'President',
      amount: 30_000,
      fund: { name: 'Student Fee' },
    });
    expect(r.attachments).toHaveLength(1);
    // the adviser (the only approver) is told by email and in-app
    expect(sentMail.some((m) => m.to === 'adviser@test.ph' && m.subject.includes('FR-0001'))).toBe(true);
    expect(await prisma.notification.count({ where: { type: 'fund_request.submitted' } })).toBe(1);
  });

  it('refuses people who may not file, missing attachments and amounts above what is available', async () => {
    expect((await collector.post('/fund-requests', { fundId, amount: 100, purpose: 'Snacks', useAt: '2026-11-01', attachmentIds: [] })).status).toBe(403);
    expect((await fileRequest(president, 1_000, { attachmentIds: [] })).body.error.code).toBe('ATTACHMENT_REQUIRED');
    expect((await fileRequest(president, 100_001)).body.error.code).toBe('INSUFFICIENT_AVAILABLE');
    // someone else's upload can't be attached
    expect((await fileRequest(president, 1_000, { attachmentIds: [await upload(adviser)] })).body.error.code).toBe('BAD_ATTACHMENT');
  });

  it('accepts today or a later date of use, never an earlier one', async () => {
    expect((await fileRequest(president, 1_000, { useAt: `${manilaDate(-1)}T12:00:00+08:00` })).body.error.code).toBe('DATE_IN_PAST');
    // late evening today in Manila still counts as today
    expectStatus(await fileRequest(president, 1_000, { useAt: `${manilaDate(0)}T23:30:00+08:00` }), 201);
    expectStatus(await fileRequest(president, 1_000, { useAt: `${manilaDate(0)}T00:30:00+08:00` }), 201);
  });
});

describe('approving requests', () => {
  it('reserves the amount on approval without touching the balance', async () => {
    const r = expectStatus(await fileRequest(president, 30_000), 201).body;
    expect((await president.post(`/fund-requests/${r.id}/approve`)).status).toBe(403); // not an approver
    expect(expectStatus(await adviser.post(`/fund-requests/${r.id}/approve`), 200).body.final).toBe(true);

    expect(await balanceOf(fundId)).toEqual({ balance: 100_000, committed: 30_000, available: 70_000 });
    const detail = expectStatus(await president.get(`/fund-requests/${r.id}`), 200).body;
    expect(detail.request).toMatchObject({ status: 'approved', approvedByName: 'Maria Santos' });
    expect(detail.viewer.canSubmitReceipt).toBe(true);
    expect(sentMail.some((m) => m.to === 'president@test.ph' && m.subject.includes('approved'))).toBe(true);
  });

  it('never lets approved requests together exceed the fund', async () => {
    const a = expectStatus(await fileRequest(president, 60_000), 201).body;
    const b = expectStatus(await fileRequest(president, 60_000), 201).body;
    expectStatus(await adviser.post(`/fund-requests/${a.id}/approve`), 200);
    const second = await adviser.post(`/fund-requests/${b.id}/approve`);
    expect(second.body.error.code).toBe('INSUFFICIENT_AVAILABLE');
    expect((await prisma.fundRequest.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('pending');
  });

  it('rejects with an optional comment and tells the requestor', async () => {
    const r = expectStatus(await fileRequest(president, 10_000), 201).body;
    expectStatus(await adviser.post(`/fund-requests/${r.id}/reject`, { comment: 'Use the other fund' }), 200);
    const detail = expectStatus(await president.get(`/fund-requests/${r.id}`), 200).body.request;
    expect(detail).toMatchObject({ status: 'rejected', rejectionComment: 'Use the other fund', rejectedByName: 'Maria Santos' });
    expect(sentMail.some((m) => m.to === 'president@test.ph' && m.text.includes('Use the other fund'))).toBe(true);
  });

  it('waits for every approver when the rule says all must approve', async () => {
    expectStatus(await adviser.put(`/approvers/${auditorUserId}`, { approvesFundRequests: true, approvesLiquidations: true }), 200);
    expectStatus(await adviser.patch('/settings', { requestApprovalRule: 'all_required' }), 200);
    const r = expectStatus(await fileRequest(president, 10_000), 201).body;

    expect(expectStatus(await adviser.post(`/fund-requests/${r.id}/approve`), 200).body.final).toBe(false);
    expect((await adviser.post(`/fund-requests/${r.id}/approve`)).body.error.code).toBe('ALREADY_DECIDED');
    const inbox = expectStatus(await auditor.get('/fund-requests?scope=inbox'), 200).body.items;
    expect(inbox.map((i: { id: string }) => i.id)).toEqual([r.id]);
    expect(expectStatus(await auditor.post(`/fund-requests/${r.id}/approve`), 200).body.final).toBe(true);
    expect((await prisma.fundRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('approved');
  });

  it('doesn’t let other approvers approve their own request', async () => {
    expectStatus(await adviser.put(`/approvers/${presidentUserId}`, { approvesFundRequests: true, approvesLiquidations: true }), 200);
    const r = expectStatus(await fileRequest(president, 5_000), 201).body;
    const res = await president.post(`/fund-requests/${r.id}/approve`);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('your own request');
    const approvals = expectStatus(await adviser.get(`/fund-requests/${r.id}`), 200).body.approvals.request;
    expect(approvals.map((a: { name: string }) => a.name)).toEqual(['Maria Santos']);
  });

  it('lets the adviser approve their own request and receipt, marked as self-approved', async () => {
    const r = expectStatus(await fileRequest(adviser, 20_000), 201).body;
    // nobody is notified about their own request
    expect(await prisma.notification.count({ where: { type: 'fund_request.submitted' } })).toBe(0);

    const before = expectStatus(await adviser.get(`/fund-requests/${r.id}`), 200).body;
    expect(before.viewer).toMatchObject({ canDecide: true, noApprovers: false });
    expect(before.approvals.request).toEqual([{ name: 'Maria Santos', designation: 'Adviser', decision: null, isRequestor: true }]);
    expect(expectStatus(await adviser.post(`/fund-requests/${r.id}/approve`), 200).body.final).toBe(true);

    expectStatus(await adviser.post(`/fund-requests/${r.id}/liquidations`, oneReceipt(18_000, [await upload(adviser)])), 201);
    const lid = (await prisma.liquidationReceipt.findFirstOrThrow({ where: { fundRequestId: r.id } })).id;
    expectStatus(await adviser.post(`/fund-requests/${r.id}/liquidations/${lid}/approve`, {}), 200);

    const detail = expectStatus(await adviser.get(`/fund-requests/${r.id}`), 200).body;
    // ₱20.00 of change is still to be returned
    expect(detail.request).toMatchObject({ status: 'settlement_due', selfApproved: true, approvedByName: 'Maria Santos' });
    expect(detail.request.liquidations[0].selfApproved).toBe(true);
    expect(detail.approvals.request[0]).toMatchObject({ decision: 'approved', isRequestor: true });
    expect(await balanceOf(fundId)).toEqual({ balance: 82_000, committed: 0, available: 82_000 });

    const audits = await prisma.auditLog.findMany({ where: { action: 'approve', entityType: { in: ['fund_request', 'liquidation_receipt'] } }, orderBy: { id: 'asc' } });
    expect(audits.map((a) => [a.entityType, (a.afterData as { selfApproved?: boolean }).selfApproved])).toEqual([
      ['fund_request', true],
      ['liquidation_receipt', true],
    ]);
    expect(await prisma.notification.count({ where: { entityType: 'fund_request' } })).toBe(0);
    expect(sentMail).toHaveLength(0);
  });

  it('still needs the other approvers when the adviser files under the all-required rule', async () => {
    expectStatus(await adviser.put(`/approvers/${auditorUserId}`, { approvesFundRequests: true, approvesLiquidations: true }), 200);
    expectStatus(await adviser.patch('/settings', { requestApprovalRule: 'all_required' }), 200);
    const r = expectStatus(await fileRequest(adviser, 10_000), 201).body;
    // the other approver is told; the adviser isn't told about their own request
    expect(sentMail.map((m) => m.to)).toEqual(['auditor@test.ph']);

    expect(expectStatus(await adviser.post(`/fund-requests/${r.id}/approve`), 200).body.final).toBe(false);
    expect(expectStatus(await auditor.post(`/fund-requests/${r.id}/approve`), 200).body.final).toBe(true);
    const detail = expectStatus(await adviser.get(`/fund-requests/${r.id}`), 200).body.request;
    expect(detail).toMatchObject({ status: 'approved', selfApproved: true, approvedByName: 'Ana Cruz' });
  });

  it('doesn’t mark requests approved by someone else as self-approved', async () => {
    const r = expectStatus(await fileRequest(president, 5_000), 201).body;
    expectStatus(await adviser.post(`/fund-requests/${r.id}/approve`), 200);
    expect(expectStatus(await president.get(`/fund-requests/${r.id}`), 200).body.request.selfApproved).toBe(false);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'approve', entityType: 'fund_request' } });
    expect(audit.afterData).not.toHaveProperty('selfApproved');
  });

  it('lets only the adviser cancel an approved request, freeing the reservation', async () => {
    const r = expectStatus(await fileRequest(president, 40_000), 201).body;
    expectStatus(await adviser.post(`/fund-requests/${r.id}/approve`), 200);
    expect((await president.post(`/fund-requests/${r.id}/cancel`, { reason: 'Not needed anymore' })).status).toBe(403);
    expectStatus(await adviser.post(`/fund-requests/${r.id}/cancel`, { reason: 'Event was moved' }), 200);
    expect(await balanceOf(fundId)).toEqual({ balance: 100_000, committed: 0, available: 100_000 });
    expect((await president.post(`/fund-requests/${r.id}/liquidations`, oneReceipt(100, [await upload(president)]))).body.error.code).toBe('NOT_APPROVED');
  });
});

describe('liquidation receipts', () => {
  async function approved(amount: number) {
    const r = expectStatus(await fileRequest(president, amount), 201).body;
    expectStatus(await adviser.post(`/fund-requests/${r.id}/approve`), 200);
    return r.id as string;
  }

  it('deducts the amount actually used, only when the receipt is approved', async () => {
    const id = await approved(300_00);
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, oneReceipt(25_060, [await upload(president)], { remarks: 'Print shop receipt' })), 201);
    expect((await prisma.fundRequest.findUniqueOrThrow({ where: { id } })).status).toBe('receipt_submitted');
    // submitting changes nothing in the ledger
    expect(await balanceOf(fundId)).toEqual({ balance: 100_000, committed: 30_000, available: 70_000 });

    const detail = expectStatus(await adviser.get(`/fund-requests/${id}`), 200).body;
    expect(detail.viewer.canReviewReceipt).toBe(true);
    const lid = detail.request.liquidations[0].id;
    expectStatus(await adviser.post(`/fund-requests/${id}/liquidations/${lid}/approve`, {}), 200);

    // ₱49.40 of the cash advance was not used: the request waits until the change is returned
    expect((await prisma.fundRequest.findUniqueOrThrow({ where: { id } })).status).toBe('settlement_due');
    expect(await balanceOf(fundId)).toEqual({ balance: 74_940, committed: 0, available: 74_940 });
    const usage = await prisma.fundLedger.findFirstOrThrow({ where: { entryType: 'usage' } });
    expect(usage).toMatchObject({ amount: -25_060n, label: 'Fund use FR-0001: Printing of the October issue', createdByName: 'Maria Santos' });
    expect(sentMail.some((m) => m.to === 'president@test.ph' && m.text.includes('return the change of ₱49.40'))).toBe(true);

    const due = expectStatus(await collector.get(`/fund-requests/${id}`), 200).body;
    expect(due.request.liquidations[0]).toMatchObject({ chargedAmount: 25_060, settlement: { kind: 'return', amount: 4_940, settledAt: null } });
    expect(due.viewer.canSettle).toBe(true);
    expect(expectStatus(await collector.get('/fund-requests/counts'), 200).body.toApprove).toBe(1);
    // the requestor can't record their own returned change
    expect(expectStatus(await president.get(`/fund-requests/${id}`), 200).body.viewer.canSettle).toBe(false);
    expect((await president.post(`/fund-requests/${id}/settle`, {})).status).toBe(403);

    expectStatus(await collector.post(`/fund-requests/${id}/settle`, { note: 'Cash received' }), 200);
    const done = await prisma.fundRequest.findUniqueOrThrow({ where: { id }, include: { liquidations: true } });
    expect(done.status).toBe('cleared');
    expect(done.clearedAt).not.toBeNull();
    expect(done.liquidations[0]).toMatchObject({ settledByName: 'Carlo Reyes', settlementNote: 'Cash received' });
    // recording the change moves no money in the ledger
    expect(await balanceOf(fundId)).toEqual({ balance: 74_940, committed: 0, available: 74_940 });
    expect((await collector.post(`/fund-requests/${id}/settle`, {})).status).toBe(404);
    expect((await adviser.post(`/fund-requests/${id}/settle`, {})).body.error.code).toBe('NOTHING_TO_SETTLE');
  });

  it('clears at once when exactly the approved amount was used', async () => {
    const id = await approved(10_000);
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, oneReceipt(10_000, [await upload(president)])), 201);
    const lid = (await prisma.liquidationReceipt.findFirstOrThrow({ where: { fundRequestId: id } })).id;
    expectStatus(await adviser.post(`/fund-requests/${id}/liquidations/${lid}/approve`, {}), 200);
    const r = await prisma.fundRequest.findUniqueOrThrow({ where: { id }, include: { liquidations: true } });
    expect(r.status).toBe('cleared');
    expect(r.liquidations[0]).toMatchObject({ chargedAmount: 10_000n, settlementKind: null });
  });

  it('reimburses the excess when the approver accepts the higher amount, with the signed slip in the report', async () => {
    const id = await approved(20_000);
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, oneReceipt(25_000, [await upload(president)])), 201);
    const lid = (await prisma.liquidationReceipt.findFirstOrThrow({ where: { fundRequestId: id } })).id;
    expectStatus(await adviser.post(`/fund-requests/${id}/liquidations/${lid}/approve`, { overAmount: 'reimburse' }), 200);
    expect((await prisma.fundRequest.findUniqueOrThrow({ where: { id } })).status).toBe('settlement_due');
    expect((await balanceOf(fundId)).balance).toBe(75_000);
    expect(sentMail.some((m) => m.to === 'president@test.ph' && m.text.includes('The fund owes you ₱50.00'))).toBe(true);

    const slip = await upload(collector);
    expectStatus(await collector.post(`/fund-requests/${id}/settle`, { note: 'Paid in cash', attachmentId: slip }), 200);
    const detail = expectStatus(await president.get(`/fund-requests/${id}`), 200).body;
    expect(detail.request.status).toBe('cleared');
    expect(detail.request.liquidations[0].settlement).toMatchObject({ kind: 'reimburse', amount: 5_000, settledByName: 'Carlo Reyes', note: 'Paid in cash', file: { id: slip } });
    // whoever may see the request can open the slip
    expectStatus(await president.get(`/files/${slip}`), 200);
    expect(sentMail.some((m) => m.to === 'president@test.ph' && m.text.includes('₱50.00 was reimbursed to you'))).toBe(true);

    const doc = expectStatus(await president.get(`/reports/liquidation?requestId=${id}`), 200).body;
    expect(doc.summary).toEqual([
      { label: 'Cash advance (approved)', value: 20_000, type: 'money' },
      { label: 'Total liquidated', value: 25_000, type: 'money' },
      { label: 'Excess reimbursed to Paolo Lim', value: 5_000, type: 'money' },
      { label: 'Receipts', value: 1, type: 'number' },
    ]);
    expect(doc.notes.join(' ')).toContain('PHP 50.00 was reimbursed to Paolo Lim');
    expect(doc.signatories.map((s: { label: string }) => s.label)).toEqual(['Prepared by', 'Approved by', 'Noted by', 'Reimbursement received by']);
    expect(doc.annex.groups.map((g: { ref: string }) => g.ref)).toEqual(['R-1', 'Settlement']);
  });

  it('charges only the approved amount when the requestor absorbs the excess', async () => {
    const id = await approved(20_000);
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, oneReceipt(25_000, [await upload(president)])), 201);
    const lid = (await prisma.liquidationReceipt.findFirstOrThrow({ where: { fundRequestId: id } })).id;
    expectStatus(await adviser.post(`/fund-requests/${id}/liquidations/${lid}/approve`, { overAmount: 'absorb' }), 200);
    const r = await prisma.fundRequest.findUniqueOrThrow({ where: { id }, include: { liquidations: true } });
    expect(r.status).toBe('cleared');
    expect(r.liquidations[0]).toMatchObject({ chargedAmount: 20_000n, settlementKind: null, overApprovedAccepted: false });
    expect(await balanceOf(fundId)).toEqual({ balance: 80_000, committed: 0, available: 80_000 });

    const doc = expectStatus(await adviser.get(`/reports/liquidation?requestId=${id}`), 200).body;
    expect(doc.summary.map((s: { label: string; value: number }) => [s.label, s.value])).toEqual([
      ['Cash advance (approved)', 20_000],
      ['Total liquidated', 25_000],
      ['Charged to the fund', 20_000],
      ['Excess absorbed by the requestor', 5_000],
      ['Receipts', 1],
    ]);
    const usage = expectStatus(await adviser.get('/reports/fund-usage'), 200).body;
    expect(usage.summary.find((s: { label: string }) => s.label === 'Used (cleared)').value).toBe(20_000);
  });

  it('takes several receipts with their items, totals them, and keeps each receipt’s files apart', async () => {
    const id = await approved(500_00);
    const [fairPhoto, bookPhoto, bookPdf] = [await upload(president), await upload(president), await upload(president)];
    const body = {
      remarks: 'Fair week',
      receipts: [
        { usedFor: 'Booth for the fair', payee: 'Event Supplies Co.', receiptNo: 'OR-551', receiptDate: manilaDate(-1), items: [{ description: 'Booth rental', quantity: 1, unitCost: 250_00 }], attachmentIds: [fairPhoto] },
        {
          usedFor: 'School supplies',
          receiptDate: manilaDate(0),
          items: [
            { description: 'Book', quantity: 1, unitCost: 100_00 },
            { description: 'Pen', quantity: 3, unitCost: 20_00 },
          ],
          attachmentIds: [bookPhoto, bookPdf],
        },
      ],
    };
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, body), 201);

    const l = (await adviser.get(`/fund-requests/${id}`)).body.request.liquidations[0];
    expect(l.fundUsed).toBe(410_00);
    expect(l.receipts.map((e: { ref: string; total: number; items: unknown[]; attachments: unknown[] }) => [e.ref, e.total, e.items.length, e.attachments.length])).toEqual([
      ['R-1', 250_00, 1, 1],
      ['R-2', 160_00, 2, 2],
    ]);
    expect(l.receipts[1].items[1]).toEqual({ description: 'Pen', quantity: 3, unitCost: 20_00, amount: 60_00 });
    expect(l.receipts[0]).toMatchObject({ usedFor: 'Booth for the fair', payee: 'Event Supplies Co.', receiptNo: 'OR-551', receiptDate: manilaDate(-1) });
    expect(l.attachments).toHaveLength(3);

    // approving deducts the total of all receipts
    expectStatus(await adviser.post(`/fund-requests/${id}/liquidations/${l.id}/approve`, {}), 200);
    expect((await balanceOf(fundId)).balance).toBe(100_000 - 410_00);
  });

  it('checks every receipt: its files, its date and its items', async () => {
    const id = await approved(500_00);
    const file = await upload(president);
    const receipt = (extra: Record<string, unknown>) => ({ usedFor: 'Food', receiptDate: manilaDate(0), items: [{ description: 'Snacks', quantity: 2, unitCost: 50_00 }], attachmentIds: [file], ...extra });
    const post = (receipts: unknown[]) => president.post(`/fund-requests/${id}/liquidations`, { receipts });

    expect((await post([receipt({}), receipt({ attachmentIds: [] })])).body.error).toMatchObject({ code: 'ATTACHMENT_REQUIRED', message: expect.stringContaining('R-2') });
    expect((await post([receipt({ receiptDate: manilaDate(2) })])).body.error.code).toBe('FUTURE_RECEIPT');
    expect((await post([receipt({ items: [] })])).status).toBe(400);
    expect((await post([receipt({ items: [{ description: 'Snacks', quantity: 0, unitCost: 50_00 }] })])).status).toBe(400);
    expect((await post([])).status).toBe(400);
    // one file can't be the photo of two receipts
    expect((await post([receipt({}), receipt({})])).status).toBe(400);
    expect(await prisma.liquidationReceipt.count()).toBe(0);
  });

  it('takes other expenses without a receipt (gas, fares): just items and costs, no photo', async () => {
    const id = await approved(500_00);
    const body = {
      receipts: [
        { usedFor: 'Booth', receiptNo: 'OR-1', receiptDate: manilaDate(0), items: [{ description: 'Tarp', quantity: 1, unitCost: 200_00 }], attachmentIds: [await upload(president)] },
        {
          usedFor: 'Other expenses (no receipt)',
          hasReceipt: false,
          receiptNo: 'ignored',
          receiptDate: manilaDate(0),
          items: [
            { description: 'Gas', quantity: 1, unitCost: 30_00 },
            { description: 'Tricycle fare', quantity: 1, unitCost: 20_00 },
          ],
          attachmentIds: [],
        },
      ],
    };
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, body), 201);

    const l = (await adviser.get(`/fund-requests/${id}`)).body.request.liquidations[0];
    expect(l.fundUsed).toBe(250_00);
    expect(l.receipts[0]).toMatchObject({ ref: 'R-1', hasReceipt: true, receiptNo: 'OR-1' });
    expect(l.receipts[1]).toMatchObject({ ref: 'Other', hasReceipt: false, receiptNo: null, total: 50_00, attachments: [] });

    // the printed liquidation lists them by item and cost only
    const doc = expectStatus(await president.get(`/reports/liquidation?requestId=${id}`), 200).body;
    const other = doc.tables.find((t: { title: string }) => t.title === 'Other expenses (no receipt)');
    expect(other.columns.map((c: { label: string }) => c.label)).toEqual(['Item', 'Cost']);
    expect(other.rows).toEqual([
      { description: 'Gas', amount: 30_00 },
      { description: 'Tricycle fare', amount: 20_00 },
    ]);
  });

  it('lets a revision reuse the files sent the first time, but not files of another request', async () => {
    const id = await approved(100_00);
    const photo = await upload(president);
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, oneReceipt(90_00, [photo])), 201);
    const first = (await prisma.liquidationReceipt.findFirstOrThrow({ where: { fundRequestId: id } })).id;
    expectStatus(await adviser.post(`/fund-requests/${id}/liquidations/${first}/revision`, { message: 'Add the items' }), 200);
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, oneReceipt(95_00, [photo])), 201);

    const other = await approved(100_00);
    expect((await president.post(`/fund-requests/${other}/liquidations`, oneReceipt(50_00, [photo]))).body.error.code).toBe('ALREADY_ATTACHED');
  });

  it('prints a liquidation report with every receipt, and the receipts last', async () => {
    const id = await approved(500_00);
    const body = {
      receipts: [
        { usedFor: 'Booth for the fair', receiptNo: 'OR-551', receiptDate: manilaDate(0), items: [{ description: 'Booth rental', quantity: 1, unitCost: 250_00 }], attachmentIds: [await upload(president)] },
        { usedFor: 'School supplies', receiptDate: manilaDate(0), items: [{ description: 'Book', quantity: 1, unitCost: 100_00 }, { description: 'Pen', quantity: 1, unitCost: 20_00 }], attachmentIds: [await upload(president)] },
      ],
    };
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, body), 201);

    const doc = expectStatus(await president.get(`/reports/liquidation?requestId=${id}`), 200).body;
    expect(doc).toMatchObject({ kind: 'liquidation', title: 'Liquidation report', subtitle: expect.stringContaining('FR-0001') });
    expect(doc.summary).toEqual([
      { label: 'Cash advance (approved)', value: 500_00, type: 'money' },
      { label: 'Total liquidated', value: 370_00, type: 'money' },
      { label: 'Unused (to return)', value: 130_00, type: 'money' },
      { label: 'Receipts', value: 2, type: 'number' },
    ]);
    expect(doc.tables[0]).toMatchObject({ title: 'Summary of receipts', totals: { ref: 'Total', total: 370_00 } });
    expect(doc.tables[0].rows.map((r: { ref: string; total: number }) => [r.ref, r.total])).toEqual([
      ['R-1', 250_00],
      ['R-2', 120_00],
    ]);
    expect(doc.tables[2]).toMatchObject({ title: expect.stringMatching(/^R-2 · School supplies/), totals: { description: 'R-2 total', amount: 120_00 } });
    expect(doc.annex.groups.map((g: { ref: string; files: unknown[] }) => [g.ref, g.files.length])).toEqual([
      ['R-1', 1],
      ['R-2', 1],
    ]);
    expect(doc.signatories.map((s: { label: string }) => s.label)).toEqual(['Prepared by', 'Approved by', 'Noted by']);

    // only people who may open the request
    expect((await collector.get(`/reports/liquidation?requestId=${id}`)).status).toBe(404);
    const unliquidated = await approved(10_00);
    expect((await adviser.get(`/reports/liquidation?requestId=${unliquidated}`)).body.error.code).toBe('NO_LIQUIDATION');
  });

  it('blocks a receipt above the approved amount unless the approver accepts it', async () => {
    const id = await approved(20_000);
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, oneReceipt(25_000, [await upload(president)])), 201);
    const lid = (await prisma.liquidationReceipt.findFirstOrThrow({ where: { fundRequestId: id } })).id;
    expect((await adviser.post(`/fund-requests/${id}/liquidations/${lid}/approve`, {})).body.error.code).toBe('OVER_APPROVED');
    expectStatus(await adviser.post(`/fund-requests/${id}/liquidations/${lid}/approve`, { acceptOverAmount: true }), 200);
    const l = await prisma.liquidationReceipt.findUniqueOrThrow({ where: { id: lid } });
    expect(l).toMatchObject({ status: 'approved', overApprovedAccepted: true, overAcceptedByName: 'Maria Santos' });
    expect((await balanceOf(fundId)).balance).toBe(75_000);
  });

  it('goes back for revision and keeps every version', async () => {
    const id = await approved(10_000);
    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, oneReceipt(9_000, [await upload(president)])), 201);
    const first = (await prisma.liquidationReceipt.findFirstOrThrow({ where: { fundRequestId: id } })).id;
    expectStatus(await adviser.post(`/fund-requests/${id}/liquidations/${first}/revision`, { message: 'The receipt photo is blurry' }), 200);
    expect((await prisma.fundRequest.findUniqueOrThrow({ where: { id } })).status).toBe('revision_requested');
    expect(sentMail.some((m) => m.to === 'president@test.ph' && m.text.includes('blurry'))).toBe(true);

    expectStatus(await president.post(`/fund-requests/${id}/liquidations`, oneReceipt(9_500, [await upload(president)])), 201);
    const versions = await prisma.liquidationReceipt.findMany({ where: { fundRequestId: id }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => [v.version, v.status, Number(v.fundUsed)])).toEqual([
      [1, 'revision_requested', 9_000],
      [2, 'submitted', 9_500],
    ]);
    // the old version can't be approved any more
    expect((await adviser.post(`/fund-requests/${id}/liquidations/${first}/approve`, {})).body.error.code).toBe('NOT_SUBMITTED');
    expectStatus(await adviser.post(`/fund-requests/${id}/liquidations/${versions[1]!.id}/approve`, {}), 200);
    expect((await balanceOf(fundId)).balance).toBe(90_500);
  });

  it('only the requestor submits receipts, and only for approved requests', async () => {
    const pending = expectStatus(await fileRequest(president, 5_000), 201).body;
    expect((await president.post(`/fund-requests/${pending.id}/liquidations`, oneReceipt(100, [await upload(president)]))).body.error.code).toBe('NOT_APPROVED');
    const id = await approved(5_000);
    expect((await adviser.post(`/fund-requests/${id}/liquidations`, oneReceipt(100, [await upload(adviser)]))).status).toBe(403);
    expect((await president.post(`/fund-requests/${id}/liquidations`, oneReceipt(100, []))).body.error.code).toBe('ATTACHMENT_REQUIRED');
  });
});

describe('the to-approve count', () => {
  it('counts requests and receipts waiting for this person only', async () => {
    const counts = async (c: Client) => expectStatus(await c.get('/fund-requests/counts'), 200).body.toApprove;
    const a = expectStatus(await fileRequest(president, 1_000), 201).body;
    expectStatus(await fileRequest(president, 2_000), 201);
    expect(await counts(adviser)).toBe(2);
    expect(await counts(president)).toBe(0); // the requestor doesn't approve
    expect(await counts(auditor)).toBe(0); // not an approver

    expectStatus(await adviser.post(`/fund-requests/${a.id}/approve`), 200);
    expect(await counts(adviser)).toBe(1);
    expectStatus(await president.post(`/fund-requests/${a.id}/liquidations`, oneReceipt(900, [await upload(president)])), 201);
    expect(await counts(adviser)).toBe(2); // the receipt is waiting now
  });

  it('splits what waits between Fund requests and Liquidations, and lists each stage on its own page', async () => {
    const a = expectStatus(await fileRequest(president, 1_000), 201).body;
    const b = expectStatus(await fileRequest(president, 2_000), 201).body;
    const counts = async (c: Client) => expectStatus(await c.get('/fund-requests/counts'), 200).body;
    expect(await counts(president)).toMatchObject({ requests: 0, liquidations: 0, toLiquidate: 0 });

    expectStatus(await adviser.post(`/fund-requests/${a.id}/approve`), 200);
    expect(await counts(president)).toMatchObject({ toLiquidate: 1 }); // approved: the requestor liquidates it
    expectStatus(await president.post(`/fund-requests/${a.id}/liquidations`, oneReceipt(900, [await upload(president)])), 201);
    expect(await counts(president)).toMatchObject({ toLiquidate: 0 });
    expect(await counts(adviser)).toMatchObject({ toApprove: 2, requests: 1, liquidations: 1 });

    const ids = async (c: Client, query: string) => expectStatus(await c.get(`/fund-requests?${query}`), 200).body.items.map((r: { id: string }) => r.id);
    expect(await ids(adviser, 'scope=inbox&stage=request')).toEqual([b.id]);
    expect(await ids(adviser, 'scope=inbox&stage=liquidation')).toEqual([a.id]);
    expect(await ids(president, 'scope=mine&stage=liquidation')).toEqual([a.id]); // the pending one isn't liquidated yet
    expect((await ids(president, 'scope=mine')).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('archiving', () => {
  async function cleared() {
    const r = expectStatus(await fileRequest(president, 1_000), 201).body;
    expectStatus(await adviser.post(`/fund-requests/${r.id}/approve`), 200);
    expectStatus(await president.post(`/fund-requests/${r.id}/liquidations`, oneReceipt(1_000, [await upload(president)])), 201);
    const lid = (await prisma.liquidationReceipt.findFirstOrThrow({ where: { fundRequestId: r.id } })).id;
    expectStatus(await adviser.post(`/fund-requests/${r.id}/liquidations/${lid}/approve`, {}), 200);
    return r.id as string;
  }
  const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

  it('moves a finished request out of the lists and into Archived, and back', async () => {
    const id = await cleared();
    expect(expectStatus(await president.get(`/fund-requests/${id}`), 200).body.viewer.canArchive).toBe(true);
    expectStatus(await president.post(`/fund-requests/${id}/archive`), 200);

    expect(ids(await president.get('/fund-requests?scope=mine'))).toEqual([]);
    expect(ids(await adviser.get('/fund-requests?scope=all'))).toEqual([]);
    expect(ids(await president.get('/fund-requests?scope=archived'))).toEqual([id]);
    expect(ids(await adviser.get('/fund-requests?scope=archived'))).toEqual([id]);
    const detail = expectStatus(await adviser.get(`/fund-requests/${id}`), 200).body;
    expect(detail.request).toMatchObject({ archivedByName: 'Paolo Lim' });
    expect(detail.viewer).toMatchObject({ canArchive: false, canUnarchive: true });
    // the money side is untouched
    expect((await balanceOf(fundId)).balance).toBe(99_000);

    expect((await president.post(`/fund-requests/${id}/archive`)).body.error.code).toBe('ALREADY_ARCHIVED');
    expectStatus(await adviser.post(`/fund-requests/${id}/unarchive`), 200);
    expect(ids(await president.get('/fund-requests?scope=mine'))).toEqual([id]);
    const audits = await prisma.auditLog.findMany({ where: { entityId: id, action: { in: ['archive', 'unarchive'] } }, orderBy: { id: 'asc' } });
    expect(audits.map((a) => [a.action, a.actorName])).toEqual([
      ['archive', 'Paolo Lim'],
      ['unarchive', 'Maria Santos'],
    ]);
  });

  it('only archives finished requests, and only for the requestor or the adviser', async () => {
    const open = expectStatus(await fileRequest(president, 1_000), 201).body;
    expect((await president.post(`/fund-requests/${open.id}/archive`)).body.error.code).toBe('NOT_FINISHED');
    expectStatus(await adviser.post(`/fund-requests/${open.id}/reject`, {}), 200);
    expectStatus(await adviser.post(`/fund-requests/${open.id}/archive`), 200); // rejected counts as finished

    const id = await cleared();
    expectStatus(await adviser.put(`/approvers/${auditorUserId}`, { approvesFundRequests: true, approvesLiquidations: true }), 200);
    expect((await auditor.post(`/fund-requests/${id}/archive`)).status).toBe(403);
    // the database refuses an archived request that isn't finished
    await expect(prisma.fundRequest.update({ where: { id: open.id }, data: { status: 'pending' } })).rejects.toThrow(/ck_fund_requests_archive_finished/);
  });
});

describe('privacy of requests and attachments', () => {
  it('shows attachments only to the requestor, approvers and the adviser', async () => {
    const r = expectStatus(await fileRequest(president, 1_000), 201).body;
    const url = r.attachments[0].url.replace('/api', '');
    expect((await president.get(url)).status).toBe(200);
    expect((await adviser.get(url)).status).toBe(200);
    expect((await collector.get(url)).status).toBe(404);
    expect((await collector.get(`/fund-requests/${r.id}`)).status).toBe(404);
  });

  it('keeps requests for confidential funds away from approvers who may not see them', async () => {
    expectStatus(await adviser.put(`/approvers/${auditorUserId}`, { approvesFundRequests: true, approvesLiquidations: true }), 200);
    await prisma.fund.update({ where: { id: fundId }, data: { isConfidential: true } });
    const presidentPos = await prisma.designation.findFirstOrThrow({ where: { academicYearId: ay.id, name: 'President' } });
    await prisma.designation.update({ where: { id: presidentPos.id }, data: { isConfidentialExempt: true } });

    const r = expectStatus(await fileRequest(president, 1_000), 201).body;
    expect((await auditor.get('/fund-requests?scope=inbox')).body.items).toHaveLength(0);
    expect((await auditor.get(`/fund-requests/${r.id}`)).status).toBe(404);
    expect((await auditor.post(`/fund-requests/${r.id}/approve`)).status).toBe(404);
    expectStatus(await adviser.post(`/fund-requests/${r.id}/approve`), 200);
  });

  it('is read-only in a closed academic year', async () => {
    const r = expectStatus(await fileRequest(president, 1_000), 201).body;
    await prisma.academicYear.update({ where: { id: ay.id }, data: { status: 'closed', isCurrent: true } });
    expect((await adviser.post(`/fund-requests/${r.id}/approve`)).body.error.code).toBe('AY_CLOSED');
    expectStatus(await adviser.get(`/fund-requests/${r.id}`), 200);
  });
});
