import type { AccountRow, AuthContext, Env, Role, SessionUser } from './types';

const PBKDF2_ITERATIONS = 210_000;
const MAX_FAILED_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* encoding helpers                                                    */
/* ------------------------------------------------------------------ */

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return new Uint8Array();
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

export function normalizeUsername(value: string): string {
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().toLowerCase();
}

/* ------------------------------------------------------------------ */
/* passwords                                                           */
/* ------------------------------------------------------------------ */

async function derivePassword(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(bits);
}

export async function hashPassword(password: string, saltHex?: string): Promise<string> {
  const salt = saltHex ?? toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const hash = await derivePassword(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('pbkdf2$')) return false;
  const [, iterationsText, salt, expected] = stored.split('$');
  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations < 1_000 || iterations > 1_000_000 || !salt || !expected) return false;
  const actual = await derivePassword(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < actual.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Spend the same PBKDF2 cost for unknown or inactive accounts. Without this,
 * response time would reveal whether a username exists.
 */
const DUMMY_PASSWORD_HASH =
  'pbkdf2$210000$f5038cd53467b405906aac273c7b4292$dec84416d13571af829fbdeca517225fc6c21fa57367892e488cffea15f0b1e8';

export async function burnPasswordCheck(password: string): Promise<void> {
  try {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
  } catch {
    /* verification failures are intentionally ignored */
  }
}

/**
 * Short fingerprint of the stored hash. Sessions remember it so a password
 * reset revokes every session that was issued before the change, without ever
 * sending the hash itself to the browser.
 */
export async function passwordFingerprint(passwordHash: string): Promise<string> {
  return (await sha256Hex(passwordHash)).slice(0, 32);
}

/* ------------------------------------------------------------------ */
/* cookies and sessions                                                */
/* ------------------------------------------------------------------ */

export function newSessionToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookie(env: Env, token: string, maxAgeSeconds: number): string {
  return [
    `${env.COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=None',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function clearSessionCookie(env: Env): string {
  return `${env.COOKIE_NAME}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;
}

function sessionTtlMs(env: Env): number {
  const hours = Number(env.SESSION_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 8) * 60 * 60 * 1000;
}

export async function createSession(env: Env, account: AccountRow): Promise<{ token: string; session: SessionUser }> {
  const token = newSessionToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const expiresAt = now + sessionTtlMs(env);
  const ph = await passwordFingerprint(account.password_hash);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    env.DB
      .prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at, ph) VALUES (?, ?, ?, ?, ?)')
      .bind(tokenHash, account.id, now, expiresAt, ph),
  ]);

  const session: SessionUser = {
    username: account.username,
    role: account.role,
    displayName: account.display_name,
    division: account.division,
    at: now,
  };
  return { token, session };
}

export async function getAuth(request: Request, env: Env): Promise<AuthContext | null> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const token = cookies[env.COOKIE_NAME];
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.expires_at AS s_expires_at, s.ph AS s_ph,
            a.id, a.username, a.display_name, a.division, a.role, a.password_hash, a.active, a.builtin,
            a.created_at, a.updated_at
       FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<AccountRow & { s_expires_at: number; s_ph: string }>();

  if (!row) return null;
  if (row.s_expires_at <= Date.now() || !row.active) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  if (row.s_ph !== (await passwordFingerprint(row.password_hash))) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }

  const account: AccountRow = {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    division: row.division,
    role: row.role,
    password_hash: row.password_hash,
    active: row.active,
    builtin: row.builtin,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  return {
    account,
    tokenHash,
    session: {
      username: account.username,
      role: account.role,
      displayName: account.display_name,
      division: account.division,
      at: row.s_expires_at - sessionTtlMs(env),
    },
  };
}

export async function destroySession(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/* ------------------------------------------------------------------ */
/* roles                                                               */
/* ------------------------------------------------------------------ */

export function canExport(role: Role): boolean {
  return role === 'extraction' || role === 'mis';
}

export function canDownloadGeoJson(role: Role): boolean {
  return role === 'gis';
}

export function canManageAccounts(role: Role): boolean {
  return role === 'mis';
}

/* ------------------------------------------------------------------ */
/* activity log                                                        */
/* ------------------------------------------------------------------ */

export async function logActivity(
  env: Env,
  type: string,
  detail: string,
  username = 'system',
  role: Role | 'unknown' = 'unknown',
): Promise<void> {
  await env.DB.prepare('INSERT INTO activity (at, type, username, role, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(
      Date.now(),
      type,
      username.slice(0, 64),
      role,
      detail.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500),
    )
    .run();
  // Trim occasionally so the table cannot grow without bound.
  if (Math.random() < 0.02) {
    await env.DB.prepare(
      'DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 2000)',
    ).run();
  }
}

/* ------------------------------------------------------------------ */
/* login rate limiting                                                 */
/* ------------------------------------------------------------------ */

export async function assertLoginAllowed(env: Env, bucket: string): Promise<number> {
  const row = await env.DB.prepare('SELECT count, reset_at FROM login_attempts WHERE bucket = ?')
    .bind(bucket)
    .first<{ count: number; reset_at: number }>();
  if (!row || row.reset_at <= Date.now()) return 0;
  if (row.count < MAX_FAILED_ATTEMPTS) return 0;
  return Math.max(1, Math.ceil((row.reset_at - Date.now()) / 1000));
}

export async function registerLoginFailure(env: Env, bucket: string): Promise<void> {
  const now = Date.now();
  const resetAt = now + ATTEMPT_WINDOW_MS;
  await env.DB.prepare(
    `INSERT INTO login_attempts (bucket, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET
       count = CASE WHEN login_attempts.reset_at <= ? THEN 1 ELSE login_attempts.count + 1 END,
       reset_at = CASE WHEN login_attempts.reset_at <= ? THEN excluded.reset_at ELSE login_attempts.reset_at END`,
  )
    .bind(bucket, resetAt, now, now)
    .run();
}

export async function clearLoginFailures(env: Env, bucket: string): Promise<void> {
  await env.DB.prepare('DELETE FROM login_attempts WHERE bucket = ?').bind(bucket).run();
}

export async function pruneLoginAttempts(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM login_attempts WHERE reset_at <= ?').bind(Date.now()).run();
}
