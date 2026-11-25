import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { NotificationIcon, useOpenNotification } from '../components/notifications';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner, cx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime, timeAgo } from '../lib/format';
import type { AppNotification, NotificationPage } from '../lib/types';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
] as const;

/** "Today", "Yesterday" or the date, in Philippine time. */
function dayLabel(iso: string) {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d);
  const d = day(new Date(iso));
  if (d === day(new Date())) return 'Today';
  if (d === day(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return formatDate(iso);
}

export function NotificationsPage() {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const open = useOpenNotification();
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') === 'unread' ? 'unread' : 'all';
  const unread = useQuery({
    queryKey: ['notifications', ay?.id, 'unread'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count', { background: true }),
  });
  const list = useInfiniteQuery({
    queryKey: ['notifications', ay?.id, 'list', filter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<NotificationPage>(`/notifications?filter=${filter}&limit=30${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unreadCount = unread.data?.count ?? 0;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications', ay?.id] });
  async function toggleRead(n: AppNotification) {
    await api(`/notifications/${n.id}/${n.readAt ? 'unread' : 'read'}`, { method: 'POST' });
    await refresh();
  }
  async function markAll() {
    await api('/notifications/read-all', { method: 'POST' });
    await refresh();
  }

  // consecutive notices of the same day share a heading
  const groups: { label: string; items: AppNotification[] }[] = [];
  for (const n of items) {
    const label = dayLabel(n.createdAt);
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unreadCount ? `${unreadCount} unread` : 'You are all caught up.'}
        actions={
          unreadCount > 0 && (
            <Button variant="secondary" size="sm" onClick={markAll}>
              Mark all as read
            </Button>
          )
        }
      />
      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={filter === t.key}
            onClick={() => setParams(t.key === 'all' ? {} : { filter: t.key })}
            className={cx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium', filter === t.key ? 'bg-surface shadow-sm' : 'text-slate-600 hover:text-slate-900')}
          >
            {t.label}
            {t.key === 'unread' && unreadCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-xs text-white">{unreadCount}</span>}
          </button>
        ))}
      </div>
      <Card>
        {list.isLoading ? (
          <div className="p-8 text-center">
            <Spinner />
          </div>
        ) : list.error ? (
          <div className="p-4">
            <Alert>{errorMessage(list.error)}</Alert>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            body="Approvals, rejections and requests that need you show up here. The adviser chooses which events notify in Settings → Email & notifications."
          />
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.label}>
                <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</h2>
                <ul className="divide-y divide-slate-100">
                  {g.items.map((n) => (
                    <li key={n.id} className="flex items-start gap-1 pr-2 hover:bg-slate-50">
                      <button type="button" onClick={() => open(n)} className="flex min-w-0 flex-1 gap-3 px-4 py-3 text-left">
                        <NotificationIcon type={n.type} className={cx('mt-0.5', n.readAt ? 'text-slate-400' : 'text-brand-600')} />
                        <span className="min-w-0 flex-1">
                          <span className={cx('block text-sm', n.readAt ? 'text-slate-700' : 'font-medium text-slate-900')}>{n.title}</span>
                          {n.body && <span className="block text-sm text-slate-500">{n.body}</span>}
                          <span className="mt-0.5 block text-xs text-slate-400" title={formatDateTime(n.createdAt)}>
                            {timeAgo(n.createdAt)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleRead(n)}
                        className="mt-2 flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        aria-label={n.readAt ? `Mark “${n.title}” as unread` : `Mark “${n.title}” as read`}
                      >
                        <span className={cx('size-2 rounded-full', n.readAt ? 'border border-slate-300' : 'bg-brand-600')} aria-hidden />
                        <span className="hidden sm:inline">{n.readAt ? 'Mark unread' : 'Mark read'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {list.hasNextPage && (
              <div className="border-t border-slate-100 p-3 text-center">
                <Button variant="secondary" size="sm" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
                  Load older notifications
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
