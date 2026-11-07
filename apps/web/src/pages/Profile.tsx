import { useState, type ChangeEvent, type FormEvent } from 'react';
import { DEFAULT_PASSWORD_POLICY, passwordIssues } from '@sft/shared';
import { usePublicInfo } from '../components/AuthLayout';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { TwoFactorCard } from '../components/TwoFactorCard';
import { useToast } from '../components/Toast';
import { Button, Card, Field, Input, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Me } from '../lib/types';

export function ProfilePage() {
  const { me, setMe, ay } = useAuth();
  const toast = useToast();
  const { data: info } = usePublicInfo();
  const policy = info?.passwordPolicy ?? DEFAULT_PASSWORD_POLICY;
  const user = me!.user;

  const [profile, setProfile] = useState({
    firstName: user.firstName,
    middleName: user.middleName ?? '',
    lastName: user.lastName,
    suffix: user.suffix ?? '',
    contactNo: user.contactNo ?? '',
  });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [confirming, setConfirming] = useState<'profile' | 'password' | null>(null);

  const setField = (key: keyof typeof profile) => (e: ChangeEvent<HTMLInputElement>) => setProfile((p) => ({ ...p, [key]: e.target.value }));
  const setPw = (key: keyof typeof passwords) => (e: ChangeEvent<HTMLInputElement>) => setPasswords((p) => ({ ...p, [key]: e.target.value }));

  const profileChanged =
    profile.firstName !== user.firstName ||
    profile.middleName !== (user.middleName ?? '') ||
    profile.lastName !== user.lastName ||
    profile.suffix !== (user.suffix ?? '') ||
    profile.contactNo !== (user.contactNo ?? '');
  const passwordValid =
    passwords.currentPassword.length > 0 &&
    passwordIssues(passwords.newPassword, policy).length === 0 &&
    passwords.newPassword === passwords.confirm;

  async function saveProfile() {
    setMe(await api<Me>('/me/profile', { method: 'PATCH', body: profile }));
    toast('Profile saved.');
  }

  async function changePassword() {
    await api('/me/password', { method: 'POST', body: { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword } });
    setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
    toast('Password changed. Other devices were signed out.');
  }

  const onSubmit = (kind: 'profile' | 'password') => (e: FormEvent) => {
    e.preventDefault();
    setConfirming(kind);
  };

  return (
    <>
      <PageHeader title="Profile" description={`${user.email} · ${ay?.membership?.status === 'active' ? ay.membership.position : 'No position in this AY'}`} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Your details</h2>
          <p className="mb-4 text-sm text-slate-500">Past records keep the name you had when they were made.</p>
          <form onSubmit={onSubmit('profile')} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" htmlFor="p-first">
                <Input id="p-first" value={profile.firstName} onChange={setField('firstName')} />
              </Field>
              <Field label="Middle name" htmlFor="p-middle" optional>
                <Input id="p-middle" value={profile.middleName} onChange={setField('middleName')} />
              </Field>
              <Field label="Last name" htmlFor="p-last">
                <Input id="p-last" value={profile.lastName} onChange={setField('lastName')} />
              </Field>
              <Field label="Suffix" htmlFor="p-suffix" optional>
                <Input id="p-suffix" value={profile.suffix} onChange={setField('suffix')} />
              </Field>
              <Field label="Contact number" htmlFor="p-contact" optional className="sm:col-span-2">
                <Input id="p-contact" type="tel" value={profile.contactNo} onChange={setField('contactNo')} />
              </Field>
            </div>
            <Button type="submit" disabled={!profileChanged || !profile.firstName.trim() || !profile.lastName.trim()}>
              Save changes
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Change password</h2>
          <p className="mb-4 text-sm text-slate-500">You'll stay signed in here; other devices are signed out.</p>
          <form onSubmit={onSubmit('password')} className="space-y-4">
            <Field label="Current password" htmlFor="pw-current">
              <Input id="pw-current" type="password" autoComplete="current-password" value={passwords.currentPassword} onChange={setPw('currentPassword')} />
            </Field>
            <Field label="New password" htmlFor="pw-new">
              <Input id="pw-new" type="password" autoComplete="new-password" value={passwords.newPassword} onChange={setPw('newPassword')} />
            </Field>
            <Field
              label="Confirm new password"
              htmlFor="pw-confirm"
              error={passwords.confirm && passwords.confirm !== passwords.newPassword ? 'Passwords do not match' : undefined}
            >
              <Input id="pw-confirm" type="password" autoComplete="new-password" value={passwords.confirm} onChange={setPw('confirm')} />
            </Field>
            <PasswordChecklist password={passwords.newPassword} policy={policy} />
            <Button type="submit" disabled={!passwordValid}>
              Change password
            </Button>
          </form>
        </Card>

        <TwoFactorCard />
      </div>

      <ConfirmDialog
        open={confirming === 'profile'}
        title="Save your details?"
        confirmLabel="Save"
        onConfirm={saveProfile}
        onClose={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'password'}
        title="Change your password?"
        description="Every other device signed in to your account will be signed out."
        confirmLabel="Change password"
        onConfirm={changePassword}
        onClose={() => setConfirming(null)}
      />
    </>
  );
}
