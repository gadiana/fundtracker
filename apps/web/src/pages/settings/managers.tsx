import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { LOGO_MIME_TYPES } from '@sft/shared';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Select, Spinner, Toggle } from '../../components/ui';
import { api, describeError, uploadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ApproverRow, PositionRow, Program, Section, Settings } from '../../lib/types';
import { useReadOnly } from './form';

interface ConfirmRequest {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  run: () => Promise<unknown>;
  done?: string;
}

/** Every change on these lists goes through one confirmation dialog. */
function useConfirm() {
  const toast = useToast();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const element = request && (
    <ConfirmDialog
      open
      title={request.title}
      description={request.description}
      confirmLabel={request.confirmLabel}
      tone={request.tone}
      onConfirm={async () => {
        try {
          await request.run();
        } catch (err) {
          throw new Error(describeError(err, { code: 'Code', name: 'Name' }));
        }
        if (request.done) toast(request.done);
      }}
      onClose={() => setRequest(null)}
    />
  );
  return [setRequest, element] as const;
}

function ManagerCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function ListState({ loading, error, empty, children }: { loading: boolean; error: unknown; empty: boolean; children: ReactNode }) {
  if (loading) return <Spinner />;
  if (error) return <Alert>{describeError(error)}</Alert>;
  if (empty) return <p className="text-sm text-slate-500">Nothing here yet.</p>;
  return <>{children}</>;
}

// ───────────────────────────── Logo ─────────────────────────────

