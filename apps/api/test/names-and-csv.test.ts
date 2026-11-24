import { describe, expect, it } from 'vitest';
import { formatPersonName, normalizeNamePart, normalizeStudentNumber, studentNameKeys } from '@sft/shared';
import { parseCsv } from '../src/lib/csv';

describe('name normalization for duplicate detection', () => {
  it('ignores case, spaces, punctuation and accents', () => {
    expect(normalizeNamePart('  Dela Cruz, Ma. ')).toBe('delacruzma');
    expect(normalizeNamePart('Peñaflor')).toBe('penaflor');
    expect(normalizeNamePart("O'Neil-Santos")).toBe('oneilsantos');
  });

  it('gives the same key however the name is punctuated', () => {
    const a = studentNameKeys({ firstName: 'Jhon Ezekiel', middleName: 'B.', lastName: 'Gadiana' });
    const b = studentNameKeys({ firstName: 'jhon ezekiel', middleName: 'B', lastName: 'GADIANA' });
    expect(a).toEqual(b);
    expect(a.nameKey).toBe('jhonezekielbgadiana');
  });

  it('keeps a looser key that ignores the middle name', () => {
    const a = studentNameKeys({ firstName: 'Jhon Ezekiel', middleName: 'B.', lastName: 'Gadiana' });
    const b = studentNameKeys({ firstName: 'Jhon Ezekiel', middleName: 'Bautista', lastName: 'Gadiana' });
    expect(a.nameKey).not.toBe(b.nameKey);
    expect(a.nameKeyLoose).toBe(b.nameKeyLoose);
  });

  it('keeps one initial per word of a compound middle name', () => {
    const name = (middleName: string | null) => formatPersonName({ firstName: 'Juan', middleName, lastName: 'Santos', suffix: 'Jr.' });
    expect(name('Bautista')).toBe('Juan B. Santos Jr.');
    expect(name('Dela Cruz')).toBe('Juan DC. Santos Jr.');
    expect(name('del Rosario')).toBe('Juan DR. Santos Jr.');
    expect(name('De la Paz')).toBe('Juan DLP. Santos Jr.');
    expect(name('D.C.')).toBe('Juan DC. Santos Jr.');
    expect(name('B.')).toBe('Juan B. Santos Jr.');
    expect(name('  ')).toBe('Juan Santos Jr.');
    expect(name(null)).toBe('Juan Santos Jr.');
  });

  it('normalizes student numbers', () => {
    expect(normalizeStudentNumber(' 2021 - 01234a ')).toBe('2021-01234A');
  });
});

describe('CSV parsing', () => {
  it('handles quotes, embedded commas, escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b,c\r\n1,"Dela Cruz, Maria","say ""hi"""\r\n2,x,y\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'Dela Cruz, Maria', 'say "hi"'],
      ['2', 'x', 'y'],
    ]);
  });

  it('strips a UTF-8 BOM, skips blank lines and detects semicolons', () => {
    const rows = parseCsv('﻿student_number;last_name\n\n1001;Gadiana\n');
    expect(rows).toEqual([
      ['student_number', 'last_name'],
      ['1001', 'Gadiana'],
    ]);
  });

  it('keeps line breaks inside quoted fields', () => {
    expect(parseCsv('a\n"line 1\nline 2"')).toEqual([['a'], ['line 1\nline 2']]);
  });
});
