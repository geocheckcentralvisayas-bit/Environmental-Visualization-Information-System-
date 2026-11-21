#!/usr/bin/env node
/**
 * Build the EMED Monitoring dataset from the workbook.
 *
 *   node scripts/build-emed.mjs            # uses data/raw/emed-source.xlsx
 *   node scripts/build-emed.mjs --fetch    # re-downloads the workbook first
 *
 * Every sheet is published in full: all rows and all used columns. The index
 * (public/data/emed.json) holds the analysis + KPI summaries; each table lives
 * in public/data/emed/sheet-NN.json and is fetched when its tab is opened.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://docs.google.com/spreadsheets/d/1LWEv11oDBzshBav0fwvCiHgD3knmZtntnoYkij0-4Gw/edit?usp=sharing';
const EXPORT_URL = 'https://docs.google.com/spreadsheets/d/1LWEv11oDBzshBav0fwvCiHgD3knmZtntnoYkij0-4Gw/export?format=xlsx';
const CACHE = path.join(ROOT, 'data', 'raw', 'emed-source.xlsx');
const INDEX = path.join(ROOT, 'public', 'data', 'emed.json');
const SHEET_DIR = path.join(ROOT, 'public', 'data', 'emed');

const CATEGORIES = [
  { id: 'overview', label: 'Performance overview', sheets: ['DASHBOARD', 'KRA', 'GUIDE', 'REPORTS COUNT', 'VERIFICATION'] },
  { id: 'people', label: 'Inspector performance', sheets: ['100% for IPCR', '130% Lock', 'INDIVIDUAL SUMMARY', '100% DISTRIBUTION', '120% DISTRIBUTION', '1st Half Commitment', 'Plan Pivot'] },
  { id: 'targets', label: 'Targets & work plan', sheets: ['TARGET', 'WORK PLAN', 'ASSIGNMENT', 'Tasks Monitoring'] },
  { id: 'monitoring', label: 'Monitoring programs', sheets: ['ECP', 'Healthcare', 'PETC & PMVIC', 'SPECIAL KRAs', 'Evaluation & Approval of SST Pl', 'PDSF', 'TSD', 'TRP', 'CNC Cat C', 'BRS Con', 'Metal Industries', 'Upland Developments', 'Quarry Permittees', 'Reclamation Projects', 'ECC Rainwater'] },
  { id: 'enforcement', label: 'Complaints & cases', sheets: ['COMPLAINTS', 'PAB Cases'] },
  { id: 'registers', label: 'Registers & references', sheets: ['ESTABLISHMENT LIST', 'Database Record', 'Address Link', 'Ref'] },
  { id: 'monthly', label: 'Monthly inspection logs', sheets: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'All Excess NOV'] },
];

const DESCRIPTIONS = {
  DASHBOARD: 'Overall CY 2026 performance: monitoring and survey targets vs accomplishments, division ratios and monthly KRA output.',
  KRA: 'Key result areas with monthly targets for each monitoring and survey program.',
  GUIDE: 'Workbook notes and the inspectors/chiefs reporting cut-off schedule.',
  'REPORTS COUNT': 'Per-inspector report count by KRA for the current year.',
  VERIFICATION: 'Verification pass over the monthly accomplishment entries.',
  '100% for IPCR': 'Individual performance matrix: each KRA total per inspector.',
  '130% Lock': 'Locked 130% accomplishment ratios per inspector and CEMU.',
  'INDIVIDUAL SUMMARY': 'Per-inspector submitted reports, KRA targets, accomplishments and catch-up plan.',
  '100% DISTRIBUTION': 'Annual target distributed per inspector across every KRA.',
  '120% DISTRIBUTION': 'Stretch (120%) target distribution per inspector.',
  '1st Half Commitment': 'First-half committed target per inspector and KRA.',
  'Plan Pivot': 'Inspector list used by the work-plan pivot.',
  TARGET: 'Monthly target allocation per inspector, KRA and half-year.',
  'WORK PLAN': 'Inspection work plan: establishments, schedules and KRA flags — all entries.',
  ASSIGNMENT: 'Area assignments per inspector and CEMU, including alternates and focal roles.',
  'Tasks Monitoring': 'Daily task log per inspector and CEMU.',
  ECP: 'Environmentally Critical Projects: inspection status, operations status and quarterly reports.',
  'ECC Rainwater': 'ECC monitoring records for rainwater harvesting projects.',
  Healthcare: 'Healthcare facilities inspection register with area, status and quarterly reports.',
  'PETC & PMVIC': 'Private Emission Testing Centers and PMVICs with lanes, case handlers and quarterly inspection reports.',
  'SPECIAL KRAs': 'RATA and CEMS special monitoring programs per establishment.',
  'Evaluation & Approval of SST Pl': 'Stack sampling test plan evaluations and approvals.',
  PDSF: 'Provincial/Municipal Disposal and Special Facilities: permit and documentation status.',
  TSD: 'Treatment, storage and disposal facilities with permits and hazardous-waste codes.',
  TRP: 'Transporters of hazardous waste: registrations, vehicles and capacities.',
  'CNC Cat C': 'Certificate of Non-Coverage Category C records and validation status.',
  'BRS Con': 'Basel, Rotterdam and Stockholm conventions invited establishments and confirmation status.',
  'Metal Industries': 'Metal industry projects monitored under ECC conditions.',
  'Upland Developments': 'Upland development projects with inspection dates and turnover status.',
  'Quarry Permittees': 'Quarry permittees in Cebu with volumes, ECC references and inspection dates.',
  'Reclamation Projects': 'Reclamation projects with location, proponent, monitoring date and remarks.',
  COMPLAINTS: 'Complaints received, case handlers, action periods, endorsements and status.',
  'PAB Cases': 'Pollution Adjudication Board cases with docket, establishment, status and assigned inspector.',
  'ESTABLISHMENT LIST': 'Master establishment register with EMB ID, coordinates, address and category — all entries.',
  'Database Record': 'Linked reference databases and historical accomplishment dashboards.',
  'Address Link': 'Province / city / municipality / barangay lookup used for address normalisation.',
  Ref: 'Reference lists of project types and cell locations.',
  JAN: 'January 2026 inspection log with every KRA flag per establishment.',
  FEB: 'February 2026 inspection log with every KRA flag per establishment.',
  MAR: 'March 2026 inspection log with every KRA flag per establishment.',
  APR: 'April 2026 inspection log with every KRA flag per establishment.',
  MAY: 'May 2026 inspection log with every KRA flag per establishment.',
  JUN: 'June 2026 inspection log with every KRA flag per establishment.',
  JUL: 'July 2026 inspection log with every KRA flag per establishment.',
  AUG: 'August 2026 inspection log with every KRA flag per establishment.',
  SEP: 'September 2026 inspection log with every KRA flag per establishment.',
  OCT: 'October 2026 inspection log with every KRA flag per establishment.',
  NOV: 'November 2026 inspection log with every KRA flag per establishment.',
  DEC: 'December 2026 inspection log with every KRA flag per establishment.',
  'All Excess NOV': 'Accumulated November inspection entries beyond the regular log.',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 1-based header rows where the workbook's banners make auto-detection pick a data row. */
