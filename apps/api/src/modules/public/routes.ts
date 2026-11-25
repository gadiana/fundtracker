import { Router } from 'express';
import { describePasswordPolicy } from '@sft/shared';
import { prisma } from '../../db';
import { notFound, uuidParam } from '../../lib/http';
import { getCurrentAy, getSettings, passwordPolicyFrom } from '../../lib/settings';
import { sendStoredFile } from '../../lib/uploads';
import { reportLogoFileIds } from '../reports/formats';
import { logoUrl } from '../settings/service';

/** No login needed: branding and consent text for the login/signup pages, and logos. */
export const publicRouter = Router();

publicRouter.get('/info', async (_req, res) => {
  const ay = await getCurrentAy();
  if (!ay) {
    res.json({ initialized: false });
    return;
  }
  const s = await getSettings(ay.id);
  const policy = passwordPolicyFrom(s);
  res.json({
    initialized: true,
    academicYear: { label: ay.label, status: ay.status },
    org: {
      name: s?.orgName ?? '',
      abbr: s?.orgAbbr ?? '',
      school: s?.schoolName ?? '',
      schoolAbbr: s?.schoolAbbr ?? '',
      college: s?.collegeName ?? '',
      collegeAbbr: s?.collegeAbbr ?? '',
      logoUrl: s?.logoFileId ? logoUrl(ay.id, 'org', s.logoFileId) : null,
    },
    privacyConsentText: s?.privacyConsentText ?? '',
    passwordPolicy: policy,
    passwordRules: describePasswordPolicy(policy),
  });
});

/** Logos are public on purpose: they appear on the login page, receipts and the QR status page. */
publicRouter.get('/ays/:ayId/logo', async (req, res) => {
  const settings = await prisma.aySetting.findUnique({
    where: { academicYearId: uuidParam(req.params.ayId) },
    include: { logoFile: true, receiptLogo: true },
  });
  const file = req.query.kind === 'receipt' ? (settings?.receiptLogo ?? settings?.logoFile) : settings?.logoFile;
  if (!file) throw notFound('No logo.');
  await sendStoredFile(res, file, { publicCache: true });
});

/** A logo in a report's header (Settings → Reports): public like the organization's logo. */
publicRouter.get('/ays/:ayId/report-logo/:fileId', async (req, res) => {
  const academicYearId = uuidParam(req.params.ayId);
  const fileId = uuidParam(req.params.fileId);
  const settings = await prisma.aySetting.findUnique({ where: { academicYearId } });
  if (!settings || !reportLogoFileIds(settings.reportFormats).includes(fileId)) throw notFound('No logo.');
  const file = await prisma.storedFile.findFirst({ where: { id: fileId, academicYearId } });
  if (!file) throw notFound('No logo.');
  await sendStoredFile(res, file, { publicCache: true });
});
