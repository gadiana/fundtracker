import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { Prisma, StoredFile } from '@prisma/client';
import { MAX_UPLOAD_BYTES } from '@sft/shared';
import type { Actor } from './audit';
import { sha256 } from './crypto';
import { badRequest, HttpError } from './http';
import { storage } from './storage';

interface FileKind {
  mime: string;
  ext: string;
  label: string;
  matches: (b: Buffer) => boolean;
}

/** Types are decided by the file's first bytes, never by its name or the browser's claim. */
const FILE_KINDS: FileKind[] = [
  {
    mime: 'image/png',
    ext: 'png',
    label: 'PNG',
    matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    ext: 'webp',
    label: 'WebP',
    matches: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { mime: 'application/pdf', ext: 'pdf', label: 'PDF', matches: (b) => b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

export const sniffFileKind = (buffer: Buffer) => FILE_KINDS.find((k) => k.matches(buffer)) ?? null;

const labelsFor = (mimes: readonly string[]) =>
  FILE_KINDS.filter((k) => mimes.includes(k.mime))
    .map((k) => k.label)
    .join(', ');

/** Keeps only a harmless display name; the stored file always gets a random name. */
export function displayName(original: string) {
  const name = basename(original.replace(/\\/g, '/'))
    .replace(/[^\w.\- ()]/g, '_')
    .trim();
  return (name || 'file').slice(-200);
}

/** Reads one multipart file field ("file") into memory, enforcing the size limit. */
export function receiveFile(req: Request, res: Response, maxBytes: number): Promise<Express.Multer.File> {
  const limit = Math.min(maxBytes, MAX_UPLOAD_BYTES);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limit, files: 1, fields: 5 } }).single('file');
  return new Promise((resolvePromise, reject) => {
    upload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          reject(new HttpError(413, 'FILE_TOO_LARGE', `The file is too large. The limit is ${(limit / 1024 / 1024).toFixed(1)} MB.`));
        } else reject(badRequest('UPLOAD_ERROR', 'The upload could not be read.'));
        return;
      }
      if (err) return reject(err);
      if (!req.file) return reject(badRequest('NO_FILE', 'Choose a file to upload.'));
      resolvePromise(req.file);
    });
  });
}

interface SaveOptions {
  academicYearId: string;
  file: Express.Multer.File;
  allowedMimes: readonly string[];
  actor: Actor;
}

type FileClient = Pick<Prisma.TransactionClient, 'storedFile'>;

/** Checks the real file type, writes it under a random name and records it. */
export async function saveUpload(db: FileClient, { academicYearId, file, allowedMimes, actor }: SaveOptions): Promise<StoredFile> {
  const kind = sniffFileKind(file.buffer);
  if (!kind || !allowedMimes.includes(kind.mime)) {
    throw badRequest('FILE_TYPE', `That file type isn't allowed. Allowed: ${labelsFor(allowedMimes)}.`);
  }
  const key = `${academicYearId}/${new Date().getUTCFullYear()}/${randomUUID()}.${kind.ext}`;
  await storage.put(key, file.buffer);
  return db.storedFile.create({
    data: {
      academicYearId,
      storageDriver: storage.driver,
      storageKey: key,
      originalName: displayName(file.originalname),
      mimeType: kind.mime,
      sizeBytes: file.size,
      sha256: sha256(file.buffer),
      uploadedById: actor.id,
      uploadedByName: actor.name,
    },
  });
}

/** Sends a stored file with headers that stop browsers from running anything in it. */
export async function sendStoredFile(res: Response, file: StoredFile, { publicCache = false } = {}) {
  const data = await storage.get(file.storageKey);
  res.set({
    'Content-Type': file.mimeType,
    'Content-Length': String(data.length),
    'Content-Disposition': `inline; filename="${file.originalName.replace(/"/g, '')}"`,
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': publicCache ? 'public, max-age=300' : 'private, max-age=300',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(data);
}
