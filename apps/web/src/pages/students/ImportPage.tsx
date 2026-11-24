import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileUp } from 'lucide-react';
import { CSV_COLUMNS, CSV_MAX_CHARS } from '@sft/shared';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Alert, Badge, Button, Card, Checkbox, Field, PageHeader, Textarea, cx } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ImportAnalysis, ImportRow } from '../../lib/types';
import { useStudentMeta } from './StudentsPage';

const STATUS: Record<ImportRow['status'], { label: string; tone: 'green' | 'amber' | 'red' }> = {
  ok: { label: 'Ready', tone: 'green' },
  similar: { label: 'Similar name', tone: 'amber' },
  exact: { label: 'Same name', tone: 'red' },
  error: { label: 'Error', tone: 'red' },
};

function downloadTemplate() {
  const header = CSV_COLUMNS.map((c) => c.header).join(',');
  const rows = ['2026-0001,Gadiana,Jhon Ezekiel,B.,,BSIT,1,A,jhon@example.com,09171234567', '2026-0002,Dela Cruz,Maria,Santos,,BSCS,2,B,,'];
  const blob = new Blob([[header, ...rows].join('\r\n') + '\r\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'students-template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ImportPage() {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const meta = useStudentMeta();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<'all' | 'problems'>('all');
  const [acknowledgeSimilar, setAcknowledgeSimilar] = useState(false);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: { line: number; status: string; messages: string[]; studentNumber: string }[] } | null>(null);
  const canOverride = meta.data?.canOverrideDuplicates ?? false;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > CSV_MAX_CHARS) {
      setError('That file is too large. Split it into files of about 900 KB or fewer.');
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    await preview(text);
  }

  async function preview(text = csv) {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setAnalysis(await api<ImportAnalysis>('/students/import/preview', { method: 'POST', body: { csv: text } }));
      setAcknowledgeSimilar(false);
      setReason('');
    } catch (err) {
      setAnalysis(null);
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const counts = analysis?.counts;
  const exactAllowed = canOverride && reason.trim().length >= 5;
  const toImport = counts ? counts.ok + (acknowledgeSimilar ? counts.similar : 0) + (exactAllowed ? counts.exact : 0) : 0;
  const rows = analysis?.rows.filter((r) => show === 'all' || r.status !== 'ok') ?? [];

  async function runImport() {
    try {
      const res = await api<NonNullable<typeof result>>('/students/import', {
        method: 'POST',
        body: { csv, acknowledgeSimilar: acknowledgeSimilar || undefined, duplicateOverrideReason: exactAllowed ? reason.trim() : undefined },
      });
      setResult(res);
      setAnalysis(null);
      setCsv('');
      await queryClient.invalidateQueries({ queryKey: ['students', ay?.id] });
    } catch (err) {
      throw new Error(describeError(err));
    }
  }

  return (
    <>
      <Link to="/students" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Students
      </Link>
      <PageHeader title="Import students from CSV" description="Nothing is saved until you confirm the preview." />

      {result && (
        <Alert tone="success" className="mb-4" title={`${result.imported} student(s) imported.`}>
          {result.skipped.length > 0 && (
            <>
              <p>{result.skipped.length} row(s) were not imported:</p>
              <ul className="mt-1 list-disc pl-5">
                {result.skipped.slice(0, 20).map((s) => (
                  <li key={s.line}>
                    Row {s.line} ({s.studentNumber || 'no number'}): {s.messages.join(' ') || STATUS[s.status as ImportRow['status']].label}
                  </li>
                ))}
              </ul>
            </>
          )}
          <Link to="/students" className="mt-2 inline-block font-medium underline">
            Go to the student list
          </Link>
        </Alert>
      )}

      <Card className="mb-4 space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
            <FileUp className="size-4" aria-hidden /> Choose CSV file
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
          </label>
          <Button variant="secondary" onClick={downloadTemplate}>
            <Download className="size-4" aria-hidden /> Download template
          </Button>
          {fileName && <span className="text-sm text-slate-600">{fileName}</span>}
        </div>
        <p className="text-sm text-slate-500">
          Columns: {CSV_COLUMNS.map((c) => (c.required ? c.header : `${c.header} (optional)`)).join(', ')}. Program and section must match the codes in
          Settings (e.g. BSIT, A). In Excel use “Save as → CSV UTF-8”.
        </p>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Or paste the CSV text</summary>
          <div className="mt-2 space-y-2">
            <Textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono text-xs" aria-label="CSV text" />
            <Button variant="secondary" onClick={() => preview()} disabled={!csv.trim()} loading={busy}>
              Preview
            </Button>
          </div>
        </details>
        {error && <Alert>{error}</Alert>}
      </Card>

      {analysis && counts && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{counts.total} rows:</span>
            <Badge tone="green">{counts.ok} ready</Badge>
            {counts.similar > 0 && <Badge tone="amber">{counts.similar} similar name</Badge>}
            {counts.exact > 0 && <Badge tone="red">{counts.exact} same name</Badge>}
            {counts.error > 0 && <Badge tone="red">{counts.error} with errors</Badge>}
            <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-1">
              {(['all', 'problems'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setShow(v)}
                  className={cx('rounded-md px-2.5 py-1 text-xs font-medium', show === v ? 'bg-white shadow-sm' : 'text-slate-600')}
                >
                  {v === 'all' ? 'All rows' : 'Only problems'}
                </button>
              ))}
            </div>
          </div>

          <Card className="mb-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Student no.</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.line} className="align-top">
                    <td className="px-3 py-2 text-slate-500">{r.line}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.values.studentNumber}</td>
                    <td className="px-3 py-2">
                      {[r.values.firstName, r.values.middleName, r.values.lastName, r.values.suffix].filter(Boolean).join(' ')}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {r.values.program} {r.values.yearLevel}
                      {r.values.section ? `-${r.values.section}` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.messages.join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="space-y-3 p-5">
            {counts.error > 0 && <p className="text-sm text-slate-600">Rows with errors are skipped. Fix them in the file and import them later.</p>}
            {counts.similar > 0 && (
              <Checkbox
                checked={acknowledgeSimilar}
                onChange={setAcknowledgeSimilar}
                label={`Also import the ${counts.similar} row(s) with a similar name`}
                description="Only if you checked that they are different people."
              />
            )}
            {counts.exact > 0 &&
              (canOverride ? (
                <Field
                  label={`Reason to also import the ${counts.exact} row(s) with exactly the same name as another student`}
                  htmlFor="import-reason"
                  optional
                  hint="Leave empty to skip them. The reason is recorded with each student."
                >
                  <Textarea id="import-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              ) : (
                <p className="text-sm text-slate-600">
                  {counts.exact} row(s) have exactly the same name as another student and will be skipped. Only the adviser can import them.
                </p>
              ))}
            <div className="flex justify-end">
              <Button onClick={() => setConfirming(true)} disabled={toImport === 0 || ay?.status === 'closed'}>
                Import {toImport} student{toImport === 1 ? '' : 's'}
              </Button>
            </div>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Import ${toImport} student${toImport === 1 ? '' : 's'}?`}
        description="They are added as active students, each with a QR code."
        confirmLabel="Import"
        onConfirm={runImport}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
