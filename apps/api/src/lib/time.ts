/** How far `timeZone` is ahead of UTC at `at`, in ms (Manila: +8 h). */
function zoneOffset(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return asUtc - at.getTime();
}

/** The moment a calendar day (yyyy-mm-dd) starts in `timeZone`. */
export function startOfDay(day: string, timeZone: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - zoneOffset(guess, timeZone));
}

/** The moment the day AFTER `day` starts, so "to" dates include the whole day. */
export function endOfDayExclusive(day: string, timeZone: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return startOfDay(next, timeZone);
}

export const formatDayLabel = (day: string) =>
  new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(`${day}T00:00:00Z`));

/** "Oct 1, 2026 – Oct 31, 2026", "From Oct 1, 2026", "Until …" or "All dates". */
export function periodLabel(from?: string, to?: string) {
  if (from && to) return `${formatDayLabel(from)} – ${formatDayLabel(to)}`;
  if (from) return `From ${formatDayLabel(from)}`;
  if (to) return `Until ${formatDayLabel(to)}`;
  return 'All dates';
}
