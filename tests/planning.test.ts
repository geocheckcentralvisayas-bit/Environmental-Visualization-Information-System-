import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import XLSX from 'xlsx';
import { diffPayloads, parseNumber, parseWorkbook } from '../scripts/planning/parse.mjs';
import { planningCsv } from '../src/lib/planning/format';

const TEMP = mkdtempSync(path.join(os.tmpdir(), 'envis-planning-'));
after(() => rmSync(TEMP, { recursive: true, force: true }));

const HEADER = [
  'SECTION/UNIT', 'PROGRAM/ PROJECTS/ ACTIVITIES', 'PERFORMANCE INDICATORS', 'MONTHLY TARGET',
  null, null, null, null, null, null, null, null, null, null, null, 'TOTAL', null,
  'MONTHLY ACCOMPLISHMENTS', null, null, null, null, null, null, null, null, null, null, null, null, 'TOTAL',
  '% TO DATE', '% ANNUAL', 'REMARKS', 'MOV', 'REMARKS 2',
];
const MONTH_HEADER = (() => {
  const row: (string | null)[] = Array(48).fill(null);
  ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].forEach((month, index) => {
    row[3 + index] = month;
    row[17 + index] = month;
  });
  row[15] = 'TOTAL';
  row[29] = 'TOTAL';
  return row;
})();

function activityRow({
  section = null, project = null, indicator, target = 0, actual = 0, pct = null, annual = null, remarks = null, mov = null,
}: {
  section?: string | null;
  project?: string | null;
  indicator: string;
  target?: number;
  actual?: number;
  pct?: number | null;
  annual?: number | null;
  remarks?: string | null;
  mov?: string | null;
}) {
  const row: (string | number | null)[] = Array(48).fill(null);
  row[0] = section;
  row[1] = project;
  row[2] = indicator;
  row[3] = target;
  row[15] = target;
  row[17] = actual;
  row[29] = actual;
  row[30] = pct;
  row[31] = annual;
  row[32] = remarks;
  row[33] = mov;
  return row;
}

function buildWorkbook(actualJan = 10) {
  const workbook = XLSX.utils.book_new();
  const main = XLSX.utils.aoa_to_sheet([
    HEADER,
    MONTH_HEADER,
    Array(48).fill(null),
    Array(48).fill(null),
    activityRow({ section: 'FAD', project: 'Project A', indicator: 'Indicator A', target: 10, actual: actualJan, pct: 1, annual: 1, remarks: 'done', mov: 'MOV-1' }),
    activityRow({ indicator: 'Indicator B', target: 4, pct: 0.5 }),
    activityRow({ indicator: 'Indicator C', actual: 3 }),
  ]);
  XLSX.utils.book_append_sheet(workbook, main, 'Main (for CO)');
  const focals = XLSX.utils.aoa_to_sheet([
    [null, 'Name of Focal staff and Alternate staff (FY 2025)'],
    [null, 'Planning and Budget (FOCAL)', 'Planning and Budget (alternate)', 'Database (FOCAL)', 'Database (alternate)', 'Represented'],
    ['FAD - HR', 'SANCHEZ, SALVACION S.', 'VENICE', 'VENICE', 'JUVY', 'false'],
  ]);
  XLSX.utils.book_append_sheet(workbook, focals, 'Focals');
  const file = path.join(TEMP, `workbook-${actualJan}.xlsx`);
  XLSX.writeFile(workbook, file);
  return file;
}

test('the parser forward-fills merges and derives statuses', () => {
  const payload = parseWorkbook(buildWorkbook());
  assert.equal(payload.meta.counts.activities, 3);
  assert.equal(payload.meta.counts.sections, 1);
  assert.equal(payload.meta.reportingMonth, 1);
  assert.equal(payload.meta.reportingMonthLabel, 'January');
  assert.equal(payload.records[0].section, 'FAD');
  assert.equal(payload.records[0].project, 'Project A');
  assert.equal(payload.records[0].status, 'Met');
  assert.equal(payload.records[0].remarks, 'done');
  assert.equal(payload.records[0].mov, 'MOV-1');
  assert.equal(payload.records[1].project, 'Project A', 'blank project carries forward');
  assert.ok(payload.records[1].flags.includes('missing-project'));
  assert.equal(payload.records[1].status, 'At Risk');
  assert.equal(payload.records[2].status, 'On Track');
  assert.ok(payload.records[2].flags.includes('actual-without-target'));
  assert.ok(payload.records[2].flags.includes('no-target'));
  assert.equal(payload.sections[0].focals[0].section, 'FAD - HR');
  assert.equal(payload.monthly.length, 12);
  assert.equal(payload.monthly[0].assessed, 2);
  assert.equal(payload.monthly[0].met, 1);
  assert.equal(payload.monthly[0].rate, 0.5);
  assert.equal(payload.monthly[1].rate, null);
});

test('the diff reports field-level changes for the change log', () => {
  const before = parseWorkbook(buildWorkbook(10));
  const afterPayload = parseWorkbook(buildWorkbook(12));
  const events = diffPayloads(before, afterPayload);
  const actual = events.find((event: { label?: string }) => event.label === 'Jan actual');
  assert.ok(actual, 'a January actual change must be reported');
  assert.equal(actual.from, 10);
  assert.equal(actual.to, 12);
  assert.ok(events.some((event: { label?: string }) => event.label === 'Accomplished total'));
});

test('percentages and text cells are read without inventing numbers', () => {
  assert.equal(parseNumber('85%'), 0.85);
  assert.equal(parseNumber('1,234'), 1234);
  assert.equal(parseNumber('-'), null);
  assert.equal(parseNumber('deduct 4 since october'), null);
  assert.equal(parseNumber(0), 0);
});

test('the CSV export carries every target and actual month', () => {
  const payload = parseWorkbook(buildWorkbook());
  const csv = planningCsv(payload.records);
  const header = csv.split('\r\n')[0];
  assert.ok(header.includes('Jan target'));
  assert.ok(header.includes('Dec target'));
  assert.ok(header.includes('Jan actual'));
  assert.ok(header.includes('Dec actual'));
  assert.ok(header.includes('Means of verification'));
  assert.equal(csv.split('\r\n').length, payload.records.length + 1);
});
