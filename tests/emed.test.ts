import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file: string) => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));

test('EMED build keeps every sheet and publishes the full tables', () => {
  execFileSync(process.execPath, ['scripts/build-emed.mjs'], { cwd: ROOT, stdio: 'pipe' });
  const index = readJson('public/data/emed.json');
  assert.equal(index.sheets.length, 50);
  assert.equal(index.dashboard.monitoring.accomplished, 3170);
  assert.equal(index.dashboard.sectors.length, 24);

  const jan = readJson('public/data/emed/sheet-21.json');
  assert.ok(jan.totalRows > 3000, 'JAN must contain every inspection row');
  assert.ok(jan.columns.length >= 50, 'JAN must contain every used column');

  const dash = index.sheets.find((sheet: { name: string }) => sheet.name === 'DASHBOARD');
  assert.equal(dash.headerRow, 21, 'DASHBOARD header must be the real spreadsheet row');

  const establishments = index.sheets.find((sheet: { name: string }) => sheet.name === 'ESTABLISHMENT LIST');
  assert.ok(
    establishments.categoricalColumns.some((column: { name: string }) => column.name === 'PROVINCE'),
    'category analysis must not delete a previously detected column',
  );
});
