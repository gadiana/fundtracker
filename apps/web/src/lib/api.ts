export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
  }

  /** Per-field messages from a server-side validation error. */
  get fieldErrors(): Record<string, string> {
    const fields = this.details?.fieldErrors as Record<string, string[]> | undefined;
    if (!fields) return {};
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0] ?? 'Invalid']));
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Polling: doesn't count as activity for the idle-session timeout. */
  background?: boolean;
}

let csrfToken: string | null = null;
let selectedAyId: string | null = null;
let refreshing: Promise<boolean> | null = null;

/** Every request carries the academic year selected in the AY switcher. */
export function setApiAcademicYear(id: string | null) {
  selectedAyId = id;
}

async function getCsrfToken() {
  if (!csrfToken) {
    const res = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    csrfToken = (await res.json()).csrfToken as string;
  }
  return csrfToken;
}

async function send(path: string, opts: RequestOptions) {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = await getCsrfToken();
  if (selectedAyId) headers['X-AY-Id'] = selectedAyId;
  if (opts.background) headers['X-Background'] = '1';
  return fetch(`/api${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
}

function refreshSession() {
  refreshing ??= send('/auth/refresh', { method: 'POST' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function errorCode(res: Response) {
  const body = await res
    .clone()
    .json()
    .catch(() => null);
  return body?.error?.code as string | undefined;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts);

  // short-lived access token expired: refresh once, then retry
  if (res.status === 401 && path !== '/auth/refresh' && path !== '/auth/login' && (await errorCode(res)) === 'TOKEN_EXPIRED') {
    if (await refreshSession()) res = await send(path, opts);
  }
  // CSRF cookie was cleared or rotated: fetch a new token, then retry
  if (res.status === 403 && (await errorCode(res)) === 'CSRF') {
    csrfToken = null;
    res = await send(path, opts);
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? `HTTP_${res.status}`,
      data?.error?.message ?? 'Request failed. Please try again.',
      data?.error?.details,
    );
  }
  return data as T;
}

/** Multipart upload of one file (field name "file"). */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = { Accept: 'application/json', 'X-CSRF-Token': await getCsrfToken() };
  if (selectedAyId) headers['X-AY-Id'] = selectedAyId;
  const res = await fetch(`/api${path}`, { method: 'POST', headers, body: form, credentials: 'same-origin' });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? `HTTP_${res.status}`, data?.error?.message ?? 'Upload failed.', data?.error?.details);
  }
  return data as T;
}

/** Validation errors as one readable sentence, using friendly field names when given. */
export function describeError(err: unknown, labels: Record<string, string> = {}) {
  if (err instanceof ApiError) {
    const fields = Object.entries(err.fieldErrors);
    if (fields.length) return fields.map(([k, v]) => `${labels[k] ?? k}: ${v}`).join(' · ');
    if (Array.isArray(err.details?.issues)) return `${err.message} ${err.details.issues.join(', ')}`;
  }
  return errorMessage(err);
}

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.';
