import type { AySetting } from '@prisma/client';
import { PUBLIC_FIELDS_ALWAYS, PUBLIC_FIELDS_OPTIONAL, type PublicFieldOption } from '@sft/shared';

export type LogoKind = 'org' | 'receipt';

export const logoUrl = (academicYearId: string, kind: LogoKind, fileId: string) =>
  `/api/public/ays/${academicYearId}/logo?kind=${kind}&v=${fileId.slice(0, 8)}`;

/** Only the optional extras; name and status are always on the public page. */
export function optionalPublicFields(stored: unknown): PublicFieldOption[] {
  const list = Array.isArray(stored) ? stored : [];
  return PUBLIC_FIELDS_OPTIONAL.filter((f) => list.includes(f));
}

export const storedPublicFields = (extras: PublicFieldOption[]) => [...PUBLIC_FIELDS_ALWAYS, ...extras];

export function serializeSettings(s: AySetting) {
  const { updatedById: _updatedById, publicFields, ...rest } = s;
  return {
    ...rest,
    publicFields: optionalPublicFields(publicFields),
    logoUrl: s.logoFileId ? logoUrl(s.academicYearId, 'org', s.logoFileId) : null,
    receiptLogoUrl: s.receiptLogoFileId ? logoUrl(s.academicYearId, 'receipt', s.receiptLogoFileId) : null,
  };
}

export const SECURITY_KEYS = [
  'passwordMinLength',
  'passwordRequireUpper',
  'passwordRequireNumber',
  'passwordRequireSymbol',
  'twofaMode',
] as const;

/** Before/after of just the fields that actually changed (for the audit log). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}
