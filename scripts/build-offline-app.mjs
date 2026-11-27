#!/usr/bin/env node
/**
 * Builds the self-contained offline copy that ships inside the Windows installer.
 *
 * It is the normal dashboard build with three differences: data is read from
 * static files (`VITE_OFFLINE=1`), the bundled map tiles are included, and no
 * Worker URL is used. The desktop app serves the folder to WebView2 without any
 * internet, and refreshes its `data/` folder from the host PC while on the LAN.
 *
 *   npm run build:offline
 *
 * Output: desktop/offline-app (packed into offline-app.zip by desktop/build.ps1)
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'desktop', 'offline-app');
const tilesDir = join(root, 'offline-tiles');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

rmSync(outDir, { recursive: true, force: true });

const env = { ...process.env, VITE_OFFLINE: '1' };
delete env.VITE_API_BASE;

const result = spawnSync(
  process.execPath,
  [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir'],
  { cwd: root, env, stdio: 'inherit' },
);
if (result.status !== 0) {
  console.error('build:offline failed: vite build did not finish.');
  process.exit(result.status ?? 1);
}

if (!existsSync(join(outDir, 'index.html'))) {
  console.error('build:offline failed: index.html was not produced.');
  process.exit(1);
}

if (existsSync(tilesDir)) {
  cpSync(tilesDir, join(outDir, 'tiles'), { recursive: true });
  console.log('build:offline: bundled the offline map tiles.');
} else {
  console.warn('build:offline: no offline-tiles folder. Run `npm run data:tiles` first for offline maps.');
}

// The gate hash is deliberately kept outside public/data on the host, so copy
// it into the snapshot explicitly (LAN sync never sees it).
const gate = join(root, 'offline-access.json');
if (existsSync(gate)) {
  mkdirSync(join(outDir, 'data'), { recursive: true });
  copyFileSync(gate, join(outDir, 'data', 'offline-access.json'));
} else {
  console.warn('build:offline: no offline-access.json; the offline copy will stay locked until MIS sets a password.');
}

writeFileSync(
  join(outDir, 'offline.json'),
  JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString() }, null, 2),
);

console.log(`build:offline: ready -> ${outDir}`);
