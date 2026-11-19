#!/usr/bin/env node
/**
 * Build the Solid Waste Management (MRF) dataset from the SWM status export.
 *
 * Source : data/SWM OVERALL DASHBOARDS.csv
 * Output : public/data/swm.json
 *
 * The workbook export is a barangay-level register of Materials Recovery
 * Facilities. It is NOT a tonnage/generation report, so this script deliberately
 * produces only what the source supports: facility status, location and
 * LGU coverage.
 *
 * Handling applied here:
 *  - the pivot table pasted under the data rows is removed
 *  - three coordinate formats are normalised (decimal, hemisphere, space-separated)
 *  - rows are grouped into facilities by IIS transaction number
 *  - coverage is computed against the 101 LGUs of Cebu and Bohol
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'data', 'SWM OVERALL DASHBOARDS.csv');
const OUTPUT = path.join(ROOT, 'public', 'data', 'swm.json');
const WORKBOOK = path.join(ROOT, 'data', 'SWM Overall Database.xlsx');

// The ENVIS dashboard covers Central Visayas = Cebu and Bohol only.
// Negros Oriental and Siquijor records in the source export are excluded so
// every SWM figure uses the same scope as the rest of the dashboard.
const PROVINCES = ['Cebu', 'Bohol'];
const EXCLUDED_PROVINCES = ['Negros Oriental', 'Siquijor'];

/** Official LGU universe for the dashboard scope (53 Cebu + 48 Bohol = 101). */
const LGU_UNIVERSE = {
  Cebu: [
    // 3 highly urbanised cities
    'Cebu City', 'Lapu-Lapu', 'Mandaue',
    // 6 component cities
    'Bogo', 'Carcar', 'Danao', 'Naga', 'Talisay', 'Toledo',
    // 44 municipalities
    'Alcantara', 'Alcoy', 'Alegria', 'Aloguinsan', 'Argao', 'Asturias', 'Badian', 'Balamban',
    'Bantayan', 'Barili', 'Boljoon', 'Borbon', 'Carmen', 'Catmon', 'Compostela', 'Consolacion',
    'Cordova', 'Daanbantayan', 'Dalaguete', 'Dumanjug', 'Ginatilan', 'Liloan', 'Madridejos',
    'Malabuyoc', 'Medellin', 'Minglanilla', 'Moalboal', 'Oslob', 'Pilar', 'Pinamungajan', 'Poro',
    'Ronda', 'Samboan', 'San Fernando', 'San Francisco', 'San Remigio', 'Santa Fe', 'Santander',
    'Sibonga', 'Sogod', 'Tabogon', 'Tabuelan', 'Tuburan', 'Tudela',
  ],
  Bohol: [
    'Tagbilaran',
    'Alburquerque', 'Alicia', 'Anda', 'Antequera', 'Baclayon', 'Balilihan', 'Batuan', 'Bien Unido',
    'Bilar', 'Buenavista', 'Calape', 'Candijay', 'Carmen', 'Catigbian', 'Clarin', 'Corella', 'Cortes',
    'Dagohoy', 'Danao', 'Dauis', 'Dimiao', 'Duero', 'Garcia Hernandez', 'Getafe', 'Guindulman',
    'Inabanga', 'Jagna', 'Lila', 'Loay', 'Loboc', 'Loon', 'Mabini', 'Maribojoc', 'Panglao', 'Pilar',
    'President Carlos P. Garcia', 'Sagbayan', 'San Isidro', 'San Miguel', 'Sevilla', 'Sierra Bullones',
    'Sikatuna', 'Talibon', 'Trinidad', 'Tubigon', 'Ubay', 'Valencia',
  ],
};

/* ------------------------------------------------------------------ */
/* CSV parsing (RFC 4180: quoted fields may contain commas)            */
/* ------------------------------------------------------------------ */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const lguKey = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+city$/, '');

/* ------------------------------------------------------------------ */
/* Coordinates                                                         */
/* ------------------------------------------------------------------ */
function parseCoordinate(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { lat: null, lon: null, status: 'missing', note: null };

  let match = value.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (match) return { lat: Number(match[1]), lon: Number(match[2]), status: 'ok', note: null };

  // 10.2510N, 123.5621E
  match = value.match(/^(-?\d+(?:\.\d+)?)\s*([NS])\s*,?\s*(-?\d+(?:\.\d+)?)\s*([EW])$/i);
  if (match) {
    let lat = Number(match[1]);
    let lon = Number(match[3]);
    if (match[2].toUpperCase() === 'S') lat = -lat;
    if (match[4].toUpperCase() === 'W') lon = -lon;
    return { lat, lon, status: 'ok', note: 'hemisphere notation normalised' };
  }

  // 10.25949 123.95062
  match = value.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
  if (match) {
    return { lat: Number(match[1]), lon: Number(match[2]), status: 'ok', note: 'space-separated coordinates normalised' };
  }

  return { lat: null, lon: null, status: 'invalid', note: `unrecognised coordinate format: "${value}"` };
}

