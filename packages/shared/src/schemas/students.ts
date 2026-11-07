import { z } from 'zod';
import { personNameFields } from './auth';

/** Student numbers are compared without spaces and in uppercase: " 2021-01234 " → "2021-01234". */
export const normalizeStudentNumber = (value: string) => value.replace(/\s+/g, '').toUpperCase();

export const studentNumberField = z
  .string()
  .transform(normalizeStudentNumber)
  .pipe(
    z
      .string()
      .min(1, 'Required')
      .max(30, 'At most 30 characters')
      .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and dashes only'),
  );

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address')
  .transform((v) => (v === '' ? undefined : v))
  .nullish();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : undefined));

export const studentFields = {
  studentNumber: studentNumberField,
  ...personNameFields,
  programId: z.string().uuid('Choose a program'),
  yearLevel: z.number().int().min(1, 'Choose a year level').max(10),
  sectionId: z.string().uuid().nullable().optional(),
  email: optionalEmail,
  contactNo: optionalText(30),
};

/**
 * How a likely duplicate is handled:
 * - a similar name (same first + last name) can be acknowledged by staff;
 * - an identical name with a different student number needs the adviser, with a reason.
 */
export const duplicateDecisionFields = {
  acknowledgeSimilar: z.boolean().optional(),
  duplicateOverrideReason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined)),
};

export const studentCreateSchema = z.object({ ...studentFields, ...duplicateDecisionFields });
export type StudentCreateInput = z.input<typeof studentCreateSchema>;

export const studentUpdateSchema = z
  .object({
    studentNumber: studentFields.studentNumber,
    firstName: studentFields.firstName,
    middleName: studentFields.middleName,
    lastName: studentFields.lastName,
    suffix: studentFields.suffix,
    programId: studentFields.programId,
    yearLevel: studentFields.yearLevel,
    sectionId: studentFields.sectionId,
    email: studentFields.email,
    contactNo: studentFields.contactNo,
  })
  .partial()
  .extend(duplicateDecisionFields);

export const studentDecisionSchema = z.object({ ...duplicateDecisionFields });
export const studentRejectSchema = z.object({ comment: optionalText(500) });
export const studentDeactivateSchema = z.object({ reason: optionalText(500) });

/** Staff confirm (or correct) a promoted student's course, year and section before their first payment. */
export const confirmProfileSchema = z.object({
  programId: studentFields.programId,
  yearLevel: studentFields.yearLevel,
  sectionId: studentFields.sectionId,
});

export const selfEnrollSchema = z.object({
  studentNumber: studentFields.studentNumber,
  ...personNameFields,
  programId: studentFields.programId,
  yearLevel: studentFields.yearLevel,
  sectionId: studentFields.sectionId,
  email: studentFields.email,
  contactNo: studentFields.contactNo,
  consent: z.literal(true, { error: 'You must agree to the data privacy notice' }),
});
export type SelfEnrollInput = z.input<typeof selfEnrollSchema>;

export const enrollmentLinkSchema = z.object({
  label: optionalText(120),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  maxUses: z.number().int().min(1).max(5000).optional(),
});

/** CSV import: columns in any order; these header names (case-insensitive) are recognized. */
export const CSV_COLUMNS = [
  { key: 'studentNumber', header: 'student_number', aliases: ['student number', 'student no', 'student_no', 'id number', 'id_number', 'id'], required: true },
  { key: 'lastName', header: 'last_name', aliases: ['last name', 'surname', 'lastname'], required: true },
  { key: 'firstName', header: 'first_name', aliases: ['first name', 'firstname', 'given name'], required: true },
  { key: 'middleName', header: 'middle_name', aliases: ['middle name', 'middlename', 'middle initial', 'mi'], required: false },
  { key: 'suffix', header: 'suffix', aliases: ['ext', 'name extension'], required: false },
  { key: 'program', header: 'program', aliases: ['course', 'program code'], required: true },
  { key: 'yearLevel', header: 'year_level', aliases: ['year level', 'year', 'yr'], required: true },
  { key: 'section', header: 'section', aliases: ['sec'], required: false },
  { key: 'email', header: 'email', aliases: ['email address', 'e-mail'], required: false },
  { key: 'contactNo', header: 'contact_no', aliases: ['contact no', 'contact number', 'contact', 'mobile', 'phone'], required: false },
] as const;
export type CsvColumnKey = (typeof CSV_COLUMNS)[number]['key'];

export const CSV_MAX_ROWS = 3000;
export const CSV_MAX_CHARS = 900_000;

export const csvImportSchema = z.object({
  csv: z.string().min(1, 'The file is empty').max(CSV_MAX_CHARS, 'The file is too large (about 900 KB at most)'),
  ...duplicateDecisionFields,
});
