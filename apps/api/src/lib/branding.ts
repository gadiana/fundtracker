import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { LOGO_MIME_TYPES } from '@sft/shared';
import { BRANDING } from '../branding';
import { prisma } from '../db';
import { sha256 } from './crypto';
import { saveUpload } from './uploads';

const NAME_KEYS = ['orgName', 'orgAbbr', 'schoolName', 'schoolAbbr', 'collegeName', 'collegeAbbr', 'programName', 'programAbbr'] as const;
const SYSTEM = { id: null, name: 'System (branding)' };

/** A logo image from apps/api/branding/, or null when none is set. */
function readLogo(fileName: string) {
  if (!fileName) return null;
  const buffer = readFileSync(resolve(process.cwd(), 'branding', basename(fileName)));
  return { buffer, name: basename(fileName), hash: sha256(buffer) };
}

/**
 * Copies the names and logos from src/branding.ts into the settings of every academic year (or
 * only the one given). Run at server start and when a year is set up. A logo is stored again only
 * when its image changed.
 */
export async function applyBranding(academicYearId?: string) {
  const logo = readLogo(BRANDING.logo);
  const receiptLogo = readLogo(BRANDING.receiptLogo);
  const rows = await prisma.aySetting.findMany({
    where: academicYearId ? { academicYearId } : {},
    include: { logoFile: true, receiptLogo: true },
  });

  for (const s of rows) {
    const data: Record<string, string | null> = {};
    for (const key of NAME_KEYS) if (s[key] !== BRANDING[key]) data[key] = BRANDING[key];

    for (const [field, current, image] of [
      ['logoFileId', s.logoFile, logo],
      ['receiptLogoFileId', s.receiptLogo, receiptLogo],
    ] as const) {
      if (!image) {
        if (current) data[field] = null;
      } else if (current?.sha256 !== image.hash) {
        const file = { buffer: image.buffer, originalname: image.name, size: image.buffer.length } as Express.Multer.File;
        data[field] = (await saveUpload(prisma, { academicYearId: s.academicYearId, file, allowedMimes: LOGO_MIME_TYPES, actor: SYSTEM })).id;
      }
    }

    if (Object.keys(data).length) {
      await prisma.aySetting.update({ where: { academicYearId: s.academicYearId }, data: { ...data, updatedById: null, updatedByName: SYSTEM.name } });
    }
  }
}
