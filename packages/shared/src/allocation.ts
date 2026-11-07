/**
 * How a payment is split across a student's charges. Used by the Collection page (to pre-fill
 * and check the form) and by the API (which re-checks everything before saving).
 * All amounts are integer centavos.
 */

export interface ChargeBalance {
  chargeId: string;
  priority: number;
  /** what is still owed on this charge */
  balance: number;
}

export interface Allocation {
  chargeId: string;
  amount: number;
}

/**
 * Fills charges in fund priority order.
 * - With partial payments allowed, each charge takes as much as is left (₱50 → ₱50 of the first fund).
 * - Without, a charge is only taken if the amount can pay it in full; smaller charges further down may still fit.
 */
export function allocateByPriority(charges: ChargeBalance[], amount: number, allowPartial: boolean): Allocation[] {
  let remaining = amount;
  const result: Allocation[] = [];
  for (const c of [...charges].sort((a, b) => a.priority - b.priority)) {
    if (remaining <= 0) break;
    if (c.balance <= 0) continue;
    const take = allowPartial ? Math.min(c.balance, remaining) : c.balance <= remaining ? c.balance : 0;
    if (take > 0) {
      result.push({ chargeId: c.chargeId, amount: take });
      remaining -= take;
    }
  }
  return result;
}

export const totalBalance = (charges: ChargeBalance[]) => charges.reduce((sum, c) => sum + Math.max(0, c.balance), 0);

/** Every reason a payment and its split can't be saved. Empty means it's valid. */
export function allocationProblems(charges: ChargeBalance[], amount: number, allocations: Allocation[], allowPartial: boolean): string[] {
  const problems: string[] = [];
  const owed = totalBalance(charges);
  if (!Number.isInteger(amount) || amount <= 0) problems.push('Enter an amount greater than zero.');
  if (amount > owed) problems.push(`The amount is more than the remaining balance (${formatCentavos(owed)}). Overpayment isn't allowed.`);

  const byId = new Map(charges.map((c) => [c.chargeId, c]));
  const seen = new Set<string>();
  let sum = 0;
  for (const a of allocations) {
    const charge = byId.get(a.chargeId);
    if (!charge) {
      problems.push('A selected fund is not one of this student’s charges.');
      continue;
    }
    if (seen.has(a.chargeId)) problems.push('A fund appears twice in the split.');
    seen.add(a.chargeId);
    if (!Number.isInteger(a.amount) || a.amount <= 0) problems.push('Every amount in the split must be greater than zero.');
    if (a.amount > charge.balance) problems.push(`An amount is more than what is left on that fund (${formatCentavos(charge.balance)}).`);
    if (!allowPartial && a.amount !== charge.balance) problems.push('Partial payments are turned off: each fund in the split must be paid in full.');
    sum += a.amount;
  }
  if (allocations.length && sum !== amount) problems.push(`The split adds up to ${formatCentavos(sum)}, but the amount paid is ${formatCentavos(amount)}.`);
  if (!allocations.length && amount > 0) problems.push('Choose which funds the payment goes to.');
  return [...new Set(problems)];
}

/** Plain peso formatting for messages (the UI uses Intl for display). */
export function formatCentavos(centavos: number) {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}₱${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** YYYY-MM-DD-#### — the counter runs for the whole academic year and only widens past 9999. */
export function formatTransactionNo(date: string, counter: number) {
  return `${date}-${String(counter).padStart(4, '0')}`;
}
