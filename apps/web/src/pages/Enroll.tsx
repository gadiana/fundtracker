import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, LinkIcon } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EMPTY_STUDENT, StudentFields, studentFormReady, studentPayload, type StudentFormValues } from '../components/StudentForm';
import { Alert, Button, EmptyState, Spinner } from '../components/ui';
import { api, ApiError, describeError } from '../lib/api';

interface EnrollInfo {
  academicYear: string;
  org: { name: string; school: string; college: string; logoUrl: string | null };
  label: string | null;
  yearLevelCount: number;
  programs: { id: string; code: string; name: string }[];
  sections: { id: string; name: string }[];
  privacyConsentText: string;
}

const LABELS = { studentNumber: 'Student number', firstName: 'First name', lastName: 'Last name', programId: 'Program', email: 'Email', consent: 'Consent' };

/** Public: a student fills in their own enrollment from the QR/link. No login. */
export function EnrollPage() {
  const { token } = useParams();
  const info = useQuery({
    queryKey: ['enroll', token],
    queryFn: () => api<EnrollInfo>(`/public/enroll/${token}`),
    retry: false,
  });
  const [values, setValues] = useState<StudentFormValues>(EMPTY_STUDENT);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<{ name: string; studentNumber: string } | null>(null);

  async function submit() {
    try {
      setDone(await api<{ name: string; studentNumber: string }>(`/public/enroll/${token}`, { method: 'POST', body: { ...studentPayload(values), consent } }));
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      throw new Error(describeError(err, LABELS));
    }
  }

  const org = info.data?.org;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-xl">
        {info.isLoading ? (
          <div className="py-20 text-center">
            <Spinner />
          </div>
        ) : info.error ? (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <EmptyState icon={LinkIcon} title="This enrollment link can’t be used" body={describeError(info.error)} />
          </div>
        ) : info.data ? (
          <>
            <div className="mb-6 flex items-center gap-3">
              {org?.logoUrl ? (
                <img src={org.logoUrl} alt="" className="size-12 shrink-0 rounded-xl object-contain" />
              ) : (
                <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">{(org?.name || 'E').slice(0, 1)}</div>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold">{org?.name || 'Student enrollment'}</p>
                <p className="truncate text-xs text-slate-500">
                  {[org?.college, org?.school].filter(Boolean).join(' · ')} · AY {info.data.academicYear}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              {done ? (
                <div className="space-y-3 py-4 text-center">
                  <CheckCircle2 className="mx-auto size-12 text-emerald-600" aria-hidden />
                  <h1 className="text-xl font-semibold">Enrollment submitted</h1>
                  <p className="text-sm text-slate-600">
                    Thank you, {done.name} ({done.studentNumber}). An officer will review your details. You don’t need to do anything else.
                  </p>
                </div>
              ) : (
                <>
                  <h1 className="text-xl font-semibold">Enroll for AY {info.data.academicYear}</h1>
                  <p className="mt-1 text-sm text-slate-500">
                    {info.data.label ? `${info.data.label}. ` : ''}Enter your details exactly as they appear in your school records.
                  </p>
                  <div className="mt-5 space-y-5">
                    <StudentFields values={values} onChange={setValues} meta={info.data} errors={errors} idPrefix="enroll" />
                    <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <legend className="px-1 text-sm font-medium text-slate-700">Data privacy notice</legend>
                      <p className="max-h-40 overflow-y-auto whitespace-pre-line text-xs leading-relaxed text-slate-600">
                        {info.data.privacyConsentText || 'Your personal information is processed in accordance with the Data Privacy Act of 2012 (RA 10173).'}
                      </p>
                      <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
                        I have read and agree to the data privacy notice.
                      </label>
                    </fieldset>
                    {errors.consent && <Alert>{errors.consent}</Alert>}
                    <Button className="w-full" size="lg" onClick={() => setConfirming(true)} disabled={!studentFormReady(values) || !consent}>
                      Submit enrollment
                    </Button>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Submit your enrollment?"
        description={`${values.firstName} ${values.lastName}, student number ${values.studentNumber.toUpperCase()}. Please double-check your details.`}
        confirmLabel="Submit"
        onConfirm={submit}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
