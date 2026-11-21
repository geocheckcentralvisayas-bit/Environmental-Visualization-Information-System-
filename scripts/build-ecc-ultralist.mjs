/**
 * Build the ECC / CNC Ultralist dataset.
 *
 * Sources (workbook D):
 *   - ECC OL (2015-Present)
 *   - ECC Manual
 *   - CAT C
 *   - CNC OL (2017-Present)
 *
 * Scope: Cebu and Bohol only. Negros Oriental and Siquijor rows are dropped.
 * The builder then intercrosses each clearance with the DP, PTO and hazardous
 * waste registers already produced by `build-data.mjs`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ECC_TABS, OUT_DIR, RAW_DIR, WORKBOOKS } from './config.mjs';
import { applyEccUltralist } from './apply-ecc-ultralist.mjs';
import { csvToObjects } from './lib/csv.mjs';
import { parseDate, todayIso, yearOf } from './lib/dates.mjs';
import {
  cleanText,
  companyCoreKey,
  companyStrictKey,
  countBy,
  normHeader,
  normKey,
  normalizeLguText,
  normalizeProvince,
  sortByCountDesc,
  titleCase,
  unique,
} from './lib/text.mjs';

const SOURCE_LABELS = Object.fromEntries(ECC_TABS.map((tab) => [tab.key, tab.sheet]));
const IN_SCOPE = new Set(['Cebu', 'Bohol']);
const COORD_BOUNDS = { lat: [4.0, 21.5], lon: [115.5, 127.5] };

function makeLookup(headers) {
  const map = new Map();
  headers.forEach((header, index) => {
    const norm = normHeader(header);
    if (norm && !map.has(norm)) map.set(norm, index);
  });
  return (...aliases) => {
    for (const alias of aliases) {
      const norm = normHeader(alias);
      if (map.has(norm)) return map.get(norm);
    }
    return -1;
  };
}

function value(row, index) {
  if (index < 0) return '';
  return cleanText(row[index] ?? '');
}

function parseNumber(raw) {
  const text = String(raw ?? '').replace(/,/g, '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function validCoord(lat, lon) {
  return (
    lat !== null && lon !== null &&
    lat >= COORD_BOUNDS.lat[0] && lat <= COORD_BOUNDS.lat[1] &&
    lon >= COORD_BOUNDS.lon[0] && lon <= COORD_BOUNDS.lon[1]
  );
}

function isPlaceholder(value) {
  return !value || /^(n\/?a|none|null|-|—|0+)$/i.test(String(value).trim());
}

function clearanceKey(value) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function splitRefs(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .split(/[\n,;]+/)
    .map((entry) => cleanText(entry).replace(/^[("'[\s]+|[)"'\]\s]+$/g, ''))
    .filter((entry) => !isPlaceholder(entry));
}

function normaliseNumber(value) {
  const cleaned = cleanText(value).replace(/\s+/g, ' ').trim();
  return isPlaceholder(cleaned) ? '' : cleaned;
}

function normaliseKind(kind, number) {
  const upper = String(number ?? '').toUpperCase();
  if (upper.startsWith('CNC')) return 'CNC';
  if (upper.startsWith('ECC')) return 'ECC';
  return kind === 'CNC' ? 'CNC' : 'ECC';
}

/**
 * Keep only rows whose primary province is Cebu or Bohol. Multi-province
 * labels are accepted only when they start with Cebu/Bohol and do not name
 * Negros Oriental or Siquijor.
 */
function scopeProvince(rawProvince, municipality, address, lguLookup) {
  const text = cleanText(rawProvince);
  const key = normKey(text);
  const hasNegros = key.includes('NEGROS');
  const hasSiquijor = key.includes('SIQUIJOR');
  if (hasNegros || hasSiquijor) return '';

  if (key.startsWith('CEBU')) return 'Cebu';
  if (key.startsWith('BOHOL')) return 'Bohol';
  if (key.includes('CEBU') && !key.includes('BOHOL')) return 'Cebu';
  if (key.includes('BOHOL') && !key.includes('CEBU')) return 'Bohol';

  // Fall back to the city / municipality index when the province cell is blank.
  const lgu = lookupLgu(municipality, lguLookup);
  if (lgu && IN_SCOPE.has(lgu.province)) return lgu.province;
  if (!lgu) {
    if (/\bCEBU\b/i.test(address)) return 'Cebu';
    if (/\bBOHOL\b/i.test(address)) return 'Bohol';
  }

  const fallback = normalizeProvince(text);
  return IN_SCOPE.has(fallback) ? fallback : '';
}

