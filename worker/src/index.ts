import {
  assertLoginAllowed,
  burnPasswordCheck,
  canExport,
  clearLoginFailures,
  clearSessionCookie,
  createSession,
  destroySession,
  getAuth,
  hashPassword,
  logActivity,
  normalizeUsername,
  pruneLoginAttempts,
  registerLoginFailure,
  sessionCookie,
  verifyPassword,
} from './auth';
import { clientIp, fail, isOriginAllowed, json, readJson, withCors } from './http';
import type { AccountRow, AuthContext, Env, Role } from './types';

const ROLES: Role[] = ['extraction', 'rd', 'emed', 'cpd', 'mis', 'viewer', 'gis'];

const MAX_USERNAME_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 128;
const MIN_PASSWORD_LENGTH = 8;
const MAX_LABEL_LENGTH = 120;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH;
}

function validPasswordHash(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(/^pbkdf2\$(\d+)\$[0-9a-f]{32}\$[0-9a-f]{64}$/i);
  if (!match) return false;
  const iterations = Number(match[1]);
  return iterations >= 1_000 && iterations <= 1_000_000;
}

const ROOT_DATA_FILES = new Set([
  'meta.json',
  'quality.json',
  'permits.json',
  'sites.json',
  'facilities.json',
  'hw.json',
  'clearances.json',
  'legal.json',
  'pco-database.json',
  'pco-analysis.json',
  'geojson/layers.json',
]);

function isAllowedDataPath(path: string): boolean {
  if (ROOT_DATA_FILES.has(path)) return true;
  return /^geojson\/[a-z0-9][a-z0-9_.-]*\.geojson$/i.test(path);
}

function publicAccount(account: AccountRow) {
  return {
    username: account.username,
    role: account.role,
    displayName: account.display_name,
    division: account.division,
    active: Boolean(account.active),
    builtin: Boolean(account.builtin),
    createdAt: account.created_at,
    updatedAt: account.updated_at,
  };
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown }>(request);
  if (typeof body?.username !== 'string' || typeof body?.password !== 'string') {
    return fail(400, 'Username and password are required.');
  }
  const username = normalizeUsername(body.username);
  if (!username || username.length > MAX_USERNAME_LENGTH || body.password.length > MAX_PASSWORD_LENGTH) {
    return fail(400, 'Username and password are required.');
  }

  const ip = clientIp(request);
  const buckets = [`ip:${ip}`, `user:${username}`];

  for (const bucket of buckets) {
    const retryAfter = await assertLoginAllowed(env, bucket);
    if (retryAfter > 0) {
      return json(
        { error: 'Too many failed attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }
  }

  const account = await env.DB.prepare('SELECT * FROM accounts WHERE lower(username) = ?')
    .bind(username)
    .first<AccountRow>();

  let ok = false;
  if (account && account.active) {
    ok = await verifyPassword(body.password, account.password_hash);
  } else {
    // Equalise timing so unknown/inactive usernames cannot be enumerated.
    await burnPasswordCheck(body.password);
  }
  if (!account || !ok) {
    for (const bucket of buckets) await registerLoginFailure(env, bucket);
    await logActivity(
      env,
      'login-failed',
      account ? `Failed sign-in for ${account.display_name}` : 'Failed sign-in (unknown or inactive account)',
      account?.username ?? 'unknown',
      account?.role ?? 'unknown',
    );
    return fail(401, 'Invalid username or password.');
  }

  for (const bucket of buckets) await clearLoginFailures(env, bucket);
  await pruneLoginAttempts(env);

  const { token, session } = await createSession(env, account);
  await logActivity(env, 'login', `${account.display_name} signed in`, account.username, account.role);

  const ttlSeconds = Math.max(1, Math.round((Number(env.SESSION_TTL_HOURS) || 8) * 3600));
  return json(session, { headers: { 'Set-Cookie': sessionCookie(env, token, ttlSeconds) } });
}

async function handleSession(env: Env, auth: AuthContext): Promise<Response> {
  return json(auth.session);
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(request, env);
  if (auth) {
    await destroySession(env, auth.tokenHash);
    await logActivity(env, 'logout', `${auth.session.displayName} signed out`, auth.session.username, auth.session.role);
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie(env) } });
}

