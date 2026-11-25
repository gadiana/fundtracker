import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, GraduationCap, QrCode, Search, UserPlus } from 'lucide-react';
import { ClearanceBadge } from '../../components/ChargesCard';
import { StudentEditorModal } from '../../components/StudentEditorModal';
import { useToast } from '../../components/Toast';
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, cx } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { yearLevelLabel } from '../../lib/format';
import type { Student, StudentMeta, StudentSummary } from '../../lib/types';

const TABS = [
  { key: 'active', label: 'Active', query: { status: 'active' } },
  { key: 'pending', label: 'Pending approval', query: { status: 'pending' } },
  { key: 'confirm', label: 'Needs confirmation', query: { status: 'active', flag: 'needs_confirmation' } },
  { key: 'duplicates', label: 'Possible duplicates', query: { flag: 'duplicates' } },
  { key: 'inactive', label: 'Deactivated', query: { status: 'inactive' } },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const PAGE_SIZE = 50;

export function StudentBadges({ s }: { s: Student }) {
  return (
    <>
      {s.status === 'active' && s.clearance && s.clearance.totalDue > 0 && <ClearanceBadge cleared={s.clearance.isCleared} />}
      {s.status === 'pending' && <Badge tone="amber">Pending</Badge>}
      {s.status === 'inactive' && <Badge>Deactivated</Badge>}
      {s.status === 'rejected' && <Badge tone="red">Rejected</Badge>}
      {s.needsProfileConfirmation && s.status === 'active' && <Badge tone="blue">Confirm course/year</Badge>}
      {s.duplicateFlag === 'exact' && <Badge tone="red">{s.duplicateOverride ? 'Same name (reviewed)' : 'Same name'}</Badge>}
      {s.duplicateFlag === 'similar' && <Badge tone="amber">Similar name</Badge>}
    </>
  );
}

export const cys = (s: Student) => `${s.program.code} ${s.yearLevel}${s.section ? `-${s.section.name}` : ''}`;

export function useStudentMeta() {
  const { ay } = useAuth();
  return useQuery({ queryKey: ['student-meta', ay?.id], queryFn: () => api<StudentMeta>('/students/meta') });
}

export function StudentsPage() {
  const { ay } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'active') as TabKey;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [filters, setFilters] = useState({ programId: '', yearLevel: '', sectionId: '', sort: 'name' });
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const readOnly = ay?.status === 'closed';

  const meta = useStudentMeta();
  const summary = useQuery({ queryKey: ['students', ay?.id, 'summary'], queryFn: () => api<StudentSummary>('/students/summary') });

  const query = new URLSearchParams({ ...TABS.find((t) => t.key === tab)!.query, page: String(page), pageSize: String(PAGE_SIZE) });
  if (search.trim()) query.set('q', search.trim());
  if (filters.programId) query.set('programId', filters.programId);
  if (filters.yearLevel) query.set('yearLevel', filters.yearLevel);
  if (filters.sectionId) query.set('sectionId', filters.sectionId);
  query.set('sort', filters.sort);

  const list = useQuery({
    queryKey: ['students', ay?.id, 'list', query.toString()],
    queryFn: () => api<{ total: number; items: Student[] }>(`/students?${query}`),
    placeholderData: keepPreviousData,
  });

  const counts: Record<TabKey, number | undefined> = {
    active: summary.data?.active,
    pending: summary.data?.pending,
    confirm: summary.data?.needsConfirmation,
    duplicates: summary.data?.duplicateGroups,
    inactive: summary.data?.inactive,
  };
  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  const setFilter = (key: keyof typeof filters) => (e: ChangeEvent<HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Students"
        
        actions={
          !readOnly && (
            <>
              <Link to="/students/enrollment" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-medium hover:bg-slate-50">
                <QrCode className="size-4" aria-hidden /> Enrollment QR
              </Link>
              <Link to="/students/import" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-surface px-4 text-sm font-medium hover:bg-slate-50">
                <FileUp className="size-4" aria-hidden /> Import CSV
              </Link>
              <Button onClick={() => setAdding(true)} disabled={!meta.data}>
                <UserPlus className="size-4" aria-hidden /> Add student
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Student lists">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setParams({ tab: t.key });
              setPage(1);
            }}
            className={cx(
              'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
              tab === t.key ? 'bg-surface text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {t.label}
            {(counts[t.key] ?? 0) > 0 && (
              <span className={cx('rounded-full px-1.5 text-xs', t.key === 'active' || t.key === 'inactive' ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-800')}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      <Card className="mb-4 grid gap-3 p-3 sm:grid-cols-[1fr_repeat(3,9rem)] lg:grid-cols-[1fr_repeat(3,9rem)_11rem]">
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Search name or student number"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <Select aria-label="Program" value={filters.programId} onChange={setFilter('programId')}>
          <option value="">All programs</option>
          {meta.data?.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code}
            </option>
          ))}
        </Select>
        <Select aria-label="Year level" value={filters.yearLevel} onChange={setFilter('yearLevel')}>
          <option value="">All years</option>
          {Array.from({ length: meta.data?.yearLevelCount ?? 4 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {yearLevelLabel(n)}
            </option>
          ))}
        </Select>
        <Select aria-label="Section" value={filters.sectionId} onChange={setFilter('sectionId')}>
          <option value="">All sections</option>
          {meta.data?.sections.map((s) => (
            <option key={s.id} value={s.id}>
              Section {s.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Sort by" value={filters.sort} onChange={setFilter('sort')} className="sm:col-span-full lg:col-span-1">
          <option value="name">Name (A–Z)</option>
          <option value="name_desc">Name (Z–A)</option>
          <option value="number">Student no. (lowest first)</option>
          <option value="number_desc">Student no. (highest first)</option>
        </Select>
      </Card>

      {tab === 'duplicates' && (
        <Alert tone="warning" className="mb-4">
          Students in this academic year who share a name but have different student numbers. Open each one to check. Same-name records the adviser
          already reviewed are marked “reviewed”.
        </Alert>
      )}
      {tab === 'confirm' && (
        <Alert tone="info" className="mb-4">
          Copied from last year one level up. Confirm each one’s course, year and section before collecting.
        </Alert>
      )}

      <Card>
        {list.isLoading ? (
          <div className="p-8 text-center">
            <Spinner />
          </div>
        ) : list.error ? (
          <div className="p-4">
            <Alert>{errorMessage(list.error)}</Alert>
          </div>
        ) : list.data?.items.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No students here"
            body={tab === 'active' && !search ? 'Add students one by one, import a CSV file, or share the enrollment QR.' : undefined}
          />
        ) : (
          <>
            <ul className="divide-y divide-slate-100 md:hidden">
              {list.data?.items.map((s) => (
                <li key={s.id}>
                  <Link to={`/students/${s.id}`} className="block space-y-1 p-4 hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-slate-900">{s.name}</p>
                      <span className="font-mono text-xs text-slate-500">{s.studentNumber}</span>
                    </div>
                    <p className="text-sm text-slate-500">{cys(s)}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <StudentBadges s={s} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Student no.</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Course / year / section</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data?.items.map((s) => (
                  <tr key={s.id} onClick={() => navigate(`/students/${s.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{s.studentNumber}</td>
                    <td className="px-4 py-3">
                      <Link to={`/students/${s.id}`} className="font-medium text-slate-900 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{cys(s)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <StudentBadges s={s} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      {list.data && list.data.total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page} of {totalPages} · {list.data.total} students
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {adding && meta.data && (
        <StudentEditorModal
          meta={meta.data}
          onClose={() => setAdding(false)}
          onSaved={async (s) => {
            setAdding(false);
            await queryClient.invalidateQueries({ queryKey: ['students', ay?.id] });
            toast(`${s.name} was added.`);
          }}
        />
      )}
    </>
  );
}
