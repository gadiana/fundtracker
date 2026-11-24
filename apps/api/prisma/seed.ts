/**
 * Seed: one sample organization and AY 2026-2027 with settings,
 * positions, programs and sections. Safe to run more than once.
 *
 * No user accounts are seeded: the first person to sign up becomes the adviser.
 * Sample students and funds are included; every student is charged by the same rules the app uses.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { studentNameKeys } from '@sft/shared';
import { COUNTER_KEYS, DEFAULT_DESIGNATIONS, defaultPrivacyConsent } from '../src/lib/defaults';
import { syncCharges } from '../src/modules/funds/charges';

const prisma = new PrismaClient();

const AY = { startYear: 2026, endYear: 2027, label: '2026-2027' };

const PROGRAMS = [
  { code: 'BSIT', name: 'Bachelor of Science in Information Technology' },
  { code: 'BSCS', name: 'Bachelor of Science in Computer Science' },
];

const SECTIONS = ['A', 'B', 'C'];

// The spec's example: ₱950 in total, in this priority order. Amounts are centavos.
const FUNDS = [
  { name: 'Student Fee', amount: 50_000, notes: 'Organization operations and activities.' },
  { name: 'Palaro', amount: 10_000, notes: 'Sports fest participation.' },
  { name: 'Insurance', amount: 15_000, notes: 'Student accident insurance.' },
  { name: 'Books', amount: 20_000, notes: 'Publication print run.' },
];

// [number, first, middle, last, program, year, section]. 1001 and 1002 are the same name on purpose:
// they show how likely duplicates are flagged for review.
const STUDENTS: [string, string, string, string, string, number, string][] = [
  ['1001', 'Jhon Ezekiel', 'B.', 'Gadiana', 'BSIT', 1, 'A'],
  ['1002', 'Jhon Ezekiel', 'B', 'Gadiana', 'BSIT', 1, 'B'],
  ['1003', 'Maria Clara', 'Santos', 'Dela Cruz', 'BSIT', 1, 'A'],
  ['1004', 'Jose', 'Rizal', 'Mercado', 'BSIT', 2, 'A'],
  ['1005', 'Andrea', 'Lim', 'Tan', 'BSIT', 2, 'B'],
  ['1006', 'Carlo', 'Reyes', 'Bautista', 'BSIT', 3, 'A'],
  ['1007', 'Patricia Ann', 'Gomez', 'Villanueva', 'BSIT', 3, 'C'],
  ['1008', 'Mark Anthony', 'Cruz', 'Ramos', 'BSIT', 4, 'A'],
  ['1009', 'Kristine', 'Flores', 'Aquino', 'BSCS', 1, 'A'],
  ['1010', 'Paolo', 'Garcia', 'Mendoza', 'BSCS', 2, 'A'],
  ['1011', 'Angelica', 'Torres', 'Navarro', 'BSCS', 3, 'B'],
  ['1012', 'Rafael', 'Domingo', 'Castillo', 'BSCS', 4, 'B'],
];

async function main() {
  const existingCurrent = await prisma.academicYear.findFirst({ where: { isCurrent: true } });
  const ay = await prisma.academicYear.upsert({
    where: { startYear: AY.startYear },
    update: {},
    create: { ...AY, isCurrent: !existingCurrent },
  });

  await prisma.aySetting.upsert({
    where: { academicYearId: ay.id },
    update: {},
    create: {
      academicYearId: ay.id,
      schoolName: 'Sample State University',
      schoolAbbr: 'SSU',
      collegeName: 'Sample College',
      collegeAbbr: 'SC',
      orgName: 'Sample Student Organization',
      orgAbbr: 'SSO',
      reportHeaderText: 'Sample Student Organization — Fund Report',
      receiptFooterText: 'Thank you! Keep this receipt for your records.',
      privacyConsentText: defaultPrivacyConsent('Sample Student Organization'),
      privacyConsentVersion: '1',
    },
  });

  for (const key of COUNTER_KEYS) {
    await prisma.ayCounter.upsert({
      where: { academicYearId_counterKey: { academicYearId: ay.id, counterKey: key } },
      update: {},
      create: { academicYearId: ay.id, counterKey: key },
    });
  }

  for (const [i, d] of DEFAULT_DESIGNATIONS.entries()) {
    await prisma.designation.upsert({
      where: { academicYearId_name: { academicYearId: ay.id, name: d.name } },
      update: {},
      create: { academicYearId: ay.id, sortOrder: i, ...d },
    });
  }

  for (const p of PROGRAMS) {
    await prisma.program.upsert({
      where: { academicYearId_code: { academicYearId: ay.id, code: p.code } },
      update: {},
      create: { academicYearId: ay.id, ...p },
    });
  }

  for (const name of SECTIONS) {
    await prisma.section.upsert({
      where: { academicYearId_name: { academicYearId: ay.id, name } },
      update: {},
      create: { academicYearId: ay.id, name },
    });
  }

  const programs = await prisma.program.findMany({ where: { academicYearId: ay.id } });
  const sections = await prisma.section.findMany({ where: { academicYearId: ay.id } });
  let added = 0;
  for (const [studentNumber, firstName, middleName, lastName, code, yearLevel, sectionName] of STUDENTS) {
    if (await prisma.student.findFirst({ where: { academicYearId: ay.id, studentNumber } })) continue;
    const student = await prisma.student.create({
      data: {
        academicYearId: ay.id,
        studentNumber,
        firstName,
        middleName,
        lastName,
        ...studentNameKeys({ firstName, middleName, lastName }),
        programId: programs.find((p) => p.code === code)!.id,
        yearLevel,
        sectionId: sections.find((x) => x.name === sectionName)?.id ?? null,
        source: 'manual',
        createdByName: 'Seed data',
        approvedAt: new Date(),
        approvedByName: 'Seed data',
      },
    });
    await prisma.studentQrToken.create({ data: { academicYearId: ay.id, studentId: student.id, token: randomBytes(32).toString('base64url') } });
    added++;
  }

  const settings = await prisma.aySetting.findUniqueOrThrow({ where: { academicYearId: ay.id } });
  const allYears = Array.from({ length: settings.yearLevelCount }, (_, i) => i + 1);
  let fundsAdded = 0;
  for (const [i, f] of FUNDS.entries()) {
    if (await prisma.fund.findFirst({ where: { academicYearId: ay.id, name: f.name } })) continue;
    const last = await prisma.fund.aggregate({ where: { academicYearId: ay.id }, _max: { priority: true } });
    await prisma.$transaction(async (tx) => {
      const fund = await tx.fund.create({
        data: {
          academicYearId: ay.id,
          name: f.name,
          notes: f.notes,
          amountPerStudent: BigInt(f.amount),
          priority: Math.max(i + 1, (last._max.priority ?? 0) + 1),
          createdByName: 'Seed data',
        },
      });
      await tx.fundYearLevel.createMany({ data: allYears.map((yearLevel) => ({ academicYearId: ay.id, fundId: fund.id, yearLevel })) });
      await syncCharges(tx, ay.id, { fundIds: [fund.id] }, { id: null, name: 'Seed data' });
    });
    fundsAdded++;
  }

  console.info(`Seeded AY ${ay.label}${ay.isCurrent ? ' (current)' : ''}: Sample Student Organization, ${DEFAULT_DESIGNATIONS.length} positions, ${PROGRAMS.length} programs, ${SECTIONS.length} sections, ${added} new sample student(s), ${fundsAdded} new sample fund(s).`);
  console.info('Next: open the web app and sign up. The first account in this AY becomes the adviser.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