const inRegion = (lat, lon) => lat >= 8.4 && lat <= 12.6 && lon >= 122 && lon <= 126.1;

/* ------------------------------------------------------------------ */
/* Load + clean                                                        */
/* ------------------------------------------------------------------ */
const text = readFileSync(SOURCE, 'utf8').replace(/^\uFEFF/, '');
const rows = parseCsv(text);
const header = rows[0].map((value) => value.replace(/\s+/g, ' ').trim());
const col = (name) => header.indexOf(name);

const IDX = {
  province: col('Province'),
  lgu: col('LGU'),
  barangay: col('Actual Location or Barangay'),
  coord: col('Gecoordinates'),
  txn: col('IIS Transaction Number'),
  status: col('MRF Status'),
};

for (const [key, index] of Object.entries(IDX)) {
  if (index < 0) throw new Error(`Missing expected column for "${key}" in ${path.basename(SOURCE)}`);
}

const JUNK = /Row Labels|Grand Total|Count of MRF/i;
const parsed = [];
for (const row of rows.slice(1)) {
  const province = (row[IDX.province] ?? '').trim();
  const lgu = (row[IDX.lgu] ?? '').trim();
  const status = (row[IDX.status] ?? '').trim();
  if (!row.some((value) => value.trim() !== '')) continue;
  // The export carries a pivot table below the register; drop it wholesale.
  if (!province || !lgu || !status || JUNK.test(`${province} ${lgu}`)) continue;
  parsed.push({
    province,
    lgu,
    barangay: (row[IDX.barangay] ?? '').trim(),
    coordRaw: (row[IDX.coord] ?? '').trim(),
    txn: (row[IDX.txn] ?? '').trim(),
    status: status === 'Operational' ? 'Operational' : 'Non-Operational',
  });
}

// Scope filter: ENVIS covers Cebu and Bohol only. Negros Oriental and
// Siquijor rows are reported separately so the exclusion is auditable.
const excludedByProvince = {};
for (const entry of parsed) {
  if (PROVINCES.includes(entry.province)) continue;
  excludedByProvince[entry.province] = (excludedByProvince[entry.province] ?? 0) + 1;
}
for (const province of EXCLUDED_PROVINCES) excludedByProvince[province] ??= 0;
const scoped = parsed.filter((entry) => PROVINCES.includes(entry.province));

const records = scoped.map((entry, index) => {
  const coord = parseCoordinate(entry.coordRaw);
  const note = coord.status !== 'ok' && coord.status !== 'missing'
    ? coord.note
    : coord.lat !== null && !inRegion(coord.lat, coord.lon)
      ? 'coordinate falls outside the Region VII bounding box'
      : coord.note;
  return {
    id: `${entry.txn || 'no-txn'}-${index + 1}`,
    province: entry.province,
    lgu: entry.lgu,
    lguKey: lguKey(entry.lgu),
    barangay: entry.barangay,
    status: entry.status,
    txn: entry.txn,
    lat: coord.lat,
    lon: coord.lon,
    coordStatus: coord.status,
    coordNote: note,
    facilityKey: entry.txn || `${entry.province}:${entry.lgu}:${entry.barangay}`,
  };
});

/* ------------------------------------------------------------------ */
/* Facilities (grouped by IIS transaction)                             */
/* ------------------------------------------------------------------ */
const facilityMap = new Map();
for (const record of records) {
  if (!facilityMap.has(record.facilityKey)) {
    facilityMap.set(record.facilityKey, {
      key: record.facilityKey,
      province: record.province,
      lgu: record.lgu,
      lguKey: record.lguKey,
      status: record.status,
      lat: record.lat,
      lon: record.lon,
      coordStatus: record.coordStatus,
      coordNote: record.coordNote,
      barangays: [],
      recordCount: 0,
    });
  }
  const facility = facilityMap.get(record.facilityKey);
  facility.recordCount += 1;
  if (record.barangay && !facility.barangays.includes(record.barangay)) facility.barangays.push(record.barangay);
  if (facility.lat === null && record.lat !== null) {
    facility.lat = record.lat;
    facility.lon = record.lon;
    facility.coordStatus = record.coordStatus;
    facility.coordNote = record.coordNote;
  }
}
const facilities = [...facilityMap.values()].sort(
  (a, b) => PROVINCES.indexOf(a.province) - PROVINCES.indexOf(b.province) || a.lgu.localeCompare(b.lgu),
);

