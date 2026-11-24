import type { AySetting } from '@prisma/client';
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from '@sft/shared';
import { prisma } from '../db';

export const getCurrentAy = () => prisma.academicYear.findFirst({ where: { isCurrent: true } });

export const getSettings = (academicYearId: string) => prisma.aySetting.findUnique({ where: { academicYearId } });

export function passwordPolicyFrom(settings: AySetting | null | undefined): PasswordPolicy {
  if (!settings) return DEFAULT_PASSWORD_POLICY;
  return {
    minLength: settings.passwordMinLength,
    requireUpper: settings.passwordRequireUpper,
    requireNumber: settings.passwordRequireNumber,
    requireSymbol: settings.passwordRequireSymbol,
  };
}

export const orgNameFrom = (settings: AySetting | null | undefined) => settings?.orgName || 'Fund Tracker';

interface SecuritySnapshot {
  passwordPolicy: PasswordPolicy;
}

let securityCache: { at: number; value: SecuritySnapshot } | null = null;

/** Security settings of the current AY (cached briefly; they are read on every request). */
export async function getSecurity(): Promise<SecuritySnapshot> {
  if (securityCache && Date.now() - securityCache.at < 15_000) return securityCache.value;
  const ay = await getCurrentAy();
  const settings = ay ? await getSettings(ay.id) : null;
  const value = {
    passwordPolicy: passwordPolicyFrom(settings),
  };
  securityCache = { at: Date.now(), value };
  return value;
}

const twoFactorCache = new Map<string, { at: number; mode: string }>();

/** The AY's two-factor mode: off, optional or required (cached briefly; read on every AY request). */
export async function twoFactorModeFor(academicYearId: string) {
  const hit = twoFactorCache.get(academicYearId);
  if (hit && Date.now() - hit.at < 15_000) return hit.mode;
  const s = await prisma.aySetting.findUnique({ where: { academicYearId }, select: { twofaMode: true } });
  const mode = s?.twofaMode ?? 'off';
  twoFactorCache.set(academicYearId, { at: Date.now(), mode });
  return mode;
}

export function invalidateSecurityCache() {
  securityCache = null;
  twoFactorCache.clear();
}
