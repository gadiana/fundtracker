import { useRef, useState, type ChangeEvent } from 'react';
import { FileText, ImageIcon, Paperclip, X } from 'lucide-react';
import { describeError, uploadFile } from '../lib/api';
import { formatBytes } from '../lib/format';
import type { AttachedFile } from '../lib/types';
import { Alert, Spinner } from './ui';

/**
 * Uploads photos/PDFs one by one as soon as they're chosen; the parent keeps the uploaded files
 * and sends their ids when the form is submitted.
 */
export function FileUploader({
  files,
  onChange,
  allowedMime,
  maxBytes,
  max = 10,
  label = 'Add photos or PDFs',
}: {
  files: AttachedFile[];
  onChange: (files: AttachedFile[]) => void;
  allowedMime: string[];
  maxBytes: number;
  max?: number;
  label?: string;
}) {
  const [busy, setBusy] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  // the latest list, so every finished upload is added to what is there now (never to an old copy)
  const current = useRef(files);
  current.current = files;

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = '';
    const problems: string[] = [];
    const room = max - current.current.length;
    if (picked.length > room) problems.push(`You can attach at most ${max} files; ${picked.length - room} were left out.`);
    const accepted: File[] = [];
    for (const file of picked.slice(0, room)) {
      if (file.size > maxBytes) problems.push(`${file.name} is larger than ${formatBytes(maxBytes)}, so it was not added.`);
      else accepted.push(file);
    }
    setErrors(problems);
    setBusy((n) => n + accepted.length);
    // images and PDFs alike, in the order they were picked
    for (const file of accepted) {
      try {
        const uploaded = await uploadFile<AttachedFile>('/uploads', file);
        current.current = [...current.current, uploaded];
        onChange(current.current);
      } catch (err) {
        setErrors((list) => [...list, `${file.name} was not added: ${describeError(err)}`]);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  function remove(id: string) {
    current.current = current.current.filter((x) => x.id !== id);
    onChange(current.current);
  }

  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              {f.mimeType === 'application/pdf' ? <FileText className="size-4 shrink-0 text-slate-400" aria-hidden /> : <ImageIcon className="size-4 shrink-0 text-slate-400" aria-hidden />}
              <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-brand-700 hover:underline">
                {f.name}
              </a>
              <span className="shrink-0 text-xs text-slate-500">{formatBytes(f.sizeBytes)}</span>
              <button type="button" onClick={() => remove(f.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label={`Remove ${f.name}`}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length < max && (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-4 text-sm font-medium text-slate-600 hover:border-brand-400 hover:bg-brand-50/40">
          {busy ? <Spinner label="Uploading" /> : <Paperclip className="size-4" aria-hidden />}
          {busy ? `Uploading ${busy} file${busy > 1 ? 's' : ''}…` : label}
          <input type="file" multiple accept={allowedMime.join(',')} className="sr-only" onChange={onPick} disabled={busy > 0} />
        </label>
      )}
      <p className="text-xs text-slate-500">
        Photos ({allowedMime.filter((m) => m.startsWith('image/')).map((m) => m.slice(6).toUpperCase()).join(', ') || 'none'}) and PDFs, up to {formatBytes(maxBytes)} each. You can pick several at once, or take a photo with your phone’s camera.
      </p>
      {errors.length > 0 && (
        <Alert tone="warning">
          <ul className="space-y-0.5">
            {errors.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
