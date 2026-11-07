import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { api, describeError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import type { Me } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { QrImage } from './QrImage';
import { useToast } from './Toast';
import { Alert, Badge, Button, Card, Field, Input } from './ui';

interface Status {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  requiredBy: string[];
}

/** Profile → Two-factor sign-in: set it up with an authenticator app, recovery codes, turn it off. */
export function TwoFactorCard() {
  const { setMe } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ['two-factor'], queryFn: () => api<Status>('/me/two-factor') });
  const [dialog, setDialog] = useState<'start' | 'disable' | 'codes' | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [setupError, setSetupError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const s = status.data;

  const open = (d: typeof dialog) => {
    setPassword('');
    setCode('');
    setDialog(d);
  };
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['two-factor'] });
    setMe(await api<Me>('/auth/me'));
  }
  const call = async <T,>(path: string, body: object) => {
    try {
      return await api<T>(path, { method: 'POST', body });
    } catch (err) {
      throw new Error(describeError(err));
    }
  };

  async function enable() {
    setBusy(true);
    setSetupError('');
    try {
      const res = await api<{ recoveryCodes: string[] }>('/me/two-factor/enable', { method: 'POST', body: { code: setupCode } });
      setSetup(null);
      setSetupCode('');
      setRecovery(res.recoveryCodes);
      await refresh();
      toast('Two-factor sign-in is on.');
    } catch (err) {
      setSetupError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const codesText = (codes: string[]) => `Fund Tracker recovery codes (each works once)\n\n${codes.join('\n')}\n`;

  return (
    <Card className="p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            Two-factor sign-in
            {s?.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}
          </h2>
          <p className="max-w-2xl text-sm text-slate-500">
            After your password, you also enter a code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy…). Someone who learns
            your password still can’t sign in.
          </p>
        </div>
        {s && !setup && !recovery && (
          <div className="flex flex-wrap gap-2">
            {s.enabled ? (
              <>
                <Button variant="secondary" onClick={() => open('codes')}>
                  <KeyRound className="size-4" aria-hidden /> New recovery codes
                </Button>
                {s.requiredBy.length === 0 && (
                  <Button variant="ghost" onClick={() => open('disable')}>
                    <ShieldOff className="size-4" aria-hidden /> Turn off
                  </Button>
                )}
              </>
            ) : (
              <Button onClick={() => open('start')}>
                <ShieldCheck className="size-4" aria-hidden /> Turn on
              </Button>
            )}
          </div>
        )}
      </div>

      {s?.enabled && !recovery && (
        <p className="mt-3 text-sm text-slate-600">
          On since {formatDate(s.enabledAt)} · {s.recoveryCodesLeft} recovery code{s.recoveryCodesLeft === 1 ? '' : 's'} left
          {s.recoveryCodesLeft <= 2 && ' — make new ones soon'}
          {s.requiredBy.length > 0 && ` · required by AY ${s.requiredBy.join(', ')}`}
        </p>
      )}
      {!s?.enabled && s?.requiredBy.length ? (
        <Alert tone="warning" className="mt-3">
          AY {s.requiredBy.join(', ')} requires two-factor sign-in. Turn it on to keep using it.
        </Alert>
      ) : null}

      {setup && (
        <div className="mt-4 grid gap-5 rounded-lg border border-slate-200 p-4 sm:grid-cols-[auto_1fr]">
          <div className="text-center">
            <QrImage value={setup.otpauthUrl} label="QR code for your authenticator app" className="mx-auto size-44" />
            <p className="mt-2 text-xs text-slate-500">Scan with your authenticator app</p>
          </div>
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>Open your authenticator app and add an account by scanning the QR code.</li>
              <li>
                Can’t scan? Enter this key instead: <span className="break-all font-mono text-xs font-semibold">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</span>
              </li>
              <li>Type the 6-digit code the app shows.</li>
            </ol>
            <Field label="Code from the app" htmlFor="tf-setup-code" error={setupError || undefined}>
              <Input
                id="tf-setup-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                className="max-w-40 font-mono tracking-widest"
              />
            </Field>
            <div className="flex gap-2">
              <Button onClick={enable} loading={busy} disabled={setupCode.replace(/\s/g, '').length !== 6}>
                Turn on two-factor
              </Button>
              <Button variant="ghost" onClick={() => setSetup(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {recovery && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Save your recovery codes now</p>
          <p className="text-sm text-amber-900">
            If you lose your phone, each code lets you sign in once. They are shown only this time; keep them somewhere safe (not on the same phone).
          </p>
          <ul className="my-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
            {recovery.map((c) => (
              <li key={c} className="rounded bg-white px-2 py-1 text-center ring-1 ring-amber-200">
                {c}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(codesText(recovery)).catch(() => {});
                toast('Recovery codes copied.');
              }}
            >
              <Copy className="size-4" aria-hidden /> Copy
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([codesText(recovery)], { type: 'text/plain' }));
                a.download = 'fund-tracker-recovery-codes.txt';
                a.click();
              }}
            >
              <Download className="size-4" aria-hidden /> Download
            </Button>
            <Button size="sm" onClick={() => setRecovery(null)}>
              I saved them
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={dialog === 'start'}
        title="Turn on two-factor sign-in?"
        description="Enter your password to start. You'll need your phone with an authenticator app."
        confirmLabel="Continue"
        confirmDisabled={!password}
        onConfirm={async () => setSetup(await call<{ secret: string; otpauthUrl: string }>('/me/two-factor/setup', { password }))}
        onClose={() => setDialog(null)}
      >
        <Field label="Password" htmlFor="tf-password">
          <Input id="tf-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'disable' || dialog === 'codes'}
        title={dialog === 'disable' ? 'Turn off two-factor sign-in?' : 'Make new recovery codes?'}
        description={dialog === 'disable' ? 'Your password alone will be enough to sign in again.' : 'Your old recovery codes stop working.'}
        confirmLabel={dialog === 'disable' ? 'Turn off' : 'Make new codes'}
        tone={dialog === 'disable' ? 'danger' : 'primary'}
        confirmDisabled={!password || code.replace(/\s/g, '').length < 6}
        onConfirm={async () => {
          if (dialog === 'disable') {
            await call('/me/two-factor/disable', { password, code });
            await refresh();
            toast('Two-factor sign-in is off.');
          } else {
            const res = await call<{ recoveryCodes: string[] }>('/me/two-factor/recovery-codes', { password, code });
            setRecovery(res.recoveryCodes);
            await refresh();
          }
        }}
        onClose={() => setDialog(null)}
      >
        <Field label="Password" htmlFor="tf-pw2">
          <Input id="tf-pw2" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Code from your app (or a recovery code)" htmlFor="tf-code2">
          <Input id="tf-code2" inputMode="numeric" autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}
