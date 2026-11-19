#!/usr/bin/env node
/**
 * Upload public/data into the private R2 bucket used by the API.
 *
 *   node worker/scripts/upload-data.mjs --local
 *   node worker/scripts/upload-data.mjs --remote
 *
 * Remote uploads require `wrangler login` (or CLOUDFLARE_API_TOKEN) and the
 * bucket named in worker/wrangler.toml.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'public', 'data');
const CONFIG = path.join(ROOT, 'worker', 'wrangler.toml');
const BUCKET = 'envis-data';
const mode = process.argv.includes('--remote') ? '--remote' : '--local';

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(json|geojson)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

const files = walk(DATA);
if (!files.length) {
  console.error('No data files found in public/data');
  process.exit(1);
}

let uploaded = 0;
const failures = [];
console.log(`Uploading ${files.length} file(s) to R2 (${mode})...`);

for (const file of files) {
  const rel = path.relative(DATA, file).split(path.sep).join('/');
  const key = `data/${rel}`;
  const contentType = file.endsWith('.geojson') ? 'application/geo+json' : 'application/json';
  // Invoke the Wrangler entry point with Node directly: spawning npx through a
  // shell breaks on Windows paths that contain spaces.
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'r2', 'object', 'put', `${BUCKET}/${key}`,
      `--file=${file}`,
      `--content-type=${contentType}`,
      mode,
      '--config', CONFIG,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.status === 0) {
    uploaded += 1;
    process.stdout.write('.');
  } else {
    failures.push({ key, error: (result.stderr || result.stdout || '').trim().split('\n').slice(-2).join(' ') });
    process.stdout.write('x');
  }
}

console.log(`\nUploaded ${uploaded}/${files.length}.`);
if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure.key}: ${failure.error}`);
  process.exit(1);
}
