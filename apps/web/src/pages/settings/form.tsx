import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Button, Card } from '../../components/ui';
import { api, ApiError, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Settings } from '../../lib/types';

/** True when the selected AY is closed: every settings control is disabled. */
export const ReadOnlyContext = createContext(false);
export const useReadOnly = () => useContext(ReadOnlyContext);

export const FIELD_LABELS: Partial<Record<keyof Settings, string>> = {
  orgName: 'Organization name',
  receiptQrMessage: 'QR message',
  passwordMinLength: 'Minimum length',
  sessionTimeoutMinutes: 'Session timeout',
  uploadAllowedMime: 'Allowed file types',
  uploadMaxBytes: 'Maximum file size',
  currency: 'Currency',
  timezone: 'Time zone',
  privacyConsentText: 'Privacy notice',
  emailSenderAddress: 'Sender email',
  emailReplyTo: 'Reply-to email',
  yearLevelCount: 'Number of year levels',
};

export interface FormApi<K extends keyof Settings> {
  values: Pick<Settings, K>;
  set: <F extends K>(key: F, value: Settings[F]) => void;
  errors: Partial<Record<K, string>>;
  readOnly: boolean;
}

function pick<K extends keyof Settings>(settings: Settings, keys: readonly K[]) {
  return Object.fromEntries(keys.map((k) => [k, settings[k]])) as Pick<Settings, K>;
}

/**
 * One card of settings with its own Save button (confirmed in a dialog).
 * `keys` must be a module-level constant so the form isn't reset on every render.
 */
export function SettingsCard<K extends keyof Settings>({
  title,
  description,
  settings,
  keys,
  children,
  refreshMeOnSave,
}: {
  title: string;
  description?: ReactNode;
  settings: Settings;
  keys: readonly K[];
  children: (form: FormApi<K>) => ReactNode;
  refreshMeOnSave?: boolean;
}) {
  const { ay, refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const readOnly = useReadOnly();
  const initial = useMemo(() => pick(settings, keys), [settings, keys]);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const [confirming, setConfirming] = useState(false);

  useEffect(() => setValues(initial), [initial]);

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  async function save() {
    try {
      const updated = await api<Settings>('/settings', { method: 'PATCH', body: values });
      queryClient.setQueryData(['settings', ay?.id], updated);
      setErrors({});
      if (refreshMeOnSave) await refreshMe();
      toast(`${title} saved.`);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors as Partial<Record<K, string>>);
      throw new Error(describeError(err, FIELD_LABELS));
    }
  }

  const form: FormApi<K> = {
    values,
    errors,
    readOnly,
    set: (key, value) => setValues((prev) => ({ ...prev, [key]: value })),
  };

  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-4 space-y-4">{children(form)}</div>
      {!readOnly && (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          {dirty && (
            <Button variant="ghost" onClick={() => setValues(initial)}>
              Discard changes
            </Button>
          )}
          <Button onClick={() => setConfirming(true)} disabled={!dirty}>
            Save
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Save ${title.toLowerCase()}?`}
        description="The change applies to this academic year only and is recorded in the audit log."
        confirmLabel="Save"
        onConfirm={save}
        onClose={() => setConfirming(false)}
      />
    </Card>
  );
}
