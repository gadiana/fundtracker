import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Download, ExternalLink, Link2Off, QrCode } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { QrImage, useQrDataUrl } from '../../components/QrImage';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import type { EnrollmentLinkRow } from '../../lib/types';

const fullUrl = (path: string) => `${window.location.origin}${path}`;

export function EnrollmentLinksPage() {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ['enrollment-links', ay?.id];
  const list = useQuery({ queryKey: key, queryFn: () => api<{ items: EnrollmentLinkRow[] }>('/enrollment-links') });
  const [draft, setDraft] = useState({ label: '', expiresInDays: '7', maxUses: '' });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<EnrollmentLinkRow | null>(null);
  const readOnly = ay?.status === 'closed';
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  async function create() {
    try {
      await api('/enrollment-links', {
        method: 'POST',
        body: {
          label: draft.label || undefined,
          expiresInDays: draft.expiresInDays ? Number(draft.expiresInDays) : undefined,
          maxUses: draft.maxUses ? Number(draft.maxUses) : undefined,
        },
      });
    } catch (err) {
      throw new Error(describeError(err));
    }
    setDraft({ label: '', expiresInDays: '7', maxUses: '' });
    await refresh();
    toast('Enrollment link created.');
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
  };

  return (
    <>
      <Link to="/students" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> Students
      </Link>
      <PageHeader
        title="Self-enrollment QR"
        description="Students enroll themselves; you approve each one."
      />

      {!readOnly && (
        <Card className="mb-6 p-4">
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_10rem_9rem_auto] sm:items-end">
            <Field label="Label" htmlFor="link-label" optional>
              <Input id="link-label" placeholder="e.g. BSIT 1-A orientation" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            </Field>
            <Field label="Expires" htmlFor="link-expiry">
              <Select id="link-expiry" value={draft.expiresInDays} onChange={(e) => setDraft({ ...draft, expiresInDays: e.target.value })}>
                <option value="1">After 1 day</option>
                <option value="7">After 7 days</option>
                <option value="30">After 30 days</option>
                <option value="">Never</option>
              </Select>
            </Field>
            <Field label="Max uses" htmlFor="link-max" optional>
              <Input id="link-max" inputMode="numeric" value={draft.maxUses} onChange={(e) => setDraft({ ...draft, maxUses: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </Field>
            <Button type="submit">
              <QrCode className="size-4" aria-hidden /> Create link
            </Button>
          </form>
        </Card>
      )}

      {list.isLoading ? (
        <div className="py-10 text-center">
          <Spinner />
        </div>
      ) : list.error ? (
        <Alert>{describeError(list.error)}</Alert>
      ) : list.data?.items.length === 0 ? (
        <Card>
          <EmptyState icon={QrCode} title="No enrollment links yet" body="Create one above, then show its QR code to students or post the link in your group chat." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.data?.items.map((l) => (
            <LinkCard key={l.id} link={l} readOnly={readOnly} onRevoke={() => setRevoking(l)} onCopied={() => toast('Link copied.')} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={creating}
        title="Create an enrollment link?"
        description="Anyone with the link can submit an enrollment."
        confirmLabel="Create"
        onConfirm={create}
        onClose={() => setCreating(false)}
      />
      {revoking && (
        <ConfirmDialog
          open
          title="Turn off this link?"
          description="Submissions already made stay pending."
          confirmLabel="Turn off"
          tone="danger"
          onConfirm={async () => {
            await api(`/enrollment-links/${revoking.id}/revoke`, { method: 'POST' });
            await refresh();
          }}
          onClose={() => setRevoking(null)}
        />
      )}
    </>
  );
}

function LinkCard({ link, readOnly, onRevoke, onCopied }: { link: EnrollmentLinkRow; readOnly: boolean; onRevoke: () => void; onCopied: () => void }) {
  const url = fullUrl(link.path);
  const png = useQrDataUrl(url, 1024);
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row">
      <QrImage value={url} label={`Enrollment QR ${link.label ?? ''}`} className="size-36 shrink-0 self-center" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{link.label || 'Enrollment link'}</p>
          {link.usable ? <Badge tone="green">Active</Badge> : <Badge>{link.isActive ? 'Expired / full' : 'Turned off'}</Badge>}
        </div>
        <p className="text-xs text-slate-500">
          {link.useCount} submission{link.useCount === 1 ? '' : 's'}
          {link.maxUses ? ` of ${link.maxUses}` : ''} · {link.expiresAt ? `expires ${formatDateTime(link.expiresAt)}` : 'no expiry'}
        </p>
        <p className="text-xs text-slate-500">
          Created by {link.createdByName}, {formatDateTime(link.createdAt)}
        </p>
        {link.pending > 0 && (
          <Link to="/students?tab=pending" className="inline-block text-sm font-medium text-amber-800 hover:underline">
            {link.pending} waiting for approval →
          </Link>
        )}
        {link.usable && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                onCopied();
              }}
            >
              <Copy className="size-4" aria-hidden /> Copy link
            </Button>
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-surface px-3 text-sm font-medium hover:bg-slate-50">
              <ExternalLink className="size-4" aria-hidden /> Open
            </a>
            {png && (
              <a
                href={png}
                download={`enrollment-qr${link.label ? `-${link.label.replace(/[^\w-]+/g, '-')}` : ''}.png`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-surface px-3 text-sm font-medium hover:bg-slate-50"
              >
                <Download className="size-4" aria-hidden /> QR image
              </a>
            )}
            {!readOnly && (
              <Button size="sm" variant="ghost" onClick={onRevoke}>
                <Link2Off className="size-4" aria-hidden /> Turn off
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
