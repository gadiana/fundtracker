import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, ImageIcon, Printer } from 'lucide-react';
import { Alert, Button, Spinner } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fileImages, type PageImage } from '../../lib/pdfPages';
import { printImages } from '../../lib/print';
import type { AttachedFile, FundRequestView } from '../../lib/types';

interface Page extends PageImage {
  file: AttachedFile;
}

/**
 * Opens in its own tab. Every photo and every PDF page is shown one per page, fitted to the
 * page, in the order they were attached; "Print" prints all of them the same way.
 */
export function AttachmentViewerPage() {
  const { id, set } = useParams();
  const { ay } = useAuth();
  const view = useQuery({ queryKey: ['fund-requests', ay?.id, 'detail', id], queryFn: () => api<FundRequestView>(`/fund-requests/${id}`) });
  const r = view.data?.request;
  // `set` is "request", a whole liquidation, or one receipt inside a liquidation
  const liquidation = set === 'request' ? null : r?.liquidations.find((l) => l.id === set || l.receipts.some((e) => e.id === set));
  const receipt = liquidation?.receipts.find((e) => e.id === set);
  const files = r ? (set === 'request' ? r.attachments : (receipt?.attachments ?? liquidation?.attachments ?? [])) : [];
  const fileKey = files.map((f) => f.id).join(',');

  const pages = useQuery({
    queryKey: ['attachment-pages', fileKey],
    enabled: files.length > 0,
    staleTime: Infinity,
    queryFn: async (): Promise<Page[]> =>
      (await Promise.all(files.map(async (f) => (await fileImages(f)).map((p): Page => ({ ...p, file: f }))))).flat(),
  });
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (r) document.title = `${r.requestNo} attachments`;
  }, [r]);

  if (view.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  if (view.error || !r) {
    return (
      <div className="p-6">
        <Alert>{describeError(view.error)}</Alert>
      </div>
    );
  }
  const title =
    set === 'request'
      ? `${r.requestNo} – approved request document`
      : receipt
        ? `${r.requestNo} – receipt ${receipt.ref}: ${receipt.usedFor}`
        : `${r.requestNo} – receipts (version ${liquidation?.version ?? '?'})`;
  const list = pages.data ?? [];

  return (
    <div className="min-h-dvh bg-slate-800">
      <header className="sticky top-0 z-10 bg-slate-900 px-4 py-2 text-white">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-medium">{title}</p>
          <Button
            size="sm"
            variant="secondary"
            disabled={!list.length}
            loading={printing}
            onClick={() => {
              setPrinting(true);
              printImages(
                list.map((p) => p.src),
                { title },
              );
              setTimeout(() => setPrinting(false), 1000);
            }}
          >
            <Printer className="size-4" aria-hidden /> Print all
          </Button>
        </div>
        {files.length > 0 && (
          <ol className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
            {files.map((f, i) => {
              const count = list.filter((p) => p.file.id === f.id).length;
              return (
                <li key={f.id} className="flex items-center gap-1">
                  {f.mimeType === 'application/pdf' ? <FileText className="size-3.5" aria-hidden /> : <ImageIcon className="size-3.5" aria-hidden />}
                  {i + 1}. {f.name}
                  {f.mimeType === 'application/pdf' && count > 0 && ` (${count} page${count > 1 ? 's' : ''})`}
                </li>
              );
            })}
          </ol>
        )}
      </header>
      {files.length === 0 && <p className="p-6 text-center text-sm text-slate-300">No files.</p>}
      {pages.isLoading && (
        <div className="grid h-64 place-items-center text-slate-300">
          <Spinner label="Opening files" />
        </div>
      )}
      {pages.error && (
        <div className="p-6">
          <Alert>{describeError(pages.error)}</Alert>
        </div>
      )}
      {list.map((p, i) => (
        <section key={`${p.file.id}-${p.pdfPage ?? 0}`} className="flex h-[calc(100dvh-4rem)] items-center justify-center p-2">
          <img
            src={p.src}
            alt={`${p.file.name}${p.pdfPage ? `, page ${p.pdfPage}` : ''} (${i + 1} of ${list.length})`}
            className="max-h-full max-w-full bg-surface object-contain"
          />
        </section>
      ))}
    </div>
  );
}
