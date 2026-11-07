/**
 * Small RFC 4180 CSV parser: quoted fields, "" escapes, CRLF/LF line endings and a UTF-8 BOM.
 * The delimiter is detected from the header line (comma, semicolon — Excel in some
 * locales — or tab).
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function detectDelimiter(headerLine: string) {
  const count = (ch: string) => headerLine.split(ch).length - 1;
  return [',', ';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
}

/** Values Excel would run as formulas get a leading quote when we export CSV later. */
export const csvSafe = (value: string) => (/^[=+\-@]/.test(value) ? `'${value}` : value);