const HEADER_OVERRIDES = {
  DASHBOARD: 21,
  '100% for IPCR': 4,
  'ESTABLISHMENT LIST': 2,
  ECP: 4,
  'PETC & PMVIC': 5,
  Healthcare: 4,
  'Plan Pivot': 1,
  ASSIGNMENT: 3,
};

const clean = (value) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

const num = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = clean(value).replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

async function fetchWorkbook() {
  mkdirSync(path.dirname(CACHE), { recursive: true });
  console.log('Downloading EMED workbook…');
  const response = await fetch(EXPORT_URL, { headers: { 'user-agent': 'Mozilla/5.0 ENVIS-Dashboard/1.0' } });
  if (!response.ok) throw new Error(`Workbook download failed (HTTP ${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(CACHE, buffer);
  console.log(`  saved ${(buffer.length / 1_048_576).toFixed(1)} MB to ${path.relative(ROOT, CACHE)}`);
}

function detectHeader(rows) {
  let best = { index: 0, score: 0 };
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const cells = rows[index].map(clean);
    const filled = cells.filter(Boolean);
    if (filled.length < 3) continue;
    const unique = new Set(filled).size;
    const short = filled.filter((cell) => cell.length <= 70).length;
    const words = filled.filter((cell) => /[a-z]/i.test(cell)).length;
    const numbers = filled.filter((cell) => /^-?\d+(\.\d+)?$/.test(cell)).length;
    if (short !== filled.length) continue;
    const score = unique * 2 + words * 2 + short - numbers * 3;
    if (score > best.score) best = { index, score };
  }
  return best.index;
}

function buildColumns(headerRow, used) {
  const seen = new Map();
  return used.map((index) => {
    let name = clean(headerRow?.[index]) || `Column ${index + 1}`;
    if (name.length > 70) name = `${name.slice(0, 67)}…`;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

function analyze(rows, columns, projected) {
  const numericColumns = [];
  const categoricalColumns = [];
  for (let col = 0; col < columns.length; col += 1) {
    let sum = 0;
    let max = 0;
    let count = 0;
    const values = new Map();
    let blank = 0;
    for (const row of rows) {
      const value = num(row[col]);
      if (value !== null) {
        sum += value;
        max = Math.max(max, Math.abs(value));
        count += 1;
      }
      const text = clean(row[col]);
      if (!text) { blank += 1; continue; }
      if (text.length <= 40) values.set(text, (values.get(text) ?? 0) + 1);
    }
    const mean = count ? sum / count : 0;
    const looksLikeDateSerial = mean > 20_000 && mean < 70_000 && count > rows.length * 0.2;
    const isIdentifier = /\b(DATE|YEAR|MONTH|QUARTER|IIS|REF|CODE|LAT(ITUDE)?|LON(GITUDE)?|ID)\b/i.test(columns[col])
      || /^NO\.?$|^SG$|^CH$/i.test(columns[col]);
    const enoughValues = count >= Math.max(2, Math.floor(rows.length * 0.05));
    if (enoughValues && !looksLikeDateSerial && !isIdentifier) {
      numericColumns.push({ name: columns[col], sum: Number(sum.toFixed(2)), max, count });
    }
    if (values.size >= 2 && values.size <= 12 && values.size < rows.length * 0.6) {
      categoricalColumns.push({
        name: columns[col],
        values: [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
      });
    }
  }

  const monthGroups = MONTHS.map((month) => {
    const target = month.toUpperCase();
    const indexes = columns
      .map((label, index) => ({ label: label.toUpperCase().replace(/ \(\d+\)$/, ''), index }))
      .filter(({ label }) => label === target)
      .map(({ index }) => index);
    return { month, indexes };
  }).filter(({ indexes }) => indexes.length);
  let monthly = null;
  if (monthGroups.length >= 10) {
    monthly = {
      months: monthGroups.map(({ month }) => month),
      totals: monthGroups.map(({ indexes }) => Number(projected.reduce(
        (sum, row) => sum + indexes.reduce((inner, index) => inner + (num(row[index]) ?? 0), 0), 0,
      ).toFixed(2))),
    };
  }

  return {
    numericColumns: numericColumns.sort((a, b) => b.sum - a.sum).slice(0, 20),
    categoricalColumns: categoricalColumns.slice(0, 10),
    monthly,
  };
}

function sheetData(workbook, name, index) {
  const sheet = workbook.Sheets[name];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true, defval: '' });
  if (!rawRows.length) {
    return { meta: { name, description: DESCRIPTIONS[name] ?? name, file: '', headerRow: 0, columns: [], totalRows: 0, numericColumns: [], categoricalColumns: [], monthly: null }, detail: null };
  }

  // Keep the real spreadsheet row numbers: blank rows are common at the top of
  // the monthly logs and the work plan, so a compacted index would lie.
  const entries = rawRows.map((row, offset) => ({ row, rowNumber: offset + 1 }));
  const filled = entries.filter(({ row }) => row.some((cell) => clean(cell)));
  const detected = filled[detectHeader(filled.map(({ row }) => row))] ?? filled[0];
  const header = HEADER_OVERRIDES[name]
    ? (entries.find(({ rowNumber }) => rowNumber === HEADER_OVERRIDES[name]) ?? detected)
    : detected;
  const width = rawRows.reduce((max, row) => Math.max(max, row.length), 0);
  const body = entries.filter(({ row, rowNumber }) => rowNumber > header.rowNumber && row.some((cell) => clean(cell))).map(({ row }) => row);
  // Keep every column that carries data or a header label; drop only the
  // formatting-only empty columns that inflate wide sheets like Ref.
  const used = [];
  for (let col = 0; col < width; col += 1) {
    const label = clean(header.row?.[col]);
    if ((label && !/^Column \d+$/.test(label)) || body.some((row) => clean(row[col]))) used.push(col);
  }
  const columns = buildColumns(header.row, used);
  const rawProjected = body.map((row) => used.map((col) => row[col]));
  const rows = rawProjected.map((row) => row.map((value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = clean(value);
    return text.length > 500 ? `${text.slice(0, 497)}…` : text;
  }));

  const summary = analyze(rawProjected, columns, rows);
  const file = `emed/sheet-${String(index).padStart(2, '0')}.json`;
  const detail = {
    name,
    description: DESCRIPTIONS[name] ?? `${name} worksheet from the source workbook.`,
    headerRow: header.rowNumber,
    columns,
    rows,
    totalRows: rows.length,
    ...summary,
  };
  const { rows: _rows, ...meta } = detail;
  return { meta: { ...meta, file }, detail };
}

function parseDashboard(workbook) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.DASHBOARD, { header: 1, blankrows: true, defval: '' });
  const ratios = [
    { label: 'Overall', value: num(rows[5]?.[4]) },
    { label: 'Air', value: num(rows[5]?.[7]) },
    { label: 'Water', value: num(rows[5]?.[9]) },
    { label: 'Chemicals', value: num(rows[5]?.[11]) },
    { label: 'Hazardous waste', value: num(rows[5]?.[14]) },
    { label: 'EIA', value: num(rows[5]?.[17]) },
  ].filter((entry) => entry.value !== null);

  const sectors = [];
  for (let index = 21; index < rows.length; index += 1) {
    const row = rows[index];
    const name = clean(row[1]).replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim();
    if (!name || clean(row[2]).toUpperCase() !== 'TARGET') continue;
    const next = rows[index + 1] ?? [];
    if (clean(next[2]).toUpperCase() !== 'ACCOMP') continue;
    const target = MONTHS.map((_, month) => num(row[4 + month]) ?? 0);
    const accomplished = MONTHS.map((_, month) => num(next[4 + month]) ?? 0);
    const targetTotal = num(row[16]) ?? target.reduce((a, b) => a + b, 0);
    const accomplishedTotal = num(next[16]) ?? accomplished.reduce((a, b) => a + b, 0);
    sectors.push({
      name,
      target,
      accomplished,
      targetTotal,
      accomplishedTotal,
      ratio: targetTotal > 0 ? Number((accomplishedTotal / targetTotal).toFixed(3)) : null,
    });
  }

  return {
    asOf: clean(rows[6]?.[13]) || null,
    ratios,
    monitoring: { target: num(rows[6]?.[1]) ?? 0, accomplished: num(rows[6]?.[2]) ?? 0 },
    survey: { target: num(rows[12]?.[1]) ?? 0, accomplished: num(rows[12]?.[2]) ?? 0 },
    complaints: num(rows[18]?.[1]) ?? 0,
    sectors,
  };
}

function parseInspectors(workbook) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['100% for IPCR'], { header: 1, blankrows: true, defval: '' });
  const initialsRow = rows[3] ?? [];
  const namesRow = rows[1] ?? [];
  const slots = [];
  for (let col = 0; col < Math.max(initialsRow.length, namesRow.length); col += 1) {
    const initial = clean(initialsRow[col]);
    if (!/^[A-Z]{2,5}$/.test(initial)) continue;
    const name = clean(namesRow[col]);
    if (!name.includes(' ') || /^(TOTAL|EMB|CEMU|PEMU|BEMU|NOV)/i.test(name)) continue;
    if (slots.some((slot) => slot.initial === initial)) continue;
    slots.push({ col, initial, name });
  }
  const kraNames = [];
  const values = slots.map(() => []);
  for (let rowIndex = 5; rowIndex < rows.length; rowIndex += 1) {
    const label = clean(rows[rowIndex]?.[0]);
    if (!label) continue;
    kraNames.push(label);
    slots.forEach((slot, slotIndex) => {
      values[slotIndex].push(num(rows[rowIndex]?.[slot.col]) ?? 0);
    });
  }
  return {
    kraNames,
    inspectors: slots.map((slot, slotIndex) => ({
      name: slot.name,
      initial: slot.initial,
      values: values[slotIndex],
      total: values[slotIndex].reduce((a, b) => a + b, 0),
    })).sort((a, b) => b.total - a.total),
  };
}

async function main() {
  if (process.argv.includes('--fetch') || !existsSync(CACHE)) await fetchWorkbook();
  const workbook = XLSX.read(readFileSync(CACHE), { type: 'buffer' });
  console.log(`Analyzing ${workbook.SheetNames.length} sheets — every row and column…`);

  mkdirSync(SHEET_DIR, { recursive: true });
  for (const file of readdirSync(SHEET_DIR)) {
    if (/^sheet-\d{2}\.json$/.test(file)) rmSync(path.join(SHEET_DIR, file));
  }
  const results = workbook.SheetNames.map((name, index) => sheetData(workbook, name, index));
  let total = 0;
  results.forEach(({ detail }, index) => {
    if (!detail) return;
    const json = JSON.stringify(detail);
    total += Buffer.byteLength(json);
    writeFileSync(path.join(SHEET_DIR, `sheet-${String(index).padStart(2, '0')}.json`), json, 'utf8');
  });

  const byName = new Map(results.map(({ meta }) => [meta.name, meta]));
  const categories = CATEGORIES.map((category) => ({
    ...category,
    sheets: category.sheets.map((name) => byName.get(name)?.name).filter(Boolean),
  })).filter((category) => category.sheets.length);
  const assigned = new Set(categories.flatMap((category) => category.sheets));
  const uncategorized = results.map(({ meta }) => meta.name).filter((name) => !assigned.has(name));
  if (uncategorized.length) categories.push({ id: 'other', label: 'Other sheets', sheets: uncategorized });

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceUrl: SOURCE_URL,
    title: 'EMED Monitoring Dashboards',
    dashboard: parseDashboard(workbook),
    performance: parseInspectors(workbook),
    categories,
    sheets: results.map(({ meta }) => meta),
    notes: [
      'Every sheet is published in full — all rows and all used columns — in a separate file loaded when the tab is opened.',
      'The index carries the per-sheet analysis: detected header, column list, numeric totals, category mix and monthly totals.',
    ],
  };

  writeFileSync(INDEX, JSON.stringify(payload), 'utf8');
  console.log(`Wrote index (${(Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(0)} KB) and ${results.length} full sheet tables (${(total / 1_048_576).toFixed(1)} MB).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