// Flag coordinates shared by facilities in different LGUs (likely copy/paste).
const coordIndex = new Map();
for (const facility of facilities) {
  if (facility.lat === null || facility.lon === null) continue;
  const key = `${facility.lat.toFixed(4)},${facility.lon.toFixed(4)}`;
  const list = coordIndex.get(key) ?? [];
  list.push(facility);
  coordIndex.set(key, list);
}
let sharedCoordinateFacilities = 0;
for (const list of coordIndex.values()) {
  const lgus = new Set(list.map((facility) => `${facility.province}|${facility.lguKey}`));
  if (lgus.size > 1) {
    sharedCoordinateFacilities += list.length;
    for (const facility of list) {
      facility.coordNote = facility.coordNote
        ? `${facility.coordNote}; also used by another LGU`
        : 'same coordinate used by a facility in another LGU';
    }
  }
}

/* ------------------------------------------------------------------ */
/* LGU coverage                                                        */
/* ------------------------------------------------------------------ */
const byLgu = new Map();
for (const record of records) {
  const key = `${record.province}|${record.lguKey}`;
  const entry = byLgu.get(key) ?? {
    province: record.province,
    name: record.lgu,
    key: record.lguKey,
    records: 0,
    operational: 0,
    nonOperational: 0,
    facilities: new Set(),
  };
  entry.records += 1;
  if (record.status === 'Operational') entry.operational += 1;
  else entry.nonOperational += 1;
  entry.facilities.add(record.facilityKey);
  byLgu.set(key, entry);
}

const lgus = [];
const unmatched = [];
for (const province of PROVINCES) {
  for (const name of LGU_UNIVERSE[province]) {
    const key = lguKey(name);
    const data = byLgu.get(`${province}|${key}`);
    if (!data) {
      lgus.push({
        province, name, key, records: 0, operational: 0, nonOperational: 0, facilities: 0,
        coverage: 'none', inUniverse: true,
      });
      continue;
    }
    lgus.push({
      province,
      name,
      key,
      records: data.records,
      operational: data.operational,
      nonOperational: data.nonOperational,
      facilities: data.facilities.size,
      coverage: data.operational > 0 ? 'operational' : 'non-operational',
      inUniverse: true,
    });
  }
}

// Any LGU name in the export that does not match the official list.
for (const [key, data] of byLgu) {
  const [province] = key.split('|');
  const known = PROVINCES.includes(province)
    && LGU_UNIVERSE[province].some((name) => lguKey(name) === data.key);
  if (known) continue;
  unmatched.push(`${province} / ${data.name}`);
  lgus.push({
    province,
    name: data.name,
    key: data.key,
    records: data.records,
    operational: data.operational,
    nonOperational: data.nonOperational,
    facilities: data.facilities.size,
    coverage: data.operational > 0 ? 'operational' : 'non-operational',
    inUniverse: false,
  });
}

const provinces = PROVINCES.map((province) => {
  const lguRows = lgus.filter((entry) => entry.province === province);
  const recordsInProvince = records.filter((entry) => entry.province === province);
  return {
    name: province,
    lgusTotal: LGU_UNIVERSE[province].length,
    lgusWithRecords: lguRows.filter((entry) => entry.records > 0).length,
    lgusWithOperational: lguRows.filter((entry) => entry.operational > 0).length,
    lgusZeroOperational: lguRows.filter((entry) => entry.inUniverse && entry.records > 0 && entry.operational === 0).length,
    records: recordsInProvince.length,
    operational: recordsInProvince.filter((entry) => entry.status === 'Operational').length,
    nonOperational: recordsInProvince.filter((entry) => entry.status === 'Non-Operational').length,
    facilities: facilities.filter((entry) => entry.province === province).length,
  };
});

const operational = records.filter((entry) => entry.status === 'Operational').length;
const missingCoordinates = facilities.filter((entry) => entry.coordStatus !== 'ok').length;

