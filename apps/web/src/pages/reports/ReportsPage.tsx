import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileBarChart, Search } from 'lucide-react';
import { FUND_REQUEST_STATUSES, FUND_REQUEST_STATUS_LABELS, REPORT_TITLES, type ReportKind } from '@sft/shared';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { yearLevelLabel } from '../../lib/format';
import type { Student } from '../../lib/types';
import { useHistoryOptions, type HistoryOptions } from './HistoryPage';

/** Opens a report in a new tab, laid out for printing, with PDF and CSV downloads. */
function openReport(kind: ReportKind, params: Record<string, string>) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  window.open(`/print/report/${kind}?${q}`, '_blank', 'noopener');
}

function ReportCard({ kind, description, children, onOpen, disabled }: { kind: ReportKind; description: string; children?: ReactNode; onOpen: () => void; disabled?: boolean }) {
  return (
    <Card className="flex flex-col p-5">
      <h2 className="font-semibold">{REPORT_TITLES[kind]}</h2>
      <p className="mb-4 text-sm text-slate-600">{description}</p>
      <div className="flex-1 space-y-3">{children}</div>
      <div className="mt-4 flex justify-end">
        <Button onClick={onOpen} disabled={disabled}>
          <ExternalLink className="size-4" aria-hidden /> Open report
        </Button>
      </div>
    </Card>
  );
}

