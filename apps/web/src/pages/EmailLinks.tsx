import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DEFAULT_PASSWORD_POLICY, passwordIssues } from '@sft/shared';
import { AuthLayout, usePublicInfo } from '../components/AuthLayout';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { Alert, Button, Field, Input, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    // the link is single-use: make sure StrictMode's double effect doesn't spend it twice
    if (started.current) return;
    started.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => setState('done'))
      .catch((err) => {
        setError(errorMessage(err));
        setState('error');
      });
  }, [token]);

  return (
    <AuthLayout title="Verify email">
      {state === 'working' && <Spinner label="Verifying" />}
      {state === 'done' && (
        <div className="space-y-4">
          <Alert tone="success" title="Email verified">
            You can now log in.
          </Alert>
          <Link to="/login" className="block text-center font-medium text-brand-700 hover:underline">
            Go to log in
          </Link>
        </div>
      )}
      {state === 'error' && (
        <div className="space-y-4">
          <Alert>{error} You can request a new link from the log-in page.</Alert>
          <Link to="/login" className="block text-center font-medium text-brand-700 hover:underline">
            Go to log in
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new password.">
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success">If an account uses {email}, a reset link is on its way. It expires in 1 hour.</Alert>
          <Link to="/login" className="block text-center font-medium text-brand-700 hover:underline">
            Back to log in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={!email}>
            Send reset link
          </Button>
          <Link to="/login" className="block text-center text-sm font-medium text-brand-700 hover:underline">
            Back to log in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { data: info } = usePublicInfo();
  const policy = info?.passwordPolicy ?? DEFAULT_PASSWORD_POLICY;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const valid = passwordIssues(password, policy).length === 0 && password === confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Choose a new password">
      {done ? (
        <div className="space-y-4">
          <Alert tone="success" title="Password changed">
            You were signed out on every device. Log in with your new password.
          </Alert>
          <Link to="/login" className="block text-center font-medium text-brand-700 hover:underline">
            Go to log in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="New password" htmlFor="password">
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm" error={confirm && confirm !== password ? 'Passwords do not match' : undefined}>
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <PasswordChecklist password={password} policy={policy} />
          <Button type="submit" className="w-full" loading={busy} disabled={!valid}>
            Change password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