const summary = {
  records: records.length,
  facilities: facilities.length,
  operational,
  nonOperational: records.length - operational,
  operationalRate: records.length ? Number(((operational / records.length) * 100).toFixed(1)) : 0,
  multiBarangayFacilities: facilities.filter((entry) => entry.barangays.length > 1).length,
  lgusTotal: PROVINCES.reduce((total, province) => total + LGU_UNIVERSE[province].length, 0),
  lgusWithRecords: lgus.filter((entry) => entry.inUniverse && entry.records > 0).length,
  lgusWithOperational: lgus.filter((entry) => entry.inUniverse && entry.operational > 0).length,
  lgusZeroOperational: lgus.filter((entry) => entry.inUniverse && entry.records > 0 && entry.operational === 0).length,
  lgusWithoutRecords: lgus.filter((entry) => entry.inUniverse && entry.records === 0).length,
  missingCoordinates,
  sharedCoordinateFacilities,
};

/* ------------------------------------------------------------------ */
/* Landfills, dumpsites and transfer stations                          */
/*                                                                     */
/* The MRF export has no facility-type field, so disposal facilities    */
/* are taken from the ECC / CNC ultralist instead. That register covers */
/* Cebu and Bohol only - Negros Oriental and Siquijor are reported as   */
/* "no data" rather than zero.                                          */
/* ------------------------------------------------------------------ */
const ECC_PATH = path.join(ROOT, 'public', 'data', 'ecc-ultralist.json');

const DISPOSAL_CATEGORIES = [
  { key: 'landfill', label: 'Sanitary landfill', tone: 'amber' },
  { key: 'dumpsite', label: 'Dumpsite / waste dump', tone: 'rose' },
  { key: 'transfer', label: 'Transfer station', tone: 'violet' },
];

function classifyDisposal(project) {
  const value = String(project ?? '').toLowerCase();
  if (/dumpsite|dump\s*\/\s*landfill|waste rock dump/.test(value)) return 'dumpsite';
  if (/transfer station/.test(value)) return 'transfer';
  if (/sanitary landfill|landfill|\bslf\b/.test(value)) return 'landfill';
  return null;
}

function readDisposal() {
  const empty = {
    available: false,
    source: 'ECC and CNC ultralist',
    coverage: Object.fromEntries(PROVINCES.map((province) => [province, 'no-data'])),
    categories: DISPOSAL_CATEGORIES.map((category) => ({ ...category, count: 0, mapped: 0 })),
    projects: [],
    note: 'The ECC/CNC ultralist has not been built yet, so disposal facilities cannot be listed.',
  };
  if (!existsSync(ECC_PATH)) return empty;

  const doc = JSON.parse(readFileSync(ECC_PATH, 'utf8'));
  const fields = Array.isArray(doc.fields) ? doc.fields : [];
  const idx = Object.fromEntries(fields.map((field, index) => [field, index]));
  const rows = Array.isArray(doc.records) ? doc.records : [];
  const cell = (row, name) => (idx[name] === undefined ? null : row[idx[name]] ?? null);

  const projects = [];
  for (const row of rows) {
    const category = classifyDisposal(cell(row, 'project'));
    if (!category) continue;
    // Roads and access projects merely mention a landfill; they are not facilities.
    if (/road|access/i.test(String(cell(row, 'projectType') ?? ''))) continue;
    const province = String(cell(row, 'province') ?? '').trim();
    if (!PROVINCES.includes(province)) continue;
    const lat = Number(cell(row, 'lat'));
    const lon = Number(cell(row, 'lon'));
    const mapped = Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0;
    projects.push({
      id: String(cell(row, 'id') ?? cell(row, 'number') ?? projects.length),
      category,
      name: String(cell(row, 'project') ?? '').trim(),
      proponent: String(cell(row, 'proponent') ?? '').trim(),
      lgu: String(cell(row, 'municipality') ?? '').trim(),
      province,
      barangay: String(cell(row, 'barangay') ?? '').trim(),
      kind: String(cell(row, 'kind') ?? '').trim(),
      ref: String(cell(row, 'number') ?? '').trim(),
      status: String(cell(row, 'status') ?? '').trim(),
      year: Number(cell(row, 'year')) || null,
      lat: mapped ? lat : null,
      lon: mapped ? lon : null,
      mapped,
    });
  }

  projects.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.province.localeCompare(b.province));

  const coverage = {};
  for (const province of PROVINCES) {
    coverage[province] = (doc.byMunicipality ?? []).some((entry) => entry.province === province)
      ? 'covered'
      : 'no-data';
  }

  return {
    available: true,
    source: `ECC and CNC ultralist${doc.scopeLabel ? ` (${doc.scopeLabel})` : ''}`,
    coverage,
    categories: DISPOSAL_CATEGORIES.map((category) => ({
      ...category,
      count: projects.filter((project) => project.category === category.key).length,
      mapped: projects.filter((project) => project.category === category.key && project.mapped).length,
    })),
    projects,
    note: 'Disposal facilities come from ECC/CNC approvals, which record approvals rather than operating status. Categories come from project names, so several are industrial (coal ash, mine waste), not municipal dumpsites. The ECC register covers Cebu and Bohol — the same scope as this dashboard.',
  };
}

