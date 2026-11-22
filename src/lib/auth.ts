import { apiFetch, apiJson } from './api';

export type Role = 'extraction' | 'rd' | 'emed' | 'cpd' | 'mis' | 'viewer' | 'gis';

export interface Session {
  username: string;
  role: Role;
  displayName: string;
  division: string;
  at: number;
}

/** Account as returned by the admin API. Password hashes never leave the server. */
export interface StoredAccount {
  username: string;
  role: Role;
  displayName: string;
  division: string;
  active: boolean;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ActivityType =
  | 'login'
  | 'login-failed'
  | 'logout'
  | 'export'
  | 'geojson'
  | 'account-add'
  | 'account-update'
  | 'account-delete'
  | 'password-change'
  | 'role-change';

export interface ActivityEntry {
  id: number;
  at: number;
  type: ActivityType;
  username: string;
  role: Role | 'unknown';
  detail: string;
}

export const ROLES: Role[] = ['extraction', 'rd', 'emed', 'cpd', 'mis', 'viewer', 'gis'];

/**
 * The API stores the session in an HttpOnly cookie, so the browser cannot read
 * it. We keep the last server response in memory for the synchronous helpers
 * used across the UI; it is refreshed on boot by `loadSession()`.
 */
let cachedSession: Session | null = null;

/** Must match the worker's SESSION_TTL_HOURS default; failing closed if the server uses a longer TTL is safe. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function getSession(): Session | null {
  if (cachedSession && cachedSession.at + SESSION_TTL_MS <= Date.now()) {
    cachedSession = null;
  }
  return cachedSession;
}

export async function loadSession(): Promise<Session | null> {
  try {
    const response = await apiFetch('/session');
    if (!response.ok) {
      cachedSession = null;
      return null;
    }
    cachedSession = (await response.json()) as Session;
    return cachedSession;
  } catch {
    cachedSession = null;
    return null;
  }
}

export async function login(username: string, password: string): Promise<Session | null> {
  let response: Response;
  try {
    response = await apiFetch('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error('Cannot reach the sign-in service. Start `npm run api:dev` or check the deployed Worker.');
  }
  // 401 is the only status that means the credentials were wrong; anything
  // else is an environment problem and must not be reported as bad credentials.
  if (response.status === 401) return null;
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (response.status >= 500 && !body?.error) {
      throw new Error('Cannot reach the sign-in service. Start `npm run api:dev` or check the deployed Worker.');
    }
    throw new Error(body?.error || `Sign-in failed (HTTP ${response.status}).`);
  }
  cachedSession = (await response.json()) as Session;
  return cachedSession;
}

export async function logout(): Promise<void> {
  cachedSession = null;
  try {
    const response = await apiFetch('/logout', { method: 'POST' });
    if (!response.ok) throw new Error(`Logout failed (HTTP ${response.status})`);
  } catch (error) {
    // The server may have already revoked the session (the cookie is what
    // matters); always clear local state so the UI never stays signed in.
    console.warn('Server logout failed; local session cleared anyway.', error);
  }
}

/**
 * Re-authenticate for a privileged action without replacing the current
 * session. Used by the export and GeoJSON download gates.
 */
export async function verifyCredentials(
  username: string,
  password: string,
  purpose: 'export' | 'geojson',
): Promise<{ ok: boolean; message?: string }> {
  const response = await apiFetch('/verify', {
    method: 'POST',
    body: JSON.stringify({ username, password, purpose }),
  });
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return { ok: false, message: body?.error || 'Authorised account required.' };
}

export function canExport(session: Session | null): boolean {
  return session?.role === 'extraction' || session?.role === 'mis';
}

export function canDownloadGeoJson(session: Session | null): boolean {
  return session?.role === 'gis';
}

export function canManageAccounts(session: Session | null): boolean {
  return session?.role === 'mis';
}

/* ------------------------------------------------------------------ */
/* admin                                                               */
/* ------------------------------------------------------------------ */

export async function listAccounts(): Promise<StoredAccount[]> {
  const body = await apiJson<{ accounts: StoredAccount[] }>('/admin/accounts');
  return body.accounts;
}

export async function addAccount(input: {
  username: string;
  displayName: string;
  division: string;
  role: Role;
  password: string;
}): Promise<void> {
  await apiJson('/admin/accounts', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateAccount(
  username: string,
  changes: { displayName?: string; division?: string; role?: Role; active?: boolean },
): Promise<void> {
  await apiJson(`/admin/accounts/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export async function setAccountActive(username: string, active: boolean): Promise<void> {
  await updateAccount(username, { active });
}

export async function setAccountPassword(username: string, password: string): Promise<void> {
  await apiJson(`/admin/accounts/${encodeURIComponent(username)}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function deleteAccount(username: string): Promise<void> {
  await apiJson(`/admin/accounts/${encodeURIComponent(username)}`, { method: 'DELETE' });
}

export async function listActivity(type?: ActivityType | 'all', limit = 500): Promise<ActivityEntry[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (type && type !== 'all') query.set('type', type);
  const body = await apiJson<{ activity: ActivityEntry[] }>(`/admin/activity?${query.toString()}`);
  return body.activity;
}

export async function clearActivity(): Promise<void> {
  await apiJson('/admin/activity', { method: 'DELETE' });
}

export function exportAccountsJson(accounts: StoredAccount[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      note: 'Password hashes are not included. Import accepts records with either password or passwordHash.',
      accounts: accounts.map(({ username, role, displayName, division, active, builtin, createdAt, updatedAt }) => ({
        username, role, displayName, division, active, builtin, createdAt, updatedAt,
      })),
    },
    null,
    2,
  );
}

export async function importAccountsJson(text: string): Promise<{ added: number; updated: number; skipped: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const accounts = Array.isArray(parsed)
    ? parsed
    : (parsed as { accounts?: unknown })?.accounts;
  if (!Array.isArray(accounts)) throw new Error('No accounts array found in that file.');

  return apiJson('/admin/accounts/import', {
    method: 'POST',
    body: JSON.stringify({ accounts }),
  });
}
