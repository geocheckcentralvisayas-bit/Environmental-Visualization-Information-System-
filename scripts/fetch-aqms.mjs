#!/usr/bin/env node
/**
 * Fetch the ambient air-quality workbook from the public Google Sheet and
 * build public/data/aqms.json.
 *
 * Source: AMBIENT AQMS DATASHEETS
 *   https://docs.google.com/spreadsheets/d/1Fh6w15beHCAHPGJw-2nfwNryez3vwnSVCd8bsFGKvHE/edit?usp=sharing
 *
 * Tabs used:
 *   CITY OF TALISAY  - hourly continuous PM2.5 / PM10
 *   CITY OF TOLEDO   - hourly continuous PM2.5 / PM10
 *   MANUAL DATUM     - manual TSP / PM10 AQI samples, 2023-2026
 *   GEOCOORDINATES   - station coordinates and operational status
 *
 * Re-run with `npm run data:aqms`. The Ambient Corner tab also polls the
 * Worker's /api/aqms/live endpoint for near-real-time updates.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'public', 'data', 'aqms.json');
const SHEET_ID = '1Fh6w15beHCAHPGJw-2nfwNryez3vwnSVCd8bsFGKvHE';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing`;
const GVIZ = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=`;

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
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchTab(name) {
  const response = await fetch(`${GVIZ}${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(120_000),
    headers: { 'User-Agent': 'ENVIS-Dashboard/1.1.0' },
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return parseCsv(await response.text());
}

const cell = (row, index) => String(row?.[index] ?? '').trim();
const numberOrNull = (value) => {
  const clean = cell(rowPlaceholder(value), 0);
  if (!clean || /^#|N\/A|NaN|DIV/i.test(clean)) return null;
  const parsed = Number(clean.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
// Tiny helper so numberOrNull can take a raw string as well as a cell array.
function rowPlaceholder(value) { return [value]; }

function parseHour(value) {
  const raw = cell([value], 0);
  const clock = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (clock) {
    let hour = Number(clock[1]) % 12;
    if (clock[3].toUpperCase() === 'PM') hour += 12;
    return hour;
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return Math.round(numeric * 24) % 24;
  return null;
}

function isoDate(value) {
  const raw = cell([value], 0);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function sampleDate(value) {
  const raw = cell([value], 0);
  if (!raw) return null;
  // gviz exports manual samples as M/D/YYYY; the XLSX export used Excel serials.
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  }
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 1000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  return isoDate(raw);
}

/* ------------------------------------------------------------------ */
/* Stations and coordinate mapping                                     */
/* ------------------------------------------------------------------ */
const geoRows = (await fetchTab('GEOCOORDINATES')).slice(1);
const CONTINUOUS_MATCH = { talisay: 'metro cebu', toledo: 'caams' };
const MANUAL_MATCH = [
  ['naga', 'sindulan'],
  ['mandaue', 'mandaue'],
  ['cebu-city-hall', 'cebu city hall'],
  ['lapu-lapu', 'lapu lapu'],
  ['emb-compound', 'banilad'],
];
const usedSourceNames = new Set();
const stations = [];

function addStation(id, name, type, keywords, sourceRow) {
  const sourceName = cell(sourceRow, 0);
  if (!sourceName || usedSourceNames.has(sourceName)) return;
  const lat = Number(cell(sourceRow, 4));
  const lon = Number(cell(sourceRow, 3));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  usedSourceNames.add(sourceName);
  stations.push({
    id,
    name,
    type: cell(sourceRow, 1) || type,
    address: cell(sourceRow, 2),
    sourceName,
    lat,
    lon,
    status: cell(sourceRow, 5) || 'Unknown',
    keywords,
  });
}

for (const row of geoRows) {
  const sourceName = cell(row, 0)
    .replace(/[\uFFFD]/g, '')
    .trim();
  const lower = sourceName.toLowerCase();
  if (lower.includes('metro cebu')) {
    addStation('talisay', 'TVI Talisay', 'Continuous', ['talisay', 'metro cebu'], row);
  } else if (lower.includes('toledo') || lower.includes('caams')) {
    addStation('toledo', 'Toledo CAAMS', 'Continuous', ['toledo', 'caams'], row);
  } else if (lower.includes('sindulan') || lower.includes('naga')) {
    addStation('naga', 'Sindulan, Naga', 'Manual', ['naga'], row);
  } else if (lower.includes('mandaue')) {
    addStation('mandaue', 'Mandaue Sports Complex', 'Manual', ['mandaue'], row);
  } else if (lower.includes('cebu city hall')) {
    addStation('cebu-city-hall', 'Cebu City Hall', 'Manual', ['cebu city hall'], row);
  } else if (lower.includes('lapu')) {
    addStation('lapu-lapu', 'Lapu-Lapu City Hall', 'Manual', ['lapu'], row);
  } else if (lower.includes('banilad') || lower.includes('emb compound')) {
    addStation('emb-compound', 'Banilad, EMB Compound', 'Manual', ['denr', 'emb compound', 'banilad'], row);
  }
}

