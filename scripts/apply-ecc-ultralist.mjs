/**
 * Rebase the dashboard's ECC / CNC clearances, clearance-site counts and map
 * facility counters on the generated ECC / CNC Ultralist.
 *
 * The ultralist is the authoritative ECC/CNC register. Each ultralist record
 * already carries its intercrossed DP / PTO / HW references, so this step
 * replaces the legacy clearance index (built only from the DP/PTO `ECC/CNC no.`
 * column and the hazardous-waste register) with the full ultralist.
 *
 * Run automatically at the end of `build-ecc-ultralist.mjs`, or directly:
 *   node scripts/apply-ecc-ultralist.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_DIR } from './config.mjs';
import { countBy, sortByCountDesc, unique } from './lib/text.mjs';

const IN_SCOPE = new Set(['Cebu', 'Bohol']);
const REGISTER_ORDER = ['DP', 'PTO', 'HW', 'ECC', 'CNC'];

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path.join(OUT_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}

function decodeUltralist(raw) {
  if (!raw || typeof raw !== 'object') {
    console.warn('[decodeUltralist] Invalid input: not an object');
    return { fields: [], records: [] };
  }

  const fields = Array.isArray(raw.fields) && raw.fields.every((f) => typeof f === 'string')
    ? raw.fields
    : (console.warn('[decodeUltralist] fields must be string[]'), []);

  const records = Array.isArray(raw.records)
    ? raw.records
        .filter((row, i) => {
          if (!Array.isArray(row)) {
            console.warn(`[decodeUltralist] Skipping row ${i}: not an array`);
            return false;
          }
          return true;
        })
        .map((row) => {
          const record = {};
          fields.forEach((field, index) => {
            record[field] = row[index];
          });
          return record;
        })
    : (console.warn('[decodeUltralist] records must be array'), []);

  return { fields, records };
}

function clearanceLifecycle(status, issued) {
  const text = String(status ?? '').toLowerCase();
  if (/(cancel|revok|denied|denial|disapprov|reject|void|lapsed|expired|closure)/.test(text)) return 'Expired';
  if (issued) return 'Active';
  if (/(issued|approv|grant|decision|endorse|compliant)/.test(text)) return 'Active';
  return 'Unknown';
}

function toClearance(record, hwByNumber) {
  const numbers = Array.isArray(record.hwNos) ? record.hwNos : [];
  const hwCodes = [];
  for (const number of numbers) {
    const entry = hwByNumber.get(number);
    if (entry) hwCodes.push(...entry.codes);
  }
  const siteIds = Array.isArray(record.siteIds) ? record.siteIds.filter(Boolean) : [];
  const issued = record.issued ?? null;
  return {
    id: record.id,
    number: record.number || '',
    type: record.kind === 'CNC' ? 'CNC' : 'ECC',
    company: record.proponent || record.project || 'Unnamed establishment',
    project: record.project || '',
    municipality: record.municipality || '',
    province: record.province || '',
    barangay: record.barangay || '',
    address: record.address || '',
    lat: record.lat ?? null,
    lon: record.lon ?? null,
    scope: IN_SCOPE.has(record.province) ? 'in' : 'unknown',
    issued,
    expiry: null,
    lifecycle: clearanceLifecycle(record.status, issued),
    year: record.year ?? (issued ? Number(String(issued).slice(0, 4)) : null),
    appNo: record.iis || '',
    hwGrNo: numbers[0] || '',
    siteId: siteIds[0] ?? null,
    siteIds,
    sources: unique([...(record.sources ?? []), 'ECC / CNC Ultralist']),
    permitRefs: unique(record.permitNos ?? []),
    hwCodes: unique(hwCodes),
  };
}

function aggregateSites(sites, clearances) {
  const bySite = new Map();
  for (const clearance of clearances) {
    const siteIds = clearance.siteIds?.length ? clearance.siteIds : clearance.siteId ? [clearance.siteId] : [];
    for (const siteId of siteIds) {
      let entry = bySite.get(siteId);
      if (!entry) {
        entry = { ecc: [], cnc: [], ambiguous: [] };
        bySite.set(siteId, entry);
      }
      if (clearance.type === 'ECC') entry.ecc.push(clearance.number);
      else if (clearance.type === 'CNC') entry.cnc.push(clearance.number);
      else entry.ambiguous.push(clearance.number);
    }
  }

  for (const site of sites) {
    const entry = bySite.get(site.id) ?? { ecc: [], cnc: [], ambiguous: [] };
    site.eccNos = unique(entry.ecc);
    site.cncNos = unique(entry.cnc);
    site.ambiguousNos = unique(entry.ambiguous);
    site.eccCount = site.eccNos.length;
    site.cncCount = site.cncNos.length;
    site.ambiguousCount = site.ambiguousNos.length;
    site.clearanceCount = site.eccCount + site.cncCount + site.ambiguousCount;
  }
  return sites;
}

function updateFacilities(facilities, sites) {
  const siteById = new Map(sites.map((site) => [site.id, site]));
  for (const facility of facilities) {
    const counts = facility.counts ?? { DP: 0, PTO: 0, HW: 0, ECC: 0, CNC: 0 };
    let ecc = 0;
    let cnc = 0;
    const numbers = new Set();
    for (const siteId of facility.siteIds ?? []) {
      const site = siteById.get(siteId);
      if (!site) continue;
      ecc += site.eccCount ?? 0;
      cnc += site.cncCount ?? 0;
      for (const number of [...site.eccNos ?? [], ...site.cncNos ?? [], ...site.ambiguousNos ?? []]) numbers.add(number);
    }
    counts.ECC = ecc;
    counts.CNC = cnc;
    facility.counts = counts;
    facility.registers = REGISTER_ORDER.filter((id) => (counts[id] ?? 0) > 0);
    facility.totalRecords = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
    facility.clearanceNumbers = [...numbers].sort();
  }
  return facilities;
}

function updateMeta(meta, clearances, facilities, ultralistTotals) {
  const totals = meta.totals ?? {};
  totals.clearances = clearances.length;
  totals.eccClearances = clearances.filter((clearance) => clearance.type === 'ECC').length;
  totals.cncClearances = clearances.filter((clearance) => clearance.type === 'CNC').length;
  totals.ambiguousClearances = clearances.filter((clearance) => clearance.type === 'ECC/CNC').length;
  totals.clearanceSites = new Set(
    clearances.flatMap((clearance) => (clearance.siteIds?.length ? clearance.siteIds : clearance.siteId ? [clearance.siteId] : [])),
  ).size;
  totals.facilities = facilities.length;
  totals.multiRegisterFacilities = facilities.filter((facility) => facility.registers.length > 1).length;
  meta.totals = totals;
  meta.clearanceSources = sortByCountDesc(
    countBy(clearances, (clearance) => (clearance.sources ?? []).join('+') || 'Unknown'),
    10,
  );
  const lguCounts = new Map();
  for (const clearance of clearances) {
    const municipality = clearance.municipality || 'Unmatched';
    const key = `${municipality}|${clearance.province || ''}`;
    const entry = lguCounts.get(key) ?? { municipality, province: clearance.province || '', count: 0 };
    entry.count += 1;
    lguCounts.set(key, entry);
  }
  meta.clearanceByLgu = [...lguCounts.values()]
    .sort((a, b) => b.count - a.count || a.municipality.localeCompare(b.municipality))
    .slice(0, 12)
    .reverse();
  if (ultralistTotals) {
    meta.eccUltralist = {
      generatedAt: ultralistTotals.generatedAt ?? null,
      referenceDate: ultralistTotals.referenceDate ?? null,
      records: ultralistTotals.records ?? clearances.length,
      ecc: ultralistTotals.ecc ?? totals.eccClearances,
      cnc: ultralistTotals.cnc ?? totals.cncClearances,
      matched: ultralistTotals.matched ?? null,
      linkedSites: ultralistTotals.linkedSites ?? totals.clearanceSites,
    };
  }
  const notes = Array.isArray(meta.notes) ? meta.notes : [];
  const ECC_NOTE = 'ECC and CNC clearances come from the ECC / CNC Ultralist (ECC OL 2015–Present, ECC Manual, CAT C and CNC OL 2017–Present), limited to Cebu and Bohol. Each clearance is intercrossed with DP, PTO and hazardous-waste records by exact reference number first, then by normalised establishment name within the same province; no fuzzy matching is used.';
  const index = notes.findIndex((note) => /ECC and CNC references are extracted/i.test(note));
  if (index >= 0) notes[index] = ECC_NOTE;
  else notes.push(ECC_NOTE);
  meta.notes = notes;
}

export async function applyEccUltralist() {
  console.log('Rebasing ECC / CNC clearances on the ultralist…');
  const raw = await readJson('ecc-ultralist.json', null);
  if (!raw) throw new Error('ecc-ultralist.json not found; run "npm run data:ecc" first.');

  const [sites, facilities, meta, hw] = await Promise.all([
    readJson('sites.json', []),
    readJson('facilities.json', []),
    readJson('meta.json', null),
    readJson('hw.json', []),
  ]);
  if (!sites.length || !facilities.length || !meta) {
    throw new Error('Dashboard dataset not found; run "npm run data:build" first.');
  }

  const hwByNumber = new Map();
  for (const registration of hw) {
    const codes = unique((registration.wasteCodes ?? []).map((code) => code.code));
    for (const number of [registration.hwGrNo, registration.appNo, registration.id]) {
      if (number) hwByNumber.set(number, { codes, registration });
    }
  }

  const records = decodeUltralist(raw).records;
  const clearances = records.map((record) => toClearance(record, hwByNumber));

  aggregateSites(sites, clearances);
  updateFacilities(facilities, sites);
  updateMeta(meta, clearances, facilities, { ...(raw.totals ?? {}), generatedAt: raw.generatedAt, referenceDate: raw.referenceDate });

  await Promise.all([
    writeFile(path.join(OUT_DIR, 'clearances.json'), JSON.stringify(clearances), 'utf8'),
    writeFile(path.join(OUT_DIR, 'sites.json'), JSON.stringify(sites), 'utf8'),
    writeFile(path.join(OUT_DIR, 'facilities.json'), JSON.stringify(facilities), 'utf8'),
    writeFile(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8'),
  ]);

  const clearanceSites = meta.totals.clearanceSites;
  console.log(
    `  ${clearances.length.toLocaleString()} clearances — ` +
    `${meta.totals.eccClearances.toLocaleString()} ECC · ${meta.totals.cncClearances.toLocaleString()} CNC · ` +
    `${clearanceSites.toLocaleString()} clearance sites · ${facilities.length.toLocaleString()} map facilities`,
  );
  return { clearances: clearances.length, clearanceSites, facilities: facilities.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  applyEccUltralist().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
