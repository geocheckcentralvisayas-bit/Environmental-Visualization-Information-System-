import type { Env } from './types';

const MAX_JSON_BODY_BYTES = 1_000_000;

/** Headers applied to every API response. */
const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function fail(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, { status });
}

/**
 * Requests without an Origin (native clients, curl, health probes) are allowed.
 * Browser-issued cross-site requests always carry an Origin, so a state-changing
 * request from an unlisted site is rejected even though the session cookie would
 * otherwise be sent with `SameSite=None`.
 */
export function isOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return allowedOrigins(env).includes(origin);
}

export function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin');
  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '600');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

export function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(request, env)) headers.set(key, value);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    const type = request.headers.get('Content-Type') ?? '';
    if (!type.includes('application/json')) return null;
    const length = Number(request.headers.get('Content-Length') ?? 0);
    if (Number.isFinite(length) && length > MAX_JSON_BODY_BYTES) return null;
    const text = await request.text();
    if (text.length > MAX_JSON_BODY_BYTES) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Cloudflare sets `CF-Connecting-IP`. We intentionally do not trust
 * `X-Forwarded-For`: it is client-controlled unless a trusted proxy overwrites
 * it, which would let callers rotate their rate-limit bucket.
 */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'local';
}
