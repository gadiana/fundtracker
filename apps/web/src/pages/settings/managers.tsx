import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Eye, EyeOff, ImageIcon, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { LOGO_MIME_TYPES } from '@sft/shared';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Select, Spinner, Toggle, cx } from '../../components/ui';
import { api, describeError, uploadFile } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { yearLevelLabel } from '../../lib/format';
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
    <ManagerCard title="Programs" description="e.g. BSIT. Programs in use can only be deactivated.">
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

/** Sections of each program, per year level: BSIT 1st year can have A, B, C while BSCS 3rd year has only A. */
export function SectionsManager({ yearLevelCount }: { yearLevelCount: number }) {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const readOnly = useReadOnly();
  const [ask, dialog] = useConfirm();
  const key = ['sections', ay?.id];
  const list = useQuery({ queryKey: key, queryFn: () => api<{ items: Section[] }>('/sections') });
  const programs = useQuery({ queryKey: ['programs', ay?.id], queryFn: () => api<{ items: Program[] }>('/programs') });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ row: string; message: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const rowKey = (programId: string, yearLevel: number) => `${programId}|${yearLevel}`;
  const years = Array.from({ length: yearLevelCount }, (_, i) => i + 1);
  const shown = (programs.data?.items ?? []).filter((p) => p.isActive || list.data?.items.some((s) => s.programId === p.id));

  /** Adds the typed names ("A" or "A, B, C") to one program's year level. */
  async function add(e: FormEvent, program: Program, yearLevel: number) {
    e.preventDefault();
    const row = rowKey(program.id, yearLevel);
    const names = (drafts[row] ?? '').split(/[,\s]+/).map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    setBusy(row);
    setError(null);
    try {
      for (const name of names) await api('/sections', { method: 'POST', body: { programId: program.id, yearLevel, name } });
      setDrafts((d) => ({ ...d, [row]: '' }));
      toast(`Added to ${program.code} ${yearLevelLabel(yearLevel)}: ${names.map((n) => n.toUpperCase()).join(', ')}.`);
    } catch (err) {
      setError({ row, message: describeError(err, { name: 'Section' }) });
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  return (
    <ManagerCard
      title="Sections"
      description="Each program has its own sections for each year level. Type one or more (e.g. A, B, C) and press Add. Sections with students can only be turned off."
    >
      <ListState loading={list.isLoading || programs.isLoading} error={list.error ?? programs.error} empty={shown.length === 0}>
        <div className="space-y-5">
          {shown.map((program) => (
            <div key={program.id}>
              <h3 className="text-sm font-semibold text-slate-900">
                {program.code} <span className="font-normal text-slate-500">· {program.name}</span>
              </h3>
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {years.map((yearLevel) => {
                  const row = rowKey(program.id, yearLevel);
                  const sections = list.data?.items.filter((s) => s.programId === program.id && s.yearLevel === yearLevel) ?? [];
                  return (
                    <li key={yearLevel} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                      <span className="w-20 shrink-0 text-sm text-slate-600">{yearLevelLabel(yearLevel)}</span>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        {sections.length === 0 && <span className="text-sm text-slate-400">No sections</span>}
                        {sections.map((s) => (
                          <SectionChip
                            key={s.id}
                            section={s}
                            readOnly={readOnly}
                            onToggle={() =>
                              ask({
                                title: `${s.isActive ? 'Turn off' : 'Turn on'} section ${s.name} of ${program.code} ${yearLevelLabel(yearLevel)}?`,
                                description: s.isActive ? 'Students already in it keep it, but it can’t be chosen anymore.' : undefined,
                                confirmLabel: s.isActive ? 'Turn off' : 'Turn on',
                                run: async () => {
                                  await api(`/sections/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } });
                                  await refresh();
                                },
                              })
                            }
                            onDelete={() =>
                              ask({
                                title: `Delete section ${s.name} of ${program.code} ${yearLevelLabel(yearLevel)}?`,
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
                          />
                        ))}
                      </div>
                      {!readOnly && program.isActive && (
                        <form onSubmit={(e) => add(e, program, yearLevel)} className="flex shrink-0 items-center gap-1.5">
                          <Input
                            aria-label={`New sections for ${program.code} ${yearLevelLabel(yearLevel)}`}
                            placeholder="A, B"
                            className="h-8 w-24 text-sm"
                            value={drafts[row] ?? ''}
                            onChange={(e) => setDrafts((d) => ({ ...d, [row]: e.target.value }))}
                          />
                          <Button type="submit" size="sm" variant="secondary" loading={busy === row} disabled={!(drafts[row] ?? '').trim()}>
                            <Plus className="size-4" aria-hidden /> Add
                          </Button>
                        </form>
                      )}
                      {error?.row === row && <p className="text-sm text-red-600 sm:basis-full">{error.message}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </ListState>
      {shown.length === 0 && !programs.isLoading && <p className="mt-2 text-sm text-slate-500">Add a program first, then its sections.</p>}
      {dialog}
    </ManagerCard>
  );
}

function SectionChip({ section, readOnly, onToggle, onDelete }: { section: Section; readOnly: boolean; onToggle: () => void; onDelete: () => void }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-0.5">
      <span className={section.isActive ? 'text-sm font-medium' : 'text-sm text-slate-400 line-through'}>{section.name}</span>
      {!readOnly && (
        <>
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
            title={section.isActive ? 'Turn off (can no longer be chosen)' : 'Turn on again'}
            aria-label={`${section.isActive ? 'Turn off' : 'Turn on'} section ${section.name}`}
          >
            {section.isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
          <button type="button" onClick={onDelete} className="rounded p-0.5 text-red-600 hover:bg-red-50" aria-label={`Delete section ${section.name}`}>
            <Trash2 className="size-3.5" />
          </button>
        </>
      )}
    </span>
  );
}

// ─────────────────────── Positions & permissions ───────────────────────

const FLAGS = [
  { key: 'canFileRequests', label: 'File fund requests', verb: 'file fund requests and liquidation receipts' },
  { key: 'canCollect', label: 'Collect payments', verb: 'record payments, manage students and issue receipts' },
  { key: 'canViewFunds', label: 'See funds', verb: 'open the Funds page and see fund balances' },
  { key: 'isConfidentialExempt', label: 'See confidential funds', verb: 'see confidential funds, their balances and requests' },
] as const;

/** "Members allowed" as typed: empty = no limit (null), a whole number 1–100, or undefined when invalid. */
function parseLimit(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 1 && n <= 100 ? n : undefined;
}

/** A number box for a position's member limit, with Save (or Enter) once it changes. */
function MemberLimitInput({ id, value, disabled, onSave }: { id: string; value: number | null; disabled?: boolean; onSave: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const parsed = parseLimit(text);
  const changed = parsed !== undefined && parsed !== value;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {changed && (
          <Button size="sm" onClick={() => onSave(parsed)}>
            Save
          </Button>
        )}
        <div className="w-28">
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            placeholder="No limit"
            className="h-9"
            value={text}
            disabled={disabled}
            invalid={parsed === undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && changed) {
                e.preventDefault();
                onSave(parsed);
              }
            }}
          />
        </div>
      </div>
      {parsed === undefined ? (
        <p className="text-xs text-red-600">Use 1 to 100, or leave empty.</p>
      ) : (
        !text && <p className="text-xs text-slate-400">Empty = no limit</p>
      )}
    </div>
  );
}

export function PositionsManager() {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const [ask, dialog] = useConfirm();
  const key = ['designations', ay?.id];
  const list = useQuery({ queryKey: key, queryFn: () => api<{ items: PositionRow[] }>('/designations') });
  const [draft, setDraft] = useState<{ name: string; canFileRequests: boolean; canCollect: boolean; isConfidentialExempt: boolean; canViewFunds: boolean; maxMembers: number | null }>({
    name: '',
    canFileRequests: false,
    canCollect: false,
    isConfidentialExempt: false,
    canViewFunds: true,
    maxMembers: null,
  });
  /** "Members allowed" of the new position, as typed */
  const [draftLimit, setDraftLimit] = useState('1');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  /** positions whose permissions are showing */
  const [open, setOpen] = useState<string[]>([]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const patch = (p: PositionRow, body: object) => async () => {
    await api(`/designations/${p.id}`, { method: 'PATCH', body });
    await refresh();
  };

  return (
    <ManagerCard
      title="Positions & permissions"
      description="What each position may do. The adviser can do everything."
    >
      <ListState loading={list.isLoading} error={list.error} empty={list.data?.items.length === 0}>
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
          {list.data?.items.map((p) => {
            const isOpen = open.includes(p.id);
            const allowed = FLAGS.filter((f) => p[f.key]).map((f) => f.label);
            return (
            <li key={p.id}>
              <div className={cx('flex flex-wrap items-center gap-2 px-3 py-2.5', isOpen && 'bg-slate-50')}>
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
                  <button
                    type="button"
                    onClick={() => setOpen((list) => (isOpen ? list.filter((id) => id !== p.id) : [...list, p.id]))}
                    aria-expanded={isOpen}
                    aria-controls={`position-${p.id}`}
                    className="-my-1 flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left"
                  >
                    <ChevronRight className={cx('size-4 shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-90')} aria-hidden />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={p.isActive ? 'font-medium' : 'font-medium text-slate-400 line-through'}>{p.name}</span>
                        {!p.isActive && <Badge tone="amber">inactive</Badge>}
                        {p.isActive && p.maxMembers !== null && p.activeMembers >= p.maxMembers && <Badge tone="green">full</Badge>}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {p.maxMembers === null ? `${p.activeMembers} member${p.activeMembers === 1 ? '' : 's'}` : `${p.activeMembers} of ${p.maxMembers}`} ·{' '}
                        {allowed.length ? allowed.join(', ') : 'no permissions'}
                      </span>
                    </span>
                  </button>
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
              {isOpen && (
                <div id={`position-${p.id}`} className="space-y-3 border-t border-slate-100 py-3 pl-9 pr-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <label htmlFor={`${p.id}-max`} className="text-sm font-medium text-slate-800">
                        Members allowed
                      </label>
                      <p className="text-xs text-slate-500">
                        {p.seatsLocked ? 'Always held by one person.' : 'How many people may hold this position at the same time.'}
                      </p>
                    </div>
                    {p.seatsLocked ? (
                      <span className="text-sm font-medium tabular-nums text-slate-700">1</span>
                    ) : (
                      <MemberLimitInput
                        id={`${p.id}-max`}
                        value={p.maxMembers}
                        disabled={readOnly || !p.isActive}
                        onSave={(value) =>
                          ask({
                            title: value === null ? `Let any number of people be ${p.name}?` : `Allow at most ${value} ${p.name}${value === 1 ? '' : 's'}?`,
                            description: `${p.activeMembers} member${p.activeMembers === 1 ? '' : 's'} hold${p.activeMembers === 1 ? 's' : ''} it now.`,
                            confirmLabel: 'Save limit',
                            run: patch(p, { maxMembers: value }),
                          })
                        }
                      />
                    )}
                  </div>
                  {FLAGS.map((f) => (
                    <Toggle
                      key={f.key}
                      id={`${p.id}-${f.key}`}
                      label={f.label}
                      description={`Members can ${f.verb}.`}
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
              )}
            </li>
            );
          })}
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
                await api('/designations', { method: 'POST', body: { ...draft, maxMembers: parseLimit(draftLimit) ?? null } });
                setDraft({ name: '', canFileRequests: false, canCollect: false, isConfidentialExempt: false, canViewFunds: true, maxMembers: null });
                setDraftLimit('1');
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
          <div className="flex flex-col gap-2">
            {FLAGS.map((f) => (
              <Checkbox key={f.key} checked={draft[f.key]} onChange={(v) => setDraft({ ...draft, [f.key]: v })} label={f.label} />
            ))}
          </div>
          <Field
            label="Members allowed"
            htmlFor="new-position-max"
            className="max-w-[12rem]"
            hint="Leave empty for no limit."
            error={parseLimit(draftLimit) === undefined ? 'Use a whole number from 1 to 100.' : undefined}
          >
            <Input
              id="new-position-max"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              placeholder="No limit"
              value={draftLimit}
              invalid={parseLimit(draftLimit) === undefined}
              onChange={(e) => setDraftLimit(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={!draft.name.trim() || parseLimit(draftLimit) === undefined}>
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
    <ManagerCard title="Extra approvers" description="Who else may approve requests and receipts.">
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
            <p className="text-sm text-slate-500">Approved members can be added here.</p>
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