async function handleVerify(request: Request, env: Env, auth: AuthContext): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown; purpose?: unknown }>(request);
  if (typeof body?.username !== 'string' || typeof body?.password !== 'string') {
    return fail(400, 'Username and password are required.');
  }
  const username = normalizeUsername(body.username);
  if (!username || username.length > MAX_USERNAME_LENGTH || body.password.length > MAX_PASSWORD_LENGTH) {
    return fail(400, 'Username and password are required.');
  }

  const purpose = body.purpose === 'geojson' ? 'geojson' : 'export';
  const bucket = `verify:${clientIp(request)}:${username}`;
  const retryAfter = await assertLoginAllowed(env, bucket);
  if (retryAfter > 0) {
    return json({ error: 'Too many failed attempts. Try again later.' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
  }

  const account = await env.DB.prepare('SELECT * FROM accounts WHERE lower(username) = ?')
    .bind(username)
    .first<AccountRow>();

  let ok = false;
  if (account && account.active) {
    ok = await verifyPassword(body.password, account.password_hash);
  } else {
    await burnPasswordCheck(body.password);
  }
  if (!account || !ok) {
    await registerLoginFailure(env, bucket);
    await logActivity(env, 'login-failed', `Failed ${purpose} re-authentication`, account?.username ?? 'unknown', account?.role ?? 'unknown');
    return fail(401, 'Invalid username or password.');
  }
  await clearLoginFailures(env, bucket);

  if (purpose === 'geojson' && account.role !== 'gis') {
    return fail(403, 'This account cannot download GeoJSON layers.');
  }
  if (purpose === 'export' && !canExport(account.role)) {
    return fail(403, 'This account cannot export data.');
  }

  await logActivity(
    env,
    purpose,
    `${account.display_name} authorised a ${purpose} action`,
    auth.session.username,
    auth.session.role,
  );
  return json({ ok: true, role: account.role, displayName: account.display_name });
}

async function handleData(request: Request, env: Env, auth: AuthContext, path: string): Promise<Response> {
  if (!isAllowedDataPath(path)) return fail(404, 'Not found.');
  const object = await env.DATA.get(`data/${path}`);
  if (!object) return fail(404, 'Not found.');

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/json; charset=utf-8');
  // Authenticated data must not remain readable from the browser cache after
  // sign-out or on a shared machine.
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);

  // Every signed-in role may read layer data for the map. The GIS-only rule
  // applies to downloading layers, which is enforced by /api/verify and the
  // client download button.
  return new Response(object.body, { headers });
}

/* ------------------------------------------------------------------ */
/* admin                                                               */
/* ------------------------------------------------------------------ */

async function listAccounts(env: Env): Promise<AccountRow[]> {
  const result = await env.DB.prepare('SELECT * FROM accounts ORDER BY display_name').all<AccountRow>();
  return result.results ?? [];
}

