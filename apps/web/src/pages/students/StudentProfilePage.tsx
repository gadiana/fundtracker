import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, History, Pencil, Printer, QrCode, UserCheck, UserX } from 'lucide-react';
import { ChargesCard, ClearanceBadge } from '../../components/ChargesCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { StudentPaymentsCard, StudentQrPanel } from '../../components/StudentPaymentsCard';
import { StudentEditorModal } from '../../components/StudentEditorModal';
import {
  DuplicateReview,
  duplicateChoiceReady,
  duplicateFromError,
  type DuplicateChoice,
  type DuplicateState,
} from '../../components/StudentForm';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Field, Select, Spinner } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, humanize, yearLevelLabel } from '../../lib/format';
import type { StudentProfile } from '../../lib/types';
import { cys, StudentBadges, useStudentMeta } from './StudentsPage';

const SOURCE_LABELS = { manual: 'Added by staff', csv_import: 'CSV import', self_enroll: 'Self-enrollment (QR)', promoted: 'Promoted from the previous academic year' };

type Action = 'approve' | 'reject' | 'deactivate' | 'reactivate' | 'confirm';

export function StudentProfilePage() {
  const { id } = useParams();
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const meta = useStudentMeta();
  const key = ['students', ay?.id, 'profile', id];
  const profile = useQuery({ queryKey: key, queryFn: () => api<StudentProfile>(`/students/${id}`) });
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateState | null>(null);
  const [choice, setChoice] = useState<DuplicateChoice>({ acknowledgeSimilar: false, reason: '' });
  const [placement, setPlacement] = useState({ programId: '', yearLevel: 1, sectionId: '' });
  const readOnly = ay?.status === 'closed';

  if (profile.isLoading) {
    return (
      <div className="py-10 text-center">
        <Spinner />
      </div>
    );
  }
  if (profile.error || !profile.data) return <Alert>{describeError(profile.error)}</Alert>;
  const { student: s, duplicates, qr, promotedFrom, history } = profile.data;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['students', ay?.id] });

  const openConfirm = () => {
    setPlacement({ programId: s.program.id, yearLevel: s.yearLevel, sectionId: s.section?.id ?? '' });
    setAction('confirm');
  };

  async function run(comment: string) {
    const base = `/students/${s.id}`;
    try {
      if (action === 'approve') {
        await api(`${base}/approve`, {
          method: 'POST',
          body: { acknowledgeSimilar: choice.acknowledgeSimilar || undefined, duplicateOverrideReason: choice.reason.trim() || undefined },
        });
      }
      if (action === 'reject') await api(`${base}/reject`, { method: 'POST', body: { comment } });
      if (action === 'deactivate') await api(`${base}/deactivate`, { method: 'POST', body: { reason: comment } });
      if (action === 'reactivate') await api(`${base}/reactivate`, { method: 'POST' });
      if (action === 'confirm') {
        await api(`${base}/confirm-profile`, { method: 'POST', body: { ...placement, sectionId: placement.sectionId || null } });
      }
    } catch (err) {
      const dup = duplicateFromError(err);
      if (dup) {
        setDuplicate(dup);
        throw new Error('Possible duplicate. Review it on this page, then approve again.');
      }
      throw new Error(describeError(err));
    }
    setDuplicate(null);
    await refresh();
    toast({ approve: 'Enrollment approved.', reject: 'Enrollment rejected.', deactivate: 'Student deactivated.', reactivate: 'Student reactivated.', confirm: 'Course, year and section confirmed.' }[action!]);
  }

  const dialogs: Record<Action, { title: string; description: string; confirmLabel: string; tone?: 'danger'; commentLabel?: string }> = {
    approve: {
      title: `Approve ${s.name}'s enrollment?`,
      description: 'They become an active student of this academic year and get their QR code.',
      confirmLabel: 'Approve',
    },
    reject: { title: `Reject ${s.name}'s enrollment?`, description: 'The record is kept as rejected.', confirmLabel: 'Reject', tone: 'danger', commentLabel: 'Reason' },
    deactivate: {
      title: `Deactivate ${s.name}?`,
      description: 'They no longer appear in active lists. Their payments and history stay. You can reactivate them later.',
      confirmLabel: 'Deactivate',
      tone: 'danger',
      commentLabel: 'Reason',
    },
    reactivate: { title: `Reactivate ${s.name}?`, description: 'They appear in active lists again.', confirmLabel: 'Reactivate' },
    confirm: {
      title: `Confirm ${s.name}'s course, year and section`,
      description: 'Check these against the student’s current enrollment. Collection is allowed once this is confirmed.',
      confirmLabel: 'Confirm',
    },
  };

  return (
    <>
      <Link to="/students" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Students
      </Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{s.name}</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{s.studentNumber}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StudentBadges s={s} />
            {s.status === 'active' && profile.data.account.charges.length > 0 && <ClearanceBadge cleared={profile.data.account.isCleared} />}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.status !== 'pending' && s.status !== 'rejected' && (
            <a
              href={`/print/report/student-statement?studentId=${s.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50"
            >
              <Printer className="size-4" aria-hidden /> Statement
            </a>
          )}
        {!readOnly && (
          <>
            {s.status === 'pending' && (
              <>
                <Button onClick={() => setAction('approve')} disabled={!duplicateChoiceReady(duplicate, choice)}>
                  <UserCheck className="size-4" aria-hidden /> Approve
                </Button>
                <Button variant="secondary" onClick={() => setAction('reject')}>
                  Reject
                </Button>
              </>
            )}
            {s.status === 'active' && !s.needsProfileConfirmation && (
              <Link to={`/collection?student=${s.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
                Record payment
              </Link>
            )}
            {s.status === 'active' && s.needsProfileConfirmation && (
              <Button onClick={openConfirm} disabled={!meta.data}>
                <CheckCircle2 className="size-4" aria-hidden /> Confirm course/year/section
              </Button>
            )}
            {s.status !== 'rejected' && (
              <Button variant="secondary" onClick={() => setEditing(true)} disabled={!meta.data}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
            )}
            {s.status === 'active' && (
              <Button variant="ghost" onClick={() => setAction('deactivate')}>
                <UserX className="size-4" aria-hidden /> Deactivate
              </Button>
            )}
            {s.status === 'inactive' && (
              <Button variant="secondary" onClick={() => setAction('reactivate')}>
                Reactivate
              </Button>
            )}
          </>
        )}
        </div>
      </div>

      {s.needsProfileConfirmation && s.status === 'active' && (
        <Alert tone="info" className="mb-4" title="Confirm before collecting">
          Copied from AY {promotedFrom?.academicYear} ({promotedFrom?.courseYearSection}) one year level up. No payment can be recorded until staff confirm
          the course, year and section.
        </Alert>
      )}
      {duplicate && (
        <div className="mb-4">
          <DuplicateReview state={duplicate} choice={choice} onChange={setChoice} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Details</h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Detail label="Course / year / section">
                {cys(s)} <span className="text-slate-400">({s.program.name}, {yearLevelLabel(s.yearLevel)})</span>
              </Detail>
              <Detail label="Email">{s.email ?? '—'}</Detail>
              <Detail label="Contact number">{s.contactNo ?? '—'}</Detail>
              <Detail label="How they were added">{SOURCE_LABELS[s.source]}</Detail>
              <Detail label="Approved">{s.approvedAt ? `${formatDateTime(s.approvedAt)} by ${s.approvedByName}` : '—'}</Detail>
              {s.profileConfirmedAt && <Detail label="Course/year confirmed">{`${formatDateTime(s.profileConfirmedAt)} by ${s.profileConfirmedByName}`}</Detail>}
              {s.consentGivenAt && <Detail label="Privacy consent">{formatDateTime(s.consentGivenAt)}</Detail>}
              {s.rejectedAt && <Detail label="Rejected">{`${formatDateTime(s.rejectedAt)} by ${s.rejectedByName}${s.rejectionComment ? `: ${s.rejectionComment}` : ''}`}</Detail>}
              {s.duplicateOverride && (
                <Detail label="Same-name override">{`${s.duplicateOverrideByName}: “${s.duplicateOverrideReason}”`}</Detail>
              )}
            </dl>
          </Card>

          {duplicates.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-1 font-semibold">Possible duplicates</h2>
              <p className="mb-3 text-sm text-slate-500">Same or similar names in this year.</p>
              <ul className="space-y-2 text-sm">
                {duplicates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <Link to={`/students/${d.id}`} className="font-medium text-brand-700 hover:underline">
                      {d.name}
                    </Link>
                    <span className="font-mono text-xs text-slate-500">{d.studentNumber}</span>
                    <span className="text-slate-500">
                      {d.program} {d.yearLevel}
                      {d.section ? `-${d.section}` : ''}
                    </span>
                    <Badge tone={d.strength === 'exact' ? 'red' : 'amber'}>{d.strength === 'exact' ? 'same name' : 'similar name'}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <ChargesCard account={profile.data.account} needsConfirmation={s.needsProfileConfirmation} />
          <StudentPaymentsCard studentId={s.id} />

          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <History className="size-4" aria-hidden /> History
            </h2>
            {history.length === 0 ? (
              <p className="text-sm text-slate-500">No changes recorded.</p>
            ) : (
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <span className="font-medium">{humanize(h.action)}</span> by {h.actorName}
                    {h.actorDesignation && <span className="text-slate-500"> ({h.actorDesignation})</span>}
                    <span className="block text-xs text-slate-400">{formatDateTime(h.createdAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <Card className="h-fit p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <QrCode className="size-4" aria-hidden /> Status QR
          </h2>
          {qr ? (
            <StudentQrPanel studentId={s.id} name={s.name} qr={qr} canRotate={!readOnly && s.status === 'active'} />
          ) : (
            <p className="text-sm text-slate-500">The QR code is created when the enrollment is approved.</p>
          )}
        </Card>
      </div>

      {editing && meta.data && (
        <StudentEditorModal
          meta={meta.data}
          student={s}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await refresh();
            toast('Student updated.');
          }}
        />
      )}
      {action && (
        <ConfirmDialog
          open
          title={dialogs[action].title}
          description={dialogs[action].description}
          confirmLabel={dialogs[action].confirmLabel}
          tone={dialogs[action].tone}
          commentLabel={dialogs[action].commentLabel}
          confirmDisabled={action === 'confirm' && !placement.programId}
          onConfirm={run}
          onClose={() => setAction(null)}
        >
          {action === 'confirm' && meta.data && (
            <div className="grid gap-3">
              <Field label="Program" htmlFor="confirm-program">
                <Select id="confirm-program" value={placement.programId} onChange={(e) => setPlacement({ ...placement, programId: e.target.value })}>
                  {meta.data.programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} – {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Year" htmlFor="confirm-year">
                  <Select id="confirm-year" value={placement.yearLevel} onChange={(e) => setPlacement({ ...placement, yearLevel: Number(e.target.value) })}>
                    {Array.from({ length: meta.data.yearLevelCount }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {yearLevelLabel(n)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Section" htmlFor="confirm-section">
                  <Select id="confirm-section" value={placement.sectionId} onChange={(e) => setPlacement({ ...placement, sectionId: e.target.value })}>
                    <option value="">None</option>
                    {meta.data.sections.map((sec) => (
                      <option key={sec.id} value={sec.id}>
                        {sec.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}
