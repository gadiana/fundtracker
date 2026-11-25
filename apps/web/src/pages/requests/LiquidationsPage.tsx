import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Inbox, ReceiptText } from 'lucide-react';
import { PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { FundRequestRow } from '../../lib/types';
import { RequestList, Tabs, useRequestCounts } from './RequestsPage';

/** Approved requests and their receipts: liquidating them, reviewing them, and settling the change. */
export function LiquidationsPage() {
  const { ay, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const counts = useRequestCounts().data;
  const tabs = [
    ...(can('file_requests') ? [{ key: 'mine', label: 'My liquidations', count: counts?.toLiquidate ?? 0 }] : []),
    { key: 'inbox', label: 'To review', count: counts?.liquidations ?? 0 },
    ...(can('manage') ? [{ key: 'all', label: 'All liquidations', count: 0 }] : []),
  ];
  const scope = tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0]!.key;
  const list = useQuery({
    queryKey: ['fund-requests', ay?.id, 'liquidations', scope],
    queryFn: () => api<{ items: FundRequestRow[] }>(`/fund-requests?scope=${scope}&stage=liquidation`),
  });

  return (
    <>
      <PageHeader title="Liquidations" description="Receipts for approved fund requests, and the change returned or reimbursed." />
      <Tabs tabs={tabs} current={scope} onChange={(tab) => setParams({ tab })} />
      <RequestList
        list={list}
        to={(r) => `/liquidations/${r.id}`}
        emptyIcon={scope === 'inbox' ? Inbox : ReceiptText}
        emptyTitle={scope === 'inbox' ? 'Nothing waiting for you' : 'No liquidations yet'}
        emptyBody={
          scope === 'inbox'
            ? 'Receipts to review and change to record appear here.'
            : scope === 'mine'
              ? 'Once a fund request of yours is approved, liquidate it here with the receipts.'
              : 'Approved fund requests appear here.'
        }
        hint={(r) =>
          scope === 'mine' && r.status === 'approved' ? 'Needs liquidation' : scope === 'mine' && r.status === 'revision_requested' ? 'Revise and resubmit' : null
        }
      />
    </>
  );
}
