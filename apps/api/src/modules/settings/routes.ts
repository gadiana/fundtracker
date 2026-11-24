import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { BRANDING_KEYS, settingsPatchSchema } from '@sft/shared';
import { prisma } from '../../db';
import { writeAudit } from '../../lib/audit';
import { conflict, forbidden } from '../../lib/http';
import { invalidateSecurityCache } from '../../lib/settings';
import { requireAuth } from '../../middleware/auth';
import { ayContext, ctxOf, requireAdviser, requireOpenAy } from '../../middleware/ay';
import { notificationSettingsRouter } from './notifications';
import { changedFields, SECURITY_KEYS, serializeSettings, storedPublicFields } from './service';

/** Settings of the selected AY. Adviser only. */
export const settingsRouter = Router();
settingsRouter.use(requireAuth, ayContext, requireAdviser);

async function loadSettings(req: Request) {
  const { db, ay } = ctxOf(req);
  const settings = await db.aySetting.findUnique({ where: { academicYearId: ay.id } });
  if (!settings) throw conflict('NEEDS_SETUP', `AY ${ay.label} hasn't been set up yet. Run the setup wizard first.`);
  return settings;
}

settingsRouter.get('/', async (req, res) => {
  res.json(serializeSettings(await loadSettings(req)));
});

settingsRouter.patch('/', requireOpenAy, async (req, res) => {
  const patch = settingsPatchSchema.parse(req.body);
  const { db, ay, actor } = ctxOf(req);
  const before = await loadSettings(req);
  const branding = BRANDING_KEYS.filter((k) => k in patch && patch[k] !== before[k]);
  if (branding.length) throw forbidden('The organization’s name and logos are set by the developers in the system’s code.', 'SET_IN_CODE');

  if (patch.yearLevelCount !== undefined && patch.yearLevelCount < before.yearLevelCount) {
    const n = patch.yearLevelCount;
    const [students, fundLevels] = await Promise.all([
      db.student.count({ where: { yearLevel: { gt: n }, status: { not: 'rejected' } } }),
      db.fundYearLevel.count({ where: { yearLevel: { gt: n } } }),
    ]);
    if (students || fundLevels) {
      throw conflict(
        'YEAR_LEVEL_IN_USE',
        `Year levels above ${n} are still in use (${students} student(s), ${fundLevels} fund setting(s)). Move them first.`,
      );
    }
  }

  const { publicFields, ...rest } = patch;
  const data: Prisma.AySettingUncheckedUpdateInput & Record<string, unknown> = { ...rest };
  if (publicFields) data.publicFields = storedPublicFields(publicFields);
  if (patch.privacyConsentText !== undefined && patch.privacyConsentText !== before.privacyConsentText) {
    // people who agreed to the old text agreed to an older version
    data.privacyConsentVersion = String((Number.parseInt(before.privacyConsentVersion, 10) || 1) + 1);
  }

  // requiring two-factor would lock the adviser out of their own settings if they haven't set it up
  if (patch.twofaMode === 'required' && before.twofaMode !== 'required' && !req.user!.totpEnabled) {
    throw conflict('TWO_FACTOR_NOT_SET_UP', 'Turn on two-factor sign-in for your own account first (Profile → Two-factor sign-in), then require it for everyone.');
  }

  const diff = changedFields(before as unknown as Record<string, unknown>, data);
  if (diff.changed.length === 0) {
    res.json(serializeSettings(before));
    return;
  }

  const updated = await db.$transaction(async (tx) => {
    const updated = await tx.aySetting.update({
      where: { academicYearId: ay.id },
      data: { ...data, updatedById: actor.id, updatedByName: actor.name },
    });
    await writeAudit(tx, {
      ayId: ay.id,
      actor,
      action: 'settings_change',
      entityType: 'settings',
      entityId: ay.id,
      before: diff.before,
      after: diff.after,
      req,
    });
    return updated;
  });

  if (diff.changed.some((k) => (SECURITY_KEYS as readonly string[]).includes(k))) invalidateSecurityCache();
  res.json(serializeSettings(updated));
});

// Email & notifications: event switches, wording, test email and the sent-email log
settingsRouter.use(notificationSettingsRouter);
