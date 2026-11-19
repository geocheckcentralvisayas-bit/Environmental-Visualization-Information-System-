/**
 * Base URL of the ENVIS API.
 *
 * In development the Vite server proxies `/api` to the local Worker. For the
 * published site set `VITE_API_BASE` at build time to the Worker URL, e.g.
 * `https://envis-region-vii-api.<account>.workers.dev/api`.
 */
const RAW_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
export const API_BASE = RAW_BASE.replace(/\/+$/, '');

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (HTTP ${response.status})`);
  }
  return (await response.json()) as T;
}

/** URL for a dataset served by the authenticated API. */
export function dataUrl(file: string): string {
  return `${API_BASE}/data/${file.replace(/^\/+/, '')}`;
}
