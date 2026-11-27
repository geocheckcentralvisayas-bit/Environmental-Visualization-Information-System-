import { execSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect } from 'vite';
import react from '@vitejs/plugin-react';

const TILE_DIR = fileURLToPath(new URL('./offline-tiles', import.meta.url));
const TILE_UPSTREAM = {
  streets: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile',
} as const;

/**
 * Serves the bundled Region VII tiles during development/LAN use and caches any
 * extra tile the user browses while online. Offline, only the bundled zooms
 * (7-12 for streets and satellite) are available; higher zooms overzoom them.
 */
function offlineTiles() {
  return {
    name: 'offline-tiles',
    apply: 'serve' as const,
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0];
        if (!path.startsWith('/tiles/')) {
          next();
          return;
        }

        const match = /^\/tiles\/(streets|satellite)\/(\d{1,2})\/(\d+)\/(\d+)\.jpg$/.exec(path);
        if (!match) {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }

        const [, style, zoom, x, y] = match;
        const file = join(TILE_DIR, style, zoom, x, `${y}.jpg`);
        const send = (image: Buffer) => {
          response.setHeader('Content-Type', 'image/jpeg');
          response.setHeader('Cache-Control', 'public, max-age=604800, immutable');
          response.end(image);
        };

        if (existsSync(file)) {
          send(readFileSync(file));
          return;
        }

        // Missing tile: fetch it once, keep it, so a later offline run has it.
        void (async () => {
          try {
            const upstream = TILE_UPSTREAM[style as keyof typeof TILE_UPSTREAM];
            const fetched = await fetch(`${upstream}/${zoom}/${y}/${x}`);
            if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
            const image = Buffer.from(await fetched.arrayBuffer());
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, image);
            send(image);
          } catch {
            response.statusCode = 404;
            response.end('Tile not available offline');
          }
        })();
      });
    },
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const offlineBuild = process.env.VITE_OFFLINE === '1';
const DATA_DIR = fileURLToPath(new URL('./public/data', import.meta.url));
// The gate hash must never be part of the served dataset tree. It lives beside
// the project config and is copied into the offline snapshot at build time.
const ACCESS_FILE = fileURLToPath(new URL('./offline-access.json', import.meta.url));
const SYNC_TOKEN = process.env.ENVIS_SYNC_TOKEN ?? '';

/** Constant-time comparison of the bearer token required by /sync/*. */
function syncAuthorized(request: { headers: { authorization?: string | string[] } }): boolean {
  const header = String(request.headers.authorization ?? '');
  if (!SYNC_TOKEN || !header.startsWith('Bearer ')) return false;
  const supplied = header.slice(7);
  if (supplied.length !== SYNC_TOKEN.length) return false;
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ SYNC_TOKEN.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Lets a client PC keep its offline copy current while it is on the office LAN.
 *
 * `/sync/manifest.json` lists every built dataset with its size and mtime;
 * `/sync/file/<path>` returns the file. Both are LAN-only because the server is
 * reachable only on the office network, and only this `public/data` folder is
 * exposed (never the project or worker state).
 */
function offlineSync() {
  const listFiles = (directory: string, prefix = ''): Array<{ path: string; size: number; mtime: number }> => {
    const entries: Array<{ path: string; size: number; mtime: number }> = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push(...listFiles(full, relative));
      } else if (entry.isFile()) {
        const stat = statSync(full);
        entries.push({ path: relative, size: stat.size, mtime: Math.round(stat.mtimeMs) });
      }
    }
    return entries;
  };

  return {
    name: 'offline-sync',
    apply: 'serve' as const,
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0];

        // Vite's public dir would otherwise serve every dataset to any LAN
        // device. Sensitive data is only available through the Worker API.
        if (path.startsWith('/data/')) {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }

        if (!path.startsWith('/sync/')) {
          next();
          return;
        }

        if (!syncAuthorized(request)) {
          response.statusCode = 403;
          response.setHeader('Cache-Control', 'no-store');
          response.end('A valid LAN sync token is required.');
          return;
        }

        if (path === '/sync/manifest.json') {
          try {
            const body = JSON.stringify({
              generatedAt: new Date().toISOString(),
              files: listFiles(DATA_DIR),
            });
            response.setHeader('Content-Type', 'application/json');
            response.setHeader('Cache-Control', 'no-store');
            response.end(body);
          } catch (error) {
            response.statusCode = 500;
            response.end('Cannot read the data folder: ' + (error as Error).message);
          }
          return;
        }

        if (path.startsWith('/sync/file/')) {
          const relative = decodeURIComponent(path.slice('/sync/file/'.length));
          const target = resolve(DATA_DIR, relative);
          if (!target.startsWith(DATA_DIR + sep) || !existsSync(target)) {
            response.statusCode = 404;
            response.end('Not found');
            return;
          }
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(readFileSync(target));
          return;
        }

        response.statusCode = 404;
        response.end('Not found');
      });
    },
  };
}

/**
 * MIS-only management of the password that unlocks the offline copy.
 *
 * The hash lives in `offline-access.json` beside the project, outside the
 * served dataset tree. The offline build copies it into the snapshot; LAN sync
 * never exposes it. Writing it requires a valid MIS login, checked against the
 * local API so no shared secret is kept here.
 */
