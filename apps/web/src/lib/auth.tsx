import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@sft/shared';
import { api, ApiError, setApiAcademicYear } from './api';
import type { AyEntry, Me } from './types';

const AY_STORAGE_KEY = 'sft.selectedAy';

function readStoredAy() {
  try {
    return localStorage.getItem(AY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeAy(id: string) {
  try {
    localStorage.setItem(AY_STORAGE_KEY, id);
  } catch {
    /* private mode: selection just won't persist */
  }
}

interface AuthValue {
  me: Me | null;
  loading: boolean;
  /** The academic year the whole UI is working in. */
  ay: AyEntry | null;
  membership: AyEntry['membership'];
  isActiveMember: boolean;
  can: (p: Permission) => boolean;
  switchAy: (id: string) => void;
  setMe: (me: Me | null) => void;
  refreshMe: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ayId, setAyId] = useState<string | null>(readStoredAy);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  const me = meQuery.data ?? null;

  const ay = useMemo(() => {
    if (!me) return null;
    return (
      me.academicYears.find((a) => a.id === ayId) ??
      me.academicYears.find((a) => a.id === me.currentAyId) ??
      me.academicYears[0] ??
      null
    );
  }, [me, ayId]);

  // set synchronously so the very first queries already carry the AY header
  setApiAcademicYear(ay?.id ?? null);

  const switchAy = useCallback(
    (id: string) => {
      storeAy(id);
      setAyId(id);
      setApiAcademicYear(id);
      // nothing from one AY may linger on screen in another
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
    [queryClient],
  );

  const setMe = useCallback((value: Me | null) => queryClient.setQueryData(['me'], value), [queryClient]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      queryClient.clear();
      queryClient.setQueryData(['me'], null);
    }
  }, [queryClient]);

  const membership = ay?.membership ?? null;
  const permissions = membership?.status === 'active' ? membership.permissions : [];

  const value: AuthValue = {
    me,
    loading: meQuery.isLoading,
    ay,
    membership,
    isActiveMember: membership?.status === 'active',
    can: (p) => permissions.includes(p),
    switchAy,
    setMe,
    refreshMe: () => meQuery.refetch(),
    logout,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
