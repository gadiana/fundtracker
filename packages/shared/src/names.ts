export interface PersonName {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  suffix?: string | null;
}

/** Lowercase, accents removed (ñ → n), no spaces or punctuation: "Dela Cruz, Ma." → "delacruzma" */
export function normalizeNamePart(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Keys used to spot likely duplicate students. They are built from the separate name
 * fields, so "Gadiana, Jhon Ezekiel B." and "Jhon Ezekiel B. Gadiana" give the same key.
 * - exact: first + middle + last + suffix
 * - loose: first + last only (catches a missing or differently written middle name)
 */
export function studentNameKeys(p: PersonName) {
  const first = normalizeNamePart(p.firstName);
  const last = normalizeNamePart(p.lastName);
  return {
    nameKey: first + normalizeNamePart(p.middleName) + last + normalizeNamePart(p.suffix),
    nameKeyLoose: first + last,
  };
}

/**
 * One letter per word of the middle name, so compound surnames keep both parts:
 * "Bautista" → "B.", "Dela Cruz" → "DC.", "del Rosario" → "DR.", "De la Paz" → "DLP."
 */
export function middleInitials(middleName: string | null | undefined): string {
  const words = (middleName ?? '').split(/[\s.-]+/).filter((w) => /\p{L}/u.test(w));
  return words.length ? `${words.map((w) => w.match(/\p{L}/u)![0].toUpperCase()).join('')}.` : '';
}

/** "Jhon Ezekiel B. Gadiana Jr." — used for every name snapshot. */
export function formatPersonName(p: PersonName): string {
  return [p.firstName.trim(), middleInitials(p.middleName), p.lastName.trim(), p.suffix?.trim() ?? '']
    .filter(Boolean)
    .join(' ');
}
