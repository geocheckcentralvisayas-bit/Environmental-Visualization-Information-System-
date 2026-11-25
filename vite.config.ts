import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
 * Once the dashboard talks to the API, the compiled JSON must not be copied to
 * the static deployment. Removing `dist/data` at close time keeps the pipeline
 * output in `public/data` (for `npm run api:upload`) without publishing it.
 */
function stripStaticData() {
  return {
    name: 'strip-static-data',
    apply: 'build' as const,
    closeBundle() {
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
  plugins: [react(), contentSecurityPolicy(), stripStaticData(), offlineTiles()],
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
