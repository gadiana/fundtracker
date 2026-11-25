import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import {
  CSV_COLUMNS,
  CSV_MAX_ROWS,
  csvImportSchema,
  formatPersonName,
  normalizeStudentNumber,
  studentNameKeys,
  type CsvColumnKey,
} from '@sft/shared';
import { z } from 'zod';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { randomToken } from '../../lib/crypto';
import { parseCsv } from '../../lib/csv';
import { badRequest } from '../../lib/http';
import { syncCharges } from '../funds/charges';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireOpenAy, requirePermission } from '../../middleware/ay';

export type RowStatus = 'ok' | 'similar' | 'exact' | 'error';

export interface ImportRow {
  line: number;
  status: RowStatus;
  messages: string[];
  values: Record<CsvColumnKey, string>;
  /** resolved values, present when the row has no errors */
  student?: {
    studentNumber: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    suffix: string | null;
    programId: string;
    yearLevel: number;
    sectionId: string | null;
    email: string | null;
    contactNo: string | null;
    nameKey: string;
    nameKeyLoose: string;
  };
}

const headerKey = (h: string) => h.trim().toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ');

function mapColumns(header: string[]) {
  const index = new Map<CsvColumnKey, number>();
  header.forEach((cell, i) => {
    const key = headerKey(cell);
    const column = CSV_COLUMNS.find((c) => headerKey(c.header) === key || c.aliases.some((a) => headerKey(a) === key));
    if (column && !index.has(column.key)) index.set(column.key, i);
  });
  const missing = CSV_COLUMNS.filter((c) => c.required && !index.has(c.key)).map((c) => c.header);
  if (missing.length) throw badRequest('MISSING_COLUMNS', `The header row is missing: ${missing.join(', ')}. Download the template to see the expected columns.`);
  return index;
}

const emailOk = (v: string) => z.string().email().safeParse(v).success;

