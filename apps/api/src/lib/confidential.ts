import type { Prisma } from '@prisma/client';
import type { Permission } from '@sft/shared';

/**
 * Confidential funds — their names, balances, ledgers and requests — are visible only to the
 * adviser and to positions marked "See confidential funds". Everyone else either doesn't see
 * them at all (fund lists, ledgers, reports) or sees a masked line (a student's charges).
 */
export const canSeeConfidential = (perms: Permission[]) => perms.includes('view_confidential');

export const visibleFundsWhere = (perms: Permission[]): Prisma.FundWhereInput => (canSeeConfidential(perms) ? {} : { isConfidential: false });

export const RESTRICTED_FUND_LABEL = 'Restricted fund';

export const fundLabelFor = (perms: Permission[], fund: { name: string; isConfidential: boolean }) =>
  fund.isConfidential && !canSeeConfidential(perms) ? RESTRICTED_FUND_LABEL : fund.name;
