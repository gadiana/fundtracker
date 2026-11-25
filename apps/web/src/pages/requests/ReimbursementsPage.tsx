import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { HandCoins, Inbox } from 'lucide-react';
import { PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney } from '../../lib/format';
import type { FundRequestRow } from '../../lib/types';
import { RequestList, Tabs, useRequestCounts } from './RequestsPage';

/**
 * Money the fund owes back: a requestor spent more than approved and the approver accepted it.
 * The adviser or treasurer pays them and marks it here; the requestor sees what is owed to them.
 */
export function ReimbursementsPage() {
  const { ay, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const counts = useRequestCounts().data;
  const pays = can('manage') || can('collect');
  const tabs = [
    ...(pays ? [{ key: 'inbox', label: 'To pay', count: counts?.reimbursements ?? 0 }] : []),
    ...(can('file_requests') ? [{ key: 'mine', label: 'Owed to me', count: 0 }] : []),
    ...(can('manage') ? [{ key: 'all', label: 'All reimbursements', count: 0 }] : []),
  ];
  const scope = tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0]?.key ?? 'mine';
  const list = useQuery({
    queryKey: ['fund-requests', ay?.id, 'reimbursements', scope],
    queryFn: () => api<{ items: FundRequestRow[] }>(`/fund-requests?scope=${scope}&stage=reimbursement`),
  });

  return (
    <>
      <PageHeader title="Reimbursements" description="When more was spent than approved and the fund pays the requestor back." />
      {tabs.length > 1 && <Tabs tabs={tabs} current={scope} onChange={(tab) => setParams({ tab })} />}
      <RequestList
        list={list}
        to={(r) => `/liquidations/${r.id}`}
        emptyIcon={scope === 'inbox' ? Inbox : HandCoins}
        emptyTitle={scope === 'inbox' ? 'Nothing to pay' : 'No reimbursements'}
        emptyBody={
          scope === 'inbox'
            ? 'Requestors waiting to be paid back appear here.'
            : scope === 'mine'
              ? 'When an approver accepts that you spent more than approved, what the fund owes you appears here.'
              : 'Reimbursements owed and paid appear here.'
        }
        hint={(r) =>
          !r.settlement
            ? null
            : r.status === 'settlement_due'
              ? `${formatMoney(r.settlement.amount)} to reimburse`
              : { text: `${formatMoney(r.settlement.amount)} reimbursed${r.settlement.settledAt ? ` ${formatDate(r.settlement.settledAt)}` : ''}`, tone: 'green' }
        }
        action={(r) =>
          r.needsMyAction &&
          r.status === 'settlement_due' &&
          ay?.status === 'open' && (
            <Link
              to={`/liquidations/${r.id}?settle=1`}
              className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700"
            >
              <HandCoins className="size-4" aria-hidden /> Mark as reimbursed
            </Link>
          )
        }
      />
    </>
  );
}
