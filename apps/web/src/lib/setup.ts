import type { AyEntry, Me } from './types';

/** May this user run the setup wizard (Copy Wizard) for this AY? Its adviser, or any adviser while it has none. */
export function canRunSetup(me: Me | null, ay: AyEntry | null) {
  if (!me || !ay || !ay.needsSetup || ay.status !== 'open') return false;
  const isItsAdviser = ay.membership?.role === 'adviser' && ay.membership.status === 'active';
  const isAdviserSomewhere = me.academicYears.some((a) => a.membership?.role === 'adviser' && a.membership.status === 'active');
  return isItsAdviser || (!ay.hasAdviser && isAdviserSomewhere);
}
