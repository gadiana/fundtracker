import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { QrCode } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, Field, Input } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Me } from '../lib/types';

const REASONS: Record<string, string> = {
  timeout: 'You were logged out after a period of inactivity.',
  ended: 'Your session ended. Please log in again.',
};

export function LoginPage() {
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [resent, setResent] = useState(false);
  // set when the password was right and the account uses two-factor sign-in
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const reason = REASONS[params.get('reason') ?? ''];

  function signedIn(me: Me) {
    setMe(me);
    const next = params.get('next');
    navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
  }

  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'Could not reach the server.');
      // the 5-minute window to enter the code ran out: start over
      if (e.code === 'TWO_FACTOR_EXPIRED') {
        setChallenge(null);
        setCode('');
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    return attempt(async () => {
      const res = await api<Me | { twoFactorRequired: true; challenge: string }>('/auth/login', { method: 'POST', body: { email, password } });
      if ('twoFactorRequired' in res) {
        setChallenge(res.challenge);
        setPassword('');
      } else signedIn(res);
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    return attempt(async () => signedIn(await api<Me>('/auth/login/2fa', { method: 'POST', body: { challenge, code } })));
  };

  if (challenge) {
    return (
      <AuthLayout title="Two-factor sign-in" subtitle="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={submitCode} className="space-y-4" noValidate>
          {error && <Alert>{error.message}</Alert>}
          <Field label="Code" htmlFor="code" hint="Lost your phone? Enter one of your recovery codes instead.">
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={20}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123 456"
              className="text-center font-mono text-lg tracking-widest"
            />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={code.replace(/\s/g, '').length < 6}>
            Verify and log in
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm font-medium text-slate-600 hover:underline"
            onClick={() => {
              setChallenge(null);
              setCode('');
              setError(null);
            }}
          >
            Use a different account
          </button>
        </form>
      </AuthLayout>
    );
  }

  async function resend() {
    await api('/auth/resend-verification', { method: 'POST', body: { email } }).catch(() => {});
    setResent(true);
  }

  return (
    <AuthLayout title="Log in" subtitle="For the adviser, officers and collectors.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {reason && !error && <Alert tone="info">{reason}</Alert>}
        {error && (
          <Alert>
            {error.message}
            {error.code === 'EMAIL_NOT_VERIFIED' && (
              <div className="mt-2">
                {resent ? (
                  <span className="text-red-900">If the account exists, a new link is on its way.</span>
                ) : (
                  <button type="button" onClick={resend} className="font-medium underline">
                    Resend verification email
                  </button>
                )}
              </div>
            )}
          </Alert>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={busy} disabled={!email || !password}>
          Log in
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-600">
        No account yet?{' '}
        <Link to="/signup" className="font-medium text-brand-700 hover:underline">
          Sign up
        </Link>
      </p>

      <div className="mt-6 border-t border-slate-200 pt-5">
        <p className="mb-2 text-center text-xs text-slate-500">Students: no login needed</p>
        <Link
          to="/scan"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-brand-600 font-semibold text-brand-700 hover:bg-brand-50"
        >
          <QrCode className="size-5" aria-hidden /> Scan Student QR
        </Link>
      </div>
    </AuthLayout>
  );
}
