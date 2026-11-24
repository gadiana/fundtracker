import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, PageHeader, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import type { Settings } from '../../lib/types';
import { BrandingEditor } from '../settings/sections';
import { useAdminAys } from './SystemLogPage';

/** Superadmin: the organization's name, description and logos, per academic year. */
export function OrganizationPage() {
  const ays = useAdminAys();
  const [picked, setPicked] = useState('');
  const ayId = picked || ays.data?.items.find((a) => a.isCurrent)?.id || ays.data?.items[0]?.id || '';
  const settings = useQuery({
    queryKey: ['admin-branding', ayId],
    enabled: Boolean(ayId),
    queryFn: () => api<Settings>(`/admin/branding/${ayId}`),
  });

  return (
    <>
      <PageHeader
        title="Organization"
        actions={
          <Select aria-label="Academic year" value={ayId} onChange={(e) => setPicked(e.target.value)} className="w-48">
            {ays.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                AY {a.label}
                {a.isCurrent ? ' · current' : ''}
              </option>
            ))}
          </Select>
        }
      />
      {ays.isLoading || settings.isLoading ? (
        <div className="py-10 text-center">
          <Spinner />
        </div>
      ) : settings.error || !settings.data ? (
        <Alert>{errorMessage(settings.error)}</Alert>
      ) : (
        <div className="max-w-3xl space-y-6">
          <BrandingEditor key={ayId} settings={settings.data} ayId={ayId} />
        </div>
      )}
    </>
  );
}
