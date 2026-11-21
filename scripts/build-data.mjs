import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PERMIT_TABS, RAW_DIR, OUT_DIR, SUPPORT_TABS, WORKBOOKS } from './config.mjs';
import { csvToObjects, parseCsv } from './lib/csv.mjs';
import { dateDiffDays, parseDate, todayIso } from './lib/dates.mjs';
import { buildLayerIndex, FLOOD_RANK, queryLayerIndex, SLIDE_RANK } from './lib/geo.mjs';
import {
  cleanText,
  companyCoreKey,
  companyStrictKey,
  countBy,
  normHeader,
  normKey,
  normalizeProvince,
  normalizeSourceStatus,
  normalizeLguText,
  parentheticalKeys,
  permitSignatures,
  significantTokens,
  similarity,
  sortByCountDesc,
  titleCase,
  tokenDice,
  unique,
} from './lib/text.mjs';

const TODAY = todayIso();
const GEO_DIR = path.join(OUT_DIR, 'geojson');

const PROVINCE_BBOX = {
  Cebu: [9.25, 11.75, 123.05, 124.75],
  Bohol: [9.25, 10.6, 123.35, 124.95],
  'Negros Oriental': [8.85, 10.75, 122.3, 123.65],
  Siquijor: [8.95, 9.55, 123.3, 123.85],
};

const IN_SCOPE = new Set(['Cebu', 'Bohol']);

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function key(row, index) {
  if (index < 0) return '';
  return cleanText(row[index] ?? '');
}

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

function parseNumber(value) {
  const s = String(value ?? '').replace(/,/g, ' ').trim();
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function inPhilippines(lat, lon) {
  return lat >= 4.0 && lat <= 21.5 && lon >= 115.5 && lon <= 127.5;
}

function validCoord(lat, lon) {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= 4.0 && lat <= 21.5 && lon >= 115.5 && lon <= 127.5
  );
}

function roundCoord(n) {
  return Math.round(n * 1e6) / 1e6;
}

function distanceKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function resolveCoordinate(latRaw, lonRaw, province) {
  const lat0 = parseNumber(latRaw);
  const lon0 = parseNumber(lonRaw);
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0) || (lat0 === 0 && lon0 === 0)) {
    return { lat: null, lon: null, status: 'missing' };
  }
  let lat = lat0;
  let lon = lon0;
  let status = 'ok';
  if (!inPhilippines(lat, lon)) {
    if (inPhilippines(lon, lat)) {
      [lat, lon] = [lon, lat];
      status = 'swapped';
    } else {
      return { lat: null, lon: null, status: 'invalid' };
    }
  }
  const bbox = PROVINCE_BBOX[province];
  if (bbox) {
    const [minLat, maxLat, minLon, maxLon] = bbox;
    if (lat < minLat - 0.35 || lat > maxLat + 0.35 || lon < minLon - 0.35 || lon > maxLon + 0.35) {
      status = status === 'swapped' ? 'swapped-suspect' : 'suspect';
    }
  }
  return { lat: roundCoord(lat), lon: roundCoord(lon), status };
}

/* ------------------------------------------------------------------ */
/* coordinate validation + address repair                              */
/* ------------------------------------------------------------------ */

/*
 * Register coordinates are frequently wrong: geocodes from Metro Manila,
 * Mindoro or the middle of a strait, points on the wrong island, or plain
 * typos. Every point is therefore validated against the DENR provincial
 * boundary polygons (land only, no municipal waters) and against a locality
 * gazetteer built from the trustworthy points of the registers themselves.
 * A point that fails is re-homed to the centroid of its barangay, city or
 * municipality derived from the company address, and flagged as such.
 */

const MAX_LGU_DRIFT_KM = 40;
const BARANGAY_SNAP_RADIUS_KM = 15;
const LGU_SNAP_RADIUS_KM = 25;

async function loadProvinceIndex() {
  try {
    const geojson = JSON.parse(await readFile(path.join(GEO_DIR, 'provincial_boundary.geojson'), 'utf8'));
    const features = geojson.features.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, _province: normalizeProvince(feature.properties.province ?? '') },
    }));
    console.log(`  Provincial land polygons: ${features.map((f) => f.properties._province).join(', ')}`);
    return buildLayerIndex(features);
  } catch (error) {
    console.warn(`  ! provincial_boundary.geojson unavailable (${error.message}); using bbox checks only`);
    return null;
  }
}

function provincesAt(index, lat, lon) {
  if (!index) return null;
  const hits = new Set();
  for (const feature of queryLayerIndex(index, lon, lat)) hits.add(feature.properties._province);
  return hits;
}

function insideProvince(index, province, lat, lon) {
  if (!province) return false;
  const hits = provincesAt(index, lat, lon);
  if (hits) return hits.has(province);
  const bbox = PROVINCE_BBOX[province];
  if (!bbox) return inPhilippines(lat, lon);
  const [minLat, maxLat, minLon, maxLon] = bbox;
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

function medianPoint(points) {
  const lats = points.map((point) => point[0]).sort((a, b) => a - b);
  const lons = points.map((point) => point[1]).sort((a, b) => a - b);
  return [lats[Math.floor(lats.length / 2)], lons[Math.floor(lons.length / 2)]];
}

function robustCentroid(points, radiusKm) {
  let centroid = medianPoint(points);
  const inliers = points.filter((point) => distanceKm(point, centroid) <= radiusKm);
  if (inliers.length >= 2) centroid = medianPoint(inliers);
  return centroid;
}

function pushPoint(map, key, point) {
  if (!key) return;
  const bucket = map.get(key);
  if (bucket) bucket.push(point);
  else map.set(key, [point]);
}

/**
 * Builds barangay / city / province reference points from coordinates that
 * are demonstrably inside the declared province. The medians are robust to
 * the bad points, which are simply left out of the trusted set.
 */
function buildCoordinateGazetteer(rows, provinceIndex) {
  const lguBuckets = new Map();
  const barangayBuckets = new Map();
  const provinceBuckets = new Map();

  for (const row of rows) {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon) || !row.province) continue;
    if (!insideProvince(provinceIndex, row.province, row.lat, row.lon)) continue;
    const point = [row.lat, row.lon];
    pushPoint(lguBuckets, `${row.province}|${row.municipality}`, point);
    pushPoint(provinceBuckets, row.province, point);
    if (row.barangay) pushPoint(barangayBuckets, `${row.province}|${row.municipality}|${row.barangay}`, point);
  }

  const lgu = new Map();
  for (const [key, points] of lguBuckets) lgu.set(key, robustCentroid(points, LGU_SNAP_RADIUS_KM));

  const barangay = new Map();
  for (const [key, points] of barangayBuckets) {
    if (points.length < 2) continue;
    barangay.set(key, robustCentroid(points, BARANGAY_SNAP_RADIUS_KM));
  }

  const province = new Map();
  for (const [key, points] of provinceBuckets) province.set(key, medianPoint(points));

  console.log(
    `  Coordinate gazetteer: ${lgu.size} cities/municipalities · ${barangay.size} barangays · ${province.size} provinces`,
  );
  return { lgu, barangay, province };
}

function addQaFlag(row, flag) {
  if (!Array.isArray(row.qa) || row.qa.includes(flag)) return;
  row.qa.push(flag);
}

function dropQaFlags(row, flags) {
  if (!Array.isArray(row.qa)) return;
  row.qa = row.qa.filter((flag) => !flags.includes(flag));
}

/**
 * Re-homes unusable coordinates onto the address locality. Keeps a valid
 * coordinate untouched, marks snapped points so the UI can show them as
 * approximate, and reports what happened.
 */
function repairCoordinates(rows, gazetteer, provinceIndex) {
  const report = { kept: 0, corrected: 0, approximate: 0, unresolved: 0, outside: 0, drift: 0 };

  for (const row of rows) {
    let declared = row.province;
    const hasRaw = Number.isFinite(row.lat) && Number.isFinite(row.lon);

    /*
     * If the raw coordinate lands in a different in-scope province than the
     * declared one, trust the coordinate: the province column is the noisy
     * field (e.g. a Bohol establishment filed under Cebu). Promoting between
     * Cebu and Bohol keeps the point where it actually is instead of snapping
     * it to the wrong island.
     */
    if (hasRaw && IN_SCOPE.has(declared)) {
      const actual = [...provincesAt(provinceIndex, row.lat, row.lon)].find((province) => IN_SCOPE.has(province));
      if (actual && actual !== declared) {
        row.province = actual;
        declared = actual;
      }
    }

    const lguRef = declared ? gazetteer.lgu.get(`${declared}|${row.municipality}`) : null;
    const barangayRef = declared && row.barangay
      ? gazetteer.barangay.get(`${declared}|${row.municipality}|${row.barangay}`)
      : null;
    const fallback = barangayRef ?? lguRef ?? (declared ? gazetteer.province.get(declared) : null);

    if (!hasRaw) {
      if (fallback) {
        row.lat = roundCoord(fallback[0]);
        row.lon = roundCoord(fallback[1]);
        row.coordStatus = 'approximate';
        addQaFlag(row, 'coordinates_approximate');
        dropQaFlags(row, ['no_coordinates', 'invalid_coordinates']);
        report.approximate += 1;
      } else {
        row.lat = null;
        row.lon = null;
        row.coordStatus = 'missing';
        report.unresolved += 1;
      }
      continue;
    }

    const inside = insideProvince(provinceIndex, declared, row.lat, row.lon);
    const drift = lguRef ? distanceKm(lguRef, [row.lat, row.lon]) : 0;
    const reason = !inside ? 'outside' : lguRef && drift > MAX_LGU_DRIFT_KM ? 'drift' : 'kept';

    if (reason === 'kept') {
      row.coordStatus = row.coordStatus === 'swapped' ? 'swapped' : 'ok';
      dropQaFlags(row, ['coordinates_suspect', 'invalid_coordinates']);
      report.kept += 1;
      continue;
    }

    if (!fallback) {
      row.lat = null;
      row.lon = null;
      row.coordStatus = 'unresolved';
      addQaFlag(row, 'invalid_coordinates');
      report.unresolved += 1;
      continue;
    }

    row.lat = roundCoord(fallback[0]);
    row.lon = roundCoord(fallback[1]);
    row.coordStatus = 'corrected';
    addQaFlag(row, 'coordinates_corrected');
    dropQaFlags(row, ['no_coordinates', 'invalid_coordinates', 'coordinates_suspect']);
    report.corrected += 1;
    report[reason] += 1;
  }

  return report;
}

function parsePermitYear(permitNo, fallback) {
  const four = String(permitNo).match(/(?:R0?7|R7)[-\s]?(\d{4})[-\s]/i);
  if (four) {
    const year = Number(four[1]);
    if (year >= 1990 && year <= 2100) return year;
  }
  const two = String(permitNo).match(/(?:R0?7|R7)[-\s]?(\d{2})[-\s]/i);
  if (two) {
    const n = Number(two[1]);
    return n >= 70 ? 1900 + n : 2000 + n;
  }
  const direct = String(permitNo).match(/(20\d{2})/);
  if (direct) return Number(direct[1]);
  return fallback;
}

