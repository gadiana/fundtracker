import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera } from 'lucide-react';
import { DEFAULT_PASSWORD_POLICY, passwordIssues } from '@sft/shared';
import { usePublicInfo } from '../components/AuthLayout';
import { Avatar, squareAvatar } from '../components/Avatar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { TwoFactorCard } from '../components/TwoFactorCard';
import { useToast } from '../components/Toast';
import { Button, Card, Field, Input, PageHeader, cx } from '../components/ui';
import { api, describeError, uploadFile } from '../lib/api';
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
      <PageHeader title="Profile" />

      <Card className="mb-6 flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <Avatar name={user.name} url={user.avatarUrl} size="xl" className="ring-4 ring-surface" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-semibold tracking-tight">{user.name}</p>
          <p className="truncate text-sm text-slate-500">{user.email}</p>
          {ay?.membership?.status === 'active' && <p className="mt-1 text-sm font-medium text-brand-700">{ay.membership.position}</p>}
        </div>
        <PictureButtons hasPicture={Boolean(user.avatarUrl)} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Your details</h2>
          <p className="mb-4 text-sm text-slate-500">Past records keep the name used at the time.</p>
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

/** Upload (cropped to a square in the browser) or remove the profile picture. */
function PictureButtons({ hasPicture }: { hasPicture: boolean }) {
  const { setMe } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      setMe(await uploadFile<Me>('/me/avatar', await squareAvatar(file)));
      toast('Picture updated.');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex gap-2">
        <label className={cx('inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700', busy && 'pointer-events-none opacity-60')}>
          <Camera className="size-4" aria-hidden />
          {busy ? 'Uploading…' : hasPicture ? 'Change picture' : 'Add picture'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={upload} disabled={busy} />
        </label>
        {hasPicture && (
          <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
            Remove
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <ConfirmDialog
        open={removing}
        title="Remove your picture?"
        confirmLabel="Remove"
        tone="danger"
        onConfirm={async () => {
          try {
            setMe(await api<Me>('/me/avatar', { method: 'DELETE' }));
          } catch (err) {
            throw new Error(describeError(err));
          }
        }}
        onClose={() => setRemoving(false)}
      />
    </div>
  );
}
