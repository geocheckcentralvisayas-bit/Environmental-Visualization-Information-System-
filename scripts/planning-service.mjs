#!/usr/bin/env node
/**
 * Realtime service for the Planning Accomplishments tab.
 *
 * Watches the synced EMB 7 Accomplishment 2026 workbook, rebuilds
 * `public/data/planning.json` whenever its contents change, and serves the
 * current payload to the local Worker so the dashboard can refresh without a
 * redeploy.
 *
 *   node scripts/planning-service.mjs
 *   PLANNING_PORT=8788 PLANNING_POLL_MS=5000 node scripts/planning-service.mjs
 *
 * The Worker proxies `/api/data/planning.json` here when PLANNING_LIVE_URL is
 * set in worker/.dev.vars (local and LAN development). Without that variable
 * the Worker serves the last uploaded R2 snapshot instead.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlanning } from './build-planning.mjs';
import { resolveWorkbookPath } from './planning/parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'public', 'data', 'planning.json');
const LOG = path.join(ROOT, 'logs', 'planning.log');
const HOST = process.env.PLANNING_HOST || '127.0.0.1';
const PORT = Number(process.env.PLANNING_PORT || 8788);
const POLL_MS = Number(process.env.PLANNING_POLL_MS || 5000);

mkdirSync(path.dirname(LOG), { recursive: true });

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG, `${line}\n`);
  } catch {
    /* logging must never stop the service */
  }
}

let payload = null;
let contentHash = '';
let lastCheck = null;
let lastChange = null;
let lastError = null;
let checking = false;
let workbookPath = null;

function readCurrent() {
  if (!existsSync(OUTPUT)) return null;
  try {
    return JSON.parse(readFileSync(OUTPUT, 'utf8'));
  } catch {
    return null;
  }
}

function adopt(current) {
  payload = current;
  contentHash = current?.meta?.contentHash ?? '';
  lastChange = current?.meta?.generatedAt ?? null;
}

adopt(readCurrent());
if (payload) log(`loaded snapshot ${payload.meta.contentHash} (${payload.meta.counts.activities} activities)`);
else log('no snapshot yet; waiting for the workbook');

async function check({ force = false, reason = 'poll' } = {}) {
  if (checking) return;
  checking = true;
  try {
    if (!workbookPath || !existsSync(workbookPath)) {
      workbookPath = resolveWorkbookPath(ROOT);
      if (!workbookPath) throw new Error('Workbook not found. Set PLANNING_WORKBOOK or copy it into data/.');
      log(`watching ${workbookPath}`);
    }
    const buffer = readFileSync(workbookPath);
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    lastCheck = new Date().toISOString();
    if (!force && hash === contentHash) return;

    const started = Date.now();
    const result = buildPlanning({ source: workbookPath, quiet: true });
    payload = result.payload;
    contentHash = payload.meta.contentHash;
    lastChange = payload.meta.generatedAt;
    lastError = null;
    const elapsed = Date.now() - started;
    log(
      `${reason}: rebuilt in ${elapsed} ms · ${payload.meta.changed} change(s) · ` +
      `${payload.meta.counts.activities} activities · hash ${contentHash}`,
    );
    for (const event of result.events.slice(0, 8)) {
      if (event.kind === 'added') log(`  + row ${event.row} added: ${event.indicator}`);
      else if (event.kind === 'removed') log(`  - row ${event.row} removed: ${event.indicator}`);
      else log(`  ~ row ${event.row} ${event.label}: ${JSON.stringify(event.from)} -> ${JSON.stringify(event.to)}`);
    }
    if (result.events.length > 8) log(`  … ${result.events.length - 8} more change(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastError) log(`watch error: ${message}`);
    lastError = message;
    // A partially written workbook fails to parse; the next poll retries.
  } finally {
    checking = false;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);
  if (url.pathname === '/health') {
    const body = JSON.stringify({
      ok: Boolean(payload),
      contentHash,
      lastCheck,
      lastChange,
      lastError,
      source: workbookPath ? path.basename(workbookPath) : null,
    });
    response.writeHead(payload ? 200 : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
    return;
  }

  if (url.pathname === '/planning.json') {
    if (url.searchParams.get('refresh') === '1' || url.searchParams.get('force') === '1') {
      await check({ force: true, reason: 'refresh' });
    }
    if (!payload) {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: lastError || 'The planning workbook has not been read yet.' }));
      return;
    }
    const etag = `"${contentHash}"`;
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    const body = JSON.stringify(payload);
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
    return;
  }

  response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'Not found.' }));
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    log(`port ${PORT} is already serving; this instance will exit.`);
    process.exit(0);
  }
  log(`server error: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  log(`planning service listening on http://${HOST}:${PORT} (poll ${POLL_MS} ms)`);
  await check({ force: false, reason: 'startup' });
  setInterval(() => { void check({ reason: 'poll' }); }, POLL_MS).unref();
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    log(`received ${signal}; stopping.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
