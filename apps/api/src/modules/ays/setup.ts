/**
 * Academic Year setup and the Copy Wizard.
 *
 * Copying is the ONLY place where data crosses from one AY to another, and it
 * only ever copies what the adviser ticked. Everything runs in one transaction.
 */
import { randomUUID } from 'node:crypto';
import type { AcademicYear, Prisma, PrismaClient } from '@prisma/client';
import { formatPersonName, type CopyOptions } from '@sft/shared';
import { prisma } from '../../db';
import { writeAudit, type Actor } from '../../lib/audit';
import { randomToken } from '../../lib/crypto';
import { COUNTER_KEYS, DEFAULT_DESIGNATIONS, defaultPrivacyConsent } from '../../lib/defaults';
import { badRequest, conflict, forbidden, notFound } from '../../lib/http';

type Db = Prisma.TransactionClient | PrismaClient;

export const carryOverLabel = (fundName: string, sourceLabel: string) => `Remaining balance from ${fundName} AY ${sourceLabel}`;

export const isActiveAdviser = async (userId: string, academicYearId: string) =>
  (await prisma.userAyRole.count({ where: { userId, academicYearId, role: 'adviser', status: 'active' } })) > 0;

export const needsSetup = async (academicYearId: string) =>
  !(await prisma.aySetting.findUnique({ where: { academicYearId }, select: { academicYearId: true } }));

/**
 * Who may set up an AY: its own adviser, or, while it has no adviser yet, anyone who is
 * an adviser somewhere. Copying from a source additionally requires being that AY's adviser.
 */
export async function authorizeSetup(userId: string, target: AcademicYear, sourceAyId?: string) {
  if (target.status === 'closed') throw conflict('AY_CLOSED', `AY ${target.label} is closed.`);
  if (!(await needsSetup(target.id))) throw conflict('ALREADY_SET_UP', `AY ${target.label} is already set up.`);

  const targetAdvisers = await prisma.userAyRole.findMany({
    where: { academicYearId: target.id, role: 'adviser', status: 'active' },
    select: { userId: true },
  });
  if (targetAdvisers.length && !targetAdvisers.some((a) => a.userId === userId)) {
    throw forbidden(`Only an adviser of AY ${target.label} can set it up.`);
  }
  if (!targetAdvisers.length && (await prisma.userAyRole.count({ where: { userId, role: 'adviser', status: 'active' } })) === 0) {
    throw forbidden('Only an adviser can set up an academic year.');
  }

  if (!sourceAyId) return null;
  if (sourceAyId === target.id) throw badRequest('SAME_AY', 'Choose a different academic year to copy from.');
  const source = await prisma.academicYear.findUnique({ where: { id: sourceAyId } });
  if (!source) throw notFound('Academic year to copy from was not found.');
  if (!(await isActiveAdviser(userId, source.id))) {
    throw forbidden(`You can only copy from an academic year where you are the adviser.`);
  }
  if (await needsSetup(source.id)) throw badRequest('SOURCE_EMPTY', `AY ${source.label} has nothing to copy yet.`);
  return source;
}

