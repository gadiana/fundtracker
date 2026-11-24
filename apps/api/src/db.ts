import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** Models whose rows belong to exactly one academic year. */
export const AY_SCOPED_MODELS: ReadonlySet<Prisma.ModelName> = new Set<Prisma.ModelName>([
  'UserAyRole',
  'Designation',
  'AyApprover',
  'StoredFile',
  'AySetting',
  'AyCounter',
  'Program',
  'Section',
  'EnrollmentLink',
  'Student',
  'StudentQrToken',
  'Fund',
  'FundYearLevel',
  'FundProgram',
  'StudentCharge',
  'Payment',
  'PaymentAllocation',
  'FundRequest',
  'FundRequestDecision',
  'LiquidationReceipt',
  'LiquidationDecision',
  'LiquidationEntry',
  'LiquidationItem',
  'Attachment',
  'FundLedger',
]);

export class CrossAyError extends Error {
  constructor(model: string) {
    super(`Blocked cross-academic-year access on ${model}`);
  }
}

function withAy(model: string, data: Record<string, unknown> | undefined, ayId: string) {
  const row = data ?? {};
  if (row.academicYearId !== undefined && row.academicYearId !== ayId) throw new CrossAyError(model);
  return { ...row, academicYearId: ayId };
}

const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

function makeScopedClient(ayId: string) {
  return prisma.$extends({
    name: 'academic-year-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!AY_SCOPED_MODELS.has(model as Prisma.ModelName)) return query(args);
          const a = { ...(args as Record<string, any>) };

          if (CREATE_OPS.has(operation)) {
            a.data = Array.isArray(a.data) ? a.data.map((d: any) => withAy(model, d, ayId)) : withAy(model, a.data, ayId);
          } else if (operation === 'upsert') {
            a.where = withAy(model, a.where, ayId);
            a.create = withAy(model, a.create, ayId);
          } else {
            // reads, counts, aggregates, updates and deletes: always filter by the AY.
            // findUnique/update/delete accept extra non-unique filters (extendedWhereUnique).
            a.where = withAy(model, a.where, ayId);
            if (a.data && typeof a.data === 'object' && 'academicYearId' in a.data && a.data.academicYearId !== ayId) {
              throw new CrossAyError(model);
            }
          }
          return query(a);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof makeScopedClient>;

const scopedClients = new Map<string, ScopedDb>();

/**
 * A Prisma client that can only see and write rows of one academic year.
 * Every AY-scoped query in route handlers goes through this.
 * Raw SQL ($queryRaw) is NOT scoped — always filter by academic_year_id yourself.
 */
export function forAy(ayId: string): ScopedDb {
  let client = scopedClients.get(ayId);
  if (!client) {
    client = makeScopedClient(ayId);
    scopedClients.set(ayId, client);
  }
  return client;
}