/** Checks every row against this AY's programs, sections, year levels and existing students. */
export async function analyzeCsv(academicYearId: string, csv: string) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw badRequest('EMPTY_CSV', 'Add a header row and at least one student.');
  if (rows.length - 1 > CSV_MAX_ROWS) throw badRequest('TOO_MANY_ROWS', `Import at most ${CSV_MAX_ROWS} students at a time.`);
  const columns = mapColumns(rows[0]!);

  const [programs, sections, settings, existing] = await Promise.all([
    prisma.program.findMany({ where: { academicYearId } }),
    prisma.section.findMany({ where: { academicYearId } }),
    prisma.aySetting.findUnique({ where: { academicYearId } }),
    prisma.student.findMany({ where: { academicYearId, status: { not: 'rejected' } } }),
  ]);
  const maxYear = settings?.yearLevelCount ?? 4;
  const programByCode = new Map(programs.map((p) => [p.code, p]));
  const sectionByKey = new Map(sections.map((s) => [`${s.programId}|${s.yearLevel}|${s.name}`, s]));
  const byNumber = new Map(existing.map((s) => [s.studentNumber, s]));
  const byKey = new Map<string, string[]>();
  const byLoose = new Map<string, string[]>();
  for (const s of existing) {
    byKey.set(s.nameKey, [...(byKey.get(s.nameKey) ?? []), `${formatPersonName(s)} (${s.studentNumber})`]);
    byLoose.set(s.nameKeyLoose, [...(byLoose.get(s.nameKeyLoose) ?? []), `${formatPersonName(s)} (${s.studentNumber})`]);
  }
  const fileNumbers = new Map<string, number>();
  const fileKeys = new Map<string, { line: number; number: string }>();
  const fileLoose = new Map<string, { line: number; number: string }>();

  const result: ImportRow[] = rows.slice(1).map((cells, i) => {
    const line = i + 2;
    const get = (key: CsvColumnKey) => {
      const idx = columns.get(key);
      return idx === undefined ? '' : (cells[idx] ?? '').trim();
    };
    const values = Object.fromEntries(CSV_COLUMNS.map((c) => [c.key, get(c.key)])) as Record<CsvColumnKey, string>;
    const errors: string[] = [];
    const warnings: string[] = [];

    const studentNumber = normalizeStudentNumber(values.studentNumber);
    if (!studentNumber) errors.push('Student number is missing.');
    else if (!/^[A-Z0-9-]{1,30}$/.test(studentNumber)) errors.push('Student number may only have letters, numbers and dashes (up to 30).');
    if (!values.firstName) errors.push('First name is missing.');
    if (!values.lastName) errors.push('Last name is missing.');
    for (const [key, max] of [['firstName', 100], ['middleName', 100], ['lastName', 100], ['suffix', 20], ['contactNo', 30]] as const) {
      if (values[key].length > max) errors.push(`${key} is longer than ${max} characters.`);
    }

    const program = programByCode.get(values.program.toUpperCase());
    if (!values.program) errors.push('Program is missing.');
    else if (!program) errors.push(`Unknown program "${values.program}". Add it in Settings first.`);
    else if (!program.isActive) errors.push(`Program ${program.code} is deactivated.`);

    const yearMatch = values.yearLevel.match(/\d+/);
    const yearLevel = yearMatch ? Number.parseInt(yearMatch[0], 10) : NaN;
    if (!values.yearLevel) errors.push('Year level is missing.');
    else if (!Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > maxYear) errors.push(`Year level must be from 1 to ${maxYear}.`);

    // sections belong to one program and year level
    const section = values.section && program ? sectionByKey.get(`${program.id}|${yearLevel}|${values.section.toUpperCase()}`) : undefined;
    if (values.section && program && Number.isInteger(yearLevel) && !section) {
      errors.push(`${program.code} year ${yearLevel} has no section "${values.section}". Add it in Settings first.`);
    }
    else if (section && !section.isActive) errors.push(`Section ${section.name} is deactivated.`);

    const email = values.email.toLowerCase();
    if (email && !emailOk(email)) errors.push(`"${values.email}" is not a valid email.`);

    if (studentNumber) {
      const sameFile = fileNumbers.get(studentNumber);
      if (sameFile) errors.push(`Same student number as row ${sameFile}.`);
      const taken = byNumber.get(studentNumber);
      if (taken) errors.push(`Student number is already used by ${formatPersonName(taken)}.`);
      if (!sameFile) fileNumbers.set(studentNumber, line);
    }

    const keys = studentNameKeys({ firstName: values.firstName, middleName: values.middleName, lastName: values.lastName, suffix: values.suffix });
    let level: RowStatus = 'ok';
    const exactExisting = byKey.get(keys.nameKey);
    const exactInFile = fileKeys.get(keys.nameKey);
    if (values.firstName && values.lastName) {
      if (exactExisting?.length) {
        level = 'exact';
        warnings.push(`Same name as ${exactExisting.join(', ')}.`);
      }
      if (exactInFile && exactInFile.number !== studentNumber) {
        level = 'exact';
        warnings.push(`Same name as row ${exactInFile.line} (${exactInFile.number}).`);
      }
      if (level === 'ok') {
        const looseExisting = byLoose.get(keys.nameKeyLoose);
        const looseInFile = fileLoose.get(keys.nameKeyLoose);
        if (looseExisting?.length) {
          level = 'similar';
          warnings.push(`Similar name to ${looseExisting.join(', ')}.`);
        } else if (looseInFile && looseInFile.number !== studentNumber) {
          level = 'similar';
          warnings.push(`Similar name to row ${looseInFile.line} (${looseInFile.number}).`);
        }
      }
      if (!fileKeys.has(keys.nameKey)) fileKeys.set(keys.nameKey, { line, number: studentNumber });
      if (!fileLoose.has(keys.nameKeyLoose)) fileLoose.set(keys.nameKeyLoose, { line, number: studentNumber });
    }

    if (errors.length) return { line, status: 'error', messages: errors, values };
    return {
      line,
      status: level,
      messages: warnings,
      values,
      student: {
        studentNumber,
        firstName: values.firstName,
        middleName: values.middleName || null,
        lastName: values.lastName,
        suffix: values.suffix || null,
        programId: program!.id,
        yearLevel,
        sectionId: section?.id ?? null,
        email: email || null,
        contactNo: values.contactNo || null,
        ...keys,
      },
    } satisfies ImportRow;
  });

  const counts = { total: result.length, ok: 0, similar: 0, exact: 0, error: 0 };
  for (const r of result) counts[r.status]++;
  return { rows: result, counts };
}

