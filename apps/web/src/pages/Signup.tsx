import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { MailCheck } from 'lucide-react';
import { passwordIssues, DEFAULT_PASSWORD_POLICY } from '@sft/shared';
import { AuthLayout, usePublicInfo } from '../components/AuthLayout';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { Alert, Button, Field, Input } from '../components/ui';
import { api, ApiError } from '../lib/api';

interface SignupResult {
  academicYear: string;
  role: 'adviser' | null;
  status: 'active' | 'pending';
  email: string;
}

const EMPTY = { firstName: '', middleName: '', lastName: '', suffix: '', email: '', contactNo: '', password: '', confirm: '' };

export function SignupPage() {
  const { data: info } = usePublicInfo();
  const policy = info?.passwordPolicy ?? DEFAULT_PASSWORD_POLICY;
  const [form, setForm] = useState(EMPTY);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SignupResult | null>(null);

  const set = (key: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const passwordOk = passwordIssues(form.password, policy).length === 0;
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const canSubmit = form.firstName && form.lastName && form.email && passwordOk && form.confirm === form.password && consent;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const { confirm: _confirm, ...body } = form;
      setResult(await api<SignupResult>('/auth/signup', { method: 'POST', body: { ...body, consent } }));
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        setError(err.code === 'WEAK_PASSWORD' ? `${err.message} ${(err.details?.issues ?? []).join(', ')}` : err.message);
      } else setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <AuthLayout title="Check your email">
        <div className="space-y-4 text-sm text-slate-600">
          <div className="grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <MailCheck className="size-6" aria-hidden />
          </div>
          <p>
            We sent a verification link to <span className="font-medium text-slate-900">{result.email}</span>. Open it to verify your
            email.
          </p>
          <Alert tone="info" title="Waiting for adviser approval">
            The advisers have been notified. Once one of them approves you and assigns your position, you'll get an email and can start
            using the system.
          </Alert>
          <Link to="/login" className="block text-center font-medium text-brand-700 hover:underline">
            Back to log in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create an account" wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {info && !info.initialized && <Alert tone="warning">The system isn't set up yet. Ask the administrator to run the database seed.</Alert>}
        {error && <Alert>{error}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" error={fieldErrors.firstName}>
            <Input id="firstName" autoComplete="given-name" value={form.firstName} onChange={set('firstName')} />
          </Field>
          <Field label="Middle name" htmlFor="middleName" optional error={fieldErrors.middleName}>
            <Input id="middleName" autoComplete="additional-name" value={form.middleName} onChange={set('middleName')} />
          </Field>
          <Field label="Last name" htmlFor="lastName" error={fieldErrors.lastName}>
            <Input id="lastName" autoComplete="family-name" value={form.lastName} onChange={set('lastName')} />
          </Field>
          <Field label="Suffix" htmlFor="suffix" optional error={fieldErrors.suffix}>
            <Input id="suffix" autoComplete="honorific-suffix" placeholder="Jr., III" value={form.suffix} onChange={set('suffix')} />
          </Field>
          <Field label="Email" htmlFor="email" error={fieldErrors.email}>
            <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Contact number" htmlFor="contactNo" optional error={fieldErrors.contactNo}>
            <Input id="contactNo" type="tel" autoComplete="tel" placeholder="09XX XXX XXXX" value={form.contactNo} onChange={set('contactNo')} />
          </Field>
          <Field label="Password" htmlFor="password" error={fieldErrors.password}>
            <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={mismatch ? 'Passwords do not match' : undefined}>
            <Input id="confirm" type="password" autoComplete="new-password" invalid={mismatch} value={form.confirm} onChange={set('confirm')} />
          </Field>
        </div>
        <PasswordChecklist password={form.password} policy={policy} />

        <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">Data privacy notice</legend>
          <p className="max-h-36 overflow-y-auto whitespace-pre-line text-xs leading-relaxed text-slate-600">
            {info?.privacyConsentText || 'Your personal information is processed in accordance with the Data Privacy Act of 2012 (RA 10173).'}
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            I have read and agree to the data privacy notice.
          </label>
          {fieldErrors.consent && <p className="mt-1 text-sm text-red-600">{fieldErrors.consent}</p>}
        </fieldset>

        <Button type="submit" className="w-full" loading={busy} disabled={!canSubmit}>
          Create account
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
