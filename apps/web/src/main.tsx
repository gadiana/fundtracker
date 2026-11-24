import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import './index.css';

const SESSION_ENDED: Record<string, string> = { SESSION_TIMEOUT: 'timeout', SESSION_ENDED: 'ended', UNAUTHENTICATED: 'ended' };

/** Any 401 after login means the session is gone: go back to the login page. */
function handleAuthError(error: unknown) {
  if (error instanceof ApiError && error.status === 401 && SESSION_ENDED[error.code] && !location.pathname.startsWith('/login')) {
    location.assign(`/login?reason=${SESSION_ENDED[error.code]}`);
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
