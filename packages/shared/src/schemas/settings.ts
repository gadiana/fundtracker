import { z } from 'zod';
import { HEADER_ALIGNMENTS, LOGO_PLACEMENTS, REPORT_KINDS } from '../reports';

/** Always shown on the public QR page: the student's name and Cleared / Has Balance. */
export const PUBLIC_FIELDS_ALWAYS = ['name', 'status'] as const;
/** Optional extras the adviser can switch on. */
export const PUBLIC_FIELDS_OPTIONAL = ['breakdown', 'courseYearSection', 'transactions'] as const;
export type PublicFieldOption = (typeof PUBLIC_FIELDS_OPTIONAL)[number];

export const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const LOGO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DATE_FORMATS = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'MMM D, YYYY'] as const;
export const ALLOCATION_MODES = ['hybrid', 'priority_only', 'staff_chooses'] as const;
export const APPROVAL_RULES = ['any_one', 'all_required'] as const;
export const PAPER_SIZES = ['A4', 'LETTER', 'LEGAL'] as const;

export const MIN_UPLOAD_BYTES = 100 * 1024;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`);
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((v) => (v ? v : null))
    .nullable();
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address')
  .transform((v) => (v === '' ? null : v))
  .nullable();

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Every adviser-editable setting. A PATCH may send any subset. */
export const settingsPatchSchema = z
  .object({
    // Personalization
    schoolName: text(200),
    schoolAbbr: text(30),
    collegeName: text(200),
    collegeAbbr: text(30),
    orgName: text(200).min(1, 'Required'),
    orgAbbr: text(30),
    programName: nullableText(200),
    programAbbr: nullableText(30),
    // Structure
    yearLevelCount: z.number().int().min(1, 'At least 1').max(10, 'At most 10'),
    // Collection
    allowPartialPayments: z.boolean(),
    allocationMode: z.enum(ALLOCATION_MODES),
    // Approvals
    requestApprovalRule: z.enum(APPROVAL_RULES),
    liquidationApprovalRule: z.enum(APPROVAL_RULES),
    // Receipts
    receiptFooterText: text(500),
    receiptQrMessage: text(200).min(1, 'Required'),
    // Fund usage
    requireRequestAttachment: z.boolean(),
    requireLiquidationAttachment: z.boolean(),
    // Public QR page (optional extras only; name and status are always shown)
    publicFields: z.array(z.enum(PUBLIC_FIELDS_OPTIONAL)).max(PUBLIC_FIELDS_OPTIONAL.length),
    // Reports
    reportHeaderText: text(300),
    reportPreparedByName: nullableText(150),
    reportPreparedByTitle: nullableText(150),
    reportNotedByName: nullableText(150),
    reportNotedByTitle: nullableText(150),
    reportPaperSize: z.enum(PAPER_SIZES),
    reportFormats: z.lazy(() => reportFormatsSchema),
    // Email sender (SMTP credentials stay in the server's env)
    emailSenderName: nullableText(150),
    emailSenderAddress: optionalEmail,
    emailReplyTo: optionalEmail,
    // Security
    passwordMinLength: z.number().int().min(8, 'At least 8').max(128, 'At most 128'),
    passwordRequireUpper: z.boolean(),
    passwordRequireNumber: z.boolean(),
    passwordRequireSymbol: z.boolean(),
    /** off | optional | required (see TWO_FACTOR_MODES) */
    twofaMode: z.enum(['off', 'optional', 'required']),
    // Files
    uploadAllowedMime: z.array(z.enum(UPLOAD_MIME_TYPES)).min(1, 'Allow at least one file type'),
    uploadMaxBytes: z.number().int().min(MIN_UPLOAD_BYTES, 'At least 100 KB').max(MAX_UPLOAD_BYTES, 'At most 50 MB'),
    // Locale
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code like PHP'),
    timezone: text(50).refine(isValidTimezone, 'Unknown time zone'),
    dateFormat: z.enum(DATE_FORMATS),
    // Data Privacy Act consent
    privacyConsentText: text(10_000).min(20, 'Write the full privacy notice (at least 20 characters)'),
  })
  .partial()
  .strict();

export type SettingsPatch = z.input<typeof settingsPatchSchema>;

// ───────────────────────────── report formats ─────────────────────────────

/** A logo in a report header: the organization's logo, or an uploaded image (its file id). */
export const reportLogoSchema = z.union([z.literal('org'), z.string().uuid()]);

export const reportHeaderLineSchema = z.object({
  text: text(200),
  bold: z.boolean(),
  size: z.number().int().min(8, 'At least 8 pt').max(32, 'At most 32 pt'),
  align: z.enum(HEADER_ALIGNMENTS),
});

export const reportSignatorySchema = z.object({
  /** what the person signs as, e.g. "Noted by" */
  label: text(60),
  /** blank: whoever generates the report */
  name: text(150),
  position: text(150),
  /** printed on the report */
  show: z.boolean(),
});

/** How one kind of report is printed: paper, letterhead and who signs it. */
export const reportFormatSchema = z.object({
  paperSize: z.enum(PAPER_SIZES),
  logosLeft: z.array(reportLogoSchema).max(4, 'At most 4 logos on a side'),
  logosRight: z.array(reportLogoSchema).max(4, 'At most 4 logos on a side'),
  logoSize: z.number().int().min(24).max(120),
  /** formats saved before these existed keep the old look: logos at the page edges */
  logoPlacement: z.enum(LOGO_PLACEMENTS).default('edges'),
  logoGap: z.number().int().min(0, 'At least 0 pt').max(144, 'At most 144 pt').default(12),
  headerLines: z.array(reportHeaderLineSchema).max(10, 'At most 10 header lines'),
  signatories: z.array(reportSignatorySchema).max(8, 'At most 8 signatories'),
});
export type ReportFormat = z.infer<typeof reportFormatSchema>;
export type ReportLogo = z.infer<typeof reportLogoSchema>;
export type ReportSignatory = z.infer<typeof reportSignatorySchema>;

/** Every report's format, by report kind (a kind left out keeps its default). */
export const reportFormatsSchema = z.partialRecord(z.enum(REPORT_KINDS), reportFormatSchema);
export type ReportFormats = z.infer<typeof reportFormatsSchema>;

/** The organization's name fields: set in the code (apps/api/src/branding.ts), not in the app. */
export const BRANDING_KEYS = ['schoolName', 'schoolAbbr', 'collegeName', 'collegeAbbr', 'orgName', 'orgAbbr', 'programName', 'programAbbr'] as const;
