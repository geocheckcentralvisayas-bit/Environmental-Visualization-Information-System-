/**
 * Parser for the EMB Region VII "EMB 7 Accomplishment 2026 - ALL SECTIONS"
 * workbook.
 *
 * The workbook is a monthly accomplishment matrix, not a project portfolio.
 * One row is one performance indicator with twelve monthly targets, twelve
 * monthly actuals, remarks and means of verification. This module turns the
 * consolidated `Main (for CO)` sheet into a compact JSON payload that the
 * dashboard can render without Excel.
 *
 * Everything is derived from the sheet, and the sheet stays the source of
 * truth. Values that cannot be read as a number are kept verbatim in a
 * `*Text` field and reported as a data-quality flag instead of being silently
 * dropped.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import XLSX from 'xlsx';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const SHEET_NAME = 'Main (for CO)';
export const FOCALS_SHEET = 'Focals';

// Column indexes (0-based) in the consolidated sheet.
const COL = {
  section: 0,
  project: 1,
  indicator: 2,
  targets: 3, // D..O
  targetTotal: 15, // P
  actuals: 17, // R..AC
  actualTotal: 29, // AD
  pctToDate: 30, // AE
  pctAnnual: 31, // AF
  remarks: 32, // AG
  mov: 33, // AH
  remarks2: 34, // AI
  workA: 37, // AL (undocumented worksheet column)
  workB: 38, // AM (undocumented worksheet column)
  quarterTarget: 44, // AS
  toDateTarget: 45, // AT
  quarterActual: 46, // AU
  toDateActual: 47, // AV
};

export const STATUS_KEYS = ['Met', 'On Track', 'At Risk', 'Delayed', 'Not Started', 'No Target'];

export const STATUS_DEFINITIONS = {
  Met: 'Attainment is at or above 100% of the target to date.',
  'On Track': 'Attainment is between 90% and 99% of the target to date.',
  'At Risk': 'Attainment is between 50% and 89% of the target to date.',
  Delayed: 'Attainment is above 0% but below 50% of the target to date.',
  'Not Started': 'A target exists but no accomplishment has been recorded.',
  'No Target': 'The indicator has no target to date, so attainment cannot be computed.',
};

export const FLAG_LABELS = {
  'missing-project': 'No project label (carried forward from the row above)',
  'no-target': 'No monthly target recorded',
  'actual-without-target': 'Accomplishment recorded where the target is zero',
  'over-100': 'Attainment is above 100%',
  'text-in-months': 'Non-numeric entry in a monthly cell',
  'total-mismatch': 'Total does not equal the sum of the monthly cells',
  'no-remarks': 'No remarks',
  'no-mov': 'No means of verification',
  'future-actual': 'Accomplishment recorded in a month after the reporting month',
  'dash-rate': 'Percentage to date is not computed in the workbook',
  'rate-mismatch': 'Workbook % to date differs from the monthly totals',
  'missing-indicator': 'Row has no performance indicator',
};

const FOCAL_ALIASES = {
  fad: ['FAD - HR', 'FAD - Finance'],
  ambient: ['AMBIENT - air', 'AMBIENT - water'],
  'emedtchwms': ['EMED-TCHWMS'],
  'cpdeia': ['EIA'],
  'emedawms': ['EMED-AWMS'],
};

export function normaliseKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Remarks cells use 0 as an empty-formula placeholder. */
function remarkText(value) {
  const text = cleanText(value);
  if (!text || text === '0' || text === '-' || text === '—') return '';
  return text;
}