function matchStation(rawName, city, isContinuous) {
  const text = `${rawName} ${city}`.toLowerCase();
  if (isContinuous) {
    const keyword = CONTINUOUS_MATCH[city] ?? city;
    return stations.find((station) => station.keywords.includes(keyword))?.id ?? null;
  }
  for (const [id, keyword] of MANUAL_MATCH) {
    if (text.includes(keyword)) return id;
  }
  return stations.find((station) => station.keywords.some((word) => text.includes(word)))?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Continuous hourly readings                                          */
/* ------------------------------------------------------------------ */
const continuous = [];
for (const city of ['talisay', 'toledo']) {
  const tab = city === 'talisay' ? 'CITY OF TALISAY' : 'CITY OF TOLEDO';
  const rows = (await fetchTab(tab)).slice(1);
  for (const row of rows) {
    const pm25 = numberOrNull(cell(row, 7));
    const pm10 = numberOrNull(cell(row, 9));
    if (pm25 === null && pm10 === null) continue; // blank / placeholder rows
    const date = isoDate(cell(row, 4));
    if (!date) continue;
    const hour = parseHour(cell(row, 5));
    if (hour === null) continue;
    continuous.push({
      station: matchStation(cell(row, 0), city, true) ?? city,
      date,
      hour,
      timestamp: `${date}T${String(hour).padStart(2, '0')}:00:00`,
      pm25,
      pm25Status: cell(row, 8).replace(/\s+/g, ' '),
      pm10,
      pm10Status: cell(row, 10).replace(/\s+/g, ' '),
    });
  }
}
continuous.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.station.localeCompare(b.station));

/* ------------------------------------------------------------------ */
/* Manual AQI samples                                                  */
/* ------------------------------------------------------------------ */
const manualRows = (await fetchTab('MANUAL DATUM')).slice(1);
const manual = [];
for (const row of manualRows) {
  const stationName = cell(row, 1);
  if (!stationName) continue;
  const date = sampleDate(cell(row, 5));
  const aqi = numberOrNull(cell(row, 6));
  if (!date || aqi === null) continue;
  manual.push({
    station: matchStation(stationName, '', false) ?? 'unknown',
    sourceStation: stationName,
    category: cell(row, 0),
    address: cell(row, 2),
    year: Number(cell(row, 3)) || Number(date.slice(0, 4)),
    month: cell(row, 4),
    date,
    aqi,
    legend: cell(row, 7).replace(/\s+/g, ' '),
  });
}
manual.sort((a, b) => a.date.localeCompare(b.date));

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */
const byStatus = {};
const byStation = {};
for (const reading of continuous) {
  const status = reading.pm25Status || 'Unknown';
  byStatus[status] = (byStatus[status] ?? 0) + 1;
  const entry = byStation[reading.station] ??= { readings: 0, pm25Sum: 0, pm10Sum: 0, pm25Count: 0, pm10Count: 0, latest: null };
  entry.readings += 1;
  if (reading.pm25 !== null) { entry.pm25Sum += reading.pm25; entry.pm25Count += 1; }
  if (reading.pm10 !== null) { entry.pm10Sum += reading.pm10; entry.pm10Count += 1; }
  if (!entry.latest || reading.timestamp > entry.latest.timestamp) entry.latest = reading;
}
for (const entry of Object.values(byStation)) {
  entry.avgPm25 = entry.pm25Count ? Math.round((entry.pm25Sum / entry.pm25Count) * 10) / 10 : null;
  entry.avgPm10 = entry.pm10Count ? Math.round((entry.pm10Sum / entry.pm10Count) * 10) / 10 : null;
  delete entry.pm25Sum; delete entry.pm10Sum; delete entry.pm25Count; delete entry.pm10Count;
}

const manualByStation = {};
const manualByYear = {};
for (const row of manual) {
  manualByStation[row.station] = (manualByStation[row.station] ?? 0) + 1;
  manualByYear[row.year] = (manualByYear[row.year] ?? 0) + 1;
}

const timestamps = continuous.map((reading) => reading.timestamp);
const payload = {
  generatedAt: new Date().toISOString(),
  source: {
    name: 'AMBIENT AQMS DATASHEETS',
    sheetId: SHEET_ID,
    url: SHEET_URL,
    tabs: ['CITY OF TALISAY', 'CITY OF TOLEDO', 'MANUAL DATUM', 'GEOCOORDINATES'],
    note: 'Hourly continuous PM2.5/PM10 readings for Talisay/Metro Cebu and Toledo, plus manual AQI samples. Live updates are polled from /api/aqms/live; this file is the historical snapshot.',
  },
  summary: {
    stations: stations.length,
    continuousReadings: continuous.length,
    manualReadings: manual.length,
    from: timestamps[0] ?? null,
    to: timestamps.at(-1) ?? null,
    liveAt: continuous.at(-1)?.timestamp ?? null,
    byStatus: Object.entries(byStatus).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    byStation,
    manualByStation: Object.entries(manualByStation).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    manualByYear: Object.entries(manualByYear).map(([year, count]) => ({ year: Number(year), count })).sort((a, b) => a.year - b.year),
  },
  stations: stations.map(({ keywords, ...station }) => station),
  continuous,
  manual,
};

writeFileSync(OUTPUT, JSON.stringify(payload), 'utf8');
console.log(`AQMS dataset written: ${path.relative(ROOT, OUTPUT)}`);
console.log(`  stations ${stations.length}`);
console.log(`  continuous readings ${continuous.length} (${payload.summary.from} -> ${payload.summary.to})`);
console.log(`  manual AQI samples ${manual.length}`);
console.log(`  PM2.5 status ${JSON.stringify(Object.fromEntries(payload.summary.byStatus.map((row) => [row.name, row.count])))}`);
