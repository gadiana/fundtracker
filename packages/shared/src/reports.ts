import { z } from 'zod';
import { formatCentavos } from './allocation';

/**
 * Every printed report and history export is one `ReportDoc`. The API builds it; the web app
 * renders the same document as a printable page, a PDF and CSV, so they always agree.
 */

export type ReportCellType = 'text' | 'money' | 'number' | 'datetime' | 'date';
export type ReportCell = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  type?: ReportCellType;
}

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** a totals row under the table */
  totals?: Record<string, ReportCell>;
  emptyText?: string;
  /** the table a CSV export contains */
  primary?: boolean;
}

export interface ReportSummaryItem {
  label: string;
  value: ReportCell;
  type?: ReportCellType;
}

export interface ReportDoc {
  kind: ReportKind;
  title: string;
  /** e.g. the fund or the student the report is about */
  subtitle?: string;
  /** what the report was filtered by, in words */
  filters: { label: string; value: string }[];
  summary: ReportSummaryItem[];
  tables: ReportTable[];
  /** shown under the summary, e.g. that restricted funds are left out */
  notes: string[];
  header: { orgName: string; schoolName: string; collegeName: string; logoUrl: string | null; headerText: string; academicYear: string };
  signatories: { label: string; name: string; title: string }[];
  paperSize: 'A4' | 'LETTER' | 'LEGAL';
  timezone: string;
  generatedAt: string;
  generatedBy: string;
  /** rows were cut off at this many */
  truncatedAt?: number;
}

export const REPORT_KINDS = ['collections', 'fund-usage', 'fund', 'student-statement', 'clearance'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_TITLES: Record<ReportKind, string> = {
  collections: 'Collection report',
  'fund-usage': 'Fund usage report',
  fund: 'Fund report',
  'student-statement': 'Student statement of account',
  clearance: 'Cleared / has-balance list',
};

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a yyyy-mm-dd date')
  .optional();
const id = z.string().uuid().optional();
const text = z.string().trim().max(100).optional();

/** Shared by the collection history and the collection report. */
export const collectionFilterSchema = z.object({
  from: day,
  to: day,
  q: text,
  programId: id,
  yearLevel: z.coerce.number().int().min(1).max(10).optional(),
  sectionId: id,
  status: z.enum(['posted', 'voided', 'all']).default('all'),
  processedById: id,
});

/** Shared by the use-of-fund history and the usage report. Dates are when the request was filed. */
export const usageFilterSchema = z.object({
  from: day,
  to: day,
  q: text,
  fundId: id,
  status: z.enum(['pending', 'approved', 'rejected', 'receipt_submitted', 'revision_requested', 'cleared', 'canceled']).optional(),
});

export const fundReportSchema = z.object({ fundId: z.string().uuid(), from: day, to: day });
export const studentStatementSchema = z.object({ studentId: z.string().uuid() });
export const clearanceFilterSchema = z.object({
  programId: id,
  yearLevel: z.coerce.number().int().min(1).max(10).optional(),
  sectionId: id,
  status: z.enum(['cleared', 'has_balance', 'all']).default('all'),
  q: text,
});

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Plain-number money for CSV and PDF cells: 123456 → "1,234.56". */
export const centavosPlain = (c: number) =>
  (c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ───────────────────────────── cell text and CSV (shared by the web app and the tests) ─────────────────────────────

const isCalendarDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** One cell as text, in the report's time zone. `plain` money has no peso sign (CSV, PDF). */
export function formatReportCell(value: ReportCell, type: ReportCellType | undefined, timeZone: string, { plain = false } = {}): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') {
    if (type === 'money') return plain ? centavosPlain(value) : formatCentavos(value);
    if (type === 'number') return value.toLocaleString('en-PH');
    return String(value);
  }
  if (type === 'date' || type === 'datetime') {
    // a calendar day stays that day; a moment is shown in the AY's time zone
    if (isCalendarDay(value)) return new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(`${value}T00:00:00Z`));
    const at = new Date(value);
    // text in a date column (e.g. "Total") stays as it is
    if (Number.isNaN(at.getTime())) return value;
    const opts: Intl.DateTimeFormatOptions = type === 'date' ? { timeZone, dateStyle: 'medium' } : { timeZone, dateStyle: 'medium', timeStyle: 'short' };
    return new Intl.DateTimeFormat('en-PH', opts).format(at);
  }
  return value;
}

/**
 * Text a spreadsheet would run as a formula (=, +, -, @, tab, return first) gets a leading
 * apostrophe. Names come from the public self-enrollment form, so this matters.
 */
export const csvSafeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

const csvQuote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The report's main table as CSV that Excel opens correctly (UTF-8 with BOM, plain amounts). */
export function reportCsv(doc: ReportDoc) {
  const t = doc.tables.find((x) => x.primary) ?? doc.tables[0];
  if (!t) return '\uFEFF';
  const lines = [t.columns.map((c) => csvQuote(csvSafeText(c.type === 'money' ? `${c.label} (PHP)` : c.label))).join(',')];
  for (const row of t.rows) {
    lines.push(
      t.columns
        .map((c) => {
          const v = row[c.key] ?? null;
          // amounts without thousands separators, so spreadsheets read them as numbers (ours, so never a formula)
          if (c.type === 'money' && typeof v === 'number') return (v / 100).toFixed(2);
          if (c.type === 'number' && typeof v === 'number') return String(v);
          return csvQuote(csvSafeText(formatReportCell(v, c.type, doc.timezone, { plain: true })));
        })
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