/** Everything the wizard could copy from the source AY. */
async function loadSource(db: Db, source: AcademicYear) {
  const settings = await db.aySetting.findUniqueOrThrow({ where: { academicYearId: source.id } });
  const [advisers, staff, designations, programs, sections, approvers, funds, balances, students] = await Promise.all([
    db.userAyRole.findMany({ where: { academicYearId: source.id, role: 'adviser', status: 'active' }, include: { user: true }, orderBy: { decidedAt: 'asc' } }),
    db.userAyRole.findMany({
      where: { academicYearId: source.id, role: 'member', status: 'active' },
      include: { user: true, designation: true },
    }),
    db.designation.findMany({ where: { academicYearId: source.id, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.program.findMany({ where: { academicYearId: source.id, isActive: true } }),
    db.section.findMany({ where: { academicYearId: source.id, isActive: true } }),
    db.ayApprover.findMany({ where: { academicYearId: source.id } }),
    db.fund.findMany({
      where: { academicYearId: source.id, isActive: true },
      include: { yearLevels: true, programs: true },
      orderBy: { priority: 'asc' },
    }),
    db.$queryRaw<{ fund_id: string; balance: bigint; committed: bigint }[]>`
      SELECT fund_id, balance, committed FROM v_fund_balances WHERE academic_year_id = ${source.id}::uuid`,
    db.student.findMany({ where: { academicYearId: source.id, status: 'active' } }),
  ]);
  const promotable = students.filter((s) => s.yearLevel < settings.yearLevelCount);
  return {
    settings,
    advisers,
    staff,
    designations,
    programs,
    sections,
    approvers,
    funds,
    balances: new Map(balances.map((b) => [b.fund_id, b])),
    promotable,
    graduating: students.length - promotable.length,
  };
}

const NO_OPTIONS: CopyOptions = { adviser: false, staff: false, settings: false, funds: false, carryOver: false, promoteStudents: false };

export async function previewSetup(target: AcademicYear, source: AcademicYear | null, options: CopyOptions) {
  const warnings: string[] = [];
  const preview = {
    target: { id: target.id, label: target.label },
    source: source ? { id: source.id, label: source.label, status: source.status } : null,
    adviser: null as null | { name: string; willCopy: boolean },
    staff: null as null | { people: { name: string; position: string | null }[] },
    settings: null as null | { orgName: string; designations: number; programs: number; sections: number; approvers: number },
    funds: null as null | { items: { name: string; amountPerStudent: number; isMandatory: boolean; isConfidential: boolean }[] },
    carryOver: null as null | { items: { fundName: string; label: string; amount: number; committed: number }[]; total: number },
    students: null as null | { promotable: number; graduating: number },
    defaults: null as null | { designations: string[] },
    warnings,
  };

  if (!source) {
    preview.defaults = { designations: DEFAULT_DESIGNATIONS.map((d) => d.name) };
    return preview;
  }

  const src = await loadSource(prisma, source);
  const inTarget = new Set(
    (await prisma.userAyRole.findMany({ where: { academicYearId: target.id, status: { in: ['active', 'deactivated'] } }, select: { userId: true } })).map((m) => m.userId),
  );

  if (options.adviser) {
    const toCopy = src.advisers.filter((a) => !inTarget.has(a.userId));
    preview.adviser = src.advisers.length ? { name: src.advisers.map((a) => formatPersonName(a.user)).join(', '), willCopy: toCopy.length > 0 } : null;
    if (!src.advisers.length) warnings.push(`AY ${source.label} has no active adviser to copy.`);
    else if (!toCopy.length) warnings.push(`The advisers of AY ${source.label} are already in AY ${target.label}.`);
  }
  if (options.staff) {
    preview.staff = { people: src.staff.map((m) => ({ name: formatPersonName(m.user), position: m.designation?.name ?? null })) };
    const orphaned = src.staff.filter((m) => !m.designation?.isActive).length;
    if (orphaned) warnings.push(`${orphaned} staff member(s) hold a deactivated position and will be skipped.`);
  }
  if (options.settings) {
    preview.settings = {
      orgName: src.settings.orgName,
      designations: src.designations.length,
      programs: src.programs.length,
      sections: src.sections.length,
      approvers: src.approvers.length,
    };
  } else {
    preview.defaults = { designations: DEFAULT_DESIGNATIONS.map((d) => d.name) };
  }
  if (options.funds) {
    preview.funds = {
      items: src.funds.map((f) => ({
        name: f.name,
        amountPerStudent: Number(f.amountPerStudent),
        isMandatory: f.isMandatory,
        isConfidential: f.isConfidential,
      })),
    };
  }
  if (options.carryOver) {
    const items = src.funds
      .map((f) => ({ fund: f, b: src.balances.get(f.id) }))
      .filter(({ b }) => b && b.balance > 0n)
      .map(({ fund, b }) => ({
        fundName: fund.name,
        label: carryOverLabel(fund.name, source.label),
        amount: Number(b!.balance),
        committed: Number(b!.committed),
      }));
    preview.carryOver = { items, total: items.reduce((sum, i) => sum + i.amount, 0) };
    if (source.status !== 'closed') {
      warnings.push(`AY ${source.label} is still open, so its balances can still change. Consider closing it before carrying balances over.`);
    }
    const committed = items.filter((i) => i.committed > 0);
    if (committed.length) {
      warnings.push(`${committed.map((i) => i.fundName).join(', ')} still have approved requests waiting for liquidation in AY ${source.label}.`);
    }
  }
  if (options.promoteStudents) {
    preview.students = { promotable: src.promotable.length, graduating: src.graduating };
    if (src.graduating) warnings.push(`${src.graduating} student(s) are in the last year level and are not copied.`);
  }
  return preview;
}

export type SetupSummary = Awaited<ReturnType<typeof runSetup>>;

export async function runSetup(input: {
  target: AcademicYear;
  source: AcademicYear | null;
  options: CopyOptions;
  actor: Actor;
  req?: Parameters<typeof writeAudit>[1]['req'];
}) {
  const { target, source, actor } = input;
  const options = source ? input.options : NO_OPTIONS;
  const T = target.id;

  return prisma.$transaction(
    async (tx) => {
      // lock the AY and re-check inside the transaction, so two wizards can't both run
      await tx.$queryRaw`SELECT id FROM academic_years WHERE id = ${T}::uuid FOR UPDATE`;
      if (await tx.aySetting.findUnique({ where: { academicYearId: T } })) {
        throw conflict('ALREADY_SET_UP', `AY ${target.label} is already set up.`);
      }
      const src = source ? await loadSource(tx, source) : null;
      const skipped: string[] = [];
      const summary = {
        settingsCopied: false,
        designations: 0,
        programs: 0,
        sections: 0,
        approvers: 0,
        adviserCopied: false,
        staff: 0,
        funds: 0,
        carryOver: { entries: 0, total: 0 },
        students: 0,
        skipped,
      };

      const designationMap = new Map<string, string>();
      const programMap = new Map<string, string>();
      const sectionMap = new Map<string, string>();

      // ── Settings (or defaults) ──
      if (options.settings && src) {
        const {
          academicYearId: _ay,
          updatedAt: _ua,
          updatedById: _ub,
          updatedByName: _un,
          logoFileId,
          receiptLogoFileId,
          emailTemplates,
          notificationEvents,
          publicFields,
          uploadAllowedMime,
          ...plain
        } = src.settings;
        await tx.aySetting.create({
          data: {
            ...plain,
            academicYearId: T,
            emailTemplates: emailTemplates as Prisma.InputJsonValue,
            notificationEvents: notificationEvents as Prisma.InputJsonValue,
            publicFields: publicFields as Prisma.InputJsonValue,
            uploadAllowedMime: uploadAllowedMime as Prisma.InputJsonValue,
            logoFileId: await copyFileRecord(tx, logoFileId, T),
            receiptLogoFileId: await copyFileRecord(tx, receiptLogoFileId, T),
            updatedById: actor.id,
            updatedByName: actor.name,
          },
        });
        summary.settingsCopied = true;

        for (const d of src.designations) {
          const created = await tx.designation.create({
            data: {
              academicYearId: T,
              name: d.name,
              canFileRequests: d.canFileRequests,
              canCollect: d.canCollect,
              isConfidentialExempt: d.isConfidentialExempt,
              canViewFunds: d.canViewFunds,
              maxMembers: d.maxMembers,
              seatsLocked: d.seatsLocked,
              sortOrder: d.sortOrder,
            },
          });
          designationMap.set(d.id, created.id);
        }
        for (const p of src.programs) {
          const created = await tx.program.create({ data: { academicYearId: T, code: p.code, name: p.name } });
          programMap.set(p.id, created.id);
        }
        for (const s of src.sections) {
          const created = await tx.section.create({ data: { academicYearId: T, name: s.name } });
          sectionMap.set(s.id, created.id);
        }
        summary.designations = designationMap.size;
        summary.programs = programMap.size;
        summary.sections = sectionMap.size;
      } else {
        await tx.aySetting.create({
          data: { academicYearId: T, privacyConsentText: defaultPrivacyConsent(), updatedById: actor.id, updatedByName: actor.name },
        });
        for (const [i, d] of DEFAULT_DESIGNATIONS.entries()) {
          await tx.designation.create({ data: { academicYearId: T, sortOrder: i, ...d } });
        }
        summary.designations = DEFAULT_DESIGNATIONS.length;
      }

      for (const counterKey of COUNTER_KEYS) {
        await tx.ayCounter.upsert({
          where: { academicYearId_counterKey: { academicYearId: T, counterKey } },
          update: {},
          create: { academicYearId: T, counterKey },
        });
      }

      // ── People ──
      const joinTarget = async (
        userId: string,
        data: { role: 'adviser' | 'member'; designationId: string | null; copiedFromId: string },
      ) => {
        const fields = {
          ...data,
          status: 'active' as const,
          decidedAt: new Date(),
          decidedById: actor.id,
          decidedByName: actor.name,
          decisionNote: `Copied from AY ${source!.label}`,
        };
        const existing = await tx.userAyRole.findUnique({ where: { academicYearId_userId: { academicYearId: T, userId } } });
        if (existing?.status === 'active' || existing?.status === 'deactivated') return false;
        if (existing) await tx.userAyRole.update({ where: { id: existing.id }, data: fields });
        else await tx.userAyRole.create({ data: { academicYearId: T, userId, ...fields } });
        return true;
      };

      if (options.adviser && src) {
        if (!src.advisers.length) skipped.push('No adviser to copy.');
        // every adviser of the source AY who isn't in this AY yet
        for (const a of src.advisers) {
          if (await joinTarget(a.userId, { role: 'adviser', designationId: null, copiedFromId: a.id })) summary.adviserCopied = true;
        }
      }

      if (options.staff && src) {
        for (const m of src.staff) {
          const designationId = m.designationId ? designationMap.get(m.designationId) : undefined;
          if (!designationId) {
            skipped.push(`${formatPersonName(m.user)}: their position is no longer active.`);
            continue;
          }
          const position = await tx.designation.findUniqueOrThrow({ where: { id: designationId } });
          if (position.maxMembers !== null && (await tx.userAyRole.count({ where: { designationId, status: 'active' } })) >= position.maxMembers) {
            skipped.push(`${formatPersonName(m.user)}: ${position.name} is already full in this AY.`);
            continue;
          }
          if (await joinTarget(m.userId, { role: 'member', designationId, copiedFromId: m.id })) summary.staff++;
          else skipped.push(`${formatPersonName(m.user)}: already has an account status in this AY.`);
        }
      }

      if (options.settings && src) {
        // approvers come with the settings, but only for people who are members of the new AY
        for (const a of src.approvers) {
          const member = await tx.userAyRole.findFirst({
            where: { academicYearId: T, userId: a.userId, role: 'member', status: 'active' },
          });
          if (!member) continue;
          await tx.ayApprover.create({
            data: {
              academicYearId: T,
              userId: a.userId,
              approvesFundRequests: a.approvesFundRequests,
              approvesLiquidations: a.approvesLiquidations,
              addedById: actor.id,
              addedByName: actor.name,
            },
          });
          summary.approvers++;
        }
      }

      // ── Funds and carry-over ──
      const fundMap = new Map<string, string>();
      if (options.funds && src) {
        for (const f of src.funds) {
          const created = await tx.fund.create({
            data: {
              academicYearId: T,
              name: f.name,
              notes: f.notes,
              amountPerStudent: f.amountPerStudent,
              isConfidential: f.isConfidential,
              isMandatory: f.isMandatory,
              allPrograms: f.allPrograms,
              priority: f.priority,
              copiedFromFundId: f.id,
              createdById: actor.id,
              createdByName: actor.name,
            },
          });
          fundMap.set(f.id, created.id);
          if (f.yearLevels.length) {
            await tx.fundYearLevel.createMany({
              data: f.yearLevels.map((y) => ({ academicYearId: T, fundId: created.id, yearLevel: y.yearLevel })),
            });
          }
          const programs = f.programs.map((p) => programMap.get(p.programId)).filter((id): id is string => Boolean(id));
          if (programs.length) {
            await tx.fundProgram.createMany({ data: programs.map((programId) => ({ academicYearId: T, fundId: created.id, programId })) });
          }
          if (!f.allPrograms && programs.length < f.programs.length) {
            skipped.push(`${f.name}: some of its programs are no longer active and were left out.`);
          }
        }
        summary.funds = fundMap.size;
      }

      if (options.carryOver && src) {
        for (const f of src.funds) {
          const balance = src.balances.get(f.id)?.balance ?? 0n;
          const newFundId = fundMap.get(f.id);
          if (balance <= 0n || !newFundId) continue;
          await tx.fundLedger.create({
            data: {
              academicYearId: T,
              fundId: newFundId,
              entryType: 'carry_over',
              amount: balance,
              label: carryOverLabel(f.name, source!.label),
              sourceAcademicYearId: source!.id,
              sourceFundId: f.id,
              createdById: actor.id,
              createdByName: actor.name,
              createdByDesignation: actor.designation ?? null,
            },
          });
          summary.carryOver.entries++;
          summary.carryOver.total += Number(balance);
        }
      }

      // ── Students: year level +1, confirmed by staff before their first payment ──
      if (options.promoteStudents && src) {
        const students: Prisma.StudentCreateManyInput[] = [];
        const tokens: Prisma.StudentQrTokenCreateManyInput[] = [];
        for (const s of src.promotable) {
          const programId = programMap.get(s.programId);
          if (!programId) {
            skipped.push(`${s.studentNumber}: their program is no longer active.`);
            continue;
          }
          const id = randomUUID();
          students.push({
            id,
            academicYearId: T,
            studentNumber: s.studentNumber,
            firstName: s.firstName,
            middleName: s.middleName,
            lastName: s.lastName,
            suffix: s.suffix,
            nameKey: s.nameKey,
            nameKeyLoose: s.nameKeyLoose,
            programId,
            yearLevel: s.yearLevel + 1,
            sectionId: s.sectionId ? (sectionMap.get(s.sectionId) ?? null) : null,
            email: s.email,
            contactNo: s.contactNo,
            status: 'active',
            source: 'promoted',
            consentGivenAt: s.consentGivenAt,
            consentVersion: s.consentVersion,
            needsProfileConfirmation: true,
            promotedFromStudentId: s.id,
            approvedAt: new Date(),
            approvedById: actor.id,
            approvedByName: actor.name,
            createdById: actor.id,
            createdByName: actor.name,
          });
          tokens.push({ academicYearId: T, studentId: id, token: randomToken() });
        }
        if (students.length) {
          await tx.student.createMany({ data: students });
          await tx.studentQrToken.createMany({ data: tokens });
        }
        summary.students = students.length;
      }

      if (source) {
        await tx.ayCopyRun.create({
          data: {
            sourceAcademicYearId: source.id,
            targetAcademicYearId: T,
            options: options as unknown as Prisma.InputJsonValue,
            resultSummary: summary as unknown as Prisma.InputJsonValue,
            executedById: actor.id!,
            executedByName: actor.name,
          },
        });
      }
      await writeAudit(tx, {
        ayId: T,
        actor,
        action: 'create',
        entityType: 'ay_setup',
        entityId: T,
        after: { source: source?.label ?? null, options, summary },
        req: input.req,
      });
      return summary;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

/** A new file record in the target AY pointing at the same (write-once) stored blob. */
async function copyFileRecord(tx: Prisma.TransactionClient, fileId: string | null, targetAyId: string) {
  if (!fileId) return null;
  const f = await tx.storedFile.findUniqueOrThrow({ where: { id: fileId } });
  const copy = await tx.storedFile.create({
    data: {
      academicYearId: targetAyId,
      storageDriver: f.storageDriver,
      storageKey: f.storageKey,
      originalName: f.originalName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      sha256: f.sha256,
      uploadedById: f.uploadedById,
      uploadedByName: f.uploadedByName,
    },
  });
  return copy.id;
}