function buildLguLookup(meta, sites) {
  const map = new Map();
  const add = (municipality, province) => {
    const label = normalizeLguText(municipality);
    if (!label || !IN_SCOPE.has(province)) return;
    const keys = new Set([
      normKey(label),
      normKey(label.replace(/\s+(CITY|MUNICIPALITY)$/i, '')),
    ]);
    for (const key of keys) {
      if (!key || map.has(key)) continue;
      map.set(key, { municipality: label, province });
    }
  };
  for (const entry of meta?.lgus ?? []) add(entry.municipality, entry.province);
  for (const site of sites) add(site.municipality, site.province);
  return map;
}

function lookupLgu(municipality, lookup) {
  const label = normalizeLguText(municipality);
  if (!label) return null;
  const keys = [
    normKey(label),
    normKey(label.replace(/\s+(CITY|MUNICIPALITY)$/i, '')),
  ];
  for (const key of keys) {
    if (lookup.has(key)) return lookup.get(key);
  }
  return null;
}

const PROVINCE_TOKENS = new Set(['CEBU', 'BOHOL', 'NEGROS ORIENTAL', 'SIQUIJOR']);

function parseMunicipalityFromLocation(location, province) {
  const parts = String(location ?? '')
    .split(',')
    .map((part) => cleanText(part))
    .filter(Boolean);
  if (!parts.length) return '';
  if (province && normKey(parts[parts.length - 1]) === normKey(province)) parts.pop();
  // Also strip a trailing province token even when it disagrees with the
  // assigned province, e.g. "Barangay IV, Tanjay City, Negros Oriental".
  while (parts.length > 1 && PROVINCE_TOKENS.has(normKey(parts[parts.length - 1]))) parts.pop();
  if (!parts.length) return '';
  const last = parts[parts.length - 1];
  if (/^(brgy\.?|barangay|sitio|purok|zone)\b/i.test(last) && parts.length > 1) return parts[parts.length - 2];
  return last;
}

function parseBarangay(address) {
  const first = String(address ?? '').split(',')[0] ?? '';
  const match = /^(?:brgy\.?|barangay)\s+(.+)$/i.exec(cleanText(first));
  return match ? titleCase(match[1]) : '';
}