async function countActiveMis(env: Env, excludeId?: number): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'mis' AND active = 1 AND id != ?")
    .bind(excludeId ?? -1)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function handleAdminAccounts(request: Request, env: Env, auth: AuthContext): Promise<Response> {
  if (request.method === 'GET') {
    return json({ accounts: (await listAccounts(env)).map(publicAccount) });
  }
  if (request.method !== 'POST') return fail(405, 'Method not allowed.');

  const body = await readJson<{ username?: unknown; displayName?: unknown; division?: unknown; role?: unknown; password?: unknown }>(request);
  if (typeof body?.username !== 'string') return fail(400, 'Username is required.');
  const username = normalizeUsername(body.username);
  if (!USERNAME_PATTERN.test(username)) {
    return fail(400, 'Username must be 3–64 characters using letters, numbers, dots, dashes or underscores.');
  }
  if (!validPassword(body.password)) return fail(400, 'Password must be 8–128 characters.');
  if (typeof body.role !== 'string' || !ROLES.includes(body.role as Role)) return fail(400, 'Invalid role.');

  const displayName = (typeof body.displayName === 'string' ? body.displayName.trim() : '') || username;
  const division = (typeof body.division === 'string' ? body.division.trim() : '') || '—';
  if (displayName.length > MAX_LABEL_LENGTH || division.length > MAX_LABEL_LENGTH) {
    return fail(400, 'Display name and division must be 120 characters or fewer.');
  }

  const existing = await env.DB.prepare('SELECT id FROM accounts WHERE lower(username) = ?').bind(username).first<{ id: number }>();
  if (existing) return fail(409, 'That username already exists.');

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO accounts (username, display_name, division, role, password_hash, active, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(
      username,
      displayName,
      division,
      body.role,
      await hashPassword(body.password),
      now,
      now,
    )
    .run();

  await logActivity(env, 'account-add', `${auth.session.displayName} added account ${username}`, auth.session.username, auth.session.role);
  return json({ ok: true }, { status: 201 });
}

async function handleAdminAccount(request: Request, env: Env, auth: AuthContext, username: string): Promise<Response> {
  const account = await env.DB.prepare('SELECT * FROM accounts WHERE lower(username) = ?').bind(normalizeUsername(username)).first<AccountRow>();
  if (!account) return fail(404, 'Account not found.');

  if (request.method === 'DELETE') {
    if (account.id === auth.account.id) return fail(400, 'You cannot delete the account you are signed in with.');
    if (account.role === 'mis' && (await countActiveMis(env, account.id)) === 0) {
      return fail(400, 'You cannot delete the last MIS account.');
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(account.id),
      env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(account.id),
    ]);
    await logActivity(env, 'account-delete', `${auth.session.displayName} deleted account ${account.display_name}`, auth.session.username, auth.session.role);
    return json({ ok: true });
  }

  if (request.method !== 'PATCH') return fail(405, 'Method not allowed.');
  const body = await readJson<{ displayName?: unknown; division?: unknown; role?: unknown; active?: unknown }>(request);
  if (!body) return fail(400, 'Invalid request.');

  const nextRole = typeof body.role === 'string' && ROLES.includes(body.role as Role) ? (body.role as Role) : account.role;
  const nextActive = typeof body.active === 'boolean' ? (body.active ? 1 : 0) : account.active;
  const nextDisplay = typeof body.displayName === 'string' && body.displayName.trim()
    ? body.displayName.trim()
    : account.display_name;
  const nextDivision = typeof body.division === 'string' && body.division.trim()
    ? body.division.trim()
    : account.division;
  if (nextDisplay.length > MAX_LABEL_LENGTH || nextDivision.length > MAX_LABEL_LENGTH) {
    return fail(400, 'Display name and division must be 120 characters or fewer.');
  }

  if (account.id === auth.account.id && (!nextActive || nextRole !== 'mis')) {
    return fail(400, 'You cannot deactivate or demote the account you are signed in with.');
  }
  if (account.role === 'mis' && (nextRole !== 'mis' || !nextActive) && (await countActiveMis(env, account.id)) === 0) {
    return fail(400, 'You cannot remove the last active MIS account.');
  }

  await env.DB.prepare(
    'UPDATE accounts SET display_name = ?, division = ?, role = ?, active = ?, updated_at = ? WHERE id = ?',
  )
    .bind(
      nextDisplay,
      nextDivision,
      nextRole,
      nextActive,
      Date.now(),
      account.id,
    )
    .run();

  // A role change or deactivation must invalidate existing sessions, not just
  // apply the new role on the next request.
  if (!nextActive || nextRole !== account.role) {
    await env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(account.id).run();
  }

  if (nextRole !== account.role) {
    await logActivity(env, 'role-change', `${auth.session.displayName} changed ${account.display_name} from ${account.role} to ${nextRole}`, auth.session.username, auth.session.role);
  }
  await logActivity(env, 'account-update', `${auth.session.displayName} updated account ${account.display_name}`, auth.session.username, auth.session.role);

  if (account.id === auth.account.id && (!nextActive || nextRole !== account.role)) {
    return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie(env) } });
  }
  return json({ ok: true });
}