const disposal = readDisposal();

/* ------------------------------------------------------------------ */
/* SWM Overall Database workbook: WACS, compliance, contacts, lookups   */
/* ------------------------------------------------------------------ */
const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const cleanNum = (value, digits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number) || String(value ?? '').trim() === '') return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
};
const inScopeProvince = (value) => ['CEBU', 'BOHOL'].includes(cleanText(value).toUpperCase());
const provinceName = (value) => (cleanText(value).toUpperCase() === 'CEBU' ? 'Cebu' : 'Bohol');
const scopedLguKey = (province, lgu) => `${province.toLowerCase()}|${lguKey(lgu)}`;
const complianceFlag = (value) => {
  const text = cleanText(value).toLowerCase();
  if (!text) return 'na';
  if (text.includes('non-compliant') || text.includes('non compliant')) return 'non-compliant';
  if (text.includes('compliant')) return 'compliant';
  return 'na';
};

const EMPTY_WORKBOOK = {
  available: false,
  note: 'The SWM Overall Database workbook is missing. Add data/SWM Overall Database.xlsx and rerun npm run data:swm.',
  wacs: { available: false, records: [], summary: null },
  compliance: { current: { available: false, records: [], summary: null }, old: { available: false, records: [], summary: null } },
  contacts: { available: false, records: [], summary: null },
  database: { available: false, lists: [] },
};

