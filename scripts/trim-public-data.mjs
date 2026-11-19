#!/usr/bin/env node
/**
 * Remove personal contact details from the published dataset.
 *
 * The dashboard is a static site, so every file under public/data is
 * downloadable without signing in. Fields that are not needed for the
 * dashboard's analytical views are stripped here so a future data rebuild
 * cannot reintroduce them.
 *
 * Idempotent: running it twice changes nothing. Run automatically as part of
 * `npm run data:all`, or manually with `npm run data:trim`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');

const TARGETS = [
  {
    file: 'hw.json',
    // The file is a plain array of registrations.
    records: (doc) => doc,
    drop: ['email', 'phone'],
  },
  {
    file: 'pco-database.json',
    // The file is an object with metadata and a `records` array.
    records: (doc) => doc?.records,
    drop: ['telephoneNo', 'managingHead'],
  },
];

let failures = 0;

for (const target of TARGETS) {
  const filePath = path.join(DATA_DIR, target.file);
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`  ✗ ${target.file}: cannot read (${error.message})`);
    failures += 1;
    continue;
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    console.error(`  ✗ ${target.file}: invalid JSON (${error.message})`);
    failures += 1;
    continue;
  }

  const records = target.records(doc);
  if (!Array.isArray(records)) {
    console.error(`  ✗ ${target.file}: expected a records array`);
    failures += 1;
    continue;
  }

  let removed = 0;
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    for (const field of target.drop) {
      if (Object.prototype.hasOwnProperty.call(record, field)) {
        delete record[field];
        removed += 1;
      }
    }
  }

  // Preserve the file's existing layout: pretty-printed files stay pretty so
  // diffs only show the removed fields; compact files stay compact.
  const indented = /^[[{]\s*\r?\n/.test(raw);
  const next = indented ? JSON.stringify(doc, null, 2) : JSON.stringify(doc);
  const changed = next !== raw;
  if (changed) writeFileSync(filePath, next, 'utf8');

  const before = Buffer.byteLength(raw, 'utf8');
  const after = Buffer.byteLength(next, 'utf8');
  const saved = Math.max(0, before - after);
  console.log(
    `  • ${target.file}: removed ${removed} value(s) [${target.drop.join(', ')}] · ` +
      `${(before / 1024 / 1024).toFixed(2)} MB → ${(after / 1024 / 1024).toFixed(2)} MB` +
      (changed ? '' : ' (already clean)'),
  );
  if (saved > 0) console.log(`    saved ${(saved / 1024).toFixed(0)} KB`);
}

if (failures > 0) {
  console.error(`\nData trim failed for ${failures} file(s).`);
  process.exit(1);
}

console.log('\nPublished data trimmed: no direct email, phone, or managing-head fields.');
