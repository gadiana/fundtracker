import { Router, type Request } from 'express';
import type { StoredFile } from '@prisma/client';
import { prisma } from '../../db';
import { forbidden, notFound, uuidParam } from '../../lib/http';
import { receiveFile, saveUpload, sendStoredFile } from '../../lib/uploads';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireMember, requireOpenAy } from '../../middleware/ay';
import { canViewRequest } from '../fund-requests/service';

/**
 * Uploaded files of the selected AY.
 * - An attachment can be opened by whoever may see its fund request (requestor, approvers,
 *   adviser), and never by people who may not see a confidential fund.
 * - A file not attached to anything yet can only be opened by the person who uploaded it.
 */
export const filesRouter = Router();
filesRouter.use(requireAuth, ayContext, requireMember);

async function assertCanView(req: Request, file: StoredFile) {
  const { ay, perms } = ctxOf(req);
  const userId = req.user!.id;
  const links = await prisma.attachment.findMany({
    where: { fileId: file.id },
    include: { fundRequest: { include: { fund: true } }, liquidationReceipt: { include: { fundRequest: { include: { fund: true } } } } },
  });
  if (links.length === 0) {
    const isLogo = await prisma.aySetting.count({ where: { academicYearId: ay.id, OR: [{ logoFileId: file.id }, { receiptLogoFileId: file.id }] } });
    if (isLogo || file.uploadedById === userId) return;
    throw notFound('File not found.');
  }
  for (const link of links) {
    const request = link.fundRequest ?? link.liquidationReceipt?.fundRequest;
    if (request && (await canViewRequest(ay.id, { userId, perms }, request))) return;
  }
  throw notFound('File not found.');
}

filesRouter.get('/:id', async (req, res) => {
  const { db } = ctxOf(req);
  const file = await db.storedFile.findUnique({ where: { id: uuidParam(req.params.id) } });
  if (!file) throw notFound('File not found.');
  await assertCanView(req, file);
  await sendStoredFile(res, file);
});

/** Upload one attachment (photo or PDF of a document or receipt). Attach it when submitting the request. */
export const uploadsRouter = Router();
uploadsRouter.use(requireAuth, ayContext, requireMember, requireOpenAy);

uploadsRouter.post('/', async (req, res) => {
  const { ay, actor, perms } = ctxOf(req);
  if (!perms.includes('file_requests') && !perms.includes('manage')) throw forbidden('Your position cannot upload request documents.');
  const settings = await prisma.aySetting.findUnique({ where: { academicYearId: ay.id } });
  const allowed = (Array.isArray(settings?.uploadAllowedMime) ? settings.uploadAllowedMime : ['image/jpeg', 'image/png', 'application/pdf']) as string[];
  const file = await receiveFile(req, res, settings?.uploadMaxBytes ?? 10 * 1024 * 1024);
  const stored = await saveUpload(prisma, { academicYearId: ay.id, file, allowedMimes: allowed, actor });
  res.status(201).json({ id: stored.id, name: stored.originalName, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, url: `/api/files/${stored.id}` });
});