function Dates({ v, set }: { v: Record<string, string>; set: (k: string, x: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="From" htmlFor={`${v.id}-from`} optional>
        <Input id={`${v.id}-from`} type="date" value={v.from ?? ''} max={v.to || undefined} onChange={(e) => set('from', e.target.value)} />
      </Field>
      <Field label="To" htmlFor={`${v.id}-to`} optional>
        <Input id={`${v.id}-to`} type="date" value={v.to ?? ''} min={v.from || undefined} onChange={(e) => set('to', e.target.value)} />
      </Field>
    </div>
  );
}

function Placement({ o, v, set }: { o: HistoryOptions; v: Record<string, string>; set: (k: string, x: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Select aria-label="Program" value={v.programId ?? ''} onChange={(e) => set('programId', e.target.value)}>
        <option value="">All programs</option>
        {o.programs.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code}
          </option>
        ))}
      </Select>
      <Select aria-label="Year level" value={v.yearLevel ?? ''} onChange={(e) => set('yearLevel', e.target.value)}>
        <option value="">All years</option>
        {Array.from({ length: o.yearLevelCount }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {yearLevelLabel(n)}
          </option>
        ))}
      </Select>
      <Select aria-label="Section" value={v.sectionId ?? ''} onChange={(e) => set('sectionId', e.target.value)}>
        <option value="">All sections</option>
        {o.sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

const useForm = (id: string) => {
  const [v, setV] = useState<Record<string, string>>({ id });
  return [v, (k: string, x: string) => setV((cur) => ({ ...cur, [k]: x }))] as const;
};
const params = ({ id: _id, ...rest }: Record<string, string>) => rest;

export function ReportsPage() {
  const options = useHistoryOptions();
  const [collections, setCollections] = useForm('col');
  const [usage, setUsage] = useForm('use');
  const [fund, setFund] = useForm('fund');
  const [clearance, setClearance] = useForm('clr');

  if (options.isLoading) {
    return (
      <div className="py-10 text-center">
        <Spinner />
      </div>
    );
  }
  if (options.error || !options.data) return <Alert>{describeError(options.error)}</Alert>;
  const o = options.data;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Printable reports with the organization’s header and signatories (Settings → Reports). Each opens in a new tab, where you can print it or download it as PDF or CSV."
      />
      {!o.canSeeCollections && !o.canSeeUsage ? (
        <Card>
          <EmptyState icon={FileBarChart} title="No reports for your position" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {o.canSeeUsage && <LiquidationCard />}
          {o.canSeeCollections && (
            <ReportCard kind="collections" description="Per fund, day and staff, with every transaction." onOpen={() => openReport('collections', params(collections))}>
              <Dates v={collections} set={setCollections} />
              <Placement o={o} v={collections} set={setCollections} />
              <Select aria-label="Status" value={collections.status ?? ''} onChange={(e) => setCollections('status', e.target.value)}>
                <option value="">Posted and voided payments</option>
                <option value="posted">Posted only</option>
                <option value="voided">Voided only</option>
              </Select>
            </ReportCard>
          )}
          {o.canSeeUsage && (
            <ReportCard kind="fund-usage" description="Requests filed, approved and actually used." onOpen={() => openReport('fund-usage', params(usage))}>
              <Dates v={usage} set={setUsage} />
              <div className="grid grid-cols-2 gap-2">
                <Select aria-label="Fund" value={usage.fundId ?? ''} onChange={(e) => setUsage('fundId', e.target.value)}>
                  <option value="">All funds</option>
                  {o.funds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Status" value={usage.status ?? ''} onChange={(e) => setUsage('status', e.target.value)}>
                  <option value="">All statuses</option>
                  {FUND_REQUEST_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {FUND_REQUEST_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
            </ReportCard>
          )}
          {o.canSeeCollections && (
            <ReportCard
              kind="fund"
              description="Ledger with running balance, and who still owes."
              onOpen={() => openReport('fund', params(fund))}
              disabled={!fund.fundId}
            >
              <Field label="Fund" htmlFor="fund-pick">
                <Select id="fund-pick" value={fund.fundId ?? ''} onChange={(e) => setFund('fundId', e.target.value)}>
                  <option value="">Choose a fund…</option>
                  {o.funds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Dates v={fund} set={setFund} />
            </ReportCard>
          )}
          {o.canSeeCollections && <StatementCard />}
          {o.canSeeCollections && (
            <ReportCard kind="clearance" description="By course, year and section." onOpen={() => openReport('clearance', params(clearance))}>
              <Placement o={o} v={clearance} set={setClearance} />
              <Select aria-label="Students" value={clearance.status ?? ''} onChange={(e) => setClearance('status', e.target.value)}>
                <option value="">Cleared and with balance</option>
                <option value="has_balance">With balance only</option>
                <option value="cleared">Cleared only</option>
              </Select>
            </ReportCard>
          )}
        </div>
      )}
    </>
  );
}

interface RequestRow {
  id: string;
  requestNo: string;
  fundName: string;
  purpose: string;
  statusLabel: string;
  fundUsed: number | null;
}

/** Every fund request with a liquidation the user may open (the adviser: all of them, archived too). */
function LiquidationCard() {
  const { ay, can } = useAuth();
  const [requestId, setRequestId] = useState('');
  const scope = can('manage') ? 'all' : 'mine';
  const requests = useQuery({
    queryKey: ['fund-requests', ay?.id, 'liquidated', scope],
    queryFn: async () => {
      const [open, archived] = await Promise.all(
        [scope, 'archived'].map((s) => api<{ items: RequestRow[] }>(`/fund-requests?scope=${s}`)),
      );
      return [...open!.items, ...archived!.items].filter((r) => r.fundUsed !== null);
    },
  });
  return (
    <ReportCard
      kind="liquidation"
      description="Every receipt and item of one fund request against the approved amount. The receipts are printed on the last pages."
      onOpen={() => openReport('liquidation', { requestId })}
      disabled={!requestId}
    >
      <Field label="Fund request" htmlFor="liq-pick">
        <Select id="liq-pick" value={requestId} onChange={(e) => setRequestId(e.target.value)} disabled={requests.isLoading}>
          <option value="">{requests.isLoading ? 'Loading…' : requests.data?.length ? 'Choose a request…' : 'No liquidated requests yet'}</option>
          {requests.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.requestNo} · {r.fundName} · {r.purpose.length > 40 ? `${r.purpose.slice(0, 40)}…` : r.purpose} ({r.statusLabel})
            </option>
          ))}
        </Select>
      </Field>
      {requests.error && <Alert>{describeError(requests.error)}</Alert>}
    </ReportCard>
  );
}

function StatementCard() {
  const { ay } = useAuth();
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Student | null>(null);
  const search = useQuery({
    queryKey: ['students', ay?.id, 'statement-search', q],
    enabled: q.trim().length >= 2,
    queryFn: () => api<{ items: Student[] }>(`/students?q=${encodeURIComponent(q.trim())}&pageSize=8`),
  });
  return (
    <ReportCard
      kind="student-statement"
      description="Charges, payments and balance."
      onOpen={() => chosen && openReport('student-statement', { studentId: chosen.id })}
      disabled={!chosen}
    >
      <Field label="Student" htmlFor="stmt-search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            id="stmt-search"
            className="pl-9"
            placeholder="Name or student number"
            value={chosen ? `${chosen.name} (${chosen.studentNumber})` : q}
            onChange={(e) => {
              setChosen(null);
              setQ(e.target.value);
            }}
          />
        </div>
      </Field>
      {!chosen && q.trim().length >= 2 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {search.isLoading && (
            <li className="p-3 text-center">
              <Spinner />
            </li>
          )}
          {search.data?.items.length === 0 && <li className="p-3 text-sm text-slate-500">No students match.</li>}
          {search.data?.items.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setChosen(s)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                {s.name} <span className="text-slate-500">· {s.studentNumber}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ReportCard>
  );
}
