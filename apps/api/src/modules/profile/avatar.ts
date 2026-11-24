import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { formatPersonName } from '@sft/shared';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { badRequest, notFound, uuidParam } from '../../lib/http';
import { getCurrentAy } from '../../lib/settings';
import { storage } from '../../lib/storage';
import { receiveFile, sniffFileKind } from '../../lib/uploads';
import { requireAuth } from '../../middleware/auth';
import { buildMe } from '../auth/me';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Profile → picture. Mounted under /api/me. */
export const avatarRouter = Router();

avatarRouter.post('/avatar', async (req, res) => {
  const file = await receiveFile(req, res, MAX_AVATAR_BYTES);
  const kind = sniffFileKind(file.buffer);
  if (!kind || !AVATAR_TYPES.includes(kind.mime)) throw badRequest('FILE_TYPE', 'Use a JPEG, PNG or WebP picture.');
  const user = req.user!;
  // files are write-once: every picture gets a new key
  const key = `avatars/${user.id}/${randomUUID()}.${kind.ext}`;
  await storage.put(key, file.buffer);
  await prisma.user.update({ where: { id: user.id }, data: { avatarKey: key, avatarMime: kind.mime, avatarUpdatedAt: new Date() } });
  const ay = await getCurrentAy();
  await writeAudit(prisma, { ayId: ay?.id, actor: { id: user.id, name: formatPersonName(user) }, action: 'update', entityType: 'user', entityId: user.id, after: { picture: 'changed' }, req });
  res.json(await buildMe(user.id));
});

avatarRouter.delete('/avatar', async (req, res) => {
  const user = req.user!;
  await prisma.user.update({ where: { id: user.id }, data: { avatarKey: null, avatarMime: null, avatarUpdatedAt: null } });
  const ay = await getCurrentAy();
  await writeAudit(prisma, { ayId: ay?.id, actor: { id: user.id, name: formatPersonName(user) }, action: 'update', entityType: 'user', entityId: user.id, after: { picture: 'removed' }, req });
  res.json(await buildMe(user.id));
});

/** Any signed-in member can see others' pictures (names and positions are shown across the app). */
export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get('/:id/avatar', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: uuidParam(req.params.id) } });
  if (!user?.avatarKey || !user.avatarMime) throw notFound('No picture.');
  const data = await storage.get(user.avatarKey);
  res.set({
    'Content-Type': user.avatarMime,
    'Content-Length': String(data.length),
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=604800, immutable',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(data);
});
