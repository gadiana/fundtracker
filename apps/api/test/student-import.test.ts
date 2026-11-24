import { beforeEach, describe, expect, it } from 'vitest';
import type { AcademicYear } from '@prisma/client';
import { prisma } from '../src/db';
import { createProgram, createSection } from './fixtures';
import { createAy, expectStatus, registerAndLogin, resetDb, type Client } from './helpers';

let ay: AcademicYear;
let adviser: Client;
let collector: Client;

const HEADER = 'student_number,last_name,first_name,middle_name,suffix,program,year_level,section,email,contact_no';

beforeEach(async () => {
  await resetDb();
  const created = await createAy(2026);
  ay = created.ay;
  const bsit = await createProgram(ay.id, 'BSIT');
  await createProgram(ay.id, 'BSCS');
  await createSection(ay.id, 'A');
  adviser = await registerAndLogin('adviser@test.ph', undefined, ['Maria', 'Santos']);
  const c = await registerAndLogin('collector@test.ph');
  const pending = (await adviser.get('/members?status=pending')).body.items[0];
  expectStatus(await adviser.post(`/members/${pending.id}/approve`, { designationId: created.designations.collector.id }), 200);
  collector = c;

  // an existing student the file will collide with
  await prisma.student.create({
    data: {
      academicYearId: ay.id,
      studentNumber: '1001',
      firstName: 'Jhon Ezekiel',
      middleName: 'B.',
      lastName: 'Gadiana',
      nameKey: 'jhonezekielbgadiana',
      nameKeyLoose: 'jhonezekielgadiana',
      programId: bsit.id,
      yearLevel: 1,
      source: 'manual',
    },
  });
});

const CSV = [
  HEADER,
  '2001,Dela Cruz,Maria,Santos,,BSIT,1,A,maria@example.com,', // ok
  '2002,Tan,Andrea,,,bscs,2nd,,,', // ok (lowercase code, "2nd")
  '2003,Gadiana,Jhon Ezekiel,B,,BSIT,1,A,,', // exact name as 1001
  '2004,Gadiana,Jhon Ezekiel,Bautista,,BSIT,1,A,,', // similar name
  '1001,Someone,Else,,,BSIT,1,A,,', // number already used
  '2005,Lim,Paolo,,,BSBA,1,,,', // unknown program
  '2006,Reyes,Carlo,,,BSIT,9,,,', // bad year
  '2001,Dup,In File,,,BSIT,1,,,', // same number as row 2
  '2007,Bad,Email,,,BSIT,1,,not-an-email,', // invalid email
].join('\n');

describe('CSV import', () => {
  it('previews every row without saving anything', async () => {
    const res = expectStatus(await collector.post('/students/import/preview', { csv: CSV }), 200).body;
    expect(res.counts).toEqual({ total: 9, ok: 2, similar: 1, exact: 1, error: 5 });
    const byLine = Object.fromEntries(res.rows.map((r: { line: number; status: string }) => [r.line, r.status]));
    expect(byLine).toEqual({ 2: 'ok', 3: 'ok', 4: 'exact', 5: 'similar', 6: 'error', 7: 'error', 8: 'error', 9: 'error', 10: 'error' });
    expect(res.rows[4].messages.join(' ')).toMatch(/already used by Jhon Ezekiel B. Gadiana/);
    expect(await prisma.student.count()).toBe(1);
  });

  it('imports only clean rows by default, in one step with one audit entry', async () => {
    const res = expectStatus(await collector.post('/students/import', { csv: CSV }), 201).body;
    expect(res.imported).toBe(2);
    expect(res.skipped.map((s: { line: number }) => s.line)).toEqual([4, 5, 6, 7, 8, 9, 10]);

    const imported = await prisma.student.findMany({ where: { source: 'csv_import' }, include: { qrTokens: true, program: true }, orderBy: { studentNumber: 'asc' } });
    expect(imported.map((s) => [s.studentNumber, s.program.code, s.yearLevel])).toEqual([
      ['2001', 'BSIT', 1],
      ['2002', 'BSCS', 2],
    ]);
    expect(imported.every((s) => s.qrTokens.length === 1)).toBe(true);
    expect(await prisma.auditLog.count({ where: { entityType: 'student_import' } })).toBe(1);
  });

  it('imports similar names once staff confirm, but exact names only with the adviser’s reason', async () => {
    const staff = expectStatus(await collector.post('/students/import', { csv: CSV, acknowledgeSimilar: true, duplicateOverrideReason: 'staff cannot override' }), 201).body;
    expect(staff.imported).toBe(3); // ok + similar; the exact-name row stays out
    expect(await prisma.student.count({ where: { studentNumber: '2003' } })).toBe(0);

    const exactOnly = [HEADER, '2003,Gadiana,Jhon Ezekiel,B,,BSIT,1,A,,'].join('\n');
    expect((await adviser.post('/students/import', { csv: exactOnly })).body.error.code).toBe('NOTHING_TO_IMPORT');
    const ok = expectStatus(await adviser.post('/students/import', { csv: exactOnly, duplicateOverrideReason: 'Different person, checked ID' }), 201).body;
    expect(ok.imported).toBe(1);
    const s = await prisma.student.findFirstOrThrow({ where: { studentNumber: '2003' } });
    expect(s).toMatchObject({ duplicateOverride: true, duplicateOverrideByName: 'Maria Santos', duplicateOverrideReason: 'Different person, checked ID' });
  });

  it('accepts common header names in any order, and reports missing columns', async () => {
    const csv = ['Program;Year;Surname;First Name;Student No', 'BSIT;1;Aquino;Kristine;3001'].join('\n');
    const res = expectStatus(await collector.post('/students/import/preview', { csv }), 200).body;
    expect(res.counts.ok).toBe(1);

    const missing = await collector.post('/students/import/preview', { csv: 'student_number,first_name\n1,A' });
    expect(missing.body.error.code).toBe('MISSING_COLUMNS');
    expect(missing.body.error.message).toMatch(/last_name/);
  });
});