function parseIssued(raw) {
  const text = cleanText(raw);
  if (!text || /^#+$/.test(text)) return null;
  return parseDate(text.split(/\s+\d{1,2}:\d{2}/)[0]);
}

function yearFrom(rawYear, issued) {
  const fromDate = yearOf(issued);
  if (fromDate) return fromDate;
  const n = Number(String(rawYear ?? '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n >= 1900 && n <= 2100 ? n : null;
}

function sourceMeta(tab) {
  const headers = {
    ECC_OL: {
      number: 'ECC NO.',
      project: 'PROJECT NAME',
      proponent: 'PROPONENT NAME',
      address: 'PROJECT ADDRESS',
      municipality: 'MUNICIPALITY',
      province: 'PROVINCE',
      region: 'Region',
      issued: 'DATE ISSUED mm/dd/yy',
      status: 'Status',
      year: 'Year Approved',
      projectType: 'Project Type (MC 2014-005)',
      specificType: 'Specific Project Type',
      sizeAmount: 'Proj Size (Amt)',
      sizeUnit: 'Proj Size (Unit)',
      landArea: 'Land Area (sqm)',
      lat: 'Latitude',
      lon: 'Longitude',
      government: 'Government Project?',
      withinPa: 'within PA?',
      amendment: 'Amendment?',
      remarks: 'Remarks',
    },
    ECC_MANUAL: {
      application: 'TYPE OF APPLICATION (Latest Issuance)',
      iis: 'IIS Number',
      number: 'ECC NO',
      project: 'PROJECT NAME',
      proponent: 'PROPONENT NAME or Company Name',
      address: 'Project Location',
      municipality: 'Municipality',
      province: 'Province',
      issued: 'DATE ISSUED MM/DD/YYYY (sorted from oldest to latest)',
      projectType: 'SPECIFIC PROJECT TYPE',
      sizeAmount: 'Proj Size (Amt)',
      sizeUnit: 'Proj Size (Unit)',
      landArea: 'Land Area (sqm)',
      lat: 'Latitude',
      lon: 'Longitude',
      withinPa: 'Within PA?',
      amendment: 'WITH Amendment (Y/N)?',
      remarks: 'Nature of Amendment',
      original: 'Original ECC: ECC Number',
    },
    CAT_C: {
      category: 'Type (CatC or pre-1982)',
      iis: 'IS No.',
      project: 'PROJECT NAME',
      projectType: 'PROJECT TYPE',
      address: 'Project Location',
      province: 'Province',
      proponent: 'Proponent Name',
      proponentAddress: 'Proponent Address',
      representative: 'Authorized Representative',
      designation: 'Designation',
      sizeAmount: 'Proj Size (Amt)',
      sizeUnit: 'Proj Size (Unit)',
      number: 'CNC Reference Number (To be inputted by casehandler)',
      issued: 'Date Signed',
    },
    CNC_OL: {
      project: 'Project Name',
      proponent: 'Proponent Name',
      address: 'Specific Address',
      municipality: 'Municipality',
      province: 'Province',
      region: 'Region',
      number: 'CNC Reference No.',
      submitted: 'DateTimeSubmitted',
      issued: 'Decision Date',
      status: 'Decision',
      year: 'Year',
      projectType: 'Project Type (MC 2014-005)',
      sizeAmount: 'Proj Size (Amt)',
      sizeUnit: 'Proj Size (Unit)',
      lat: 'Latitude',
      lon: 'Longitude',
      plotted: 'Plotted in KML?',
      remarks: 'Remarks',
    },
  };
  return headers[tab.key] ?? {};
}

function readSource(tab, csvText, lguLookup) {
  const { headers, rows } = csvToObjects(csvText);
  const find = makeLookup(headers);
  const spec = sourceMeta(tab);
  const index = Object.fromEntries(Object.entries(spec).map(([field, header]) => [field, find(header)]));
  const cell = (row, column) => (column >= 0 ? cleanText(row[headers[column]] ?? '') : '');
  const out = [];
  const excluded = { negros: 0, siquijor: 0, other: 0, blank: 0 };

  for (const row of rows) {
    const rawProvince = cell(row, index.province);
    const rawMunicipality = index.municipality >= 0 ? cell(row, index.municipality) : '';
    const address = cell(row, index.address);
    // Some source rows carry a wrong province cell for an out-of-scope project
    // (for example a Negros Oriental location filed under "Cebu"). Guard on the
    // project location text as well so those rows never enter the ultralist.
    // The phrase check avoids dropping Cebu addresses that merely contain a
    // street named "Negros".
    const locationText = `${rawMunicipality} ${address}`;
    if (/\bNEGROS\s+ORIENTAL\b/i.test(locationText)) {
      excluded.negros += 1;
      continue;
    }
    if (/\bSIQUIJOR\b/i.test(locationText)) {
      excluded.siquijor += 1;
      continue;
    }
    const province = scopeProvince(rawProvince, rawMunicipality || address, address, lguLookup);
    if (!province) {
      const key = normKey(rawProvince);
      if (key.includes('NEGROS')) excluded.negros += 1;
      else if (key.includes('SIQUIJOR')) excluded.siquijor += 1;
      else if (!key) excluded.blank += 1;
      else excluded.other += 1;
      continue;
    }

    const number = normaliseNumber(cell(row, index.number));
    const project = cell(row, index.project);
    const proponent = cell(row, index.proponent);
    if (!project && !proponent && !number) continue;

    let municipality = normalizeLguText(rawMunicipality);
    if (!municipality && tab.key === 'CAT_C') municipality = parseMunicipalityFromLocation(address, province);
    if (!municipality) municipality = parseMunicipalityFromLocation(address, province);
    const known = lookupLgu(municipality, lguLookup);
    if (known) {
      municipality = known.municipality;
    } else if (municipality) {
      municipality = titleCase(municipality);
    }

    const issued = parseIssued(cell(row, index.issued));
    const rawYear = cell(row, index.year);
    const year = yearFrom(rawYear, issued);
    const lat = parseNumber(cell(row, index.lat));
    const lon = parseNumber(cell(row, index.lon));
    const hasCoord = validCoord(lat, lon);

    const kind = normaliseKind(tab.type, number);
    const statusRaw = cell(row, index.status);
    const categoryRaw = cell(row, index.category);
    const application = cell(row, index.application);
    const remarks = unique([
      cell(row, index.remarks),
      cell(row, index.original) ? `Original ECC: ${cell(row, index.original)}` : '',
      cell(row, index.representative) ? `Representative: ${cell(row, index.representative)}` : '',
    ]).join(' · ');

    out.push({
      sourceKey: tab.key,
      sourceSheet: SOURCE_LABELS[tab.key] ?? tab.sheet,
      kind,
      number,
      project,
      proponent,
      address,
      barangay: parseBarangay(address),
      municipality,
      province,
      region: cell(row, index.region),
      issued,
      year,
      status: statusRaw || categoryRaw || (issued ? 'Issued' : ''),
      applicationType: application,
      projectType: unique([cell(row, index.projectType), cell(row, index.specificType)]).join(' · '),
      sizeAmount: cell(row, index.sizeAmount),
      sizeUnit: cell(row, index.sizeUnit),
      landArea: cell(row, index.landArea),
      lat: hasCoord ? lat : null,
      lon: hasCoord ? lon : null,
      withinPa: cell(row, index.withinPa),
      government: cell(row, index.government),
      amendment: cell(row, index.amendment),
      plotted: cell(row, index.plotted),
      remarks,
      iis: cell(row, index.iis),
    });
  }

  return { rows: out, total: rows.length, excluded };
}

function mergeRecord(target, incoming) {
  if (!target.project && incoming.project) target.project = incoming.project;
  if (!target.proponent && incoming.proponent) target.proponent = incoming.proponent;
  if (!target.address && incoming.address) target.address = incoming.address;
  if (!target.barangay && incoming.barangay) target.barangay = incoming.barangay;
  if (!target.municipality && incoming.municipality) target.municipality = incoming.municipality;
  if (!target.province && incoming.province) target.province = incoming.province;
  if (!target.region && incoming.region) target.region = incoming.region;
  if (!target.issued && incoming.issued) target.issued = incoming.issued;
  if (!target.year && incoming.year) target.year = incoming.year;
  if (!target.status && incoming.status) target.status = incoming.status;
  if (!target.applicationType && incoming.applicationType) target.applicationType = incoming.applicationType;
  if (!target.projectType && incoming.projectType) target.projectType = incoming.projectType;
  if (!target.sizeAmount && incoming.sizeAmount) target.sizeAmount = incoming.sizeAmount;
  if (!target.sizeUnit && incoming.sizeUnit) target.sizeUnit = incoming.sizeUnit;
  if (!target.landArea && incoming.landArea) target.landArea = incoming.landArea;
  if (target.lat === null && incoming.lat !== null) {
    target.lat = incoming.lat;
    target.lon = incoming.lon;
  }
  if (!target.withinPa && incoming.withinPa) target.withinPa = incoming.withinPa;
  if (!target.government && incoming.government) target.government = incoming.government;
  if (!target.amendment && incoming.amendment) target.amendment = incoming.amendment;
  if (!target.plotted && incoming.plotted) target.plotted = incoming.plotted;
  if (!target.iis && incoming.iis) target.iis = incoming.iis;
  if (incoming.remarks) target.remarks = unique([target.remarks, incoming.remarks].filter(Boolean)).join(' · ');
  target.sources = unique([...target.sources, incoming.sourceSheet]);
  target.sourceKeys = unique([...target.sourceKeys, incoming.sourceKey]);
}

function dedupeRecords(records) {
  const merged = new Map();
  const noNumber = [];
  for (const record of records) {
    const numberKey = clearanceKey(record.number);
    if (!numberKey) {
      noNumber.push(record);
      continue;
    }
    const key = `${record.kind}|${numberKey}`;
    const existing = merged.get(key);
    if (existing) {
      mergeRecord(existing, record);
      existing.rowCount += 1;
    } else {
      merged.set(key, {
        ...record,
        sources: [record.sourceSheet],
        sourceKeys: [record.sourceKey],
        rowCount: 1,
      });
    }
  }
  return [...merged.values(), ...noNumber.map((record) => ({
    ...record,
    sources: [record.sourceSheet],
    sourceKeys: [record.sourceKey],
    rowCount: 1,
  }))];
}

function buildRegistry({ sites, permits, hw, clearances }) {
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  const permitsBySite = new Map();
  const hwBySite = new Map();
  const sitesByStrict = new Map();
  const sitesByCore = new Map();
  const permitsByStrict = new Map();
  const permitsByCore = new Map();
  const hwByStrict = new Map();
  const hwByCore = new Map();
  const clearanceByNumber = new Map();
  const permitByNumberRef = new Map();
  const hwByNumberRef = new Map();

  const push = (map, key, item) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  };

  for (const site of sites) {
    push(sitesByStrict, companyStrictKey(site.company), site);
    push(sitesByCore, companyCoreKey(site.company), site);
  }
  for (const permit of permits) {
    push(permitsBySite, permit.siteId, permit);
    push(permitsByStrict, companyStrictKey(permit.company), permit);
    push(permitsByCore, companyCoreKey(permit.company), permit);
    for (const ref of splitRefs(permit.eccNo)) {
      permitByNumberRef.set(clearanceKey(ref), permit);
    }
  }
  for (const registration of hw) {
    push(hwBySite, registration.siteId, registration);
    push(hwByStrict, companyStrictKey(registration.company), registration);
    push(hwByCore, companyCoreKey(registration.company), registration);
    for (const ref of [...registration.eccNos, ...registration.cncNos]) {
      hwByNumberRef.set(clearanceKey(ref), registration);
    }
  }
  for (const clearance of clearances) {
    clearanceByNumber.set(clearanceKey(clearance.number), clearance);
  }

  return {
    sitesById,
    permitsBySite,
    hwBySite,
    sitesByStrict,
    sitesByCore,
    permitsByStrict,
    permitsByCore,
    hwByStrict,
    hwByCore,
    clearanceByNumber,
    permitByNumberRef,
    hwByNumberRef,
  };
}

function linkedRefs(record, registry) {
  const numberKey = clearanceKey(record.number);
  const siteIds = new Set();
  let numberMatch = false;

  const clearance = numberKey ? registry.clearanceByNumber.get(numberKey) : null;
  if (clearance) {
    numberMatch = true;
    if (clearance.siteId) siteIds.add(clearance.siteId);
  }
  const directPermit = numberKey ? registry.permitByNumberRef.get(numberKey) : null;
  if (directPermit) {
    numberMatch = true;
    if (directPermit.siteId) siteIds.add(directPermit.siteId);
  }
  const directHw = numberKey ? registry.hwByNumberRef.get(numberKey) : null;
  if (directHw) {
    numberMatch = true;
    if (directHw.siteId) siteIds.add(directHw.siteId);
  }

  const strict = companyStrictKey(record.proponent);
  const core = companyCoreKey(record.proponent);
  const provinceMatches = (item) => !record.province || item.province === record.province;
  const municipalityKey = normKey(record.municipality);
  const areaMatches = (item) => provinceMatches(item) && (!municipalityKey || normKey(item.municipality) === municipalityKey);
  const narrow = (items) => {
    if (!items.length) return [];
    const inArea = items.filter(areaMatches);
    if (inArea.length || !municipalityKey) return inArea;
    // A small province-wide fallback keeps legitimate single-site companies
    // connected when their register address sits in a neighbouring LGU.
    const provinceWide = items.filter(provinceMatches);
    return provinceWide.length <= 5 ? provinceWide : [];
  };
  let nameMethod = 'none';

  const exactSites = narrow(strict ? registry.sitesByStrict.get(strict) ?? [] : []);
  const aliasSites = narrow(core ? registry.sitesByCore.get(core) ?? [] : []);
  let nameSites = [];
  if (exactSites.length) {
    nameSites = exactSites;
    nameMethod = 'exact';
  } else if (aliasSites.length) {
    nameSites = aliasSites;
    nameMethod = 'alias';
  }

  for (const site of nameSites) siteIds.add(site.id);

  // Some raw registers contain permits or HW rows that are not represented by
  // a site; keep their direct records available as a fallback.
  const exactPermits = narrow(strict ? registry.permitsByStrict.get(strict) ?? [] : []);
  const aliasPermits = narrow(core ? registry.permitsByCore.get(core) ?? [] : []);
  const exactHw = narrow(strict ? registry.hwByStrict.get(strict) ?? [] : []);
  const aliasHw = narrow(core ? registry.hwByCore.get(core) ?? [] : []);
  const permitFallback = exactPermits.length ? exactPermits : aliasPermits;
  const hwFallback = exactHw.length ? exactHw : aliasHw;
  if (!nameSites.length && (permitFallback.length || hwFallback.length)) {
    nameMethod = exactPermits.length || exactHw.length ? 'exact' : 'alias';
  }

  const permitMap = new Map();
  const hwMap = new Map();
  const siteList = [];

  for (const siteId of siteIds) {
    const site = registry.sitesById.get(siteId);
    if (site) {
      siteList.push({
        id: site.id,
        company: site.company,
        municipality: site.municipality,
        province: site.province,
      });
    }
    for (const permit of registry.permitsBySite.get(siteId) ?? []) {
      permitMap.set(permit.permitNo, permit);
    }
    for (const registration of registry.hwBySite.get(siteId) ?? []) {
      hwMap.set(registration.hwGrNo || registration.id, registration);
    }
  }
  for (const permit of permitFallback) permitMap.set(permit.permitNo, permit);
  for (const registration of hwFallback) hwMap.set(registration.hwGrNo || registration.id, registration);
  if (directPermit) permitMap.set(directPermit.permitNo, directPermit);
  if (directHw) hwMap.set(directHw.hwGrNo || directHw.id, directHw);

  const permitRefs = [...permitMap.values()]
    .map((permit) => ({
      type: permit.type,
      number: permit.permitNo,
      year: permit.year ?? null,
      expiry: permit.expiry ?? null,
      lifecycle: permit.lifecycle ?? 'Unknown',
      municipality: permit.municipality ?? '',
      province: permit.province ?? '',
    }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.number.localeCompare(b.number));

  const hwRefs = [...hwMap.values()]
    .map((registration) => ({
      number: registration.hwGrNo || registration.appNo || '',
      expiry: registration.expiry ?? null,
      lifecycle: registration.lifecycle ?? 'Unknown',
      municipality: registration.municipality ?? '',
      province: registration.province ?? '',
    }))
    .filter((entry) => entry.number)
    .sort((a, b) => String(b.expiry ?? '').localeCompare(String(a.expiry ?? '')) || a.number.localeCompare(b.number));

  const companies = unique(siteList.map((site) => site.company)).slice(0, 30);
  const matchMethod = numberMatch ? 'number' : nameMethod;
  const linkedSite = siteList[0] ?? null;
  const coordSource = record.lat !== null && record.lon !== null
    ? 'record'
    : linkedSite
      ? 'linked-site'
      : 'none';

  let lat = record.lat;
  let lon = record.lon;
  if (lat === null || lon === null) {
    const site = linkedSite ? registry.sitesById.get(linkedSite.id) : null;
    if (site && site.lat !== null && site.lon !== null) {
      lat = site.lat;
      lon = site.lon;
    }
  }

  return {
    ...record,
    lat,
    lon,
    coordSource,
    matchMethod,
    matched: matchMethod !== 'none',
    siteIds: [...siteIds],
    siteCount: siteIds.size,
    sites: siteList.slice(0, 30),
    companies,
    permitRefs,
    hwRefs,
    dpCount: permitRefs.filter((ref) => ref.type === 'DP').length,
    ptoCount: permitRefs.filter((ref) => ref.type === 'PTO').length,
    hwCount: hwRefs.length,
  };
}

function recordId(record) {
  const numberKey = clearanceKey(record.number);
  if (numberKey) return `${record.kind}-${numberKey}`;
  const fallback = `${record.kind}-${companyStrictKey(record.proponent)}-${record.year ?? ''}-${normKey(record.project).slice(0, 60)}`;
  return fallback.replace(/[^A-Z0-9-]/g, '').slice(0, 120) || `ECC-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Keep the published payload small. Linked DP/PTO/HW details are resolved
 * from the main dataset at runtime; only the reference numbers are stored.
 */
function compactRecord(record) {
  return {
    id: record.id,
    kind: record.kind,
    number: record.number,
    project: record.project,
    proponent: record.proponent,
    address: record.address,
    barangay: record.barangay,
    municipality: record.municipality,
    province: record.province,
    region: record.region,
    issued: record.issued,
    year: record.year,
    status: record.status,
    applicationType: record.applicationType,
    projectType: record.projectType,
    sizeAmount: record.sizeAmount,
    sizeUnit: record.sizeUnit,
    landArea: record.landArea,
    lat: record.lat,
    lon: record.lon,
    coordSource: record.coordSource,
    withinPa: record.withinPa,
    government: record.government,
    amendment: record.amendment,
    plotted: record.plotted,
    remarks: record.remarks,
    iis: record.iis,
    sources: record.sources,
    matchMethod: record.matchMethod,
    matched: record.matched,
    siteIds: record.siteIds,
    siteCount: record.siteCount,
    permitNos: record.permitRefs.map((ref) => ref.number),
    hwNos: record.hwRefs.map((ref) => ref.number),
    dpCount: record.dpCount,
    ptoCount: record.ptoCount,
    hwCount: record.hwCount,
    rowCount: record.rowCount,
  };
}

/** Field order for the compact array-of-arrays payload. */
const RECORD_FIELDS = Object.keys(compactRecord({
  id: '', kind: '', number: '', project: '', proponent: '', address: '', barangay: '',
  municipality: '', province: '', region: '', issued: null, year: null, status: '',
  applicationType: '', projectType: '', sizeAmount: '', sizeUnit: '', landArea: '',
  lat: null, lon: null, coordSource: '', withinPa: '', government: '', amendment: '',
  plotted: '', remarks: '', iis: '', sources: [], matchMethod: '', matched: false,
  siteIds: [], siteCount: 0, permitRefs: [], hwRefs: [], dpCount: 0, ptoCount: 0, hwCount: 0,
  rowCount: 0,
}));

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path.join(OUT_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const TODAY = todayIso();
  await mkdir(OUT_DIR, { recursive: true });

  console.log('Building ECC / CNC Ultralist (Cebu and Bohol only)…');
  const meta = await readJson('meta.json', {});
  const sites = await readJson('sites.json', []);
  const permits = await readJson('permits.json', []);
  const hw = await readJson('hw.json', []);
  const clearances = await readJson('clearances.json', []);

  const lguLookup = buildLguLookup(meta, sites);
  const collected = [];
  const sourceStats = [];

  for (const tab of ECC_TABS) {
    let text;
    try {
      text = await readFile(path.join(RAW_DIR, `${tab.key}.csv`), 'utf8');
    } catch {
      throw new Error(`${tab.key}: run "npm run data:fetch" first (missing ${RAW_DIR}/${tab.key}.csv)`);
    }
    const result = readSource(tab, text, lguLookup);
    collected.push(...result.rows);
    sourceStats.push({
      key: tab.key,
      sheet: tab.sheet,
      fetchedRows: result.total,
      keptRows: result.rows.length,
      excludedNegros: result.excluded.negros,
      excludedSiquijor: result.excluded.siquijor,
      excludedOther: result.excluded.other,
      excludedBlank: result.excluded.blank,
    });
    console.log(
      `  ${tab.key.padEnd(12)} ${String(result.total).padStart(6)} rows → ${String(result.rows.length).padStart(6)} in Cebu/Bohol ` +
      `(${result.excluded.negros + result.excluded.siquijor} excluded for Negros/Siquijor)`,
    );
  }

  const deduped = dedupeRecords(collected);
  console.log(`  ${collected.length.toLocaleString()} in-scope rows → ${deduped.length.toLocaleString()} unique ECC/CNC records`);

  const registry = buildRegistry({ sites, permits, hw, clearances });
  const records = deduped
    .map((record) => linkedRefs(record, registry))
    .map((record) => ({ ...record, id: recordId(record) }))
    .sort((a, b) => {
      const yearDiff = (b.year ?? 0) - (a.year ?? 0);
      if (yearDiff) return yearDiff;
      return String(a.number || a.project).localeCompare(String(b.number || b.project));
    });
  const recordsOut = records.map(compactRecord);

  const byYearMap = new Map();
  for (const record of records) {
    if (!record.year) continue;
    const entry = byYearMap.get(record.year) ?? { year: record.year, ecc: 0, cnc: 0 };
    if (record.kind === 'CNC') entry.cnc += 1;
    else entry.ecc += 1;
    byYearMap.set(record.year, entry);
  }

  const byMunicipality = sortByCountDesc(
    countBy(records, (record) => `${record.municipality || 'Unmatched'}|${record.province}`),
    60,
  ).map(({ name, count }) => {
    const [municipality, province] = name.split('|');
    return { municipality, province, count };
  });

  const totals = {
    records: records.length,
    ecc: records.filter((record) => record.kind === 'ECC').length,
    cnc: records.filter((record) => record.kind === 'CNC').length,
    cebu: records.filter((record) => record.province === 'Cebu').length,
    bohol: records.filter((record) => record.province === 'Bohol').length,
    matched: records.filter((record) => record.matched).length,
    unmatched: records.filter((record) => !record.matched).length,
    linkedDp: records.filter((record) => record.dpCount > 0).length,
    linkedPto: records.filter((record) => record.ptoCount > 0).length,
    linkedHw: records.filter((record) => record.hwCount > 0).length,
    linkedSites: new Set(records.flatMap((record) => record.siteIds)).size,
    active: records.filter((record) => record.permitRefs.some((ref) => ref.lifecycle === 'Active' || ref.lifecycle === 'Expiring')).length,
  };

  const data = {
    generatedAt: new Date().toISOString(),
    referenceDate: TODAY,
    sourceUrl: WORKBOOKS.D.url,
    scopeLabel: 'Region VII · Cebu and Bohol only',
    sources: sourceStats,
    totals,
    matchQuality: {
      number: records.filter((record) => record.matchMethod === 'number').length,
      exact: records.filter((record) => record.matchMethod === 'exact').length,
      alias: records.filter((record) => record.matchMethod === 'alias').length,
      none: records.filter((record) => record.matchMethod === 'none').length,
    },
    byYear: [...byYearMap.values()].sort((a, b) => a.year - b.year),
    byMunicipality,
    byProjectType: sortByCountDesc(countBy(records, (record) => record.projectType || 'Unspecified'), 30),
    byStatus: sortByCountDesc(countBy(records, (record) => record.status || 'Unspecified'), 15),
    bySource: sortByCountDesc(countBy(records.flatMap((record) => record.sources), (source) => source), 10),
    fields: RECORD_FIELDS,
    records: recordsOut.map((record) => RECORD_FIELDS.map((field) => record[field] ?? null)),
    notes: [
      'ECC and CNC records are consolidated from the four approved EIA ultralist tabs: ECC OL (2015-Present), ECC Manual, CAT C and CNC OL (2017-Present).',
      'Rows are limited to Cebu and Bohol. Negros Oriental and Siquijor rows are excluded before matching, including rows whose project location names an out-of-scope province even when the province cell is mislabelled.',
      'Duplicate ECC/CNC numbers across the source tabs are merged into one record while retaining every source tab.',
      'Records are intercrossed with the DP, PTO and hazardous-waste registers by exact ECC/CNC number first, then by normalised proponent name within the same province. No fuzzy matching is used.',
      'Coordinates come from the source row when present. If a row has no usable coordinate, the exact point of the linked establishment is used; no municipality-centroid approximation is applied.',
    ],
  };

  const outFile = path.join(OUT_DIR, 'ecc-ultralist.json');
  await writeFile(outFile, JSON.stringify(data), 'utf8');
  const bytes = Buffer.byteLength(JSON.stringify(data));
  console.log(
    `  totals: ${totals.records.toLocaleString()} records (${totals.ecc.toLocaleString()} ECC · ${totals.cnc.toLocaleString()} CNC) · ` +
    `${totals.matched.toLocaleString()} matched · ${totals.unmatched.toLocaleString()} unmatched`,
  );
  console.log(
    `  linked: ${totals.linkedDp.toLocaleString()} with DP · ${totals.linkedPto.toLocaleString()} with PTO · ` +
    `${totals.linkedHw.toLocaleString()} with HW · ${totals.linkedSites.toLocaleString()} establishments`,
  );
  console.log(`  ecc-ultralist.json ${(bytes / 1024 / 1024).toFixed(2)} MB`);

  // The ultralist is the authoritative ECC/CNC register: rebase the clearance
  // index, clearance-site counters and map facility totals on it.
  await applyEccUltralist();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