export const importRouter = Router();
importRouter.use(requireAuth, ayContext, requirePermission('collect'));

/** Dry run: nothing is saved. */
importRouter.post('/preview', async (req, res) => {
  const { csv } = csvImportSchema.parse(req.body);
  res.json(await analyzeCsv(ctxOf(req).ay.id, csv));
});

/**
 * Imports every row without errors. Rows with a similar name need "acknowledgeSimilar";
 * rows with an identical name need the adviser and a reason. Everything is saved at once.
 */
importRouter.post('/', requireOpenAy, async (req, res) => {
  const body = csvImportSchema.parse(req.body);
  const { ay, actor, perms } = ctxOf(req);
  const analysis = await analyzeCsv(ay.id, body.csv);
  const canOverride = perms.includes('manage') && Boolean(body.duplicateOverrideReason && body.duplicateOverrideReason.length >= 5);

  const accepted = analysis.rows.filter(
    (r) => r.status === 'ok' || (r.status === 'similar' && body.acknowledgeSimilar) || (r.status === 'exact' && canOverride),
  );
  if (accepted.length === 0) throw badRequest('NOTHING_TO_IMPORT', 'No rows can be imported. Fix the rows with errors or review the possible duplicates.');

  const now = new Date();
  const students: Prisma.StudentCreateManyInput[] = [];
  const tokens: Prisma.StudentQrTokenCreateManyInput[] = [];
  for (const r of accepted) {
    const id = randomUUID();
    const overridden = r.status === 'exact';
    students.push({
      id,
      academicYearId: ay.id,
      ...r.student!,
      status: 'active',
      source: 'csv_import',
      ...(overridden
        ? { duplicateOverride: true, duplicateOverrideById: actor.id, duplicateOverrideByName: actor.name, duplicateOverrideReason: body.duplicateOverrideReason }
        : {}),
      approvedAt: now,
      approvedById: actor.id,
      approvedByName: actor.name,
      createdById: actor.id,
      createdByName: actor.name,
    });
    tokens.push({ academicYearId: ay.id, studentId: id, token: randomToken() });
  }

  await prisma.$transaction(async (tx) => {
    await tx.student.createMany({ data: students });
    await tx.studentQrToken.createMany({ data: tokens });
    const charges = await syncCharges(tx, ay.id, { studentIds: students.map((s) => s.id!) }, actor);
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'create',
      entityType: 'student_import',
      entityId: null,
      after: {
        imported: students.length,
        charges,
        studentNumbers: students.map((s) => s.studentNumber),
        overridden: accepted.filter((r) => r.status === 'exact').map((r) => r.student!.studentNumber),
        overrideReason: canOverride ? body.duplicateOverrideReason : undefined,
        skippedRows: analysis.rows.filter((r) => !accepted.includes(r)).map((r) => r.line),
      },
      req,
    });
  });

  res.status(201).json({
    imported: students.length,
    skipped: analysis.rows
      .filter((r) => !accepted.includes(r))
      .map((r) => ({ line: r.line, status: r.status, messages: r.messages, studentNumber: r.values.studentNumber })),
  });
});
