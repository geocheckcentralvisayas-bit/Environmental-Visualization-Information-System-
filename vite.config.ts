import { readFileSync, rmSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const buildNumber = process.env.GITHUB_RUN_NUMBER ?? '';
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
  "frame-src 'none'",
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
      if (!apiBase) return;
      rmSync(new URL('./dist/data', import.meta.url), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy(), stripStaticData()],
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
    watch: { ignored: ['**/data/raw/**', '**/dist/**'] },
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
