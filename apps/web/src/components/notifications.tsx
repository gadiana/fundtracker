import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, FileText, GraduationCap, Receipt, UserPlus, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import type { AppNotification, NotificationPage } from '../lib/types';
import { Spinner, cx } from './ui';

/** An icon per kind of event (the part of the type before the dot). */
export function NotificationIcon({ type, className }: { type: string; className?: string }) {
  const Icon =
    { membership: UserPlus, student: GraduationCap, fund_request: FileText, liquidation: Receipt, payment: Wallet }[type.split('.')[0]!] ?? Bell;
  return <Icon className={cx('size-4 shrink-0', className)} aria-hidden />;
}

/** Marks a notice read (when it isn't yet) and follows its link. */
export function useOpenNotification() {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (n: AppNotification) => {
    if (!n.readAt) {
      await api(`/notifications/${n.id}/read`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['notifications', ay?.id] });
    }
    if (n.linkPath) navigate(n.linkPath);
  };
}

/** The bell in the header: the unread count and the latest notices in a dropdown. */
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const { ay } = useAuth();
  const queryClient = useQueryClient();
  const open = useOpenNotification();
  const [shown, setShown] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const latest = useQuery({
    queryKey: ['notifications', ay?.id, 'latest'],
    queryFn: () => api<NotificationPage>('/notifications?limit=6'),
    enabled: shown,
  });

  useEffect(() => {
    if (!shown) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setShown(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShown(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [shown]);

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: ['notifications', ay?.id] });
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={shown}
        aria-haspopup="dialog"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {shown && (
        <div
          role="dialog"
          aria-label="Latest notifications"
          className="fixed inset-x-2 top-14 z-40 overflow-hidden rounded-xl bg-surface shadow-xl ring-1 ring-slate-200 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unreadCount > 0 && (
              <button type="button" onClick={markAll} className="text-xs font-medium text-brand-700 hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          {latest.isLoading ? (
            <div className="p-6 text-center">
              <Spinner />
            </div>
          ) : !latest.data?.items.length ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {latest.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={async () => {
                      setShown(false);
                      await open(n);
                    }}
                    className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
                  >
                    <NotificationIcon type={n.type} className={cx('mt-0.5', n.readAt ? 'text-slate-400' : 'text-brand-600')} />
                    <span className="min-w-0 flex-1">
                      <span className={cx('block truncate text-sm', !n.readAt && 'font-medium')}>{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-slate-500">{n.body}</span>}
                      <span className="block text-xs text-slate-400">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link to="/notifications" onClick={() => setShown(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-slate-50">
            See all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
