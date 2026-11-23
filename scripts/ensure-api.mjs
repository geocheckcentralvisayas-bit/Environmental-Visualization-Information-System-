#!/usr/bin/env node
/**
 * Starts the local authenticated API (Cloudflare Worker) for `npm run dev`.
 *
 * `npm run dev` only launches Vite. Vite proxies `/api/*` to the Worker on
 * port 8787, so if the Worker is not running every login and dataset request
 * fails with `ECONNREFUSED`:
 *
 *   http proxy error: /api/login
 *   AggregateError [ECONNREFUSED]
 *
 * This script runs automatically as npm's `predev` hook. It reuses an API that
 * is already serving and only starts one when port 8787 is free, so it can
 * never create the overlapping-wrangler situation that corrupts the local D1
 * state with SQLITE_BUSY.
 *
 * The Worker is detached so it keeps serving after this hook exits, and its
 * output goes to `logs/api-dev.log`. Set ENVIS_SKIP_API=1 to opt out.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ENVIS_API_PORT || 8787);
const HOST = '127.0.0.1';
const WRANGLER_BIN = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

if (process.env.ENVIS_SKIP_API === '1') {
  console.log('[api] ENVIS_SKIP_API=1 — not starting the local Worker.');
  process.exit(0);
}

if (!existsSync(WRANGLER_BIN)) {
  console.log('[api] wrangler is not installed; run `npm install` first.');
  process.exit(0);
}

function portInUse(port, timeout = 700) {
  return new Promise((done) => {
    const socket = connect({ host: HOST, port });
    const finish = (result) => {
      socket.destroy();
      done(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function healthy() {
  try {
    const response = await fetch(`http://${HOST}:${PORT}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

if (await portInUse(PORT)) {
  console.log(`[api] already serving on http://${HOST}:${PORT}`);
  process.exit(0);
}

mkdirSync(join(root, 'logs'), { recursive: true });
const logHandle = openSync(join(root, 'logs', 'api-dev.log'), 'a');

const child = spawn(
  process.execPath,
  [WRANGLER_BIN, 'dev', '--config', 'worker/wrangler.toml', '--local', '--port', String(PORT)],
  {
    cwd: root,
    env: process.env,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logHandle, logHandle],
  },
);
child.unref();

console.log(`[api] starting local Worker on http://${HOST}:${PORT} (log: logs/api-dev.log)`);

const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  if (await healthy()) {
    console.log('[api] ready');
    process.exit(0);
  }
  await sleep(400);
}

console.log('[api] still starting — Vite will proxy to it as soon as it answers.');
process.exit(0);