function readWorkbook() {
  if (!existsSync(WORKBOOK)) return EMPTY_WORKBOOK;
  const workbook = XLSX.read(readFileSync(WORKBOOK), { type: 'buffer' });
  const sheetRows = (name, from = 1) => {
    if (!workbook.Sheets[name]) return [];
    const all = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', blankrows: false });
    return all.slice(from);
  };

  /* WACS — waste analysis and characterisation, one row per LGU. */
  const wacsRows = sheetRows('WACS', 2);
  const wacs = [];
  for (const row of wacsRows) {
    if (!inScopeProvince(row[0]) || !cleanText(row[1])) continue;
    wacs.push({
      province: provinceName(row[0]),
      lgu: cleanText(row[1]),
      lguKey: scopedLguKey(provinceName(row[0]), row[1]),
      bioKgDay: cleanNum(row[2]),
      recyclableKgDay: cleanNum(row[3]),
      diversionKgDay: cleanNum(row[4]),
      residualKgDay: cleanNum(row[5]),
      specialKgDay: cleanNum(row[6]),
      totalKgDay: cleanNum(row[7]),
      population2015: cleanNum(row[8], 0),
      growthRate: cleanNum(row[9]),
      pcgKgDay: cleanNum(row[10]),
      wacsYear: cleanNum(row[11], 0),
      projected2025KgDay: cleanNum(row[12]),
      projectedBioKgDay: cleanNum(row[21]),
      projectedRecyclableKgDay: cleanNum(row[23]),
      projectedResidualKgDay: cleanNum(row[26]),
      projectedSpecialKgDay: cleanNum(row[28]),
      disposalFacility: cleanText(row[30]),
    });
  }

  const sum = (list, key) => list.reduce((total, entry) => total + (entry[key] ?? 0), 0);
  const wacsSummary = {
    lgus: wacs.length,
    totalKgDay: Math.round(sum(wacs, 'totalKgDay')),
    projected2025KgDay: Math.round(sum(wacs, 'projected2025KgDay')),
    population2015: Math.round(sum(wacs, 'population2015')),
    avgPcgKgDay: wacs.length ? cleanNum(sum(wacs, 'pcgKgDay') / wacs.length, 3) : 0,
    composition: {
      bio: Math.round(sum(wacs, 'bioKgDay')),
      recyclable: Math.round(sum(wacs, 'recyclableKgDay')),
      residual: Math.round(sum(wacs, 'residualKgDay')),
      special: Math.round(sum(wacs, 'specialKgDay')),
    },
    byProvince: PROVINCES.map((province) => {
      const rows = wacs.filter((entry) => entry.province === province);
      return {
        name: province,
        lgus: rows.length,
        totalKgDay: Math.round(sum(rows, 'totalKgDay')),
        projected2025KgDay: Math.round(sum(rows, 'projected2025KgDay')),
        population2015: Math.round(sum(rows, 'population2015')),
      };
    }),
    byYear: Object.entries(
      wacs.reduce((acc, entry) => {
        const year = entry.wacsYear ?? 'unknown';
        acc[year] ??= { year, lgus: 0, totalKgDay: 0 };
        acc[year].lgus += 1;
        acc[year].totalKgDay += entry.totalKgDay ?? 0;
        return acc;
      }, {}),
    )
      .map(([, value]) => ({ ...value, totalKgDay: Math.round(value.totalKgDay) }))
      .sort((a, b) => String(a.year).localeCompare(String(b.year))),
    byDisposal: Object.entries(
      wacs.reduce((acc, entry) => {
        const name = entry.disposalFacility || 'Not stated';
        acc[name] ??= { name, lgus: 0, totalKgDay: 0 };
        acc[name].lgus += 1;
        acc[name].totalKgDay += entry.totalKgDay ?? 0;
        return acc;
      }, {}),
    )
      .map(([, value]) => ({ ...value, totalKgDay: Math.round(value.totalKgDay) }))
      .sort((a, b) => b.lgus - a.lgus),
  };

  /* Annual compliance summaries — current and archived versions. */
  const CRITERIA_CURRENT = [
    [28, 'dumpsite', 'Dumpsite / OD'],
    [29, 'scrp', 'SCRP'],
    [30, 'disposal', 'Final disposal'],
    [31, 'plan', '10-year SWM plan'],
    [32, 'segregation', 'Segregation at source'],
    [36, 'rca', 'RCA'],
    [37, 'slfEcc', 'SLF with ECC'],
    [38, 'slfNoEcc', 'SLF without ECC'],
    [39, 'altTech', 'Alternative technology'],
  ];
  const CRITERIA_OLD = [
    [34, 'od', 'Dumpsite / OD'],
    [35, 'scrp', 'SCRP'],
    [36, 'disposal', 'Final disposal'],
    [37, 'fundedMrf', 'EMB-funded MRF'],
    [38, 'plan', '10-year SWM plan'],
    [39, 'segregation', 'Segregation at source'],
    [40, 'dumpsite', 'Dumpsite'],
    [45, 'equipment', 'SWM equipment'],
    [47, 'scmar', 'SCMAR'],
  ];

  function readCompliance(name, criteria, isOld) {
    const rows = sheetRows(name, 1);
    const records = [];
    for (const row of rows) {
      if (!inScopeProvince(row[0]) || !cleanText(row[10])) continue;
      const province = provinceName(row[0]);
      const lgu = cleanText(row[10]);
      const record = {
        id: cleanText(row[1]) || `${province} ${lgu}`,
        province,
        lgu,
        lguKey: scopedLguKey(province, lgu),
        district: cleanText(row[3]),
        type: cleanText(row[9]),
        hall: cleanText(row[6]),
        location: cleanText(row[11]),
        zip: cleanText(row[8]).slice(0, 12),
        dumpsiteStatus: cleanText(row[13]),
        scrpStatus: cleanText(row[14]),
        disposalFacility: cleanText(row[16]),
        disposalAddress: cleanText(row[17]).slice(0, 160),
        planStatus: cleanText(row[19]),
        overall: complianceStatusText(cleanText(row[isOld ? 27 : 26])),
        criteria: criteria
          .filter(([index]) => cleanText(row[index]))
          .map(([index, key, label]) => ({ key, label, status: complianceFlag(row[index]) })),
      };
      if (isOld) {
        record.planStart = cleanNum(row[20], 0);
        record.planEnd = cleanNum(row[21], 0);
        record.equipment2020 = cleanText(row[23]).slice(0, 80);
        record.equipment2021 = cleanText(row[24]).slice(0, 80);
        record.equipment2022 = cleanText(row[25]).slice(0, 80);
        record.overallStatus = complianceStatusText(cleanText(row[54]));
      } else {
        record.fundedMrfStatus = cleanText(row[20]).slice(0, 120);
        record.fundedMrfLocation = cleanText(row[21]).slice(0, 120);
        record.equipment = cleanText(row[23]).slice(0, 80);
        record.equipmentStatus = cleanText(row[24]).slice(0, 80);
      }
      records.push(record);
    }

    // Several LGUs are entered twice (Cebu City, Mandaue, Badian...). Keep one
    // row per LGU, preferring the copy with a definitive compliance status.
    const deduped = new Map();
    for (const record of records) {
      const existing = deduped.get(record.lguKey);
      if (!existing || (existing.overall === 'Not stated' && record.overall !== 'Not stated')) {
        deduped.set(record.lguKey, record);
      }
    }
    const uniqueRecords = [...deduped.values()];

    const byStatus = {};
    const byProvince = PROVINCES.map((province) => ({ name: province, lgus: 0 }));
    const criteriaCounts = {};
    for (const record of uniqueRecords) {
      byStatus[record.overall] = (byStatus[record.overall] ?? 0) + 1;
      const provinceRow = byProvince.find((entry) => entry.name === record.province);
      if (provinceRow) provinceRow.lgus += 1;
      for (const item of record.criteria) {
        criteriaCounts[item.key] ??= { key: item.key, label: item.label, compliant: 0, 'non-compliant': 0, na: 0 };
        criteriaCounts[item.key][item.status] += 1;
      }
    }
    return {
      available: rows.length > 0,
      records: uniqueRecords,
      summary: {
        lgus: uniqueRecords.length,
        byStatus,
        byProvince,
        compliant: byStatus.Compliant ?? 0,
        nonCompliant: byStatus['Non-Compliant'] ?? 0,
        criteria: Object.values(criteriaCounts),
      },
    };
  }

  function complianceStatusText(value) {
    const text = value.toLowerCase();
    if (text.includes('non-compliant') || text.includes('non compliant')) return 'Non-Compliant';
    if (text.includes('compliant')) return 'Compliant';
    return value || 'Not stated';
  }

  /* LGU contact directory — official mayor, vice mayor and SWM focal contacts. */
  const contactRows = sheetRows('LGU Contact Details', 2);
  const contacts = [];
  for (const row of contactRows) {
    if (!inScopeProvince(row[1]) || !cleanText(row[3])) continue;
    contacts.push({
      province: provinceName(row[1]),
      lgu: cleanText(row[3]),
      lguKey: scopedLguKey(provinceName(row[1]), row[3]),
      type: cleanText(row[2]),
      district: cleanText(row[4]),
      mayor: cleanText(row[6]),
      mayorContact: cleanText(row[10]),
      mayorEmail: cleanText(row[11]),
      mayorParty: cleanText(row[12]).slice(0, 80),
      viceMayor: cleanText(row[15]),
      viceMayorContact: cleanText(row[19]),
      viceMayorEmail: cleanText(row[20]),
      focal: cleanText(row[23]),
      focalPosition: cleanText(row[24]).slice(0, 120),
      focalContact: cleanText(row[25]),
      focalEmail: cleanText(row[26]),
      incomeClass: cleanText(row[27]),
      barangays: cleanNum(row[28], 0),
      address: cleanText(row[29]).slice(0, 180),
      zip: cleanText(row[30]).slice(0, 12),
    });
  }
  // One contact per LGU; keep the more complete row where the sheet repeats one.
  const contactMap = new Map();
  for (const entry of contacts) {
    const existing = contactMap.get(entry.lguKey);
    const score = Number(Boolean(entry.focalContact)) + Number(Boolean(entry.mayorContact)) + Number(Boolean(entry.viceMayorContact));
    const oldScore = existing
      ? Number(Boolean(existing.focalContact)) + Number(Boolean(existing.mayorContact)) + Number(Boolean(existing.viceMayorContact))
      : -1;
    if (!existing || score > oldScore) contactMap.set(entry.lguKey, entry);
  }
  const uniqueContacts = [...contactMap.values()];

  const contactsSummary = {
    lgus: uniqueContacts.length,
    byProvince: PROVINCES.map((province) => ({
      name: province,
      lgus: uniqueContacts.filter((entry) => entry.province === province).length,
    })),
    withMayor: uniqueContacts.filter((entry) => entry.mayor && entry.mayorContact).length,
    withViceMayor: uniqueContacts.filter((entry) => entry.viceMayor && entry.viceMayorContact).length,
    withFocal: uniqueContacts.filter((entry) => entry.focal && entry.focalContact).length,
  };

  /* The "Database" tab is the workbook's lookup / data-dictionary matrix. */
  const dbRows = sheetRows('Database', 0);
  const DB_LABELS = {
    1: 'Province',
    15: 'Dumpsite status',
    18: 'Ownership / sector',
    36: 'SCRP status',
    48: 'Current disposal facility',
    49: 'Disposal facility name',
    54: 'Implementing sector',
    66: '10-year plan / endorsement status',
    86: 'MRF / equipment type',
    89: 'Operational status',
    90: 'Liquidation status',
    101: 'Compliance status',
    110: 'Waste-based livelihood project',
    111: 'Implementing agency',
    117: 'Assistance / programme type',
  };
  const lists = [];
  const columnCount = dbRows[0]?.length ?? 0;
  for (let column = 0; column < columnCount; column += 1) {
    const values = [...new Set(dbRows.map((row) => cleanText(row[column])).filter((value) => value && value.length <= 120))];
    // The province lookup is scoped like every other view in this dashboard.
    const scopedValues = column === 1
      ? values.filter((value) => ['CEBU', 'BOHOL'].includes(value.toUpperCase())).map((value) => provinceName(value))
      : values;
    if (scopedValues.length < 2) continue;
    lists.push({
      key: `c${column}`,
      label: DB_LABELS[column] ?? `Reference list ${column + 1}`,
      values: scopedValues.slice(0, 200).sort((a, b) => a.localeCompare(b)),
    });
  }

  return {
    available: true,
    note: 'WACS, current and archived annual compliance summaries, official LGU contacts and the workbook reference lists. All sheets are filtered to Cebu and Bohol.',
    wacs: { available: wacs.length > 0, records: wacs, summary: wacsSummary },
    compliance: {
      current: readCompliance('AnnualComplianceSummaryv1', CRITERIA_CURRENT, false),
      old: readCompliance('OldAnnualComplianceSummary V2', CRITERIA_OLD, true),
    },
    contacts: { available: uniqueContacts.length > 0, records: uniqueContacts, summary: contactsSummary },
    database: { available: lists.length > 0, lists },
  };
}

