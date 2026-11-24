import { useState } from 'react';
import { cx } from './ui';

const SIZES = { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-20 text-2xl', xl: 'size-28 text-3xl' } as const;

/** Two letters from a name: "Maria Clara S. Dela Cruz" → "MC". */
function initials(name: string) {
  const words = name.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** A person's picture, or their initials when there is none (or it fails to load). */
export function Avatar({ name, url, size = 'sm', className }: { name: string; url?: string | null; size?: keyof typeof SIZES; className?: string }) {
  const [broken, setBroken] = useState(false);
  const base = cx('inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold select-none', SIZES[size], className);
  if (url && !broken) {
    return <img src={url} alt="" className={cx(base, 'bg-slate-100 object-cover')} onError={() => setBroken(true)} />;
  }
  return (
    <span className={cx(base, 'bg-brand-100 text-brand-700')} aria-hidden>
      {initials(name)}
    </span>
  );
}

/**
 * Prepares a chosen photo for upload: crops the middle square and scales it to 256 px, so
 * every picture is small and the same shape, whatever the phone camera produced.
 */
export async function squareAvatar(file: File, px = 256): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, px, px);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!blob) throw new Error('That picture could not be read.');
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}
