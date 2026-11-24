#!/usr/bin/env node
/**
 * Build public/data/planning.json from the EMB 7 Accomplishment 2026 workbook.
 *
 *   node scripts/build-planning.mjs
 *   node scripts/build-planning.mjs --source "C:\path\to\workbook.xlsx"
 *   node scripts/build-planning.mjs --quiet
 *
 * The output is the single source the dashboard reads. The same builder is
 * used by the realtime watcher (scripts/planning-service.mjs), so a manual
 * build and a detected change produce identical payloads.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffPayloads, parseWorkbook, resolveWorkbookPath } from './planning/parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'public', 'data', 'planning.json');
const MAX_LOG = 300;
const MAX_EVENTS = 500;

function readPrevious() {
  if (!existsSync(OUTPUT)) return null;
  try {
    return JSON.parse(readFileSync(OUTPUT, 'utf8'));
  } catch {
    return null;
  }
}

function trim(value) {
  if (typeof value !== 'string') return value;
  return value.length > 300 ? `${value.slice(0, 297)}…` : value;
}

export function buildPlanning({ source, quiet = false } = {}) {
  const filePath = source ? path.resolve(source) : resolveWorkbookPath(ROOT);
  if (!filePath) {
    throw new Error(
      'The EMB 7 Accomplishment 2026 workbook was not found. Set PLANNING_WORKBOOK or copy it to data/EMB 7 Accomplishment 2026 - ALL SECTIONS.xlsx.',
    );
  }
  if (!existsSync(filePath)) throw new Error(`Workbook not found at ${filePath}`);

  const previous = readPrevious();
  const payload = parseWorkbook(filePath);

  const now = payload.meta.generatedAt;
  const events = diffPayloads(previous, payload).slice(0, MAX_EVENTS).map((event) => ({
    at: now,
    ...event,
    from: trim(event.from),
    to: trim(event.to),
  }));
  const previousLog = Array.isArray(previous?.meta?.changeLog) ? previous.meta.changeLog : [];
  payload.meta.changeLog = [...events, ...previousLog].slice(0, MAX_LOG);
  payload.meta.changed = events.length;
  payload.meta.previousGeneratedAt = previous?.meta?.generatedAt ?? null;
  payload.changes = events;

  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const temporary = `${OUTPUT}.tmp`;
  writeFileSync(temporary, JSON.stringify(payload), 'utf8');
  renameSync(temporary, OUTPUT);

  if (!quiet) {
    const { meta } = payload;
    console.log(`[planning] ${meta.counts.activities} activities · ${meta.counts.sections} sections · ${meta.counts.projects} projects`);
    console.log(`[planning] reporting month: ${meta.reportingMonthLabel} · status: ${JSON.stringify(meta.statusCounts)}`);
    console.log(`[planning] ${meta.changed} detected change(s) since the previous build`);
    console.log(`[planning] source: ${filePath}`);
    console.log(`[planning] wrote ${path.relative(ROOT, OUTPUT)} (${(readFileSync(OUTPUT).length / 1024).toFixed(1)} KB)`);
  }
  return { payload, output: OUTPUT, events };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const sourceIndex = process.argv.indexOf('--source');
  const source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined;
  try {
    buildPlanning({ source, quiet: process.argv.includes('--quiet') });
  } catch (error) {
    console.error(`[planning] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
