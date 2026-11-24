import type { User } from '@prisma/client';

/** Where a user's picture is served; the version changes with every new picture, so it can be cached. */
export const avatarUrl = (u: Pick<User, 'id' | 'avatarKey' | 'avatarUpdatedAt'>) =>
  u.avatarKey && u.avatarUpdatedAt ? `/api/users/${u.id}/avatar?v=${u.avatarUpdatedAt.getTime().toString(36)}` : null;