export function LogoUploader({ kind, settings, title, description }: { kind: 'org' | 'receipt'; settings: Settings; title: string; description: string }) {
  const { ay, refreshMe } = useAuth();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const [ask, dialog] = useConfirm();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const current = kind === 'org' ? settings.logoUrl : settings.receiptLogoUrl;

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const after = async (updated: Settings) => {
    queryClient.setQueryData(['settings', ay?.id], updated);
    setFile(null);
    if (kind === 'org') await refreshMe();
  };

  return (
    <ManagerCard title={title} description={description}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {preview || current ? (
            <img src={preview ?? current!} alt={`${title} preview`} className="size-full object-contain" />
          ) : (
            <ImageIcon className="size-8 text-slate-300" aria-hidden />
          )}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
              <Upload className="size-4" aria-hidden /> Choose image
              <input
                type="file"
                accept={LOGO_MIME_TYPES.join(',')}
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {file && (
              <Button
                onClick={() =>
                  ask({
                    title: `Use this image as the ${title.toLowerCase()}?`,
                    confirmLabel: 'Upload',
                    run: async () => after(await uploadFile<Settings>(`/settings/logo?kind=${kind}`, file)),
                    done: `${title} updated.`,
                  })
                }
              >
                Upload
              </Button>
            )}
            {file && (
              <Button variant="ghost" onClick={() => setFile(null)}>
                Cancel
              </Button>
            )}
            {!file && current && (
              <Button
                variant="ghost"
                onClick={() =>
                  ask({
                    title: `Remove the ${title.toLowerCase()}?`,
                    description: 'Receipts already issued keep the logo they were printed with.',
                    confirmLabel: 'Remove',
                    tone: 'danger',
                    run: async () => after(await api<Settings>(`/settings/logo?kind=${kind}`, { method: 'DELETE' })),
                    done: `${title} removed.`,
                  })
                }
              >
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
      {dialog}
    </ManagerCard>
  );
}

// ───────────────────────────── Programs ─────────────────────────────

export function ProgramsManager() {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const [ask, dialog] = useConfirm();
  const key = ['programs', ay?.id];
  const list = useQuery({ queryKey: key, queryFn: () => api<{ items: Program[] }>('/programs') });
  const [draft, setDraft] = useState({ code: '', name: '' });
  const [editing, setEditing] = useState<{ id: string; code: string; name: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const add = (e: FormEvent) => {
    e.preventDefault();
    ask({
      title: `Add program ${draft.code.toUpperCase()}?`,
      description: draft.name,
      confirmLabel: 'Add program',
      run: async () => {
        await api('/programs', { method: 'POST', body: draft });
        setDraft({ code: '', name: '' });
        await refresh();
      },
      done: 'Program added.',
    });
  };

  return (
    <ManagerCard title="Programs" description="Courses students can belong to, e.g. BSIT. Programs in use can be deactivated but not deleted.">
      <ListState loading={list.isLoading} error={list.error} empty={list.data?.items.length === 0}>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {list.data?.items.map((p) =>
            editing?.id === p.id ? (
              <li key={p.id} className="flex flex-col gap-2 p-3 sm:flex-row">
                <Input aria-label="Code" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} className="sm:w-32" />
                <Input aria-label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      ask({
                        title: `Save changes to ${p.code}?`,
                        description: 'Existing students and funds keep pointing to this program.',
                        confirmLabel: 'Save',
                        run: async () => {
                          await api(`/programs/${p.id}`, { method: 'PATCH', body: { code: editing.code, name: editing.name } });
                          setEditing(null);
                          await refresh();
                        },
                        done: 'Program updated.',
                      })
                    }
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </li>
            ) : (
              <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="w-20 font-mono text-sm font-semibold">{p.code}</span>
                <span className="min-w-0 flex-1 text-sm text-slate-700">{p.name}</span>
                {!p.isActive && <Badge>inactive</Badge>}
                {!readOnly && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Edit ${p.code}`} onClick={() => setEditing({ id: p.id, code: p.code, name: p.name })}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        ask({
                          title: `${p.isActive ? 'Deactivate' : 'Activate'} ${p.code}?`,
                          description: p.isActive ? 'It can no longer be chosen for new students or funds. Existing records keep it.' : undefined,
                          confirmLabel: p.isActive ? 'Deactivate' : 'Activate',
                          run: async () => {
                            await api(`/programs/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } });
                            await refresh();
                          },
                        })
                      }
                    >
                      {p.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${p.code}`}
                      onClick={() =>
                        ask({
                          title: `Delete ${p.code}?`,
                          description: 'Only possible while no student or fund uses it.',
                          confirmLabel: 'Delete',
                          tone: 'danger',
                          run: async () => {
                            await api(`/programs/${p.id}`, { method: 'DELETE' });
                            await refresh();
                          },
                          done: 'Program deleted.',
                        })
                      }
                    >
                      <Trash2 className="size-4 text-red-600" />
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      </ListState>
      {!readOnly && (
        <form onSubmit={add} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Code" htmlFor="new-program-code" className="sm:w-32">
            <Input id="new-program-code" placeholder="BSIT" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
          </Field>
          <Field label="Name" htmlFor="new-program-name" className="flex-1">
            <Input
              id="new-program-name"
              placeholder="Bachelor of Science in Information Technology"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={!draft.code.trim() || !draft.name.trim()}>
            <Plus className="size-4" aria-hidden /> Add
          </Button>
        </form>
      )}
      {dialog}
    </ManagerCard>
  );
}

// ───────────────────────────── Sections ─────────────────────────────

export function SectionsManager() {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const [ask, dialog] = useConfirm();
  const key = ['sections', ay?.id];
  const list = useQuery({ queryKey: key, queryFn: () => api<{ items: Section[] }>('/sections') });
  const [draft, setDraft] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const add = (e: FormEvent) => {
    e.preventDefault();
    ask({
      title: `Add section ${draft.toUpperCase()}?`,
      confirmLabel: 'Add section',
      run: async () => {
        await api('/sections', { method: 'POST', body: { name: draft } });
        setDraft('');
        await refresh();
      },
      done: 'Section added.',
    });
  };

  return (
    <ManagerCard title="Sections" description="e.g. A, B, C. Sections with students can be deactivated but not deleted.">
      <ListState loading={list.isLoading} error={list.error} empty={list.data?.items.length === 0}>
        <ul className="flex flex-wrap gap-2">
          {list.data?.items.map((s) => (
            <li key={s.id} className="flex items-center gap-1 rounded-lg border border-slate-200 py-1 pl-3 pr-1">
              <span className={s.isActive ? 'text-sm font-medium' : 'text-sm text-slate-400 line-through'}>{s.name}</span>
              {!readOnly && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      ask({
                        title: `${s.isActive ? 'Deactivate' : 'Activate'} section ${s.name}?`,
                        confirmLabel: s.isActive ? 'Deactivate' : 'Activate',
                        run: async () => {
                          await api(`/sections/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } });
                          await refresh();
                        },
                      })
                    }
                  >
                    {s.isActive ? 'Off' : 'On'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete section ${s.name}`}
                    onClick={() =>
                      ask({
                        title: `Delete section ${s.name}?`,
                        description: 'Only possible while no student is in it.',
                        confirmLabel: 'Delete',
                        tone: 'danger',
                        run: async () => {
                          await api(`/sections/${s.id}`, { method: 'DELETE' });
                          await refresh();
                        },
                        done: 'Section deleted.',
                      })
                    }
                  >
                    <Trash2 className="size-4 text-red-600" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </ListState>
      {!readOnly && (
        <form onSubmit={add} className="mt-4 flex items-end gap-2">
          <Field label="New section" htmlFor="new-section" className="w-40">
            <Input id="new-section" placeholder="D" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" disabled={!draft.trim()}>
            <Plus className="size-4" aria-hidden /> Add
          </Button>
        </form>
      )}
      {dialog}
    </ManagerCard>
  );
}

// ─────────────────────── Positions & permissions ───────────────────────

const FLAGS = [
  { key: 'canFileRequests', label: 'File fund requests', verb: 'file fund requests and liquidation receipts' },
  { key: 'canCollect', label: 'Collect payments', verb: 'record payments, manage students and issue receipts' },
  { key: 'isConfidentialExempt', label: 'See confidential funds', verb: 'see confidential funds, their balances and requests' },
] as const;

export function PositionsManager() {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const [ask, dialog] = useConfirm();
  const key = ['designations', ay?.id];
  const list = useQuery({ queryKey: key, queryFn: () => api<{ items: PositionRow[] }>('/designations') });
  const [draft, setDraft] = useState({ name: '', canFileRequests: false, canCollect: false, isConfidentialExempt: false });
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const patch = (p: PositionRow, body: object) => async () => {
    await api(`/designations/${p.id}`, { method: 'PATCH', body });
    await refresh();
  };

  return (
    <ManagerCard
      title="Positions & permissions"
      description="Each member holds one position. What the position may do applies to everyone holding it. The adviser can do everything."
    >
      <ListState loading={list.isLoading} error={list.error} empty={list.data?.items.length === 0}>
        <ul className="space-y-3">
          {list.data?.items.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {renaming?.id === p.id ? (
                  <>
                    <Input aria-label="Position name" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} className="max-w-xs" />
                    <Button
                      size="sm"
                      onClick={() =>
                        ask({
                          title: `Rename "${p.name}" to "${renaming.name}"?`,
                          description: 'Past records keep the name the position had at the time.',
                          confirmLabel: 'Rename',
                          run: async () => {
                            await patch(p, { name: renaming.name })();
                            setRenaming(null);
                          },
                        })
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <span className={p.isActive ? 'font-medium' : 'font-medium text-slate-400 line-through'}>{p.name}</span>
                    <Badge>{p.activeMembers} member{p.activeMembers === 1 ? '' : 's'}</Badge>
                    {!p.isActive && <Badge tone="amber">inactive</Badge>}
                  </>
                )}
                {!readOnly && renaming?.id !== p.id && (
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Rename ${p.name}`} onClick={() => setRenaming({ id: p.id, name: p.name })}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        ask({
                          title: `${p.isActive ? 'Deactivate' : 'Activate'} "${p.name}"?`,
                          description: p.isActive ? 'It can no longer be assigned. Members must be moved to another position first.' : undefined,
                          confirmLabel: p.isActive ? 'Deactivate' : 'Activate',
                          run: patch(p, { isActive: !p.isActive }),
                        })
                      }
                    >
                      {p.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${p.name}`}
                      onClick={() =>
                        ask({
                          title: `Delete "${p.name}"?`,
                          description: 'Only possible if nobody ever held it.',
                          confirmLabel: 'Delete',
                          tone: 'danger',
                          run: async () => {
                            await api(`/designations/${p.id}`, { method: 'DELETE' });
                            await refresh();
                          },
                          done: 'Position deleted.',
                        })
                      }
                    >
                      <Trash2 className="size-4 text-red-600" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {FLAGS.map((f) => (
                  <Toggle
                    key={f.key}
                    id={`${p.id}-${f.key}`}
                    label={f.label}
                    checked={p[f.key]}
                    disabled={readOnly || !p.isActive}
                    onChange={(on) =>
                      ask({
                        title: on ? `Let ${p.name} ${f.verb}?` : `Stop ${p.name} from being able to ${f.verb}?`,
                        description: `This applies right away to ${p.activeMembers} member(s) holding this position.`,
                        confirmLabel: on ? 'Allow' : 'Remove permission',
                        tone: on ? 'primary' : 'danger',
                        run: patch(p, { [f.key]: on }),
                      })
                    }
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </ListState>
      {!readOnly && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask({
              title: `Add the position "${draft.name}"?`,
              confirmLabel: 'Add position',
              run: async () => {
                await api('/designations', { method: 'POST', body: draft });
                setDraft({ name: '', canFileRequests: false, canCollect: false, isConfidentialExempt: false });
                await refresh();
              },
              done: 'Position added.',
            });
          }}
          className="mt-4 space-y-3 rounded-lg border border-dashed border-slate-300 p-3"
        >
          <Field label="New position" htmlFor="new-position" className="max-w-sm">
            <Input id="new-position" placeholder="e.g. Business Manager" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {FLAGS.map((f) => (
              <Checkbox key={f.key} checked={draft[f.key]} onChange={(v) => setDraft({ ...draft, [f.key]: v })} label={f.label} />
            ))}
          </div>
          <Button type="submit" variant="secondary" disabled={!draft.name.trim()}>
            <Plus className="size-4" aria-hidden /> Add position
          </Button>
        </form>
      )}
      {dialog}
    </ManagerCard>
  );
}

// ───────────────────────────── Approvers ─────────────────────────────

export function ApproversManager() {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const [ask, dialog] = useConfirm();
  const key = ['approvers', ay?.id];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<{ items: ApproverRow[]; candidates: { userId: string; name: string; position: string | null }[] }>('/approvers'),
  });
  const [draft, setDraft] = useState({ userId: '', approvesFundRequests: true, approvesLiquidations: true });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const candidates = list.data?.candidates ?? [];

  const save = (userId: string, flags: { approvesFundRequests: boolean; approvesLiquidations: boolean }) => async () => {
    await api(`/approvers/${userId}`, { method: 'PUT', body: flags });
    await refresh();
  };

  return (
    <ManagerCard title="Extra approvers" description="Besides the adviser, who may approve fund requests and liquidation receipts.">
      <ListState loading={list.isLoading} error={list.error} empty={false}>
        {list.data?.items.length === 0 ? (
          <p className="text-sm text-slate-500">Only the adviser approves.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {list.data?.items.map((a) => (
              <li key={a.userId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {a.name} {!a.active && <Badge tone="amber">no longer active</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{a.position}</p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <Checkbox
                    checked={a.approvesFundRequests}
                    disabled={readOnly || (a.approvesFundRequests && !a.approvesLiquidations)}
                    onChange={(v) =>
                      ask({
                        title: v ? `Let ${a.name} approve fund requests?` : `Stop ${a.name} approving fund requests?`,
                        confirmLabel: 'Save',
                        run: save(a.userId, { approvesFundRequests: v, approvesLiquidations: a.approvesLiquidations }),
                      })
                    }
                    label="Fund requests"
                  />
                  <Checkbox
                    checked={a.approvesLiquidations}
                    disabled={readOnly || (a.approvesLiquidations && !a.approvesFundRequests)}
                    onChange={(v) =>
                      ask({
                        title: v ? `Let ${a.name} approve liquidation receipts?` : `Stop ${a.name} approving liquidation receipts?`,
                        confirmLabel: 'Save',
                        run: save(a.userId, { approvesFundRequests: a.approvesFundRequests, approvesLiquidations: v }),
                      })
                    }
                    label="Liquidations"
                  />
                  {!readOnly && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        ask({
                          title: `Remove ${a.name} as an approver?`,
                          confirmLabel: 'Remove',
                          tone: 'danger',
                          run: async () => {
                            await api(`/approvers/${a.userId}`, { method: 'DELETE' });
                            await refresh();
                          },
                          done: 'Approver removed.',
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </ListState>
      {!readOnly && (
        <div className="mt-4 space-y-3 rounded-lg border border-dashed border-slate-300 p-3">
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-500">Approve members with a position first; they can then be added here.</p>
          ) : (
            <>
              <Field label="Add an approver" htmlFor="new-approver" className="max-w-sm">
                <Select id="new-approver" value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })}>
                  <option value="">Choose a member…</option>
                  {candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name} {c.position ? `(${c.position})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox checked={draft.approvesFundRequests} onChange={(v) => setDraft({ ...draft, approvesFundRequests: v })} label="Fund requests" />
                <Checkbox checked={draft.approvesLiquidations} onChange={(v) => setDraft({ ...draft, approvesLiquidations: v })} label="Liquidation receipts" />
              </div>
              <Button
                variant="secondary"
                disabled={!draft.userId || (!draft.approvesFundRequests && !draft.approvesLiquidations)}
                onClick={() =>
                  ask({
                    title: `Add ${candidates.find((c) => c.userId === draft.userId)?.name} as an approver?`,
                    confirmLabel: 'Add approver',
                    run: async () => {
                      await save(draft.userId, { approvesFundRequests: draft.approvesFundRequests, approvesLiquidations: draft.approvesLiquidations })();
                      setDraft({ userId: '', approvesFundRequests: true, approvesLiquidations: true });
                    },
                    done: 'Approver added.',
                  })
                }
              >
                <Plus className="size-4" aria-hidden /> Add approver
              </Button>
            </>
          )}
        </div>
      )}
      {dialog}
    </ManagerCard>
  );
}
