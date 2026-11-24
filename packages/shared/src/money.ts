/** Money is always integer centavos (₱1.00 = 100). These helpers never use floating-point math on stored values. */

export const MAX_CENTAVOS = 1_000_000_000; // ₱10,000,000.00

/** "1,234.5" → 123450. Returns null for anything that isn't a valid peso amount with at most 2 decimals. */
export function parsePesos(input: string): number | null {
  const s = input.trim().replace(/[₱,\s]/g, '').replace(/^PHP/i, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  const negative = s.startsWith('-');
  const [whole, fraction = ''] = s.replace('-', '').split('.');
  const centavos = Number.parseInt(whole!, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(centavos) || centavos > MAX_CENTAVOS) return null;
  return negative ? -centavos : centavos;
}

/** 123450 → "1234.50" (for input fields). */
export function centavosToInput(centavos: number) {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