function offlineAccess() {
  const accessFile = ACCESS_FILE;

  const send = (response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }, status: number, body: unknown) => {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(body));
  };

  const readBody = async (request: AsyncIterable<unknown>) => {
    let text = '';
    for await (const chunk of request) text += String(chunk);
    return text;
  };

  return {
    name: 'offline-access',
    apply: 'serve' as const,
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use((request, response, next) => {
        if ((request.url ?? '').split('?')[0] !== '/offline-access') {
          next();
          return;
        }

        void (async () => {
          try {
            if (request.method === 'GET') {
              if (!existsSync(accessFile)) {
                send(response, 200, { configured: false });
                return;
              }
              const file = JSON.parse(readFileSync(accessFile, 'utf8')) as { updatedAt?: string; updatedBy?: string };
              send(response, 200, { configured: true, updatedAt: file.updatedAt, updatedBy: file.updatedBy });
              return;
            }

            if (request.method !== 'POST') {
              send(response, 405, { error: 'Method not allowed.' });
              return;
            }

            const body = JSON.parse(await readBody(request)) as {
              username?: string; password?: string; newPassword?: string;
            };
            const username = (body.username ?? '').trim();
            const password = body.password ?? '';
            const newPassword = body.newPassword ?? '';
            if (!username || !password) {
              send(response, 400, { error: 'Enter your MIS password.' });
              return;
            }
            if (newPassword.length < 8) {
              send(response, 400, { error: 'The offline password must be at least 8 characters.' });
              return;
            }

            const check = await fetch('http://127.0.0.1:8787/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password }),
            });
            const session = check.ok ? (await check.json()) as { username?: string; role?: string } : null;
            if (!session || session.role !== 'mis') {
              send(response, 403, { error: 'Only an MIS account can create or change the offline password.' });
              return;
            }

            const salt = randomBytes(16);
            const iterations = 120000;
            const hash = pbkdf2Sync(newPassword, salt, iterations, 32, 'sha256').toString('base64');
            writeFileSync(accessFile, JSON.stringify({
              v: 1,
              salt: salt.toString('base64'),
              iterations,
              hash,
              updatedAt: new Date().toISOString(),
              updatedBy: session.username ?? username,
            }, null, 2) + '\n');
            send(response, 200, { configured: true });
          } catch (error) {
            send(response, 500, { error: 'Could not save the offline password: ' + (error as Error).message });
          }
        })();
      });
    },
  };
}
// GitHub Actions supplies the run number. Locally, use the commit count so the
// build identity advances with every commit instead of staying frozen.
function localBuildNumber(): string {
  if (process.env.GITHUB_RUN_NUMBER) return process.env.GITHUB_RUN_NUMBER;
  try {
    return execSync('git rev-list --count HEAD', { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}
const buildNumber = localBuildNumber();
const commitSha = (process.env.GITHUB_SHA ?? '').slice(0, 7);

/**
 * Content-Security-Policy for the published build.
 *
 * Injected at build time only: the Vite dev server adds an inline React Refresh
 * preamble that a strict `script-src 'self'` policy would block. `frame-ancestors`
 * is intentionally omitted because browsers ignore it in a meta tag — set it as a
 * real HTTP header on the host if the deployment platform allows it.
 */
const apiBase = process.env.VITE_API_BASE ?? '';
let apiOrigin = '';
try {
  if (apiBase) apiOrigin = new URL(apiBase).origin;
} catch {
  apiOrigin = '';
}
const connectSources = ["'self'", ...(apiOrigin ? [apiOrigin] : [])].join(' ');

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://server.arcgisonline.com https://tile.openstreetmap.org",
  `connect-src ${connectSources}`,
  "frame-src 'self'",
  "media-src 'none'",
  "worker-src 'none'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

function contentSecurityPolicy() {
  return {
    name: 'inject-content-security-policy',
    apply: 'build' as const,
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend' as const,
        },
      ];
    },
  };
}

/**
 * The dev/LAN server previously had no CSP at all. React Refresh needs inline
 * scripts and eval in development, so this is deliberately looser than the
 * published CSP but still blocks cross-origin framing and unexpected fetches.
 */
const DEV_SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://server.arcgisonline.com https://tile.openstreetmap.org",
    "connect-src 'self' ws: wss: http://127.0.0.1:8787 http://localhost:8787",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
};

function devSecurityHeaders() {
  return {
    name: 'dev-security-headers',
    apply: 'serve' as const,
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use((_request, response, next) => {
        for (const [name, value] of Object.entries(DEV_SECURITY_HEADERS)) response.setHeader(name, value);
        next();
      });
    },
  };
}

/**
 * Once the dashboard talks to the API, the compiled JSON must not be copied to
 * the static deployment. Removing `dist/data` at close time keeps the pipeline
 * output in `public/data` (for `npm run api:upload`) without publishing it.
 */
function stripStaticData() {
  return {
    name: 'strip-static-data',
    apply: 'build' as const,
    closeBundle() {
      if (offlineBuild) return;
      if (!apiOrigin) {
        // Published builds must not ship the authenticated dataset as static files.
        if (process.env.CI) throw new Error('VITE_API_BASE (absolute Worker URL) is required in CI');
        return;
      }
      rmSync(new URL('./dist/data', import.meta.url), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    contentSecurityPolicy(),
    stripStaticData(),
    devSecurityHeaders(),
    offlineTiles(),
    offlineSync(),
    offlineAccess(),
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(buildNumber),
    __APP_COMMIT__: JSON.stringify(commitSha),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5173,
    open: false,
    watch: { ignored: ['**/data/raw/**', '**/data/*.csv', '**/data/*.xlsx', '**/dist/**', '**/offline-tiles/**', '**/desktop/**', '**/ENVIS-Pixel-Office/**'] },
    // Local development: the authenticated API runs as a Cloudflare Worker on
    // :8787 (`npm run api:dev`). Production builds use VITE_API_BASE instead.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Never publish source maps: the shipped bundle must not expose source files.
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-charts': ['echarts', 'echarts-for-react'],
          'vendor-map': ['leaflet', 'leaflet.markercluster'],
          'vendor-ui': ['lucide-react', 'clsx', 'zustand'],
        },
      },
    },
  },
});