const workbook = readWorkbook();

const payload = {
  generatedAt: new Date().toISOString(),
  source: {
    file: 'SWM OVERALL DASHBOARDS.csv',
    workbook: 'SWM Overall Database.xlsx',
    system: 'DENR-EMB Region VII — IIS transaction register',
    scope: 'Central Visayas — Cebu and Bohol only',
    rowsParsed: rows.length - 1,
    recordsKept: records.length,
    pivotRowsRemoved: rows.length - 1 - parsed.length,
    excludedByProvince,
    note: 'Barangay-level MRF status register for 2025. No waste generation, diversion or disposal tonnage is present in this export. Rows from Negros Oriental and Siquijor are excluded because the dashboard covers Cebu and Bohol only.',
  },
  summary,
  provinces,
  lgus,
  facilities,
  records,
  unmatched,
  disposal,
  workbook,
};

writeFileSync(OUTPUT, JSON.stringify(payload), 'utf8');

console.log(`SWM dataset written: ${path.relative(ROOT, OUTPUT)}`);
console.log(`  scope ${payload.source.scope}`);
console.log(`  excluded rows: ${JSON.stringify(excludedByProvince)}`);
console.log(`  records   ${summary.records}`);
console.log(`  facilities ${summary.facilities}`);
console.log(`  operational ${summary.operational} (${summary.operationalRate}%) / non-operational ${summary.nonOperational}`);
console.log(`  LGU coverage ${summary.lgusWithRecords}/${summary.lgusTotal} (${summary.lgusWithoutRecords} without a record)`);
console.log(`  LGUs with zero operational MRF: ${summary.lgusZeroOperational}`);
console.log(`  facilities missing coordinates: ${summary.missingCoordinates}`);
console.log(`  facilities on a coordinate also used by another LGU: ${summary.sharedCoordinateFacilities}`);
if (disposal.available) {
  console.log(`  disposal projects: ${disposal.projects.length} (${disposal.categories.map((category) => `${category.label} ${category.count}`).join(', ')})`);
  console.log(`  disposal projects without coordinates: ${disposal.projects.filter((project) => !project.mapped).length}`);
  const missing = PROVINCES.filter((province) => disposal.coverage[province] === 'no-data');
  if (missing.length) console.log(`  disposal coverage missing for: ${missing.join(', ')} (reported as no data)`);
} else {
  console.warn('  disposal data unavailable - run npm run data:ecc first');
}
if (workbook.available) {
  console.log(`  workbook WACS LGUs: ${workbook.wacs.records.length}`);
  console.log(`  workbook compliance: current ${workbook.compliance.current.records.length}, archived ${workbook.compliance.old.records.length}`);
  console.log(`  workbook LGU contacts: ${workbook.contacts.records.length}`);
  console.log(`  workbook reference lists: ${workbook.database.lists.length}`);
} else {
  console.warn('  workbook data unavailable - add data/SWM Overall Database.xlsx');
}
if (unmatched.length) {
  console.warn('  unmatched LGU names (kept in output, not counted as official coverage):');
  for (const name of unmatched) console.warn(`    - ${name}`);
}