export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return null;
  const raw = String(value).trim();
  if (!raw || raw === '-' || raw === '—' || raw === '–') return null;
  const percent = raw.endsWith('%');
  const cleaned = raw.replace(/,/g, '').replace(/%$/, '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return percent ? parsed / 100 : parsed;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

export function statusFor(rate, target, actual) {
  if (rate === null || rate === undefined) {
    if (target <= 0 && actual > 0) return 'On Track';
    return 'No Target';
  }
  if (rate >= 1) return 'Met';
  if (rate >= 0.9) return 'On Track';
  if (rate >= 0.5) return 'At Risk';
  if (rate > 0) return 'Delayed';
  return 'Not Started';
}

function pick(row, index) {
  return row?.[index];
}

function sectionKeyForFocals(section) {
  const key = normaliseKey(section);
  return FOCAL_ALIASES[key] ?? [section];
}

/** Find the workbook on disk: explicit env var, project copy, known OneDrive path, then a glob. */
export function resolveWorkbookPath(root, override = process.env.PLANNING_WORKBOOK) {
  const candidates = [
    override,
    path.join(root, 'data', 'EMB 7 Accomplishment 2026 - ALL SECTIONS.xlsx'),
    path.join(
      os.homedir(),
      'OneDrive - Environmental Management Bureau',
      'EMB Office Files',
      '10 Reports (Annual, Monthly, Quarterly)',
      '2026 Monthly Accomplishment',
      'ORD-PLANNING',
      'EMB 7 Accomplishment 2026 - ALL SECTIONS.xlsx',
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Last resort: search the user's OneDrive folders for the workbook.
  try {
    const home = os.homedir();
    const roots = readdirSync(home, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^OneDrive/i.test(entry.name))
      .map((entry) => path.join(home, entry.name));
    for (const base of roots) {
      const found = findFile(base, /^EMB 7 Accomplishment 2026.*\.xlsx$/i, 0);
      if (found) return found;
    }
  } catch {
    /* ignore discovery errors */
  }
  return null;
}

function findFile(dir, pattern, depth) {
  if (depth > 8) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (/^(\$RECYCLE|node_modules|\.git)$/i.test(entry.name)) continue;
      const found = findFile(path.join(dir, entry.name), pattern, depth + 1);
      if (found) return found;
    } else if (pattern.test(entry.name)) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

function readFocals(workbook) {
  const sheet = workbook.Sheets[FOCALS_SHEET];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  const entries = [];
  let inFirstBlock = false;
  for (const row of rows) {
    const cells = row.map(cleanText);
    const heading = cells[0] || cells[1] || '';
    if (/^name of focal staff/i.test(heading)) {
      inFirstBlock = /FY 2025/i.test(heading);
      continue;
    }
    const section = cells[0] ?? '';
    if (!inFirstBlock || !section || /^planning and budget/i.test(section)) continue;
    entries.push({
      section,
      focal: cells[1] || '',
      alternate: cells[2] || '',
      database: cells[3] || '',
      databaseAlternate: cells[4] || '',
    });
  }
  return entries;
}

export function parseWorkbook(filePath) {
  const stat = statSync(filePath);
  const buffer = readFileSync(filePath);
  const contentHash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" was not found. Sheets: ${workbook.SheetNames.join(', ')}`);
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  const focals = readFocals(workbook);

  let lastSection = '';
  let lastProject = '';
  const records = [];
  const issues = [];

  for (let index = 4; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rawSection = cleanText(pick(row, COL.section));
    const rawProject = cleanText(pick(row, COL.project));
    const indicator = cleanText(pick(row, COL.indicator));

    if (rawSection) lastSection = rawSection;
    // A/B are sparse because the workbook uses visual merges. A row without an
    // indicator is a heading (for example "SUPPORT ACTIVITIES"), not an activity.
    if (!indicator) continue;
    if (rawProject) lastProject = rawProject;

    const targets = [];
    const actuals = [];
    const targetText = [];
    const actualText = [];
    const flags = [];

    for (let month = 0; month < 12; month += 1) {
      const targetCell = pick(row, COL.targets + month);
      const actualCell = pick(row, COL.actuals + month);
      targets.push(parseNumber(targetCell) ?? 0);
      actuals.push(parseNumber(actualCell) ?? 0);
      targetText.push(parseNumber(targetCell) === null ? remarkText(targetCell) : '');
      actualText.push(parseNumber(actualCell) === null ? remarkText(actualCell) : '');
      if (actualText[month]) flags.push('text-in-months');
    }

    const targetTotalCell = parseNumber(pick(row, COL.targetTotal));
    const actualTotalCell = parseNumber(pick(row, COL.actualTotal));
    const targetsTotal = targetTotalCell ?? sum(targets);
    const actualsTotal = actualTotalCell ?? sum(actuals);
    if (targetTotalCell !== null && Math.abs(targetTotalCell - sum(targets)) > 0.001) flags.push('total-mismatch');
    if (actualTotalCell !== null && Math.abs(actualTotalCell - sum(actuals)) > 0.001) flags.push('total-mismatch');

    const pctToDate = parseNumber(pick(row, COL.pctToDate));
    const pctAnnual = parseNumber(pick(row, COL.pctAnnual));
    const remarks = remarkText(pick(row, COL.remarks));
    const mov = remarkText(pick(row, COL.mov));
    const remarks2 = remarkText(pick(row, COL.remarks2));

    if (!rawProject) flags.push('missing-project');
    if (targets.every((value) => value === 0)) flags.push('no-target');
    if (remarks === '') flags.push('no-remarks');
    if (mov === '') flags.push('no-mov');
    if (pctToDate === null) flags.push('dash-rate');

    const record = {
      id: `r${index + 1}`,
      row: index + 1,
      section: lastSection,
      project: lastProject,
      indicator,
      targets: targets.map((value) => round(value)),
      actuals: actuals.map((value) => round(value)),
      targetText,
      actualText,
      targetsTotal: round(targetsTotal),
      actualsTotal: round(actualsTotal),
      pctToDate: round(pctToDate),
      pctAnnual: round(pctAnnual),
      remarks,
      mov,
      remarks2,
      working: {
        a: round(parseNumber(pick(row, COL.workA))),
        b: round(parseNumber(pick(row, COL.workB))),
        quarterTarget: round(parseNumber(pick(row, COL.quarterTarget))),
        toDateTarget: round(parseNumber(pick(row, COL.toDateTarget))),
        quarterActual: round(parseNumber(pick(row, COL.quarterActual))),
        toDateActual: round(parseNumber(pick(row, COL.toDateActual))),
      },
      flags: [...new Set(flags)],
      status: 'No Target',
      rate: null,
      ytdTarget: 0,
      ytdActual: 0,
    };
    records.push(record);
  }

  // Reporting month: the latest month that actually contains an accomplishment.
  // A month full of zeroes is not evidence that it has been reported.
  const lastMonthIndex = (() => {
    for (let month = 11; month >= 0; month -= 1) {
      if (records.some((record) => record.actuals[month] !== 0)) return month;
    }
    return new Date().getMonth();
  })();
  const reportingMonth = lastMonthIndex + 1;

  for (const record of records) {
    for (let month = 0; month < 12; month += 1) {
      const target = record.targets[month];
      const actual = record.actuals[month];
      if (target === 0 && actual > 0) record.flags.push('actual-without-target');
      if (month + 1 > reportingMonth && actual > 0) record.flags.push('future-actual');
    }
    const ytdSlice = record.targets.slice(0, reportingMonth);
    record.ytdTarget = round(sum(ytdSlice));
    record.ytdActual = round(sum(record.actuals.slice(0, reportingMonth)));
    const computed = record.ytdTarget > 0 ? record.ytdActual / record.ytdTarget : null;
    record.rate = record.pctToDate ?? computed;
    record.status = statusFor(record.rate, record.ytdTarget, record.ytdActual);
    if (record.rate !== null && record.rate > 1) record.flags.push('over-100');
    if (record.pctToDate !== null && computed !== null && record.ytdTarget > 0 && Math.abs(record.pctToDate - computed) > 0.05) {
      record.flags.push('rate-mismatch');
    }
    record.flags = [...new Set(record.flags)];
    for (const flag of record.flags) {
      issues.push({
        row: record.row,
        id: record.id,
        section: record.section,
        indicator: record.indicator,
        type: flag,
        label: FLAG_LABELS[flag] ?? flag,
      });
    }
  }

  const monthly = MONTHS.map((label, index) => {
    const assessed = records.filter((record) => record.targets[index] > 0);
    const met = assessed.filter((record) => record.actuals[index] >= record.targets[index]);
    return {
      index: index + 1,
      label,
      longLabel: MONTHS_LONG[index],
      target: round(sum(records.map((record) => record.targets[index]))),
      actual: round(sum(records.map((record) => record.actuals[index]))),
      assessed: assessed.length,
      met: met.length,
      rate: index + 1 > reportingMonth ? null : assessed.length ? round(met.length / assessed.length) : null,
      isReportingMonth: index + 1 === reportingMonth,
      isFuture: index + 1 > reportingMonth,
    };
  });

  const sections = [...new Set(records.map((record) => record.section))].map((section) => {
    const items = records.filter((record) => record.section === section);
    const rates = items.map((record) => record.rate).filter((value) => value !== null);
    const counts = Object.fromEntries(STATUS_KEYS.map((status) => [status, 0]));
    for (const item of items) counts[item.status] += 1;
    const focalNames = new Set(sectionKeyForFocals(section).map(normaliseKey));
    const matchedFocals = focals.filter((entry) => focalNames.has(normaliseKey(entry.section)));
    return {
      section,
      activities: items.length,
      projects: new Set(items.map((record) => record.project).filter(Boolean)).size,
      medianRate: round(median(rates)),
      meanRate: rates.length ? round(sum(rates) / rates.length) : null,
      assessed: rates.length,
      statusCounts: counts,
      metMonths: monthly.reduce((total, point) => total + items.filter((record) => record.targets[point.index - 1] > 0 && record.actuals[point.index - 1] >= record.targets[point.index - 1]).length, 0),
      assessedMonths: monthly.reduce((total, point) => total + items.filter((record) => record.targets[point.index - 1] > 0).length, 0),
      focals: matchedFocals,
    };
  }).sort((a, b) => b.activities - a.activities);

  const byType = {};
  for (const issue of issues) byType[issue.type] = (byType[issue.type] ?? 0) + 1;

  const statusCounts = Object.fromEntries(STATUS_KEYS.map((status) => [status, 0]));
  for (const record of records) statusCounts[record.status] += 1;

  const totalAssessed = records.filter((record) => record.rate !== null).length;
  const totalMet = records.filter((record) => record.status === 'Met').length;

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      contentHash,
      year: 2026,
      reportingMonth,
      reportingMonthLabel: MONTHS_LONG[reportingMonth - 1] ?? '',
      source: {
        path: filePath,
        fileName: path.basename(filePath),
        sheet: SHEET_NAME,
        modifiedAt: stat.mtime.toISOString(),
        bytes: stat.size,
      },
      monthLabels: MONTHS,
      statusDefinitions: STATUS_DEFINITIONS,
      counts: {
        activities: records.length,
        sections: sections.length,
        projects: new Set(records.map((record) => record.project).filter(Boolean)).size,
        assessed: totalAssessed,
        met: totalMet,
        overallRate: totalAssessed ? round(totalMet / totalAssessed) : null,
      },
      statusCounts,
    },
    monthly,
    sections,
    records,
    focals,
    quality: {
      totalIssues: issues.length,
      byType,
      issues: issues.slice(0, 600),
      truncated: issues.length > 600,
    },
    changes: [],
  };
}

function comparable(record) {
  return {
    section: record.section,
    project: record.project,
    indicator: record.indicator,
    targets: record.targets,
    actuals: record.actuals,
    pctToDate: record.pctToDate,
    pctAnnual: record.pctAnnual,
    targetsTotal: record.targetsTotal,
    actualsTotal: record.actualsTotal,
    remarks: record.remarks,
    mov: record.mov,
    remarks2: record.remarks2,
    status: record.status,
  };
}

const FIELD_LABELS = {
  section: 'Section',
  project: 'Project',
  indicator: 'Indicator',
  pctToDate: '% to date',
  pctAnnual: '% annual',
  targetsTotal: 'Target total',
  actualsTotal: 'Accomplished total',
  remarks: 'Remarks',
  mov: 'Means of verification',
  remarks2: 'Remarks (column AI)',
  status: 'Status',
};

/** Field-level difference between two payload snapshots, for the change log. */
export function diffPayloads(previous, next) {
  const events = [];
  if (!previous) return events;
  const before = new Map((previous.records ?? []).map((record) => [record.id, record]));
  const after = new Map((next.records ?? []).map((record) => [record.id, record]));

  for (const [id, record] of after) {
    const old = before.get(id);
    if (!old) {
      events.push({ kind: 'added', row: record.row, id, section: record.section, indicator: record.indicator });
      continue;
    }
    const a = comparable(old);
    const b = comparable(record);
    for (const key of ['section', 'project', 'indicator', 'pctToDate', 'pctAnnual', 'targetsTotal', 'actualsTotal', 'remarks', 'mov', 'remarks2', 'status']) {
      if (a[key] !== b[key]) {
        events.push({
          kind: 'updated', row: record.row, id, section: record.section, indicator: record.indicator,
          field: key, label: FIELD_LABELS[key], from: a[key], to: b[key],
        });
      }
    }
    for (let month = 0; month < 12; month += 1) {
      if (a.targets[month] !== b.targets[month]) {
        events.push({
          kind: 'updated', row: record.row, id, section: record.section, indicator: record.indicator,
          field: `targets.${month}`, label: `${MONTHS[month]} target`, from: a.targets[month], to: b.targets[month],
        });
      }
      if (a.actuals[month] !== b.actuals[month]) {
        events.push({
          kind: 'updated', row: record.row, id, section: record.section, indicator: record.indicator,
          field: `actuals.${month}`, label: `${MONTHS[month]} actual`, from: a.actuals[month], to: b.actuals[month],
        });
      }
    }
  }
  for (const [id, record] of before) {
    if (!after.has(id)) {
      events.push({ kind: 'removed', row: record.row, id, section: record.section, indicator: record.indicator });
    }
  }
  return events;
}
