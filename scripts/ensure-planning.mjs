#!/usr/bin/env node
/**
 * Starts the planning realtime service for `npm run dev`.
 *
 * The service watches the EMB 7 Accomplishment workbook and serves the live
 * payload on port 8788. Like scripts/ensure-api.mjs it reuses a service that is
 * already answering, so `predev` never starts a duplicate.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PLANNING_PORT || 8788);
const HOST = '127.0.0.1';

if (process.env.ENVIS_SKIP_PLANNING === '1') {
  console.log('[planning] ENVIS_SKIP_PLANNING=1 — not starting the planning service.');
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
    const response = await fetch(`http://${HOST}:${PORT}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

if (await portInUse(PORT)) {
  console.log(`[planning] already serving on http://${HOST}:${PORT}`);
  process.exit(0);
}

mkdirSync(join(root, 'logs'), { recursive: true });
const logHandle = openSync(join(root, 'logs', 'planning.log'), 'a');

const child = spawn(process.execPath, [join(root, 'scripts', 'planning-service.mjs')], {
  cwd: root,
  env: process.env,
  detached: true,
  windowsHide: true,
  stdio: ['ignore', logHandle, logHandle],
});
child.unref();

console.log(`[planning] starting realtime service on http://${HOST}:${PORT} (log: logs/planning.log)`);

const deadline = Date.now() + 20_000;
while (Date.now() < deadline) {
  if (await healthy()) {
    console.log('[planning] ready');
    process.exit(0);
  }
  await sleep(400);
}

console.log('[planning] still starting — the dashboard will fall back to the last snapshot until it answers.');
process.exit(0);