async function handleAdminImport(request: Request, env: Env, auth: AuthContext): Promise<Response> {
  if (request.method !== 'POST') return fail(405, 'Method not allowed.');
  const body = await readJson<{ accounts?: unknown[] }>(request);
  if (!body || !Array.isArray(body.accounts)) return fail(400, 'No accounts array found in that file.');
  if (body.accounts.length > 500) return fail(400, 'Import at most 500 accounts at a time.');

  const existing = await listAccounts(env);
  const byName = new Map(existing.map((account) => [account.username.toLowerCase(), account]));
  const nextState = new Map(existing.map((account) => [account.username.toLowerCase(), { role: account.role, active: Boolean(account.active) }]));
  const statements: D1PreparedStatement[] = [];
  const revoke = new Set<number>();
  const now = Date.now();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of body.accounts) {
    const record = (raw ?? {}) as Record<string, unknown>;
    const username = typeof record.username === 'string' ? normalizeUsername(record.username) : '';
    if (!USERNAME_PATTERN.test(username)) { skipped += 1; continue; }
    const role = typeof record.role === 'string' && ROLES.includes(record.role as Role) ? (record.role as Role) : null;
    if (!role) { skipped += 1; continue; }

    const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : '';
    const division = typeof record.division === 'string' ? record.division.trim() : '';
    if (displayName.length > MAX_LABEL_LENGTH || division.length > MAX_LABEL_LENGTH) { skipped += 1; continue; }
    if (record.active !== undefined && typeof record.active !== 'boolean') { skipped += 1; continue; }
    const active = record.active === undefined ? true : record.active;

    let passwordHash = '';
    if (validPasswordHash(record.passwordHash)) {
      passwordHash = record.passwordHash;
    } else if (validPassword(record.password)) {
      passwordHash = await hashPassword(record.password);
    }

    const current = byName.get(username);
    if (!current && !passwordHash) { skipped += 1; continue; }

    nextState.set(username, { role, active });

    if (current) {
      if (passwordHash || role !== current.role || Boolean(current.active) !== active) revoke.add(current.id);
      statements.push(
        env.DB.prepare(
          'UPDATE accounts SET display_name = ?, division = ?, role = ?, active = ?, password_hash = ?, updated_at = ? WHERE id = ?',
        ).bind(
          displayName || current.display_name,
          division || current.division,
          role,
          active ? 1 : 0,
          passwordHash || current.password_hash,
          now,
          current.id,
        ),
      );
      updated += 1;
    } else {
      statements.push(
        env.DB.prepare(
          `INSERT INTO accounts (username, display_name, division, role, password_hash, active, builtin, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).bind(username, displayName || username, division || '—', role, passwordHash, active ? 1 : 0, now, now),
      );
      added += 1;
    }
  }

  const activeMis = [...nextState.values()].filter((entry) => entry.active && entry.role === 'mis').length;
  if (activeMis === 0) return fail(400, 'That import would leave no active MIS account.');

  if (statements.length) await env.DB.batch(statements);

  // Imported password/role/status changes revoke those accounts' sessions.
  const revokeIds = [...revoke];
  for (let index = 0; index < revokeIds.length; index += 100) {
    const chunk = revokeIds.slice(index, index + 100);
    await env.DB.prepare(
      `DELETE FROM sessions WHERE account_id IN (${chunk.map(() => '?').join(',')})`,
    ).bind(...chunk).run();
  }

  await logActivity(
    env,
    'account-update',
    `${auth.session.displayName} imported accounts (${added} added, ${updated} updated, ${skipped} skipped)`,
    auth.session.username,
    auth.session.role,
  );
  return json({ added, updated, skipped });
}

async function handleAdminPassword(request: Request, env: Env, auth: AuthContext, username: string): Promise<Response> {
  if (request.method !== 'POST') return fail(405, 'Method not allowed.');
  const body = await readJson<{ password?: unknown }>(request);
  if (!validPassword(body?.password)) return fail(400, 'Password must be 8–128 characters.');

  const account = await env.DB.prepare('SELECT * FROM accounts WHERE lower(username) = ?').bind(normalizeUsername(username)).first<AccountRow>();
  if (!account) return fail(404, 'Account not found.');

  await env.DB.batch([
    env.DB.prepare('UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?')
      .bind(await hashPassword(body.password), Date.now(), account.id),
    // Revoke every session for that account, including the caller's own.
    env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(account.id),
  ]);
  await logActivity(env, 'password-change', `${auth.session.displayName} reset the password for ${account.display_name}`, auth.session.username, auth.session.role);

  if (account.id === auth.account.id) {
    return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie(env) } });
  }
  return json({ ok: true });
}

async function handleAdminActivity(request: Request, env: Env, auth: AuthContext): Promise<Response> {
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM activity').run();
    await logActivity(env, 'account-update', `${auth.session.displayName} cleared the activity log`, auth.session.username, auth.session.role);
    return json({ ok: true });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
  const result = type && type !== 'all'
    ? await env.DB.prepare('SELECT * FROM activity WHERE type = ? ORDER BY id DESC LIMIT ?').bind(type, limit).all()
    : await env.DB.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?').bind(limit).all();
  return json({ activity: result.results ?? [] });
}

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    // Cookies are SameSite=None so the Pages UI can call the API. Reject
    // state-changing requests that carry an Origin we do not trust (CSRF).
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && !isOriginAllowed(request, env)) {
      return withCors(fail(403, 'Origin not allowed.'), request, env);
    }

    try {
      if (path === '/api/health') {
        return withCors(json({ ok: true, service: 'envis-region-vii-api' }), request, env);
      }

      if (path === '/api/login' && request.method === 'POST') {
        return withCors(await handleLogin(request, env), request, env);
      }
      if (path === '/api/logout' && request.method === 'POST') {
        return withCors(await handleLogout(request, env), request, env);
      }

      const auth = await getAuth(request, env);

      if (path === '/api/session' && request.method === 'GET') {
        return withCors(auth ? await handleSession(env, auth) : fail(401, 'Not signed in.'), request, env);
      }
      if (path === '/api/verify' && request.method === 'POST') {
        if (!auth) return withCors(fail(401, 'Not signed in.'), request, env);
        return withCors(await handleVerify(request, env, auth), request, env);
      }

      if (path.startsWith('/api/data/') && request.method === 'GET') {
        if (!auth) return withCors(fail(401, 'Not signed in.'), request, env);
        return withCors(await handleData(request, env, auth, path.slice('/api/data/'.length)), request, env);
      }

      if (path.startsWith('/api/admin/')) {
        if (!auth) return withCors(fail(401, 'Not signed in.'), request, env);
        if (auth.session.role !== 'mis') return withCors(fail(403, 'Only the MIS account can manage accounts.'), request, env);

        if (path === '/api/admin/accounts') {
          return withCors(await handleAdminAccounts(request, env, auth), request, env);
        }
        if (path === '/api/admin/activity') {
          return withCors(await handleAdminActivity(request, env, auth), request, env);
        }
        if (path === '/api/admin/accounts/import') {
          return withCors(await handleAdminImport(request, env, auth), request, env);
        }
        const passwordMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)\/password$/);
        if (passwordMatch) {
          return withCors(await handleAdminPassword(request, env, auth, decodeURIComponent(passwordMatch[1])), request, env);
        }
        const accountMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)$/);
        if (accountMatch) {
          return withCors(await handleAdminAccount(request, env, auth, decodeURIComponent(accountMatch[1])), request, env);
        }
        return withCors(fail(404, 'Not found.'), request, env);
      }

      return withCors(fail(404, 'Not found.'), request, env);
    } catch (error) {
      console.error('Unhandled API error', error);
      return withCors(fail(500, 'Internal server error.'), request, env);
    }
  },
};
