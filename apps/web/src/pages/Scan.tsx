import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Camera, QrCode } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, Field, Input } from '../components/ui';

/** Pulls the status token out of a scanned receipt QR (a /verify/<token> URL) or a pasted link. */
export function tokenFromScan(text: string): string | null {
  const match = text.trim().match(/\/verify\/([\w-]{20,64})(?:[?#/]|$)/);
  if (match) return match[1]!;
  return /^[\w-]{20,64}$/.test(text.trim()) ? text.trim() : null;
}

/** Public: scan a receipt QR with the camera (no login), or paste its link. */
export function ScanPage() {
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const scannerRef = useRef<{ stop: () => Promise<void>; isScanning: boolean } | null>(null);

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        const scanner = new Html5Qrcode('qr-reader');
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            const token = tokenFromScan(decoded);
            if (token) {
              void scanner.stop().finally(() => navigate(`/verify/${token}`));
            } else {
              setError('That QR code isn’t a student status QR from a receipt.');
            }
          },
          () => {},
        );
      } catch (err) {
        setError(
          window.isSecureContext
            ? `The camera couldn’t start (${err instanceof Error ? err.message : 'permission denied'}). Allow camera access, or paste the link below.`
            : 'The camera only works over https (or on localhost). Paste the receipt link below instead.',
        );
        setScanning(false);
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s?.isScanning) void s.stop().catch(() => {});
    };
  }, [scanning, navigate]);

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const token = tokenFromScan(manual);
    if (token) navigate(`/verify/${token}`);
    else setError('Paste the full link from the receipt QR (it contains /verify/…).');
  };

  return (
    <AuthLayout title="Scan Student QR" subtitle="Check a student’s payment status from the QR on their receipt. No login needed.">
      <div className="space-y-4">
        <div id="qr-reader" className={scanning ? 'overflow-hidden rounded-xl bg-black' : 'hidden'} />
        {!scanning && (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-600">
              <QrCode className="size-8" aria-hidden />
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                setError('');
                setScanning(true);
              }}
            >
              <Camera className="size-5" aria-hidden /> Open camera
            </Button>
          </div>
        )}
        {scanning && (
          <Button variant="secondary" className="w-full" onClick={() => setScanning(false)}>
            Stop camera
          </Button>
        )}
        {error && <Alert tone="warning">{error}</Alert>}
        <form onSubmit={submitManual} className="space-y-2 border-t border-slate-200 pt-4">
          <Field label="Or paste the link" htmlFor="manual-link">
            <Input id="manual-link" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="https://…/verify/…" />
          </Field>
          <Button type="submit" variant="secondary" className="w-full" disabled={!manual.trim()}>
            Check status
          </Button>
        </form>
        <Link to="/login" className="block text-center text-sm font-medium text-brand-700 hover:underline">
          Back to log in
        </Link>
      </div>
    </AuthLayout>
  );
}
