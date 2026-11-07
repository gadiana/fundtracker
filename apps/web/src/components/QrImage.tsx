import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { cx } from './ui';

/** Renders a QR code for `value` as an image (also used for "download QR"). */
export function useQrDataUrl(value: string, size = 512) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return url;
}

export function QrImage({ value, label, className }: { value: string; label: string; className?: string }) {
  const url = useQrDataUrl(value);
  return url ? (
    <img src={url} alt={label} className={cx('rounded-lg bg-white p-2 ring-1 ring-slate-200', className)} />
  ) : (
    <div className={cx('animate-pulse rounded-lg bg-slate-100', className)} aria-hidden />
  );
}
