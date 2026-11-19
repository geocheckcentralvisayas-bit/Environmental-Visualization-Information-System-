import { readFileSync } from 'node:fs';
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
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://server.arcgisonline.com https://tile.openstreetmap.org",
  "connect-src 'self'",
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

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
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
