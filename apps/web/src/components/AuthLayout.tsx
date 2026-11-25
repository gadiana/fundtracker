import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api';
import type { PublicInfo } from '../lib/types';

export const usePublicInfo = () =>
  useQuery({ queryKey: ['public-info'], queryFn: () => api<PublicInfo>('/public/info'), staleTime: 5 * 60_000 });

/** Shell for the logged-out pages: org branding on top, one card below. */
export function AuthLayout({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  const { data: info } = usePublicInfo();
  const org = info?.org;

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-8 sm:py-12">
      <div className={`mx-auto w-full ${wide ? 'max-w-xl' : 'max-w-sm'}`}>
        <Link to="/login" className="mb-6 flex items-center gap-3">
          {org?.logoUrl ? (
            <img src={org.logoUrl} alt="" className="size-11 shrink-0 rounded-xl object-contain" />
          ) : (
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">
              {(org?.abbr || org?.name || 'F').slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{org?.name || 'Fund Tracker'}</p>
            <p className="truncate text-xs text-slate-500">
              {[org?.collegeAbbr, org?.schoolAbbr].filter(Boolean).join(' · ') || 'Student Organization Fund Tracker'}
              {info?.academicYear && ` · AY ${info.academicYear.label}`}
            </p>
          </div>
        </Link>
        <div className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm sm:p-6">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
