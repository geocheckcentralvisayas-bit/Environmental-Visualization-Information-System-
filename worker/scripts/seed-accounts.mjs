#!/usr/bin/env node
/**
 * Seed the API's account table from the untracked CREDENTIALS.md file.
 *
 * Produces worker/.local/seed.sql (git-ignored) with PBKDF2 hashes. The
 * plaintext passwords never leave CREDENTIALS.md.
 *
 *   node worker/scripts/seed-accounts.mjs
 *   wrangler d1 execute envis --local --config worker/wrangler.toml --file=worker/.local/seed.sql
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CREDS = path.join(ROOT, 'CREDENTIALS.md');
const OUT_DIR = path.join(ROOT, 'worker', '.local');
const OUT = path.join(OUT_DIR, 'seed.sql');
const ITERATIONS = 210_000;

const PROFILE = {
  'rd.regional': { displayName: 'Regional Director', division: 'Office of the Regional Director', role: 'rd' },
  'emed.enforce': { displayName: 'Environmental Monitoring & Enforcement Division', division: 'EMED', role: 'emed' },
  'cpd.permits': { displayName: 'Clearance and Permitting Division', division: 'CPD', role: 'cpd' },
  'mis.systems': { displayName: 'Management and Information System', division: 'MIS', role: 'mis' },
  extractor: { displayName: 'Data Extraction Unit', division: 'Data Extraction', role: 'extraction' },
  'gis.spatial': { displayName: 'GIS Unit', division: 'GIS / Spatial Data', role: 'gis' },
};

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const digest = pbkdf2Sync(password, Buffer.from(salt, 'hex'), ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2$${ITERATIONS}$${salt}$${digest}`;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const raw = readFileSync(CREDS, 'utf8');
const rows = [];
for (const line of raw.split(/\r?\n/)) {
  const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/);
  if (match) rows.push({ login: match[1].trim().toLowerCase(), password: match[2] });
}

if (!rows.length) throw new Error('No credentials parsed from CREDENTIALS.md');

const statements = ['PRAGMA foreign_keys = ON;'];
const now = Date.now();

for (const row of rows) {
  const profile = PROFILE[row.login];
  if (!profile) {
    console.warn(`  ! skipping unknown account ${row.login}`);
    continue;
  }
  statements.push(
    `INSERT INTO accounts (username, display_name, division, role, password_hash, active, builtin, created_at, updated_at)
VALUES (${sqlString(row.login)}, ${sqlString(profile.displayName)}, ${sqlString(profile.division)}, ${sqlString(profile.role)}, ${sqlString(hashPassword(row.password))}, 1, 1, ${now}, ${now})
ON CONFLICT(username) DO UPDATE SET
  display_name = excluded.display_name,
  division = excluded.division,
  role = excluded.role,
  password_hash = excluded.password_hash,
  active = 1,
  builtin = 1,
  updated_at = excluded.updated_at;`,
  );
}

statements.push('DELETE FROM sessions;');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, `${statements.join('\n')}\n`, 'utf8');
console.log(`Seeded ${rows.length} account(s) into ${path.relative(ROOT, OUT)} (passwords not printed).`);
