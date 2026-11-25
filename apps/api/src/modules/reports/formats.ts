import type { AySetting } from '@prisma/client';
import { REPORT_KINDS, reportFormatSchema, type ReportFormat, type ReportKind, type ReportLogo } from '@sft/shared';
import { logoUrl } from '../settings/service';

/**
 * A report's format before the adviser changes it: the organization's logo and name centered,
 * and the report's preparer as the signatory. The liquidation report names its own signatories
 * (who prepared, approved and received the money), so it has none by default.
 */
export function defaultReportFormat(kind: ReportKind, s: AySetting): ReportFormat {
  const school = [s.collegeName, s.schoolName].filter(Boolean).join(' · ');
  return {
    paperSize: s.reportPaperSize,
    logosLeft: s.logoFileId ? ['org'] : [],
    logosRight: [],
    logoSize: 56,
    logoPlacement: 'edges',
    logoGap: 12,
    headerLines: [
      { text: s.orgName || 'Fund Tracker', bold: true, size: 16, align: 'center' },
      ...(school ? [{ text: school, bold: false, size: 11, align: 'center' as const }] : []),
      { text: 'Academic year {year}', bold: false, size: 11, align: 'center' },
      ...(s.reportHeaderText ? [{ text: s.reportHeaderText, bold: false, size: 10, align: 'center' as const }] : []),
    ],
    signatories:
      kind === 'liquidation'
        ? []
        : [{ label: 'Prepared by', name: s.reportPreparedByName ?? '', position: s.reportPreparedByTitle ?? '', show: true }],
  };
}

/** Every report's format: what the adviser saved, else the default. */
export function reportFormats(s: AySetting): Record<ReportKind, ReportFormat> {
  const stored = (s.reportFormats ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    REPORT_KINDS.map((kind) => {
      const saved = reportFormatSchema.safeParse(stored[kind]);
      return [kind, saved.success ? saved.data : defaultReportFormat(kind, s)];
    }),
  ) as Record<ReportKind, ReportFormat>;
}

/** Where a header logo is loaded from (null when the organization has no logo). */
export function reportLogoUrl(s: AySetting, logo: ReportLogo) {
  if (logo === 'org') return s.logoFileId ? logoUrl(s.academicYearId, 'org', s.logoFileId) : null;
  return `/api/public/ays/${s.academicYearId}/report-logo/${logo}`;
}

/** The uploaded images the formats use (not the organization's logo). */
export function reportLogoFileIds(formats: unknown): string[] {
  const ids = new Set<string>();
  for (const f of Object.values((formats ?? {}) as Record<string, Partial<ReportFormat>>)) {
    for (const logo of [...(f?.logosLeft ?? []), ...(f?.logosRight ?? [])]) if (logo !== 'org') ids.add(logo);
  }
  return [...ids];
}
