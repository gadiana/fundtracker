const TIMEZONE = 'Asia/Manila';

const dateTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const dateOnly = new Intl.DateTimeFormat('en-PH', { timeZone: TIMEZONE, year: 'numeric', month: 'short', day: 'numeric' });

/** A missing or unparseable value shows as "—" instead of throwing. */
function safeFormat(format: Intl.DateTimeFormat, value: string | Date | null | undefined) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? format.format(date) : '—';
}

export const formatDateTime = (value: string | Date | null | undefined) => safeFormat(dateTime, value);
export const formatDate = (value: string | Date | null | undefined) => safeFormat(dateOnly, value);

export function timeAgo(value: string | Date) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(value);
}

export const humanize = (s: string) => s.replace(/[_.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });

/** Money is stored as integer centavos: 95000 → ₱950.00 */
export const formatMoney = (centavos: number) => peso.format(centavos / 100);

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB` : `${Math.round(bytes / 1024)} KB`;

const ORDINALS = ['1st', '2nd', '3rd'];
export const yearLevelLabel = (n: number) => `${ORDINALS[n - 1] ?? `${n}th`} year`;