function lifecycleOf(expiry) {
  if (!expiry) return 'Unknown';
  const days = dateDiffDays(TODAY, expiry);
  if (days === null) return 'Unknown';
  if (days < 0) return 'Expired';
  if (days <= 90) return 'Expiring';
  return 'Active';
}

function sortValue(permit) {
  return permit.expiry ?? permit.issued ?? String(permit.year ?? '');
}

/* ------------------------------------------------------------------ */
/* hazardous waste + ECC / CNC helpers                                 */
/* ------------------------------------------------------------------ */

const MUNICIPALITY_COLUMNS = [
  { province: 'Cebu', field: 'Municipalities in Cebu' },
  { province: 'Bohol', field: 'Municipalities in Bohol' },
  { province: 'Negros Oriental', field: 'Municipalities in Negros Oriental' },
  { province: 'Siquijor', field: 'Municipalities in Siquijor' },
];

function normalizeCompanyName(value) {
  return cleanText(value)
    .replace(/^"+|"+$/g, '')
    .replace(/_x000d_/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitHwEntries(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((entry) => entry.replace(/^[,\s]+|[,\s]+$/g, '').trim())
    .filter(Boolean);
}

function cleanPermitRef(value) {
  return cleanText(value)
    .replace(/^[("'[\s]+|[)"'\]\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlaceholderRef(value) {
  return !value || /^(n\/?a|none|null|-|—|0+)$/i.test(value);
}

function clearanceKey(value) {
  return cleanPermitRef(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function permitKindFromType(value) {
  const type = String(value ?? '').toLowerCase();
  if (type.includes('environmental compliance')) return 'ECC';
  if (type.includes('non coverage')) return 'CNC';
  if (type.includes('permit to operate')) return 'PTO';
  if (type.includes('discharge permit')) return 'DP';
  if (type.includes('generator')) return 'HW';
  if (type.includes('officer accreditation')) return 'PCO';
  if (type.includes('chemical control')) return 'CCO';
  return 'OTHER';
}

function permitKindFromNumber(value) {
  const number = cleanPermitRef(value).toUpperCase();
  if (!number) return '';
  if (number.startsWith('ECC')) return 'ECC';
  if (number.startsWith('CNC')) return 'CNC';
  if (number.startsWith('PTO')) return 'PTO';
  if (number.startsWith('DP')) return 'DP';
  if (/^(OL[- ]?GR|M[- ]?GR|GR[- ]?R|HW[- ]?GR)/.test(number)) return 'HW';
  if (number.startsWith('COA') || number.startsWith('POA')) return 'PCO';
  if (number.startsWith('CCO') || number.startsWith('CCOR')) return 'CCO';
  return '';
}

function clearanceKind(number, permitType) {
  const fromNumber = permitKindFromNumber(number);
  if (fromNumber === 'ECC' || fromNumber === 'CNC') return fromNumber;
  const fromType = permitKindFromType(permitType);
  if (fromType === 'ECC' || fromType === 'CNC') return fromType;
  return fromNumber === 'PTO' || fromNumber === 'DP' || fromNumber === 'HW' || fromNumber === 'PCO' || fromNumber === 'CCO'
    ? fromNumber
    : 'OTHER';
}

function pickMunicipality(row, province) {
  const preferred = MUNICIPALITY_COLUMNS.find((entry) => entry.province === province);
  if (preferred && cleanText(row[preferred.field])) return row[preferred.field];
  for (const entry of MUNICIPALITY_COLUMNS) {
    if (cleanText(row[entry.field])) return row[entry.field];
  }
  return '';
}

const HW_BRANCH_WORDS = new Set([
  'TOWER', 'PLANT', 'BUILDING', 'BLDG', 'PHASE', 'UNIT', 'BLOCK', 'STAGE',
  'WAREHOUSE', 'SEPTIC', 'TANK', 'OUTLET', 'CELLSITE', 'SITE', 'TRAIN',
  'LINE', 'WEIR', 'FACILITY', 'BRANCH', 'STORE', 'OFFICE',
]);

function hwBranchMarkers(name) {
  const tokens = normKey(name).split(' ');
  const numbers = new Set(tokens.filter((token) => /^\d+$/.test(token)));
  const letters = new Set();
  tokens.forEach((token, index) => {
    if (token.length === 1 && index > 0 && HW_BRANCH_WORDS.has(tokens[index - 1])) letters.add(token);
  });
  return { numbers, letters };
}

function hwParentheticals(name) {
  const values = new Set();
  const regex = /\(([^)]{2,})\)/g;
  let match;
  while ((match = regex.exec(cleanText(name))) !== null) {
    const key = normKey(match[1]);
    if (key) values.add(key);
  }
  return values;
}

function hwIdentityConflict(nameA, nameB) {
  const a = hwBranchMarkers(nameA);
  const b = hwBranchMarkers(nameB);
  const sameSet = (left, right) => left.size === right.size && [...left].every((value) => right.has(value));
  if (a.numbers.size && b.numbers.size && !sameSet(a.numbers, b.numbers)) return true;
  if (a.letters.size && b.letters.size && !sameSet(a.letters, b.letters)) return true;
  const pa = hwParentheticals(nameA);
  const pb = hwParentheticals(nameB);
  if (pa.size && pb.size && ![...pa].some((value) => pb.has(value))) return true;
  return false;
}

/** All name keys that can identify the same establishment across registers. */
function hwMatchKeys(name) {
  const keys = new Set();
  const primary = companyStrictKey(name);
  if (primary) keys.add(primary);
  const core = companyCoreKey(name);
  if (core) keys.add(core);
  for (const alias of parentheticalKeys(name)) keys.add(alias);
  for (const part of cleanText(name).split(/\s+[-–—|]\s+/)) {
    const key = companyStrictKey(part);
    if (key && significantTokens(key).size >= 2) keys.add(key);
  }
  return keys;
}

/* ------------------------------------------------------------------ */
/* hazardous waste extraction                                          */
/* ------------------------------------------------------------------ */

async function extractHazardousWaste() {
  const file = path.join(RAW_DIR, 'HW_ALL_DATA.csv');
  let rows;
  try {
    let text = await readFile(file, 'utf8');
    const nl = text.indexOf('\n');
    const headers = text.slice(0, nl).split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    let seen = 0;
    const newHeaders = headers.map((h) => {
      if (h === 'Date Issued') { seen += 1; return seen === 1 ? 'App Date Issued' : 'Date Issued'; }
      return h;
    });
    text = newHeaders.join(',') + text.slice(nl);
    ({ rows } = csvToObjects(text));
  } catch (error) {
    throw new Error(`Expected hazardous-waste source ${file} is missing or unreadable: ${String(error.message ?? error)}`);
  }

  const groups = new Map();
  for (const row of rows) {
    const appNo = cleanText(row['App #']);
    if (!appNo) continue;
    const list = groups.get(appNo) ?? [];
    list.push(row);
    groups.set(appNo, list);
  }

  const registrations = [];
  let scopedRows = 0;
  for (const [appNo, list] of groups) {
    const first = list[0];
    const company = normalizeCompanyName(first['Name of Company']);
    if (!company) continue;

    // Trust the register's declared province before any LGU inference. This keeps
    // Negros Oriental / Siquijor applications from being re-homed into Cebu or Bohol
    // just because a municipality column matched.
    const declaredProvince = normalizeProvince(first['Province']);
    if (declaredProvince && !IN_SCOPE.has(declaredProvince)) continue;

    const address = cleanText(first['Company Address']);
    let province = resolveProvince(first['Province']);
    const municipalityRaw = pickMunicipality(first, province);
    let lgu = resolveLgu(municipalityRaw, province);
    if (!lgu.matched) {
      const inferred = inferLguFromAddress(address, province);
      if (inferred) lgu = inferred;
    }
    if (lgu.matched) {
      if (!province || lgu.province === province) province = lgu.province;
    } else if (!province) {
      const inferred = inferLguFromAddress(address);
      if (inferred) {
        lgu = inferred;
        province = inferred.province;
      }
    }
    const scope = !province ? 'unknown' : IN_SCOPE.has(province) ? 'in' : 'out';
    if (!IN_SCOPE.has(province)) continue;
    scopedRows += list.length;
    const coord = resolveCoordinate(first['Latitude'], first['longitude'], province);

    const types = String(first['Permit'] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
    const refs = splitHwEntries(first['Permit No.']);
    const issuedEntries = splitHwEntries(first['Date Issued']);
    const expiryEntries = splitHwEntries(first['Date Expiry']);
    const placeEntries = splitHwEntries(first['Place Issuance']);

    const aligned = [];
    const entryCount = Math.max(types.length, refs.length);
    for (let index = 0; index < entryCount; index += 1) {
      const type = types[index] ?? '';
      const number = cleanPermitRef(refs[index] ?? '');
      const kind = clearanceKind(number, type);
      aligned.push({
        kind,
        type,
        number: isPlaceholderRef(number) ? '' : number,
        issued: parseDate(issuedEntries[index] ?? ''),
        expiry: parseDate(expiryEntries[index] ?? ''),
        place: cleanText(placeEntries[index] ?? ''),
      });
    }

    const clearances = aligned
      .filter((entry) => (entry.kind === 'ECC' || entry.kind === 'CNC') && entry.number)
      .map((entry) => ({ number: entry.number, type: entry.kind, issued: entry.issued, expiry: entry.expiry }));
    const eccNos = unique(clearances.filter((entry) => entry.type === 'ECC').map((entry) => entry.number));
    const cncNos = unique(clearances.filter((entry) => entry.type === 'CNC').map((entry) => entry.number));
    const ptoNos = unique(aligned.filter((entry) => entry.kind === 'PTO' && entry.number).map((entry) => entry.number));
    const dpNos = unique(aligned.filter((entry) => entry.kind === 'DP' && entry.number).map((entry) => entry.number));
    const hwEntry = aligned.find((entry) => entry.kind === 'HW');
    const hwGrNo = cleanText(first['HW GR No.']) || hwEntry?.number || '';

    const wasteByKey = new Map();
    const wasteRecordCounts = {};
    for (const row of list) {
      const code = cleanText(row['HW Code']);
      if (!code) continue;
      wasteRecordCounts[code] = (wasteRecordCounts[code] ?? 0) + 1;
      const description = cleanText(row['Desription']);
      const key = `${code}|${description}`;
      if (!wasteByKey.has(key)) {
        wasteByKey.set(key, {
          code,
          description,
          nature: cleanText(row['Nature']),
          catalogue: cleanText(row['Catalogue']),
          practice: cleanText(row['Current Waste Management Practice']),
        });
      }
    }
    const wasteCodes = [...wasteByKey.values()].sort((a, b) => a.code.localeCompare(b.code));

    const industry = cleanText(first['Nature of Business'])
      || cleanText(first['Services'])
      || cleanText(first['Products']);

    const issued = parseDate(first['App Date Issued']) ?? hwEntry?.issued ?? null;
    const expiry = hwEntry?.expiry ?? null;

    const qa = [];
    if (!address) qa.push('no_address');
    if (!issued) qa.push('no_issued_date');
    if (!expiry) qa.push('no_expiry_date');
    if (coord.status === 'missing') qa.push('no_coordinates');
    if (coord.status === 'invalid') qa.push('invalid_coordinates');
    if (coord.status === 'swapped' || coord.status === 'swapped-suspect') qa.push('coordinates_swapped');
    if (coord.status === 'suspect' || coord.status === 'swapped-suspect') qa.push('coordinates_suspect');
    if (scope === 'out') qa.push('out_of_scope');
    if (scope === 'unknown') qa.push('province_unknown');
    if (!lgu.matched) qa.push('lgu_unmatched');
    if (!wasteCodes.length) qa.push('no_waste_codes');

    registrations.push({
      id: `HW-${appNo}`,
      appNo,
      hwGrNo,
      company,
      companyKey: companyStrictKey(company),
      municipality: lgu.display,
      province,
      barangay: deriveBarangay(address, ''),
      address,
      lat: coord.lat,
      lon: coord.lon,
      coordStatus: coord.status,
      scope,
      subtype: normalizeSourceStatus(first['Sub Type']),
      issued,
      expiry,
      lifecycle: lifecycleOf(expiry),
      caseHandler: cleanText(first['Case Handler']),
      pco: cleanText(first['PCO Name']),
      pcoAccreditation: cleanText(first['PCO Accreditation No.']),
      pcoAccreditationDate: parseDate(first['Date of Accreditation']),
      employees: cleanText(first['No. of Employees']),
      industry,
      psic: cleanText(first['PSIC Number']),
      permitTypes: types,
      eccNos,
      cncNos,
      ptoNos,
      dpNos,
      hwNumber: hwEntry?.number ?? '',
      wasteCodes,
      wasteCount: wasteCodes.length,
      wasteRecordCounts,
      recordCount: list.length,
      siteId: null,
      matched: false,
      sourceRow: 0,
      qa,
      _clearances: clearances,
      _tokens: significantTokens(companyStrictKey(company)),
      _keys: hwMatchKeys(company),
    });
  }

  console.log(`  ${registrations.length.toLocaleString()} HW registrations · ${scopedRows.toLocaleString()} in-scope waste-stream rows (${rows.length.toLocaleString()} total)`);
  return { registrations, wasteRows: scopedRows };
}


/* ------------------------------------------------------------------ */
/* PSGC reference                                                      */
/* ------------------------------------------------------------------ */

const psgc = JSON.parse(await readFile('data/reference/psgc.json', 'utf8'));

const localityIndex = new Map();
function addLocality(key, value) {
  const norm = normKey(normalizeLguText(key));
  if (!norm) return;
  const list = localityIndex.get(norm) ?? [];
  if (!list.some((entry) => entry.province === value.province && entry.code === value.code)) list.push(value);
  localityIndex.set(norm, list);
}
for (const locality of psgc.localities) {
  const value = {
    display: locality.display || titleCase(locality.name),
    province: normalizeProvince(locality.province),
    code: locality.code,
    level: locality.level,
  };
  for (const alias of [locality.name, locality.display, ...(locality.aliases ?? [])]) {
    addLocality(alias, value);
    if (alias) {
      addLocality(String(alias).replace(/^City of\s+/i, ''), value);
      addLocality(`City of ${String(alias).replace(/\s+City$/i, '')}`, value);
    }
  }
}

function resolveLgu(raw, provinceHint = '') {
  const cleaned = normalizeLguText(raw);
  if (!cleaned) return { display: '', province: '', code: null, matched: false };
  const base = normKey(cleaned);
  const candidates = [
    base,
    base.replace(/^CITY OF /, ''),
    base.replace(/^MUNICIPALITY OF /, ''),
    base.replace(/^MUN OF /, ''),
    `${base} CITY`,
    base.replace(/ CITY$/, ''),
    base.replace(/ (CITY|MUNICIPALITY|CAPITAL|POBLACION)$/, ''),
    base.replace(/(CEBU|BOHOL|NEGROS ORIENTAL|SIQUIJOR)$/, '').trim(),
    base.replace(/^CITY OF /, '').replace(/ CAPITAL$/, '').trim(),
  ];
  for (const candidate of candidates) {
    const list = localityIndex.get(candidate.replace(/\s+/g, ' ').trim());
    if (list && list.length) {
      if (provinceHint) {
        const match = list.find((entry) => entry.province === provinceHint);
        if (match) return { ...match, matched: true };
      }
      return { ...list[0], matched: true };
    }
  }
  return { display: titleCase(cleaned), province: '', code: null, matched: false };
}

/* Locality names found inside a free-text address, longest first. */
const addressLocalities = [...localityIndex.entries()]
  .flatMap(([key, values]) => (Array.isArray(values) ? values : [values]).map((value) => ({ key, value })))
  .filter((entry) => entry.key.length >= 4 && entry.key.split(' ').length <= 4)
  .sort((a, b) => b.key.length - a.key.length);

function inferLguFromAddress(address, provinceHint = '') {
  const haystack = ` ${normKey(address)} `;
  if (haystack.trim().length < 4) return null;
  let fallback = null;
  for (const entry of addressLocalities) {
    if (!haystack.includes(` ${entry.key} `)) continue;
    if (provinceHint && entry.value.province !== provinceHint) continue;
    if (provinceHint) return { ...entry.value, matched: true };
    fallback = fallback ?? { ...entry.value, matched: true };
  }
  return fallback;
}

const REGION_PROVINCES = ['Cebu', 'Bohol', 'Negros Oriental', 'Siquijor'];
const PROVINCE_KEYWORDS = [
  ['CEBU', 'Cebu'],
  ['BOHOL', 'Bohol'],
  ['NEGROS ORIENTAL', 'Negros Oriental'],
  ['SIQUIJOR', 'Siquijor'],
];

/**
 * Repairs noisy free-text province values such as "Boho", "Ceb", "Ebu",
 * "Mandaue City" or "Dumaguete City Capital".
 */
function resolveProvince(raw) {
  const direct = normalizeProvince(raw);
  if (REGION_PROVINCES.includes(direct)) return direct;
  if (direct === 'Metro Manila') return direct;

  const key = normKey(raw);
  if (!key) return '';

  for (const [needle, province] of PROVINCE_KEYWORDS) {
    if (key.includes(needle)) return province;
  }

  let best = { province: '', score: 0 };
  for (const province of REGION_PROVINCES) {
    const score = similarity(key, normKey(province));
    if (score > best.score) best = { province, score };
  }
  if (best.score >= 0.72) return best.province;

  const asLocality = resolveLgu(raw);
  if (asLocality.matched) return asLocality.province;

  const fromAddress = inferLguFromAddress(raw);
  if (fromAddress) return fromAddress.province;
  return '';
}

/* ------------------------------------------------------------------ */
/* extraction                                                          */
/* ------------------------------------------------------------------ */

const SKIP_PERMIT_NO = /^(permit|dp no\.?|po no\.?|application|total|subtotal)$/i;

function deriveBarangay(address, explicit) {
  const cleanExplicit = cleanText(explicit);
  const looksLikeAddress = cleanExplicit.length > 48 || /,/.test(cleanExplicit);
  if (cleanExplicit && !looksLikeAddress) return titleCase(cleanExplicit);
  const match = String(address ?? '').match(/(?:brgy\.?|barangay)\s*([^,;]+)/i);
  if (match) return titleCase(match[1].trim());
  if (cleanExplicit) return titleCase(cleanExplicit);
  return '';
}

async function extractPermits() {
  const permits = [];
  const skipped = [];

  for (const tab of PERMIT_TABS) {
    const file = path.join(RAW_DIR, `${tab.key}.csv`);
    const text = parseCsv(await readFile(file, 'utf8'));
    if (!text.length) continue;
    const headers = text[0];
    const find = makeLookup(headers);

    const idx = {
      appNo: find('app no', 'application no', 'application number'),
      permitNo: find('dp no', 'po no', 'permit no', 'pto no'),
      company: find('company name'),
      barangay: find('barangay', 'brgy'),
      address: find('address', 'full address'),
      municipality: find('municipality city', 'municipality', 'city municipality'),
      province: find('province'),
      lat: find('latitude', 'gps coordinates lat', 'geolocation lat'),
      lon: find('longitude', 'gps coordinates long', 'geolocation long', 'lon', 'lng'),
      issued: find('issued date', 'date approved', 'date issued'),
      expiry: find('expiry date', 'date expiry', 'expiry', 'exipary date'),
      paid: find('date paid'),
      sourceStatus: find('new renewal', 'new renewal tpo', 'status'),
      industry: find('industry classification', 'industry'),
      psic: find('psic code dao 2016 08', 'psic code', 'psic'),
      ecc: find('ecc cnc no', 'ecc cnc'),
      waterbody: find('waterbody', 'water body'),
      wastewater: find('type of wastewater discharge', 'wastewater'),
      volume: find('allowed volume cubic meter per year', 'allowed volume'),
      fee: find('wastewater discharge fee', 'discharge fee'),
      pco: find('pco'),
      remarks: find('remarks'),
      link: find('dp link'),
    };

    if (tab.key === 'DP_2019_2020' && idx.appNo < 0) idx.appNo = 0;
    if (tab.key === 'DP_2022' && idx.expiry < 0) idx.expiry = 11;
    if (tab.key === 'DP_2019_2020' && idx.issued < 0) idx.issued = find('date approved');
    if (tab.key === 'DP_2019_2020' && idx.expiry < 0) idx.expiry = find('exipary date');

    const workbook = WORKBOOKS[tab.workbook];
    let tabSkipped = 0;

    for (let r = 1; r < text.length; r += 1) {
      const row = text[r];
      if (!row || !row.some((c) => cleanText(c))) continue;

      const permitNo = cleanText(row[idx.permitNo] ?? '');
      const company = cleanText(row[idx.company] ?? '');
      if (!permitNo || SKIP_PERMIT_NO.test(permitNo) || !company) {
        tabSkipped += 1;
        if (permitNo || company) {
          skipped.push({ tab: tab.key, row: r + 1, permitNo, company, reason: !permitNo ? 'missing permit number' : 'missing establishment name' });
        }
        continue;
      }

      const year = parsePermitYear(permitNo, tab.fallbackYear);
      const address = cleanText(row[idx.address] ?? '') || cleanText(row[idx.barangay] ?? '');
      const barangay = deriveBarangay(address, row[idx.barangay] ?? '');

      let province = resolveProvince(row[idx.province] ?? '');
      let lgu = resolveLgu(row[idx.municipality] ?? '', province);
      if (!lgu.matched) {
        const inferred = inferLguFromAddress(address, province);
        if (inferred) lgu = inferred;
      }
      if (lgu.matched) {
        if (!province || lgu.province === province) province = lgu.province;
      } else if (!province) {
        const inferred = inferLguFromAddress(address);
        if (inferred) {
          lgu = inferred;
          province = inferred.province;
        }
      }
      const scope = !province ? 'unknown' : IN_SCOPE.has(province) ? 'in' : 'out';
      if (!IN_SCOPE.has(province)) continue;
      const issued = parseDate(row[idx.issued] ?? '');
      const expiry = parseDate(row[idx.expiry] ?? '');
      const paid = parseDate(row[idx.paid] ?? '');
      const coord = resolveCoordinate(row[idx.lat] ?? '', row[idx.lon] ?? '', province);

      const sourceStatus = normalizeSourceStatus(row[idx.sourceStatus] ?? '');
      const industry = cleanText(row[idx.industry] ?? '');

      const qa = [];
      if (!address && !barangay) qa.push('no_address');
      if (!barangay) qa.push('no_barangay');
      if (!issued) qa.push('no_issued_date');
      if (!expiry) qa.push('no_expiry_date');
      if (issued && expiry && expiry < issued) qa.push('expiry_before_issue');
      if (coord.status === 'missing') qa.push('no_coordinates');
      if (coord.status === 'invalid') qa.push('invalid_coordinates');
      if (coord.status === 'swapped' || coord.status === 'swapped-suspect') qa.push('coordinates_swapped');
      if (coord.status === 'suspect' || coord.status === 'swapped-suspect') qa.push('coordinates_suspect');
      if (scope === 'out') qa.push('out_of_scope');
      if (scope === 'unknown') qa.push('province_unknown');
      if (!lgu.matched) qa.push('lgu_unmatched');
      if (!/^(DP|PTO)/i.test(permitNo)) qa.push('nonstandard_permit_no');
      if (!industry) qa.push('no_industry');
      if (!cleanText(row[idx.appNo] ?? '')) qa.push('no_application_no');

      const companyKey = companyStrictKey(company);

      permits.push({
        id: permitNo,
        type: tab.type,
        permitNo,
        appNo: cleanText(row[idx.appNo] ?? ''),
        year,
        company: company || 'Unnamed establishment',
        companyKey,
        coreKey: companyCoreKey(company),
        barangay,
        address,
        municipality: lgu.display,
        province,
        lguCode: lgu.code,
        scope,
        lat: coord.lat,
        lon: coord.lon,
        coordStatus: coord.status,
        sourceStatus,
        lifecycle: lifecycleOf(expiry),
        issued,
        expiry,
        paid,
        industry,
        psic: cleanText(row[idx.psic] ?? ''),
        eccNo: cleanText(row[idx.ecc] ?? ''),
        waterbody: cleanText(row[idx.waterbody] ?? ''),
        wastewater: cleanText(row[idx.wastewater] ?? ''),
        volume: cleanText(row[idx.volume] ?? ''),
        fee: cleanText(row[idx.fee] ?? ''),
        pco: cleanText(row[idx.pco] ?? ''),
        remarks: cleanText(row[idx.remarks] ?? ''),
        link: cleanText(row[idx.link] ?? ''),
        qa,
        sourceSheet: tab.sheet,
        sourceRow: r + 1,
        workbook: workbook.key,
      });
    }

    console.log(`  ${tab.key.padEnd(14)} ${String(text.length - 1 - tabSkipped).padStart(5)} permits  (${tabSkipped} skipped rows)`);
  }

  return { permits, skipped };
}

/* ------------------------------------------------------------------ */
/* de-duplication                                                      */
/* ------------------------------------------------------------------ */

function completeness(permit) {
  let score = 0;
  for (const field of ['appNo', 'barangay', 'address', 'municipality', 'province', 'lat', 'lon', 'issued', 'expiry', 'paid', 'industry', 'eccNo', 'pco']) {
    if (permit[field] !== '' && permit[field] !== null && permit[field] !== undefined) score += 1;
  }
  return score;
}

function dedupe(permits) {
  const byKey = new Map();
  for (const permit of permits) {
    const normalized = permit.permitNo.toUpperCase().replace(/\s+/g, '');
    const groupKey = `${permit.type}|${normalized}`;
    const list = byKey.get(groupKey) ?? [];
    list.push(permit);
    byKey.set(groupKey, list);
  }

  const kept = [];
  const duplicates = [];
  for (const list of byKey.values()) {
    if (list.length === 1) {
      kept.push(list[0]);
      continue;
    }
    const sorted = [...list].sort((a, b) => completeness(b) - completeness(a) || String(b.issued).localeCompare(String(a.issued)));
    const winner = sorted[0];
    winner.qa = [...new Set([...winner.qa, 'duplicate_source'])];
    kept.push(winner);
    for (const loser of sorted.slice(1)) {
      duplicates.push({
        permitNo: winner.permitNo,
        type: winner.type,
        keptFrom: `${winner.sourceSheet} row ${winner.sourceRow}`,
        droppedFrom: `${loser.sourceSheet} row ${loser.sourceRow}`,
        company: loser.company,
      });
    }
  }

  const usedIds = new Set();
  for (const permit of kept) {
    let id = permit.permitNo;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${permit.permitNo}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    permit.id = id;
  }
  return { permits: kept, duplicates };
}

/* ------------------------------------------------------------------ */
/* sites / DP-PTO intercross                                           */
/* ------------------------------------------------------------------ */

function buildSites(permits) {
  /*
   * Branch markers distinguish genuinely separate facilities that share a
   * parent company, e.g. "EBLOC Tower 1" vs "EBLOC Tower 4" or
   * "Plant A" vs "Plant B". Two names with different markers are never
   * fused into one site.
   */
  const BRANCH_WORDS = new Set([
    'TOWER', 'PLANT', 'BUILDING', 'BLDG', 'PHASE', 'UNIT', 'BLOCK', 'STAGE',
    'WAREHOUSE', 'SEPTIC', 'TANK', 'OUTLET', 'CELLSITE', 'SITE', 'TRAIN',
    'LINE', 'WEIR', 'FACILITY', 'BRANCH', 'STORE', 'OFFICE',
  ]);
  function branchMarkers(name) {
    const tokens = normKey(name).split(' ');
    const numbers = new Set(tokens.filter((t) => /^\d+$/.test(t)));
    const letters = new Set();
    tokens.forEach((token, index) => {
      if (token.length === 1 && index > 0 && BRANCH_WORDS.has(tokens[index - 1])) letters.add(token);
    });
    return { numbers, letters };
  }
  const sameSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));
  function hasMarkerConflict(nameA, nameB) {
    const a = branchMarkers(nameA);
    const b = branchMarkers(nameB);
    if (a.numbers.size && b.numbers.size && !sameSet(a.numbers, b.numbers)) return true;
    if (a.letters.size && b.letters.size && !sameSet(a.letters, b.letters)) return true;
    return false;
  }
  function parentheticals(name) {
    const values = new Set();
    const regex = /\(([^)]{2,})\)/g;
    let match;
    while ((match = regex.exec(cleanText(name))) !== null) {
      const key = normKey(match[1]);
      if (key) values.add(key);
    }
    return values;
  }
  function hasParentheticalConflict(nameA, nameB) {
    const a = parentheticals(nameA);
    const b = parentheticals(nameB);
    if (!a.size || !b.size) return false;
    return ![...a].some((value) => b.has(value));
  }
  function groupsConflict(groupA, groupB) {
    for (const a of groupA) {
      for (const b of groupB) {
        if (hasMarkerConflict(a, b)) return true;
        if (hasParentheticalConflict(a, b)) return true;
      }
    }
    return false;
  }

  const groups = new Map();
  for (const permit of permits) {
    const lguKey = normKey(permit.municipality);
    const companyKey = permit.companyKey || `__UNNAMED_${permit.id}`;
    const groupKey = `${lguKey}|${companyKey}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        lguKey,
        companyKey,
        coreKey: companyCoreKey(permit.company),
        tokens: significantTokens(permit.companyKey),
        permits: [],
      };
      groups.set(groupKey, group);
    }
    group.permits.push(permit);
  }

  const list = [...groups.values()];
  const parent = list.map((_, index) => index);
  const mergeMethod = new Map();
  const groupNames = new Map(list.map((group, index) => [index, new Set(group.permits.map((p) => p.company))]));
  const USABLE_COORD = new Set(['ok', 'swapped', 'corrected', 'approximate']);
  const groupPoints = new Map(list.map((group, index) => [
    index,
    group.permits
      .filter((p) => p.lat !== null && p.lon !== null && USABLE_COORD.has(p.coordStatus))
      .map((p) => [p.lat, p.lon]),
  ]));
  const groupBarangays = new Map(list.map((group, index) => [
    index,
    new Set(group.permits.map((p) => p.barangay).filter(Boolean)),
  ]));

  const findRoot = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const namesOf = (index) => groupNames.get(findRoot(index)) ?? new Set();
  const union = (a, b, method) => {
    const rootA = findRoot(a);
    const rootB = findRoot(b);
    if (rootA === rootB) return;
    parent[rootB] = rootA;
    const rank = { exact: 4, alias: 3, core: 2, fuzzy: 1 };
    const best = [mergeMethod.get(rootA), mergeMethod.get(rootB), method]
      .filter(Boolean)
      .sort((x, y) => rank[y] - rank[x])[0];
    mergeMethod.set(rootA, best);
    mergeMethod.delete(rootB);
    const names = groupNames.get(rootA) ?? new Set();
    for (const name of groupNames.get(rootB) ?? []) names.add(name);
    groupNames.set(rootA, names);
    groupNames.delete(rootB);

    const points = groupPoints.get(rootA) ?? [];
    for (const point of groupPoints.get(rootB) ?? []) points.push(point);
    groupPoints.set(rootA, points);
    groupPoints.delete(rootB);

    const barangays = groupBarangays.get(rootA) ?? new Set();
    for (const barangay of groupBarangays.get(rootB) ?? []) barangays.add(barangay);
    groupBarangays.set(rootA, barangays);
    groupBarangays.delete(rootB);
  };

  function centroidOf(index) {
    const points = groupPoints.get(findRoot(index)) ?? [];
    if (!points.length) return null;
    const lat = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const lon = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    return [lat, lon];
  }

  /**
   * Fuzzy name matches must also agree spatially: two branches of the same
   * company more than 2 km apart are separate establishments.
   */
  function fuzzyPlausible(indexA, indexB) {
    const a = centroidOf(indexA);
    const b = centroidOf(indexB);
    if (a && b) return distanceKm(a, b) <= 2;
    const rootA = findRoot(indexA);
    const rootB = findRoot(indexB);
    const barangaysA = groupBarangays.get(rootA) ?? new Set();
    const barangaysB = groupBarangays.get(rootB) ?? new Set();
    if (barangaysA.size && barangaysB.size) {
      return [...barangaysA].some((barangay) => barangaysB.has(barangay));
    }
    return true;
  }

  const buckets = new Map();
  list.forEach((group, index) => {
    const bucket = buckets.get(group.lguKey) ?? [];
    bucket.push(index);
    buckets.set(group.lguKey, bucket);
  });

  /*
   * Alias union: a permit like "NPC-Pamilacan Diesel Power Plant" can be a
   * parenthetical alias, a branch suffix or a core name of its DP/PTO twin.
   * Signatures are only trusted when they contain at least two distinctive
   * tokens, which keeps generic words from collapsing unrelated sites.
   */
  const GENERIC_SIGNATURE_TOKENS = new Set([
    'FARM', 'POULTRY', 'HATCHERY', 'RESORT', 'HOTEL', 'TERMINAL', 'WAREHOUSE',
    'OFFICE', 'BUILDING', 'BLDG', 'SEPTIC', 'TANK', 'CONDOMINIUM', 'SUBDIVISION',
    'TOWER', 'STATION', 'SUBSTATION', 'MILL', 'FACTORY', 'BRANCH', 'PLANT',
    'FACILITY', 'SITE', 'MAIN', 'POWERHOUSE',
  ]);

  const signatureBuckets = new Map();
  list.forEach((group, index) => {
    const signatures = new Set();
    for (const permit of group.permits) {
      for (const signature of permitSignatures(permit.company)) {
        const tokens = significantTokens(signature);
        if (tokens.size < 2) continue;
        if ([...tokens].every((token) => GENERIC_SIGNATURE_TOKENS.has(token))) continue;
        signatures.add(signature);
      }
    }
    group.signatures = signatures;
    for (const signature of signatures) {
      const key = `${group.lguKey}|${signature}`;
      const bucket = signatureBuckets.get(key) ?? [];
      bucket.push(index);
      signatureBuckets.set(key, bucket);
    }
  });

  for (const bucket of signatureBuckets.values()) {
    if (bucket.length < 2) continue;
    for (let i = 1; i < bucket.length; i += 1) {
      const root = findRoot(bucket[0]);
      const other = findRoot(bucket[i]);
      if (root === other) continue;
      if (groupsConflict(namesOf(bucket[0]), namesOf(bucket[i]))) continue;
      union(bucket[0], bucket[i], 'alias');
    }
  }

  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = list[bucket[i]];
        const b = list[bucket[j]];
        if (a.tokens.size < 2 || b.tokens.size < 2) continue;
        let shared = 0;
        for (const token of a.tokens) if (b.tokens.has(token)) shared += 1;
        if (shared < 2) continue;
        if (tokenDice(a.tokens, b.tokens) < 0.88) continue;
        const rootA = findRoot(bucket[i]);
        const rootB = findRoot(bucket[j]);
        if (rootA === rootB) continue;
        if (groupsConflict(namesOf(rootA), namesOf(rootB))) continue;
        if (!fuzzyPlausible(bucket[i], bucket[j])) continue;
        union(bucket[i], bucket[j], 'fuzzy');
      }
    }
  }

  const siteGroups = new Map();
  list.forEach((group, index) => {
    const root = findRoot(index);
    const entry = siteGroups.get(root) ?? { permits: [], method: mergeMethod.get(root) ?? 'exact' };
    entry.permits.push(...group.permits);
    siteGroups.set(root, entry);
  });

  const sites = [];
  for (const entry of siteGroups.values()) {
    const members = entry.permits.sort((a, b) => sortValue(b).localeCompare(sortValue(a)));
    const latest = members[0];
    const dp = members.filter((p) => p.type === 'DP');
    const pto = members.filter((p) => p.type === 'PTO');

    const keys = new Set(members.map((p) => p.companyKey));
    const method = keys.size === 1 ? 'exact' : entry.method;

    /*
     * Prefer exact coordinates; corrected / approximate points are only used
     * when the site has no exact point of its own.
     */
    const exactMembers = members.filter((p) => p.coordStatus === 'ok' || p.coordStatus === 'swapped');
    const coordinatePool = exactMembers.length ? exactMembers : members;
    const coordinateCounts = new Map();
    for (const permit of coordinatePool) {
      if (permit.lat !== null && permit.lon !== null) {
        const coordKey = `${permit.lat.toFixed(5)},${permit.lon.toFixed(5)}`;
        coordinateCounts.set(coordKey, (coordinateCounts.get(coordKey) ?? 0) + 1);
      }
    }
    let lat = latest.lat;
    let lon = latest.lon;
    if (coordinateCounts.size) {
      const [bestKey, bestCount] = [...coordinateCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      const [bestLat, bestLon] = bestKey.split(',').map(Number);
      const latestKey = latest.lat !== null ? `${latest.lat.toFixed(5)},${latest.lon.toFixed(5)}` : '';
      if (bestCount > 1 || latestKey !== bestKey) {
        lat = bestLat;
        lon = bestLon;
      }
    }
    const coordStatus = lat === null || lon === null
      ? 'missing'
      : members.find((p) => p.lat === lat && p.lon === lon)?.coordStatus ?? 'ok';

    const dpExpiry = dp.map((p) => p.expiry).filter(Boolean).sort().at(-1) ?? null;
    const ptoExpiry = pto.map((p) => p.expiry).filter(Boolean).sort().at(-1) ?? null;
    const latestIssued = members.map((p) => p.issued).filter(Boolean).sort().at(-1) ?? null;
    const activeDP = dp.some((p) => p.lifecycle === 'Active' || p.lifecycle === 'Expiring');
    const activePTO = pto.some((p) => p.lifecycle === 'Active' || p.lifecycle === 'Expiring');

    let gap;
    if (dp.length && pto.length) {
      if (activeDP && activePTO) gap = 'both-active';
      else if (activeDP) gap = 'dp-active';
      else if (activePTO) gap = 'pto-active';
      else gap = 'both-inactive';
    } else if (dp.length) gap = 'dp-only';
    else gap = 'pto-only';

    const barangay = members.map((p) => p.barangay).find(Boolean) ?? '';
    const address = latest.address || members.map((p) => p.address).find(Boolean) || '';
    const industry = latest.industry || members.map((p) => p.industry).find(Boolean) || '';

    const site = {
      id: '',
      company: latest.company,
      key: latest.companyKey,
      municipality: latest.municipality,
      province: latest.province,
      barangay,
      address,
      lat: lat ?? null,
      lon: lon ?? null,
      coordStatus,
      dpCount: dp.length,
      ptoCount: pto.length,
      permitCount: members.length,
      years: [...new Set(members.map((p) => p.year))].sort(),
      latestIssued,
      dpExpiry,
      ptoExpiry,
      activeDP,
      activePTO,
      gap,
      matchMethod: method,
      matchType: dp.length && pto.length ? 'both' : dp.length ? 'dp' : 'pto',
      industry,
      scope: latest.scope,
      spatial: null,
      risk: 0,
    };
    site._members = members;
    sites.push(site);
  }

  sites.sort((a, b) => a.province.localeCompare(b.province) || a.municipality.localeCompare(b.municipality) || a.company.localeCompare(b.company));
  return sites;
}

/* ------------------------------------------------------------------ */
/* hazardous-waste intercross                                          */
/* ------------------------------------------------------------------ */

function addSiteToIndex(site, index) {
  const lguKey = normKey(site.municipality);
  const provinceKey = normKey(site.province);
  site._matchKeys = hwMatchKeys(site.company);
  site._tokens = significantTokens(site.key);
  for (const key of site._matchKeys) {
    if (lguKey) {
      const bucket = index.byLguKey.get(`${lguKey}|${key}`) ?? [];
      bucket.push(site);
      index.byLguKey.set(`${lguKey}|${key}`, bucket);
    }
    if (provinceKey) {
      const bucket = index.byProvinceKey.get(`${provinceKey}|${key}`) ?? [];
      bucket.push(site);
      index.byProvinceKey.set(`${provinceKey}|${key}`, bucket);
    }
  }
  if (lguKey) {
    const bucket = index.byLgu.get(lguKey) ?? [];
    bucket.push(site);
    index.byLgu.set(lguKey, bucket);
  }
  if (provinceKey) {
    const bucket = index.byProvince.get(provinceKey) ?? [];
    bucket.push(site);
    index.byProvince.set(provinceKey, bucket);
  }
}

function buildSiteIndex(sites) {
  const index = {
    byLguKey: new Map(),
    byProvinceKey: new Map(),
    byLgu: new Map(),
    byProvince: new Map(),
  };
  for (const site of sites) addSiteToIndex(site, index);
  return index;
}

function findSiteForHw(hw, index) {
  const lguKey = normKey(hw.municipality);
  const provinceKey = normKey(hw.province);
  const primaryKey = companyStrictKey(hw.company);

  const keyed = new Set();
  if (lguKey) {
    for (const key of hw._keys) {
      for (const site of index.byLguKey.get(`${lguKey}|${key}`) ?? []) keyed.add(site);
    }
  } else if (provinceKey) {
    for (const key of hw._keys) {
      for (const site of index.byProvinceKey.get(`${provinceKey}|${key}`) ?? []) keyed.add(site);
    }
  }

  let best = null;
  let bestScore = 0;
  const consider = (site, score) => {
    if (score <= bestScore) return;
    if (score >= 90) {
      if (site.key !== primaryKey && hwIdentityConflict(hw.company, site.company)) return;
    } else if (hwIdentityConflict(hw.company, site.company)) {
      return;
    }
    if (score < 90 && hw.lat !== null && hw.lon !== null && site.lat !== null && site.lon !== null) {
      if (distanceKm([hw.lat, hw.lon], [site.lat, site.lon]) > 2) return;
    }
    best = site;
    bestScore = score;
  };

  for (const site of keyed) {
    if (site.key === primaryKey) consider(site, 100);
    else if (site._matchKeys.has(primaryKey)) consider(site, 90);
    else {
      const dice = tokenDice(hw._tokens, site._tokens);
      if (dice >= 0.88) consider(site, 70 + dice * 10);
    }
  }

  if (bestScore < 90 && lguKey) {
    for (const site of index.byLgu.get(lguKey) ?? []) {
      const dice = tokenDice(hw._tokens, site._tokens);
      if (dice >= 0.88) consider(site, 50 + dice * 10);
    }
  }

  return best;
}

function intercrossHazardousWaste(sites, registrations) {
  const index = buildSiteIndex(sites);
  let matched = 0;
  let created = 0;

  for (const hw of registrations) {
    const site = findSiteForHw(hw, index);
    if (site) {
      hw.matched = true;
      matched += 1;
      site._hwMembers = site._hwMembers ?? [];
      site._hwMembers.push(hw);
      if ((site.lat === null || site.lon === null) && hw.lat !== null && hw.lon !== null) {
        site.lat = hw.lat;
        site.lon = hw.lon;
        site.coordStatus = hw.coordStatus ?? 'ok';
      }
      continue;
    }

    const newSite = {
      company: hw.company,
      key: hw.companyKey,
      municipality: hw.municipality,
      province: hw.province,
      barangay: hw.barangay,
      address: hw.address,
      lat: hw.lat,
      lon: hw.lon,
      coordStatus: hw.coordStatus ?? 'ok',
      dpCount: 0,
      ptoCount: 0,
      permitCount: 0,
      years: [],
      latestIssued: hw.issued,
      dpExpiry: null,
      ptoExpiry: null,
      activeDP: false,
      activePTO: false,
      gap: 'hw-only',
      matchMethod: 'none',
      matchType: 'hw',
      industry: hw.industry,
      scope: hw.scope,
      spatial: null,
      risk: 0,
      _members: [],
      _hwMembers: [hw],
    };
    sites.push(newSite);
    addSiteToIndex(newSite, index);
    created += 1;
  }

  console.log(`  ${matched.toLocaleString()} HW registrations matched to DP/PTO sites · ${created.toLocaleString()} HW-only sites created`);
  return { matched, created };
}

function aggregateClearanceFields(sites, clearances) {
  const bySite = new Map();
  for (const clearance of clearances) {
    if (!clearance.siteId) continue;
    const entry = bySite.get(clearance.siteId) ?? { ecc: [], cnc: [], ambiguous: [] };
    if (clearance.type === 'ECC') entry.ecc.push(clearance.number);
    else if (clearance.type === 'CNC') entry.cnc.push(clearance.number);
    else entry.ambiguous.push(clearance.number);
    bySite.set(clearance.siteId, entry);
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
}

/*
 * Map facilities: one marker per company per location, merging the DP, PTO,
 * hazardous-waste and ECC/CNC registers of every site that shares the company
 * name and sits within ~350 m. Orphan clearances that never matched a site are
 * added at their own coordinates so no register disappears from the map.
 */
const FACILITY_JOIN_KM = 0.35;

function buildMapFacilities(sites, clearances) {
  const entries = [];

  for (const site of sites) {
    if (site.lat === null || site.lon === null) continue;
    entries.push({
      company: site.company,
      key: site.key || companyStrictKey(site.company),
      lat: site.lat,
      lon: site.lon,
      coordStatus: site.coordStatus ?? 'ok',
      municipality: site.municipality,
      province: site.province,
      barangay: site.barangay,
      address: site.address,
      scope: site.scope,
      risk: site.risk ?? 0,
      gap: site.gap,
      matchType: site.matchType,
      activeDP: Boolean(site.activeDP),
      activePTO: Boolean(site.activePTO),
      activeHW: Boolean(site.activeHW),
      siteId: site.id,
      years: site.years ?? [],
      latestIssued: site.latestIssued ?? null,
      counts: {
        DP: site.dpCount ?? 0,
        PTO: site.ptoCount ?? 0,
        HW: site.hwCount ?? 0,
        ECC: site.eccCount ?? 0,
        CNC: site.cncCount ?? 0,
      },
      clearanceNumbers: [],
    });
  }

  for (const clearance of clearances) {
    if (clearance.siteId || clearance.lat === null || clearance.lon === null) continue;
    const counts = { DP: 0, PTO: 0, HW: 0, ECC: 0, CNC: 0 };
    const register = clearance.type === 'CNC' ? 'CNC' : 'ECC';
    counts[register] = 1;
    entries.push({
      company: clearance.company,
      key: companyStrictKey(clearance.company),
      lat: clearance.lat,
      lon: clearance.lon,
      coordStatus: 'ok',
      municipality: clearance.municipality,
      province: clearance.province,
      barangay: clearance.barangay,
      address: clearance.address,
      scope: clearance.scope,
      risk: 0,
      gap: null,
      matchType: null,
      activeDP: false,
      activePTO: false,
      activeHW: false,
      siteId: null,
      years: clearance.issued ? [Number(clearance.issued.slice(0, 4))] : [],
      latestIssued: clearance.issued,
      counts,
      clearanceNumbers: [clearance.number],
    });
  }

  const buckets = new Map();
  for (const entry of entries) {
    const key = entry.key || normKey(entry.company);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  const clusters = [];
  for (const [key, list] of buckets) {
    const groups = [];
    for (const entry of list) {
      let group = groups.find((candidate) => distanceKm([candidate.lat, candidate.lon], [entry.lat, entry.lon]) <= FACILITY_JOIN_KM);
      if (!group) {
        group = { key, lat: entry.lat, lon: entry.lon, members: [] };
        groups.push(group);
      }
      group.members.push(entry);
      const points = group.members.map((member) => [member.lat, member.lon]);
      const centroid = medianPoint(points);
      group.lat = centroid[0];
      group.lon = centroid[1];
    }
    clusters.push(...groups);
  }

  const facilities = clusters.map((cluster) => {
    const members = cluster.members;
    const counts = { DP: 0, PTO: 0, HW: 0, ECC: 0, CNC: 0 };
    for (const member of members) {
      for (const id of Object.keys(counts)) counts[id] += member.counts[id] ?? 0;
    }
    const totalRecords = Object.values(counts).reduce((sum, value) => sum + value, 0);

    /*
     * The marker sits on the coordinate of the member with the most records,
     * preferring exact points over repaired ones and a real site over an
     * orphan clearance, so a merged group does not drift between buildings.
     */
    const best = [...members].sort((a, b) => {
      const exactA = a.coordStatus === 'ok' || a.coordStatus === 'swapped' ? 1 : 0;
      const exactB = b.coordStatus === 'ok' || b.coordStatus === 'swapped' ? 1 : 0;
      if (exactA !== exactB) return exactB - exactA;
      const siteA = a.siteId ? 1 : 0;
      const siteB = b.siteId ? 1 : 0;
      if (siteA !== siteB) return siteB - siteA;
      return Object.values(b.counts).reduce((s, v) => s + v, 0) - Object.values(a.counts).reduce((s, v) => s + v, 0);
    })[0];

    const primary = members.find((member) => member.siteId === best.siteId) ?? best;
    const names = unique(members.map((member) => member.company).filter(Boolean));
    const company = names.sort((a, b) => b.length - a.length)[0] ?? best.company;
    const registers = ['DP', 'PTO', 'HW', 'ECC', 'CNC'].filter((id) => counts[id] > 0);
    const siteIds = unique(members.map((member) => member.siteId).filter(Boolean));
    const years = unique(members.flatMap((member) => member.years ?? [])).sort((a, b) => a - b);
    const latestIssued = members.map((member) => member.latestIssued).filter(Boolean).sort().at(-1) ?? null;
    const risk = Math.max(...members.map((member) => member.risk ?? 0));

    return {
      id: '',
      company,
      aliases: names,
      key: cluster.key,
      lat: roundCoord(best.lat),
      lon: roundCoord(best.lon),
      coordStatus: best.coordStatus,
      municipality: primary.municipality,
      province: primary.province,
      barangay: primary.barangay || members.map((member) => member.barangay).find(Boolean) || '',
      address: primary.address || members.map((member) => member.address).find(Boolean) || '',
      scope: primary.scope,
      risk,
      siteId: best.siteId ?? siteIds[0] ?? null,
      siteIds,
      gap: primary.gap ?? null,
      matchType: primary.matchType ?? null,
      activeDP: members.some((member) => member.activeDP),
      activePTO: members.some((member) => member.activePTO),
      activeHW: members.some((member) => member.activeHW),
      registers,
      counts,
      totalRecords,
      years,
      latestIssued,
      clearanceNumbers: unique(members.flatMap((member) => member.clearanceNumbers)),
    };
  });

  facilities.sort(
    (a, b) => a.province.localeCompare(b.province) || a.municipality.localeCompare(b.municipality) || a.company.localeCompare(b.company),
  );
  facilities.forEach((facility, index) => {
    facility.id = `F${String(index + 1).padStart(5, '0')}`;
  });

  const multi = facilities.filter((facility) => facility.registers.length > 1).length;
  console.log(
    `  ${facilities.length.toLocaleString()} map facilities — ${multi.toLocaleString()} carrying more than one register · ` +
    `${facilities.filter((f) => f.registers.length === 5).length} with all five`,
  );
  return facilities;
}

function finalizeSites(sites) {
  sites.sort((a, b) => a.province.localeCompare(b.province) || a.municipality.localeCompare(b.municipality) || a.company.localeCompare(b.company));
  sites.forEach((site, index) => {
    site.id = `S${String(index + 1).padStart(5, '0')}`;
    for (const permit of site._members ?? []) permit.siteId = site.id;
    for (const hw of site._hwMembers ?? []) hw.siteId = site.id;

    const hwMembers = site._hwMembers ?? [];
    site.hwCount = hwMembers.length;
    site.hwGrNos = unique(hwMembers.map((hw) => hw.hwGrNo));
    site.hwExpiry = hwMembers.map((hw) => hw.expiry).filter(Boolean).sort().at(-1) ?? null;
    site.activeHW = hwMembers.some((hw) => hw.lifecycle === 'Active' || hw.lifecycle === 'Expiring');
    site.hwCodeCount = unique(hwMembers.flatMap((hw) => hw.wasteCodes.map((code) => code.code))).length;

    delete site._members;
    delete site._hwMembers;
    delete site._matchKeys;
    delete site._tokens;
  });
}

function buildClearances(permits, registrations) {
  const map = new Map();

  const add = (entry) => {
    const key = clearanceKey(entry.number);
    if (!key) return;
    const current = map.get(key);
    if (!current) {
      map.set(key, {
        id: key,
        number: entry.number,
        type: entry.type,
        company: entry.company,
        municipality: entry.municipality,
        province: entry.province,
        barangay: entry.barangay ?? '',
        address: entry.address ?? '',
        lat: entry.lat ?? null,
        lon: entry.lon ?? null,
        scope: entry.scope ?? 'unknown',
        issued: entry.issued ?? null,
        expiry: entry.expiry ?? null,
        appNo: entry.appNo ?? '',
        hwGrNo: entry.hwGrNo ?? '',
        siteId: entry.siteId ?? null,
        sources: [...new Set(entry.sources ?? [])],
        permitRefs: [...new Set(entry.permitRefs ?? [])],
        hwCodes: [...new Set(entry.hwCodes ?? [])],
      });
      return;
    }
    current.sources = [...new Set([...current.sources, ...(entry.sources ?? [])])];
    current.permitRefs = [...new Set([...current.permitRefs, ...(entry.permitRefs ?? [])])];
    current.hwCodes = [...new Set([...current.hwCodes, ...(entry.hwCodes ?? [])])];
    if (!current.issued && entry.issued) current.issued = entry.issued;
    if (!current.expiry && entry.expiry) current.expiry = entry.expiry;
    if (!current.siteId && entry.siteId) current.siteId = entry.siteId;
    if (!current.hwGrNo && entry.hwGrNo) current.hwGrNo = entry.hwGrNo;
    if (!current.appNo && entry.appNo) current.appNo = entry.appNo;
    if (current.type === 'ECC/CNC' && (entry.type === 'ECC' || entry.type === 'CNC')) current.type = entry.type;
    if (!current.municipality && entry.municipality) current.municipality = entry.municipality;
    if (!current.province && entry.province) current.province = entry.province;
    if (current.lat === null && entry.lat !== null) {
      current.lat = entry.lat;
      current.lon = entry.lon;
    }
  };

  for (const hw of registrations) {
    const codes = hw.wasteCodes.map((code) => code.code);
    for (const clearance of hw._clearances ?? []) {
      add({
        ...clearance,
        company: hw.company,
        municipality: hw.municipality,
        province: hw.province,
        barangay: hw.barangay,
        address: hw.address,
        lat: hw.lat,
        lon: hw.lon,
        scope: hw.scope,
        appNo: hw.appNo,
        hwGrNo: hw.hwGrNo,
        siteId: hw.siteId,
        sources: ['HW register'],
        hwCodes: codes,
      });
    }
  }

  for (const permit of permits) {
    for (const raw of String(permit.eccNo ?? '').split(/[\n,;]+/)) {
      const number = cleanPermitRef(raw);
      if (isPlaceholderRef(number)) continue;
      const kind = permitKindFromNumber(number);
      add({
        number,
        type: kind === 'ECC' || kind === 'CNC' ? kind : 'ECC/CNC',
        company: permit.company,
        municipality: permit.municipality,
        province: permit.province,
        barangay: permit.barangay,
        address: permit.address,
        lat: permit.lat,
        lon: permit.lon,
        scope: permit.scope,
        issued: null,
        expiry: null,
        appNo: permit.appNo,
        siteId: permit.siteId,
        sources: [`${permit.type} register`],
        permitRefs: [permit.permitNo],
      });
    }
  }

  const list = [...map.values()].map((entry) => ({
    ...entry,
    lifecycle: lifecycleOf(entry.expiry),
    year: entry.issued ? Number(entry.issued.slice(0, 4)) : null,
  }));
  list.sort((a, b) => a.type.localeCompare(b.type) || a.company.localeCompare(b.company));
  return list;
}


/* ------------------------------------------------------------------ */
/* spatial screening                                                   */
/* ------------------------------------------------------------------ */

const SCREEN_LAYERS = [
  { layer: 'flooding', key: 'flood', field: 'FloodSusc', mode: 'max', ranks: FLOOD_RANK },
  { layer: 'landslide', key: 'slide', field: 'LndslideSu', mode: 'max', ranks: SLIDE_RANK },
  { layer: 'protected_areas', key: 'pa', field: 'PA_NAME', mode: 'first' },
  { layer: 'watersheds', key: 'ws', field: 'WATERSHED', mode: 'first' },
  { layer: 'land_cover', key: 'lc', field: 'LCM_CLASS', mode: 'first' },
  { layer: 'land_classification', key: 'land', field: 'CLASSIFIC_', mode: 'first' },
];

async function screenPermits(permits) {
  const manifest = JSON.parse(await readFile(path.join(GEO_DIR, 'layers.json'), 'utf8'));
  const byId = new Map(manifest.layers.map((layer) => [layer.id, layer]));
  const indexes = new Map();

  for (const def of SCREEN_LAYERS) {
    const meta = byId.get(def.layer);
    if (!meta) continue;
    const geojson = JSON.parse(await readFile(path.join(GEO_DIR, meta.file), 'utf8'));
    indexes.set(def.key, { ...def, index: buildLayerIndex(geojson.features), meta });
    console.log(`  ${def.key.padEnd(6)} ${geojson.features.length} polygons indexed`);
  }

  let screened = 0;
  for (const permit of permits) {
    if (permit.lat === null || permit.lon === null) continue;
    const spatial = {};
    for (const [key, def] of indexes) {
      const matches = queryLayerIndex(def.index, permit.lon, permit.lat);
      if (!matches.length) continue;
      if (def.mode === 'max') {
        let best = null;
        let bestRank = -1;
        for (const feature of matches) {
          const value = feature.properties?.[def.field];
          const rank = def.ranks[value] ?? 0;
          if (rank > bestRank) {
            bestRank = rank;
            best = value;
          }
        }
        if (best) spatial[key] = best;
      } else {
        const value = matches.map((feature) => feature.properties?.[def.field]).find(Boolean);
        if (value) spatial[key] = value;
      }
    }
    if (Object.keys(spatial).length) {
      permit.spatial = spatial;
      if (permit.province === 'Cebu' && !spatial.lc) {
        if (!permit.qa.includes('possible_water')) permit.qa.push('possible_water');
      }
      permit.risk = Math.min(
        10,
        (FLOOD_RANK[spatial.flood] ?? 0) +
          (SLIDE_RANK[spatial.slide] ?? 0) +
          (spatial.pa ? 2 : 0) +
          (spatial.ws ? 1 : 0),
      );
      screened += 1;
    } else {
      permit.spatial = null;
      permit.risk = 0;
    }
  }
  console.log(`  Screened ${screened.toLocaleString()} records against ${indexes.size} spatial layers`);
  return screened;
}

function aggregateSpatial(permits) {
  const spatial = {};
  let risk = 0;
  let flood = null;
  let slide = null;
  for (const permit of permits) {
    const s = permit.spatial;
    if (!s) continue;
    if (s.flood && (FLOOD_RANK[s.flood] ?? 0) > (FLOOD_RANK[flood] ?? 0)) flood = s.flood;
    if (s.slide && (SLIDE_RANK[s.slide] ?? 0) > (SLIDE_RANK[slide] ?? 0)) slide = s.slide;
    if (!spatial.pa && s.pa) spatial.pa = s.pa;
    if (!spatial.ws && s.ws) spatial.ws = s.ws;
    if (!spatial.lc && s.lc) spatial.lc = s.lc;
    if (!spatial.land && s.land) spatial.land = s.land;
    risk = Math.max(risk, permit.risk ?? 0);
  }
  if (flood) spatial.flood = flood;
  if (slide) spatial.slide = slide;
  return { spatial: Object.keys(spatial).length ? spatial : null, risk };
}

/* ------------------------------------------------------------------ */
/* supporting QA data                                                  */
/* ------------------------------------------------------------------ */

async function loadSupport() {
  const result = { audit: [], issues: { total: 0, byType: [], byAction: [] }, reviewQueue: [] };
  const readTab = async (keyName) => {
    try {
      return parseCsv(await readFile(path.join(RAW_DIR, `${keyName}.csv`), 'utf8'));
    } catch {
      throw new Error(`Expected support tab ${keyName}.csv is missing — run npm run data:fetch`);
    }
  };

  const auditRows = await readTab('CLEANSE_AUDIT');
  if (auditRows.length > 1) {
    const headers = auditRows[0];
    const find = makeLookup(headers);
    const idx = {
      timestamp: find('timestamp'),
      type: find('permit type'),
      year: find('permit year'),
      permitNo: find('permit no'),
      company: find('company name'),
      field: find('field'),
      original: find('original value'),
      clean: find('clean value'),
      action: find('action'),
      reason: find('reason'),
    };
    for (let i = 1; i < auditRows.length; i += 1) {
      const row = auditRows[i];
      result.audit.push({
        at: key(row, idx.timestamp),
        type: key(row, idx.type),
        year: key(row, idx.year),
        permitNo: key(row, idx.permitNo),
        company: key(row, idx.company),
        field: key(row, idx.field),
        original: key(row, idx.original),
        clean: key(row, idx.clean),
        action: key(row, idx.action),
        reason: key(row, idx.reason),
      });
    }
  }

  const issuesRows = await readTab('ISSUES_V26');
  if (issuesRows.length > 1) {
    const headers = issuesRows[0];
    const find = makeLookup(headers);
    const typeIdx = find('issue type');
    const actionIdx = find('action');
    const typeCount = new Map();
    const actionCount = new Map();
    let total = 0;
    for (let i = 1; i < issuesRows.length; i += 1) {
      const row = issuesRows[i];
      if (!row.some((c) => cleanText(c))) continue;
      total += 1;
      const type = key(row, typeIdx) || 'Unspecified';
      const action = key(row, actionIdx) || 'Unspecified';
      typeCount.set(type, (typeCount.get(type) ?? 0) + 1);
      actionCount.set(action, (actionCount.get(action) ?? 0) + 1);
    }
    result.issues = {
      total,
      byType: sortByCountDesc(typeCount, 30),
      byAction: sortByCountDesc(actionCount, 30),
    };
  }

  const reviewRows = await readTab('REVIEW_QUEUE');
  if (reviewRows.length > 1) {
    const headers = reviewRows[0];
    const find = makeLookup(headers);
    const idx = {
      type: find('permit type'),
      year: find('permit year'),
      permitNo: find('permit no'),
      company: find('company name'),
      municipality: find('municipality city'),
      province: find('province'),
      issue: find('issue'),
      action: find('recommended review'),
    };
    for (let i = 1; i < reviewRows.length; i += 1) {
      const row = reviewRows[i];
      if (!row.some((c) => cleanText(c))) continue;
      result.reviewQueue.push({
        type: key(row, idx.type),
        year: key(row, idx.year),
        permitNo: key(row, idx.permitNo),
        company: key(row, idx.company),
        municipality: key(row, idx.municipality),
        province: key(row, idx.province),
        issue: key(row, idx.issue),
        action: key(row, idx.action),
      });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Building dataset (reference date ${TODAY})`);

  console.log('\nNormalising permit tabs…');
  const { permits: rawPermits, skipped } = await extractPermits();
  console.log(`  ${rawPermits.length.toLocaleString()} raw permit rows`);

  const { permits, duplicates } = dedupe(rawPermits);
  console.log(`  ${permits.length.toLocaleString()} unique permits (${duplicates.length} duplicate rows merged)`);

  console.log('\nExtracting hazardous-waste and ECC/CNC records…');
  const { registrations: hazardous, wasteRows } = await extractHazardousWaste();

  console.log('\nValidating coordinates against the provincial land boundaries…');
  const provinceIndex = await loadProvinceIndex();
  const located = [...permits, ...hazardous];
  const gazetteer = buildCoordinateGazetteer(located, provinceIndex);
  const coordinateReport = repairCoordinates(located, gazetteer, provinceIndex);
  console.log(
    `  ${coordinateReport.kept.toLocaleString()} kept · ${coordinateReport.corrected.toLocaleString()} corrected ` +
    `(${coordinateReport.outside.toLocaleString()} off-province/sea, ${coordinateReport.drift.toLocaleString()} far from the address) · ` +
    `${coordinateReport.approximate.toLocaleString()} placed from the address · ${coordinateReport.unresolved.toLocaleString()} unresolved`,
  );

  console.log('\nScreening permits and hazardous-waste registrations against spatial layers…');
  const screened = await screenPermits([...permits, ...hazardous]);

  console.log('\nBuilding establishment sites and DP / PTO / HW intercross…');
  const sites = buildSites(permits);
  const { matched: hwMatched, created: hwOnlySites } = intercrossHazardousWaste(sites, hazardous);
  finalizeSites(sites);

  const permitsBySite = new Map();
  for (const permit of permits) {
    const list = permitsBySite.get(permit.siteId) ?? [];
    list.push(permit);
    permitsBySite.set(permit.siteId, list);
  }
  const screenablesBySite = new Map();
  for (const item of [...permits, ...hazardous]) {
    const list = screenablesBySite.get(item.siteId) ?? [];
    list.push(item);
    screenablesBySite.set(item.siteId, list);
  }
  for (const site of sites) {
    const aggregate = aggregateSpatial(screenablesBySite.get(site.id) ?? []);
    site.spatial = aggregate.spatial;
    site.risk = aggregate.risk;
  }

  const both = sites.filter((s) => s.matchType === 'both').length;
  console.log(`  ${sites.length.toLocaleString()} sites — ${both.toLocaleString()} with both DP and PTO`);
  console.log(`  ${hwMatched.toLocaleString()} hazardous-waste registrations joined existing sites · ${hwOnlySites.toLocaleString()} created HW-only sites`);

  console.log('\nLoading QA logs…');
  const support = await loadSupport();

  console.log('\nBuilding ECC / CNC clearance index…');
  const clearances = buildClearances(permits, hazardous);
  aggregateClearanceFields(sites, clearances);
  console.log(`  ${clearances.length.toLocaleString()} unique clearances — ${clearances.filter((c) => c.type === 'ECC').length} ECC · ${clearances.filter((c) => c.type === 'CNC').length} CNC · ${clearances.filter((c) => c.type === 'ECC/CNC').length} unclassified`);

  console.log('\nGrouping map facilities by company and location…');
  const facilities = buildMapFacilities(sites, clearances);

  const scopeIn = permits.filter((p) => p.scope === 'in');
  const qaCounts = new Map();
  for (const permit of permits) {
    for (const flag of permit.qa) qaCounts.set(flag, (qaCounts.get(flag) ?? 0) + 1);
  }

  const manifest = JSON.parse(await readFile(path.join(RAW_DIR, '_manifest.json'), 'utf8'));

  const meta = {
    generatedAt: new Date().toISOString(),
    referenceDate: TODAY,
    sources: {
      fetchedAt: manifest.fetchedAt,
      workbooks: Object.fromEntries(Object.entries(manifest.workbooks).map(([k, v]) => [k, { label: v.label }])),
      tabs: manifest.tabs.map(({ gid, ...rest }) => rest),
    },
    totals: {
      permits: permits.length,
      dp: permits.filter((p) => p.type === 'DP').length,
      pto: permits.filter((p) => p.type === 'PTO').length,
      sites: sites.length,
      bothSites: both,
      dpOnlySites: sites.filter((s) => s.matchType === 'dp').length,
      ptoOnlySites: sites.filter((s) => s.matchType === 'pto').length,
      hwOnlySites: sites.filter((s) => s.matchType === 'hw').length,
      hwSites: sites.filter((s) => s.hwCount > 0).length,
      hwRegistrations: hazardous.length,
      hwWasteRows: wasteRows,
      hwGenerators: new Set(hazardous.map((hw) => hw.hwGrNo).filter(Boolean)).size,
      hwActive: hazardous.filter((hw) => hw.lifecycle === 'Active').length,
      hwExpiring: hazardous.filter((hw) => hw.lifecycle === 'Expiring').length,
      hwExpired: hazardous.filter((hw) => hw.lifecycle === 'Expired').length,
      hwUnknown: hazardous.filter((hw) => hw.lifecycle === 'Unknown').length,
      matchedHw: hazardous.filter((hw) => hw.matched).length,
      clearanceSites: sites.filter((s) => s.clearanceCount > 0).length,
      clearances: clearances.length,
      facilities: facilities.length,
      multiRegisterFacilities: facilities.filter((f) => f.registers.length > 1).length,
      eccClearances: clearances.filter((c) => c.type === 'ECC').length,
      cncClearances: clearances.filter((c) => c.type === 'CNC').length,
      ambiguousClearances: clearances.filter((c) => c.type === 'ECC/CNC').length,
      inScope: scopeIn.length,
      outOfScope: permits.filter((p) => p.scope === 'out').length,
      unknownScope: permits.filter((p) => p.scope === 'unknown').length,
      plotted: permits.filter((p) => p.lat !== null).length,
      coordinatesKept: coordinateReport.kept,
      coordinatesCorrected: coordinateReport.corrected,
      coordinatesApproximate: coordinateReport.approximate,
      coordinatesUnresolved: coordinateReport.unresolved,
      screened,
      active: permits.filter((p) => p.lifecycle === 'Active').length,
      expiring: permits.filter((p) => p.lifecycle === 'Expiring').length,
      expired: permits.filter((p) => p.lifecycle === 'Expired').length,
      unknownExpiry: permits.filter((p) => p.lifecycle === 'Unknown').length,
      crossMatchedSites: both,
      riskSites: sites.filter((s) => s.risk >= 4).length,
      sourceRows: rawPermits.length + skipped.length + duplicates.length + wasteRows,
      duplicates: duplicates.length,
      skippedRows: skipped.length,
    },
    years: [...new Set([...permits.map((p) => p.year), ...hazardous.map((hw) => hw.issued ? Number(hw.issued.slice(0, 4)) : null).filter(Boolean)])].sort(),
    provinces: sortByCountDesc(countBy(permits, (p) => p.province || 'Unknown'), 20),
    lgus: sortByCountDesc(countBy(scopeIn, (p) => `${p.municipality}|${p.province}`), 200).map(({ name, count }) => {
      const [municipality, province] = name.split('|');
      return { municipality, province, count };
    }),
    industries: sortByCountDesc(countBy(permits, (p) => p.industry || 'Unspecified'), 25),
    statuses: sortByCountDesc(countBy(permits, (p) => p.sourceStatus), 10),
    lifecycles: sortByCountDesc(countBy(permits, (p) => p.lifecycle), 10),
    qa: sortByCountDesc(qaCounts, 30),
    hwWasteCodes: sortByCountDesc(
      countBy(hazardous.flatMap((hw) => hw.wasteCodes.map((code) => `${code.code} · ${code.description}`)), (name) => name),
      15,
    ),
    hwIndustries: sortByCountDesc(countBy(hazardous, (hw) => hw.industry || 'Unspecified'), 15),
    clearanceSources: sortByCountDesc(countBy(clearances, (c) => (c.sources ?? []).join('+') || 'Unknown'), 10),
    audit: {
      rows: support.audit.length,
      byAction: sortByCountDesc(countBy(support.audit, (r) => r.action || 'Unspecified'), 10),
      byField: sortByCountDesc(countBy(support.audit, (r) => r.field || 'Unspecified'), 10),
    },
    issues: support.issues,
    reviewQueue: support.reviewQueue,
    notes: [
      'Permit records are normalised from the DENR-EMB Region VII Google Sheets registers (DP 2019–2026, PTO 2020–2026).',
      'Hazardous-waste generator registrations come from the DENR-EMB Region VII hazardous-waste register (workbook C, ALL DATA), normalised to one registration per application number with de-duplicated waste codes.',
      'ECC and CNC references are extracted from both the DP/PTO register (ECC/CNC no. column) and the hazardous-waste register (Permit / Permit No. columns), de-duplicated by clearance number.',
      'Sites are cross-matched on normalised establishment name + municipality/city; fuzzy matches require ≥88% token similarity within the same LGU, with branch-marker, parenthetical and location guards.',
      'Lifecycle status is derived from the expiry date against the reference date; source status (New/Renewal/TPO/Amendment) is preserved separately.',
      'In-scope provinces follow the 2026 PSGC Region VII definition: Cebu and Bohol. Negros Oriental and Siquijor records are excluded from in-scope and from the map.',
      'Spatial results are point-in-polygon screens against the supplied DENR hazard, protected-area, watershed and land-cover layers.',
      'Register coordinates are validated against the DENR Region VII provincial land polygons. Points in the sea, on another island or more than 40 km from their declared city/municipality are re-homed to the barangay / city / municipality centroid derived from the company address and flagged as corrected or approximate.',
    ],
  };

  const permitsOut = permits
    .map((permit) => {
      const out = { ...permit };
      delete out.companyKey;
      delete out.coreKey;
      return out;
    })
    .sort((a, b) => a.year - b.year || a.type.localeCompare(b.type) || a.permitNo.localeCompare(b.permitNo));

  const sitesOut = sites.map((site) => {
    const out = { ...site };
    delete out._members;
    delete out._hwMembers;
    delete out._matchKeys;
    delete out._tokens;
    return out;
  });

  const hwOut = hazardous.map((hw) => {
    const out = { ...hw };
    delete out._clearances;
    delete out._tokens;
    delete out._keys;
    delete out.companyKey;
    return out;
  });

  await writeFile(path.join(OUT_DIR, 'permits.json'), JSON.stringify(permitsOut), 'utf8');
  await writeFile(path.join(OUT_DIR, 'sites.json'), JSON.stringify(sitesOut), 'utf8');
  await writeFile(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  await writeFile(path.join(OUT_DIR, 'hw.json'), JSON.stringify(hwOut), 'utf8');
  await writeFile(path.join(OUT_DIR, 'clearances.json'), JSON.stringify(clearances), 'utf8');
  await writeFile(path.join(OUT_DIR, 'facilities.json'), JSON.stringify(facilities), 'utf8');
  await writeFile(
    path.join(OUT_DIR, 'quality.json'),
    JSON.stringify({ audit: support.audit, reviewQueue: support.reviewQueue, duplicates, skipped }, null, 0),
    'utf8',
  );

  const size = stat;
  for (const file of ['permits.json', 'sites.json', 'meta.json', 'hw.json', 'clearances.json', 'facilities.json', 'quality.json']) {
    const info = await size(path.join(OUT_DIR, file));
    console.log(`  ${file.padEnd(16)} ${(info.size / 1024 / 1024).toFixed(2)} MB`);
  }
  console.log('\nDone.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
