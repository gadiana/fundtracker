import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Eye, Lock, Mail, PencilLine, RotateCcw, Send } from 'lucide-react';
import { emailLayout, renderEvent, unknownPlaceholders, type EventTemplate } from '@sft/shared';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner, Textarea, Toggle, cx } from '../../components/ui';
import { api, describeError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import type { EmailStatus, NotificationEventView, NotificationSettings, OutboxEmail, Settings } from '../../lib/types';
import { useReadOnly } from './form';
import { EmailSenderCard } from './sections';

/** Settings → Email & notifications. */
export function EmailNotificationsSection({ settings }: { settings: Settings }) {
  const { ay } = useAuth();
  const data = useQuery({ queryKey: ['notification-settings', ay?.id], queryFn: () => api<NotificationSettings>('/settings/notifications') });
  return (
    <>
      <EmailSenderCard settings={settings} />
      {data.isLoading ? (
        <div className="py-8 text-center">
          <Spinner />
        </div>
      ) : data.error || !data.data ? (
        <Alert>{errorMessage(data.error)}</Alert>
      ) : (
        <>
          <DeliveryCard data={data.data} />
          <EventsCard events={data.data.events} />
        </>
      )}
      <OutboxCard />
    </>
  );
}

function DeliveryCard({ data }: { data: NotificationSettings }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { ay } = useAuth();
  const [testing, setTesting] = useState(false);
  const [to, setTo] = useState('');
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Delivery</h2>
          <p className="text-sm text-slate-600">
            Emails are sent as <span className="font-mono text-xs">{data.sender.from}</span>
            {data.sender.replyTo && (
              <>
                , replies go to <span className="font-mono text-xs">{data.sender.replyTo}</span>
              </>
            )}
            . A failed email is tried again after 1 minute, 5 minutes, 30 minutes and 2 hours.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setTesting(true)}>
          <Send className="size-4" aria-hidden /> Send a test email
        </Button>
      </div>
      {!data.smtpConfigured && (
        <Alert tone="warning" title="No mail server is configured">
          Emails are recorded below and printed in the server’s console, but not delivered. Set SMTP_HOST (and its login) in the server’s .env to send them.
        </Alert>
      )}
      <ConfirmDialog
        open={testing}
        title="Send a test email?"
        description="Leave the address empty to send it to yourself."
        confirmLabel="Send"
        onConfirm={async () => {
          const res = await api<{ ok: boolean; to: string; error: string | null }>('/settings/email/test', { method: 'POST', body: to.trim() ? { to: to.trim() } : {} });
          await queryClient.invalidateQueries({ queryKey: ['outbox', ay?.id] });
          if (!res.ok) throw new Error(`It could not be sent to ${res.to}: ${res.error}`);
          toast(`Test email sent to ${res.to}.`);
          setTo('');
        }}
        onClose={() => setTesting(false)}
      >
        <Field label="Send to" htmlFor="test-to" optional>
          <Input id="test-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}

type Switches = Record<string, { inApp: boolean; email: boolean }>;

function EventsCard({ events }: { events: NotificationEventView[] }) {
  const readOnly = useReadOnly();
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const saved = useMemo<Switches>(() => Object.fromEntries(events.map((e) => [e.key, { inApp: e.inApp, email: e.email }])), [events]);
  const [draft, setDraft] = useState<Switches>(saved);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<NotificationEventView | null>(null);
  const changed = events.filter((e) => draft[e.key]!.inApp !== saved[e.key]!.inApp || draft[e.key]!.email !== saved[e.key]!.email);
  const groups = [...new Set(events.map((e) => e.group))];

  const set = (key: string, channel: 'inApp' | 'email', value: boolean) => setDraft((d) => ({ ...d, [key]: { ...d[key]!, [channel]: value } }));

  return (
    <Card>
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="font-semibold">Events that notify</h2>
        <p className="text-sm text-slate-600">
          For each event, choose an in-app notice (the bell and the Notifications page) and/or an email, and edit what it says. Nobody is notified about something they did themself.
        </p>
      </div>
      {groups.map((group) => (
        <section key={group} className="border-b border-slate-100 last:border-0">
          <h3 className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h3>
          <ul className="divide-y divide-slate-100">
            {events
              .filter((e) => e.group === group)
              .map((e) => (
                <li key={e.key} className="grid gap-3 px-5 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.label}</span>
                      {e.locked && (
                        <Badge>
                          <Lock className="mr-1 inline size-3" aria-hidden />
                          Always emailed
                        </Badge>
                      )}
                      {e.customized && <Badge tone="brand">Edited wording</Badge>}
                    </div>
                    <p className="text-xs text-slate-500">To: {e.audience}</p>
                    {e.emailSwitchLabel && <p className="text-xs text-slate-500">Email: {e.emailSwitchLabel}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="w-28">
                      <Toggle
                        id={`${e.key}-inapp`}
                        label="In-app"
                        checked={draft[e.key]!.inApp}
                        disabled={readOnly || !e.channels.inApp}
                        onChange={(v) => set(e.key, 'inApp', v)}
                      />
                    </div>
                    <div className="w-28">
                      <Toggle
                        id={`${e.key}-email`}
                        label="Email"
                        checked={draft[e.key]!.email}
                        disabled={readOnly || !e.channels.email || e.locked}
                        onChange={(v) => set(e.key, 'email', v)}
                      />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                      <PencilLine className="size-4" aria-hidden /> Wording
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {!readOnly && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          {changed.length > 0 && (
            <Button variant="ghost" onClick={() => setDraft(saved)}>
              Undo
            </Button>
          )}
          <Button onClick={() => setConfirming(true)} disabled={changed.length === 0}>
            Save changes
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Save which events notify?"
        description={
          <ul className="list-disc space-y-0.5 pl-5">
            {changed.map((e) => (
              <li key={e.key}>
                {e.label}: in-app {draft[e.key]!.inApp ? 'on' : 'off'}, email {draft[e.key]!.email ? 'on' : 'off'}
              </li>
            ))}
          </ul>
        }
        confirmLabel="Save"
        onConfirm={async () => {
          for (const e of changed) {
            await api(`/settings/notifications/${e.key}`, { method: 'PUT', body: { ...draft[e.key], template: e.customized ? e.template : null } });
          }
          await queryClient.invalidateQueries({ queryKey: ['notification-settings', ay?.id] });
          toast('Notification settings saved.');
        }}
        onClose={() => setConfirming(false)}
      />
      {editing && (
        <TemplateEditor
          key={editing.key}
          event={editing}
          switches={saved[editing.key]!}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ['notification-settings', ay?.id] });
          }}
        />
      )}
    </Card>
  );
}

type TemplateField = keyof EventTemplate;

function TemplateEditor({
  event,
  switches,
  onClose,
  onSaved,
}: {
  event: NotificationEventView;
  switches: { inApp: boolean; email: boolean };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const readOnly = useReadOnly();
  const toast = useToast();
  const { ay } = useAuth();
  const [t, setT] = useState<EventTemplate>(event.template);
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null);
  const [view, setView] = useState<'email' | 'notice'>(event.channels.email ? 'email' : 'notice');
  const refs = useRef<Partial<Record<TemplateField, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const lastField = useRef<TemplateField>('body');
  const unknown = unknownPlaceholders(event.key, t);
  const isDefault = JSON.stringify(t) === JSON.stringify(event.defaultTemplate);
  const hasLink = event.defaultTemplate.button !== '';

  const vars = { ...event.variables, orgName: ay?.orgName || event.variables.orgName!, ayLabel: ay?.label ?? event.variables.ayLabel! };
  const rendered = renderEvent(t, vars);
  const preview = emailLayout(vars.orgName!, rendered, hasLink ? 'https://example.com/…' : undefined).html;

  function insert(name: string) {
    const field = lastField.current;
    const el = refs.current[field];
    const token = `{{${name}}}`;
    const value = t[field];
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setT({ ...t, [field]: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const bind = (field: TemplateField) => ({
    value: t[field],
    disabled: readOnly,
    ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      refs.current[field] = el;
    },
    onFocus: () => {
      lastField.current = field;
    },
    onChange: (e: { target: { value: string } }) => setT({ ...t, [field]: e.target.value }),
  });

  async function save(template: EventTemplate | null) {
    try {
      await api(`/settings/notifications/${event.key}`, { method: 'PUT', body: { ...switches, template } });
    } catch (err) {
      throw new Error(describeError(err));
    }
    toast(template ? `Wording of “${event.label}” saved.` : `“${event.label}” is back to the default wording.`);
    await onSaved();
  }

  return (
    <Modal
      open
      title={`Wording: ${event.label}`}
      subtitle={`To: ${event.audience}`}
      onClose={onClose}
      footer={
        !readOnly && (
          <>
            <Button variant="ghost" onClick={() => setConfirm('reset')} disabled={!event.customized && isDefault}>
              <RotateCcw className="size-4" aria-hidden /> Default wording
            </Button>
            <Button onClick={() => setConfirm('save')} disabled={unknown.length > 0 || !t.subject.trim() || isDefault === !event.customized}>
              Save wording
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-600">Placeholders (click to insert where the cursor is)</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(event.variables).map((name) => (
              <button
                key={name}
                type="button"
                disabled={readOnly}
                onClick={() => insert(name)}
                className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700 hover:bg-brand-50 hover:text-brand-700"
                title={`Example: ${event.variables[name]}`}
              >
                {`{{${name}}}`}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">A paragraph whose placeholders are all empty (for example, no comment was given) is left out.</p>
        </div>
        <Field label={event.channels.email ? 'Email subject (also the notice title)' : 'Notice title'} htmlFor="tpl-subject" error={!t.subject.trim() ? 'The subject can’t be empty' : undefined}>
          <Input id="tpl-subject" maxLength={200} {...bind('subject')} />
        </Field>
        {event.channels.inApp && (
          <Field label="In-app notice text" htmlFor="tpl-notice" optional hint="One short line under the title.">
            <Input id="tpl-notice" maxLength={300} {...bind('notice')} />
          </Field>
        )}
        {event.channels.email && (
          <Field label="Email text" htmlFor="tpl-body" hint="Leave a blank line between paragraphs.">
            <Textarea id="tpl-body" rows={7} maxLength={4000} {...bind('body')} />
          </Field>
        )}
        {event.channels.email && hasLink && (
          <Field label="Button label" htmlFor="tpl-button" hint="The button opens the page this email is about.">
            <Input id="tpl-button" maxLength={40} {...bind('button')} />
          </Field>
        )}
        {unknown.length > 0 && <Alert>{`This message can’t use ${unknown.map((n) => `{{${n}}}`).join(', ')}. Use only the placeholders listed above.`}</Alert>}

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Eye className="size-4" aria-hidden /> Preview with example details
            </p>
            {event.channels.email && event.channels.inApp && (
              <Select aria-label="Preview" value={view} onChange={(e) => setView(e.target.value as 'email' | 'notice')} className="w-36">
                <option value="email">Email</option>
                <option value="notice">In-app notice</option>
              </Select>
            )}
          </div>
          {view === 'email' ? (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <p className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                <Mail className="size-3.5" aria-hidden /> {rendered.subject}
              </p>
              {/* sandboxed: nothing in the preview can run */}
              <iframe title="Email preview" sandbox="" srcDoc={preview} className="h-72 w-full bg-surface" />
            </div>
          ) : (
            <div className="flex gap-3 rounded-lg border border-slate-200 p-3">
              <Bell className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium">{rendered.subject}</p>
                {rendered.notice && <p className="text-sm text-slate-500">{rendered.notice}</p>}
                <p className="text-xs text-slate-400">just now</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'reset' ? 'Go back to the default wording?' : 'Save this wording?'}
        description={
          confirm === 'reset' ? 'Your edits for this event are removed. The switches stay as they are.' : 'Every message for this event uses it from now on. Messages already sent don’t change.'
        }
        confirmLabel={confirm === 'reset' ? 'Use the default' : 'Save'}
        onConfirm={() => save(confirm === 'reset' ? null : t)}
        onClose={() => setConfirm(null)}
      />
    </Modal>
  );
}

const STATUS_TONE: Record<EmailStatus, 'green' | 'amber' | 'red' | 'gray'> = { sent: 'green', queued: 'amber', sending: 'gray', failed: 'red' };
const STATUS_LABEL: Record<EmailStatus, string> = { sent: 'Sent', queued: 'Will retry', sending: 'Sending', failed: 'Failed' };

function OutboxCard() {
  const { ay } = useAuth();
  const readOnly = useReadOnly();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<EmailStatus | ''>('');
  const [page, setPage] = useState(1);
  const [retrying, setRetrying] = useState<OutboxEmail | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['outbox', ay?.id, status, page],
    queryFn: () =>
      api<{ total: number; pageSize: number; counts: Partial<Record<EmailStatus, number>>; items: OutboxEmail[] }>(`/settings/email/outbox?page=${page}${status ? `&status=${status}` : ''}`),
  });
  const detail = useQuery({ queryKey: ['outbox', ay?.id, 'detail', viewing], enabled: Boolean(viewing), queryFn: () => api<OutboxEmail>(`/settings/email/outbox/${viewing}`) });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.pageSize ?? 25)));
  const counts = list.data?.counts ?? {};

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-semibold">Sent emails</h2>
          <p className="text-sm text-slate-600">Every email this academic year sent, newest first. Emails with one-time links keep no copy of their text.</p>
        </div>
        <Select
          aria-label="Status"
          className="w-44"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as EmailStatus | '');
            setPage(1);
          }}
        >
          <option value="">All</option>
          <option value="sent">Sent ({counts.sent ?? 0})</option>
          <option value="queued">Will retry ({counts.queued ?? 0})</option>
          <option value="failed">Failed ({counts.failed ?? 0})</option>
        </Select>
      </div>
      {list.isLoading ? (
        <div className="p-6 text-center">
          <Spinner />
        </div>
      ) : !list.data?.items.length ? (
        <p className="p-6 text-sm text-slate-500">No emails{status ? ' with this status' : ' yet'}.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.data.items.map((m) => (
            <li key={m.id} className="grid gap-2 px-5 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
                  <span className="truncate text-sm font-medium">{m.subject}</span>
                </div>
                <p className="truncate text-xs text-slate-500">
                  To {m.to} · {m.eventLabel ?? 'Email'} · {formatDateTime(m.createdAt)}
                  {m.attempts > 1 && ` · ${m.attempts} attempts`}
                  {m.requestedByName && ` · by ${m.requestedByName}`}
                </p>
                {m.lastError && m.status !== 'sent' && <p className="truncate text-xs text-red-700">{m.lastError}</p>}
                {m.nextTryAt && <p className="text-xs text-amber-800">Next try {formatDateTime(m.nextTryAt)}</p>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setViewing(m.id)}>
                  View
                </Button>
                {!readOnly && m.retryable && (m.status === 'failed' || m.status === 'queued') && (
                  <Button size="sm" variant="secondary" onClick={() => setRetrying(m)}>
                    <RotateCcw className="size-4" aria-hidden /> Send now
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <span className="text-slate-500">
            Page {page} of {pages}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(retrying)}
        title="Send this email now?"
        description={retrying && `“${retrying.subject}” to ${retrying.to}.`}
        confirmLabel="Send now"
        onConfirm={async () => {
          const res = await api<{ ok: boolean; email: OutboxEmail }>(`/settings/email/outbox/${retrying!.id}/retry`, { method: 'POST' });
          await queryClient.invalidateQueries({ queryKey: ['outbox', ay?.id] });
          if (!res.ok) throw new Error(`It failed again: ${res.email.lastError ?? 'unknown error'}`);
          toast(`Sent to ${res.email.to}.`);
        }}
        onClose={() => setRetrying(null)}
      />
      <Modal open={Boolean(viewing)} title={detail.data?.subject ?? 'Email'} subtitle={detail.data && `To ${detail.data.to} · ${formatDateTime(detail.data.createdAt)}`} onClose={() => setViewing(null)} size="md">
        {detail.isLoading ? (
          <Spinner />
        ) : (
          <pre className={cx('whitespace-pre-wrap break-words font-sans text-sm text-slate-700')}>{detail.data?.text ?? 'No text was kept.'}</pre>
        )}
      </Modal>
    </Card>
  );
}
