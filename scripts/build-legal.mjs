#!/usr/bin/env node
/**
 * Build the NOV / legal layer for the ENVIS dashboard.
 *
 * Source of truth
 *   data/legal/snapshot.json  — pinned copy of the Legal Dashboards snapshot
 *   scripts/vendor/legal/buildData.mjs — vendored Legal Dashboards normaliser
 *
 * Output
 *   public/data/legal.json                 — entities, docket, PAB year totals
 *   reports/legal-match-candidates.csv     — review queue for manual aliases
 *
 * Matching is deliberately conservative: exact / register-alias / manual only.
 * Fuzzy suggestions are written to the review CSV but never auto-linked.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboardData } from './vendor/legal/buildData.mjs';
import {
  branchBaseKey,
  cleanText,
  companyCoreKey,
  companyStrictKey,
  normKey,
  parentheticalKeys,
  tokenDice,
} from './lib/text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_FILE = path.join(ROOT, 'data', 'legal', 'snapshot.json');
const FACILITIES_FILE = path.join(ROOT, 'public', 'data', 'facilities.json');
const SITES_FILE = path.join(ROOT, 'public', 'data', 'sites.json');
const ALIAS_FILE = path.join(ROOT, 'scripts', 'legal-aliases.json');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const OUT_FILE = path.join(OUT_DIR, 'legal.json');
const REPORT_DIR = path.join(ROOT, 'reports');
const REPORT_FILE = path.join(REPORT_DIR, 'legal-match-candidates.csv');
const CHECK = process.argv.includes('--check');

/** Compliance-status column per source year (master tab). */
const MASTER_STATUS_COLUMN = {
  '2021': 19,
  '2022': 22,
  '2023': 22,
  '2024': 21,
  '2025': null,
  '2026': null,
};

const SOURCE_YEARS = ['2021', '2022', '2023', '2024', '2025', '2026'];

const PAB_COVERAGE = {
  '2021': { coverage: 'none', note: 'No PAB tab in the 2021 workbook.' },
  '2022': { coverage: 'none', note: 'No PAB tab in the 2022 workbook.' },
  '2023': { coverage: 'partial', note: 'PAB NOVs only; paid amounts are embedded in the NOV tab.' },
  '2024': { coverage: 'full', note: 'PAB NOVs plus the PAB penalty payment register.' },
  '2025': { coverage: 'full', note: 'PAB NOVs, PAB orders and the PAB penalty register.' },
  '2026': { coverage: 'full', note: 'PAB NOVs, PAB orders and the PAB penalty register.' },
};

const CLOSED_PATTERN = /\b(CLOSED|RESOLVED|RESOLUTION\s+ISSUED|DISMISS(?:ED)?|SET\s+ASIDE|TERMINATED|WITHDRAWN|PAID\s+PENALTY\s+ALREADY|COMPLIED|COMPLIANCE\s+SATISFIED)\b/i;
const OPEN_PATTERN = /\b(OPEN|PENDING|UNPAID|FOR\s+(?:RESOLUTION|INVESTIGATION|COMPLIANCE|CASE\s+UPDATING|RD|RELEASE|SIGNATURE|PAYMENT)|RELEASED|ENDORSED|ISSUED|NO\s+COMPLIANCE|WITH\s+PENALTY|RECONSIDERED|REDUCE[D]?|DENIED|SUSPENDED|NOV\s+RELEASED)\b/i;
const PAID_PATTERN = /\b(PAID|PAYMENT\s+RECEIVED|SETTLED)\b/i;
const PENDING_PAYMENT_PATTERN = /\b(PENDING|UNPAID|FOR\s+PAYMENT|NOT\s+PAID)\b/i;

const MONTH_PATTERN = /^(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)$/i;

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
}

function normalizeCaseNo(value) {
  const raw = cleanText(value).toUpperCase();
  if (!raw) return '';
  const match = raw.match(/(20\d{2})\D*?(\d{3,5})\s*$/);
  if (match) return `${match[1]}-${match[2].padStart(4, '0')}`;
  return raw.replace(/\s+/g, '');
}

function deriveProvince(...values) {
  const text = cleanText(values.filter(Boolean).join(' ')).toUpperCase();
  if (/\bNEGROS\b/.test(text)) return 'Negros Oriental';
  if (/\bSIQUIJOR\b/.test(text)) return 'Siquijor';
  if (/\bCEBU\b/.test(text)) return 'Cebu';
  if (/\bBOHOL\b/.test(text)) return 'Bohol';
  return '';
}

function normalizeProvince(value) {
  const text = cleanText(value).toUpperCase();
  if (!text) return '';
  if (/\bCEBU\b/.test(text)) return 'Cebu';
  if (/\bBOHOL\b/.test(text)) return 'Bohol';
  if (/\bNEGROS\b/.test(text)) return 'Negros Oriental';
  if (/\bSIQUIJOR\b/.test(text)) return 'Siquijor';
  return cleanText(value);
}

function lguKey(value) {
  return normKey(value)
    .replace(/\b(CITY|MUNICIPALITY|TOWN|CAPITAL|POBLACION|POB)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameKeys(name) {
  const raw = cleanText(name);
  if (!raw) return [];
  return unique([
    normKey(raw),
    companyStrictKey(raw),
    companyCoreKey(raw),
    branchBaseKey(raw),
    ...parentheticalKeys(raw),
  ]);
}

function masterCaseNo(year, row) {
  const raw = year === '2021' ? row[0] : year === '2022' || year === '2023' ? row[1] : row[0];
  return normalizeCaseNo(raw);
}

function isHeaderLike(value) {
  return /^(CASE\s*(NO\.?|NUMBER)?|RESPONDENT|ESTABLISHMENT|NAME|IIS\s*REFERENCE)/i.test(cleanText(value));
}

/** Rows that carry only a generated number and no respondent, address or date. */
function isEmptyRow(record) {
  if (record.linkedCaseNo) return false;
  const name = cleanText(
    record.establishment || record.company || record.respondent || record.project || record.subject,
  );
  return (
    !name &&
    !cleanText(record.iisRef) &&
    !cleanText(record.address) &&
    !cleanText(record.municipality || record.city) &&
    !cleanText(record.province) &&
    !cleanText(record.dateDocketed || record.dateIssued || record.date || record.dateIso) &&
    !cleanText(record.status)
  );
}

function collectStatuses(texts) {
  const closed = [];
  const open = [];
  for (const text of texts) {
    const value = cleanText(text);
    if (!value) continue;
    if (CLOSED_PATTERN.test(value)) closed.push(value);
    else if (OPEN_PATTERN.test(value)) open.push(value);
  }
  return { closed: unique(closed), open: unique(open) };
}

function deriveCaseStatus(closed, open) {
  if (closed.length && !open.length) return 'CLOSED';
  if (open.length) return 'OPEN';
  return 'UNKNOWN';
}

function deriveEntryPayment(paidSignals, pendingSignals) {
  const paid = paidSignals.length > 0;
  const pending = pendingSignals.length > 0;
  if (paid && pending) return 'MIXED';
  if (paid) return 'PAID';
  if (pending) return 'PENDING';
  return 'NONE';
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function readOptionalJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const [snapshot, facilities, sites, manualAliases] = await Promise.all([
    readFile(SNAPSHOT_FILE, 'utf8').then(JSON.parse),
    readFile(FACILITIES_FILE, 'utf8').then(JSON.parse),
    readFile(SITES_FILE, 'utf8').then(JSON.parse),
    readOptionalJson(ALIAS_FILE, {}),
  ]);

  const data = buildDashboardData(snapshot);

  // Drop generated placeholder rows that never had a respondent or document.
  const pabNovRows = (data.pabNov ?? []).filter((record) => !isEmptyRow(record));
  const orderRows = (data.orders ?? []).filter((record) => !isEmptyRow(record));
  const pabOrderRows = (data.pabOrders ?? []).filter((record) => !isEmptyRow(record));
  const erfRows = (data.erf ?? []).filter((record) => !isEmptyRow(record));
  const pabPenaltyRows = (data.pabPenalties ?? []).filter((record) => !isEmptyRow(record));
  const ra6969Rows = (data.ra6969 ?? []).filter((record) => !isEmptyRow(record));
  const complaintRows = (data.complaints ?? []).filter((record) => !isEmptyRow(record));
  const placeholderCount = (data.pabNov?.length ?? 0) - pabNovRows.length;

  /* ------------------------------------------------------------------ *
   * 1. Master compliance status (not exposed by the Legal CaseRecord)
   * ------------------------------------------------------------------ */
  const masterStatus = new Map();
  for (const source of snapshot.sources) {
    const column = MASTER_STATUS_COLUMN[source.year];
    if (column === null || column === undefined) continue;
    const master = source.tabs?.master;
    if (!master) continue;
    for (const row of master.rows) {
      const caseNo = masterCaseNo(source.year, row);
      if (!caseNo) continue;
      const status = cleanText(row[column]);
      if (!status || status.toUpperCase() === 'STATUS') continue;
      masterStatus.set(`${source.year}:${caseNo}`, status);
    }
  }

  /* ------------------------------------------------------------------ *
   * 2. Register index: exact keys only, with LGU disambiguation
   * ------------------------------------------------------------------ */
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  const facilityExactKeys = new Map(
    facilities.map((facility) => [
      facility.id,
      new Set(unique([facility.key, companyStrictKey(facility.company)])),
    ]),
  );
  const facilityBySiteId = new Map();
  for (const facility of facilities) {
    for (const siteId of unique([facility.siteId, ...(facility.siteIds ?? [])])) {
      facilityBySiteId.set(siteId, facility);
    }
  }

  const keyIndex = new Map(); // key -> { facilities:Set, method }
  const addKey = (key, facility, method) => {
    if (!key) return;
    const entry = keyIndex.get(key) ?? { facilities: new Set(), method };
    entry.facilities.add(facility);
    if (!entry.method || entry.method === 'alias') entry.method = method;
    keyIndex.set(key, entry);
  };

  const addFacilityNames = (facility, method) => {
    for (const key of nameKeys(facility.company)) addKey(key, facility, method);
    for (const alias of facility.aliases ?? []) {
      for (const key of nameKeys(alias)) addKey(key, facility, 'alias');
    }
  };

  for (const facility of facilities) addFacilityNames(facility, 'exact');
  for (const site of sites) {
    const facility = facilityBySiteId.get(site.id);
    if (!facility) continue;
    for (const key of unique([site.key, ...nameKeys(site.company)])) addKey(key, facility, 'exact');
  }

  const manualKeyMap = new Map();
  for (const [rawKey, facilityId] of Object.entries(manualAliases?.aliases ?? manualAliases ?? {})) {
    if (typeof facilityId !== 'string') continue;
    const key = normKey(rawKey);
    if (key && facilityById.has(facilityId)) manualKeyMap.set(key, facilityId);
  }

  const lguCompatible = (facility, province, municipality) => {
    if (province && facility.province && normKey(province) !== normKey(facility.province)) return false;
    if (municipality && facility.municipality) {
      const a = lguKey(municipality);
      const b = lguKey(facility.municipality);
      if (a && b && a !== b) return false;
    }
    return true;
  };

  const resolveFacility = (name, province, municipality) => {
    const keys = nameKeys(name);
    for (const key of keys) {
      const facilityId = manualKeyMap.get(key);
      if (facilityId) return { facility: facilityById.get(facilityId), method: 'manual', key };
    }
    for (const key of keys) {
      const entry = keyIndex.get(key);
      if (!entry || !entry.facilities.size) continue;
      const pool = [...entry.facilities];
      const pick = (facility) => ({
        facility,
        method: facilityExactKeys.get(facility.id)?.has(key) ? 'exact' : 'alias',
        key,
      });
      if (pool.length === 1) return pick(pool[0]);
      const local = pool.filter((facility) => lguCompatible(facility, province, municipality));
      if (local.length === 1) return pick(local[0]);
    }
    return null;
  };

  /* ------------------------------------------------------------------ *
   * 3. Flatten every legal event into one docket row
   * ------------------------------------------------------------------ */
  const entries = [];

  const baseLocation = (record) => ({
    municipality: cleanText(record?.municipality || record?.city || ''),
    province: normalizeProvince(record?.province) || deriveProvince(record?.address, record?.municipality, record?.city),
    address: cleanText(record?.address || ''),
  });

  const statusFromTexts = (texts, fallbackPayment = { paid: [], pending: [] }) =>
    collectStatuses([...texts, ...fallbackPayment.paid, ...fallbackPayment.pending]);

  const paymentFromTexts = (texts, pendingFlag = false) => {
    const paid = texts.filter((text) => PAID_PATTERN.test(cleanText(text)));
    const pending = texts.filter((text) => PENDING_PAYMENT_PATTERN.test(cleanText(text)));
    if (pendingFlag && !pending.length) pending.push('Payment pending');
    return { paid: unique(paid), pending: unique(pending) };
  };

  const pushEntry = (entry) => {
    const statuses = collectStatuses(entry.statusTexts);
    entry.closedSignals = statuses.closed;
    entry.openSignals = statuses.open;
    entry.status = deriveCaseStatus(statuses.closed, statuses.open);
    entry.payment = deriveEntryPayment(entry.paidSignals, entry.pendingSignals);
    entries.push(entry);
  };

  for (const record of data.cases) {
    const year = record.docketYear || record.sourceYear;
    const statusTexts = [
      masterStatus.get(`${record.sourceYear}:${record.caseNo}`) ?? '',
      ...record.orders.map((order) => order.status),
      ...record.pabOrders.map((order) => order.status),
      ...record.erf.map((payment) => payment.status),
      ...record.pabPenalties.map((penalty) => penalty.status),
      ...record.complaints.flatMap((complaint) => [complaint.status, complaint.actions]),
      ...record.flags,
    ];
    const paymentTexts = [
      ...record.orders.map((order) => order.status),
      ...record.pabOrders.map((order) => order.status),
      ...record.erf.map((payment) => payment.status),
      ...record.pabPenalties.map((penalty) => penalty.status),
    ];
    const payment = paymentFromTexts(paymentTexts, record.pendingPayment);
    const name =
      cleanText(record.establishment) ||
      cleanText(record.pabNov[0]?.establishment) ||
      cleanText(record.orders[0]?.company) ||
      cleanText(record.pabOrders[0]?.company) ||
      cleanText(record.erf[0]?.company) ||
      cleanText(record.pabPenalties[0]?.company) ||
      cleanText(record.complaints[0]?.respondent) ||
      'Unidentified respondent';

    const location = baseLocation(record);
    pushEntry({
      id: record.id,
      kind: 'case',
      type: 'NOV',
      sourceYear: record.sourceYear,
      docketYear: String(year),
      caseNo: record.caseNo,
      displayCaseNo: record.displayCaseNo || record.caseNo,
      rawCaseNo: record.rawCaseNo || '',
      pabCaseNos: unique(record.pabNov.map((row) => row.pabCaseNo)),
      iisRef: cleanText(record.iisRef),
      dateDocketed: record.dateDocketed || record.dateIso || '',
      establishment: name,
      ...location,
      documentType: record.documentType || 'NOV',
      stage: record.stage,
      stageLabel: record.stageLabel,
      violations: unique(record.violations.map((violation) => violation.law || violation.key)),
      statusTexts,
      paidSignals: payment.paid,
      pendingSignals: payment.pending,
      types: {
        nov: 1,
        pabNov: record.pabNov.length,
        order: record.orders.length,
        pabOrder: record.pabOrders.length,
        erf: record.erf.length,
        pabPenalty: record.pabPenalties.length,
        complaint: record.complaints.length,
        ra6969: 0,
      },
    });
  }

  const pushUnlinked = (records, config) => {
    for (const record of records) {
      if (record.linkedCaseNo) continue;
      const location = baseLocation(record);
      const statusTexts = config.statusTexts(record);
      const payment = paymentFromTexts(statusTexts);
      pushEntry({
        id: record.id,
        kind: config.kind,
        type: config.type,
        sourceYear: record.sourceYear,
        docketYear: String(record.docketYear || record.sourceYear),
        caseNo: cleanText(record.caseNo || ''),
        displayCaseNo: cleanText(record.caseNo || ''),
        rawCaseNo: cleanText(record.caseNo || ''),
        pabCaseNos: unique([record.pabCaseNo, record.hwCaseNo].map((value) => cleanText(value))),
        iisRef: cleanText(record.iisRef),
        dateDocketed: record.dateDocketed || record.dateIssued || record.date || record.dateIso || '',
        establishment: cleanText(record.establishment || record.company || record.respondent || record.project || '') || 'Unidentified respondent',
        ...location,
        documentType: record.documentType || record.subtype || config.type,
        stage: config.stage,
        stageLabel: config.stageLabel,
        violations: unique((record.violations ?? []).map((violation) =>
          typeof violation === 'string' ? violation : violation.law || violation.key || '',
        )),
        statusTexts,
        paidSignals: payment.paid,
        pendingSignals: payment.pending,
        types: config.types,
      });
    }
  };

  pushUnlinked(pabNovRows, {
    kind: 'pabNov',
    type: 'PAB NOV',
    stage: 'pabNov',
    stageLabel: 'PAB NOV (unlinked)',
    statusTexts: (record) => [record.aw, ...record.violations],
    types: { nov: 0, pabNov: 1, order: 0, pabOrder: 0, erf: 0, pabPenalty: 0, complaint: 0, ra6969: 0 },
  });

  pushUnlinked(orderRows, {
    kind: 'order',
    type: 'Order',
    stage: 'order',
    stageLabel: 'Order (unlinked)',
    statusTexts: (record) => [record.status],
    types: { nov: 0, pabNov: 0, order: 1, pabOrder: 0, erf: 0, pabPenalty: 0, complaint: 0, ra6969: 0 },
  });

  pushUnlinked(pabOrderRows, {
    kind: 'pabOrder',
    type: 'PAB Order',
    stage: 'pabOrder',
    stageLabel: 'PAB order (unlinked)',
    statusTexts: (record) => [record.status],
    types: { nov: 0, pabNov: 0, order: 0, pabOrder: 1, erf: 0, pabPenalty: 0, complaint: 0, ra6969: 0 },
  });

  pushUnlinked(erfRows, {
    kind: 'erf',
    type: 'ERF',
    stage: 'payment',
    stageLabel: 'ERF payment (unlinked)',
    statusTexts: (record) => [record.status],
    types: { nov: 0, pabNov: 0, order: 0, pabOrder: 0, erf: 1, pabPenalty: 0, complaint: 0, ra6969: 0 },
  });

  pushUnlinked(pabPenaltyRows, {
    kind: 'pabPenalty',
    type: 'PAB Penalty',
    stage: 'payment',
    stageLabel: 'PAB penalty (unlinked)',
    statusTexts: (record) => [record.status],
    types: { nov: 0, pabNov: 0, order: 0, pabOrder: 0, erf: 0, pabPenalty: 1, complaint: 0, ra6969: 0 },
  });

  pushUnlinked(ra6969Rows, {
    kind: 'ra6969',
    type: 'RA 6969',
    stage: 'payment',
    stageLabel: 'RA 6969 penalty (unlinked)',
    statusTexts: (record) => [record.status],
    types: { nov: 0, pabNov: 0, order: 0, pabOrder: 0, erf: 0, pabPenalty: 0, complaint: 0, ra6969: 1 },
  });

  pushUnlinked(complaintRows, {
    kind: 'complaint',
    type: 'Complaint',
    stage: 'nov',
    stageLabel: 'Complaint (unlinked)',
    statusTexts: (record) => [record.status, record.actions, record.remarks],
    types: { nov: 0, pabNov: 0, order: 0, pabOrder: 0, erf: 0, pabPenalty: 0, complaint: 1, ra6969: 0 },
  });

  /* ------------------------------------------------------------------ *
   * 4. Resolve each docket row to a DP/PTO/HW facility
   * ------------------------------------------------------------------ */
  const matchQuality = { exact: 0, alias: 0, manual: 0, unmatched: 0 };
  const candidateRows = [];
  const unmatchedNames = new Map();

  for (const entry of entries) {
    const resolved = entry.establishment
      ? resolveFacility(entry.establishment, entry.province, entry.municipality)
      : null;
    if (resolved?.facility) {
      entry.facilityId = resolved.facility.id;
      entry.siteId = resolved.facility.siteId;
      entry.entityName = resolved.facility.company;
      entry.matchMethod = resolved.method;
      entry.matchKey = resolved.key;
      // Docket sheets frequently omit the LGU; borrow it from the matched register facility
      // so the municipality filter and map popup agree with the establishment record.
      if (resolved.facility.municipality) entry.municipality = cleanText(resolved.facility.municipality);
      if (resolved.facility.province) entry.province = cleanText(resolved.facility.province);
      matchQuality[resolved.method] = (matchQuality[resolved.method] ?? 0) + 1;
    } else {
      entry.facilityId = null;
      entry.siteId = null;
      entry.entityName = null;
      entry.matchMethod = 'unmatched';
      entry.matchKey = companyStrictKey(entry.establishment);
      matchQuality.unmatched += 1;
      if (entry.matchKey) {
        const bucket = unmatchedNames.get(entry.matchKey) ?? { name: entry.establishment, count: 0, province: entry.province, municipality: entry.municipality };
        bucket.count += 1;
        unmatchedNames.set(entry.matchKey, bucket);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 5. Group docket rows into establishments
   * ------------------------------------------------------------------ */
  const entities = new Map();

  const blankEntity = (id, name, seed) => ({
    id,
    name,
    legalNames: [],
    facilityId: seed.facilityId ?? null,
    siteId: seed.siteId ?? null,
    municipality: seed.municipality || '',
    province: seed.province || '',
    barangay: seed.barangay || '',
    registers: seed.registers ?? [],
    matchMethod: seed.matchMethod ?? 'unmatched',
    lat: seed.lat ?? null,
    lon: seed.lon ?? null,
    coordStatus: seed.coordStatus ?? null,
    cases: 0,
    novCount: 0,
    pabNovCount: 0,
    orderCount: 0,
    pabOrderCount: 0,
    erfCount: 0,
    pabPenaltyCount: 0,
    complaintCount: 0,
    ra6969Count: 0,
    recordCount: 0,
    paidCases: 0,
    pendingCases: 0,
    openCases: 0,
    closedCases: 0,
    unknownCases: 0,
    years: [],
    caseNos: [],
    status: 'UNKNOWN',
    payment: 'NONE',
  });

  for (const entry of entries) {
    let entity;
    if (entry.facilityId) {
      const facility = facilityById.get(entry.facilityId);
      entity = entities.get(`F:${entry.facilityId}`);
      if (!entity) {
        entity = blankEntity(`F:${entry.facilityId}`, facility.company, {
          facilityId: facility.id,
          siteId: facility.siteId,
          municipality: facility.municipality,
          province: facility.province,
          barangay: facility.barangay,
          registers: facility.registers,
          matchMethod: entry.matchMethod,
          lat: facility.lat,
          lon: facility.lon,
          coordStatus: facility.coordStatus,
        });
        entities.set(entity.id, entity);
      }
    } else {
      const key = entry.matchKey || normKey(entry.establishment) || 'UNKNOWN';
      entity = entities.get(`U:${key}`);
      if (!entity) {
        entity = blankEntity(`U:${key}`, entry.establishment, {
          municipality: entry.municipality,
          province: entry.province,
          matchMethod: 'unmatched',
        });
        entities.set(entity.id, entity);
      }
      if (!entity.municipality && entry.municipality) entity.municipality = entry.municipality;
      if (!entity.province && entry.province) entity.province = entry.province;
    }

    if (entry.establishment) entity.legalNames.push(entry.establishment);
    entity.cases += entry.kind === 'case' ? 1 : 0;
    entity.novCount += entry.types.nov;
    entity.pabNovCount += entry.types.pabNov;
    entity.orderCount += entry.types.order;
    entity.pabOrderCount += entry.types.pabOrder;
    entity.erfCount += entry.types.erf;
    entity.pabPenaltyCount += entry.types.pabPenalty;
    entity.complaintCount += entry.types.complaint;
    entity.ra6969Count += entry.types.ra6969;
    entity.recordCount +=
      entry.types.nov +
      entry.types.pabNov +
      entry.types.order +
      entry.types.pabOrder +
      entry.types.erf +
      entry.types.pabPenalty +
      entry.types.complaint +
      entry.types.ra6969;

    if (entry.status === 'CLOSED') entity.closedCases += 1;
    else if (entry.status === 'OPEN') entity.openCases += 1;
    else entity.unknownCases += 1;

    if (entry.payment === 'PAID') entity.paidCases += 1;
    if (entry.payment === 'PENDING' || entry.payment === 'MIXED') entity.pendingCases += 1;

    entity.years.push(entry.docketYear);
    if (entry.caseNo) entity.caseNos.push(entry.caseNo);
    else if (entry.pabCaseNos.length) entity.caseNos.push(...entry.pabCaseNos);
  }

  const finalizeEntity = (entity) => {
    entity.legalNames = unique(entity.legalNames).sort((a, b) => a.localeCompare(b));
    entity.years = unique(entity.years).sort();
    entity.caseNos = unique(entity.caseNos);
    entity.latestYear = entity.years.length ? entity.years[entity.years.length - 1] : null;
    entity.openCases = entity.openCases;
    entity.status =
      entity.openCases > 0
        ? 'OPEN'
        : entity.closedCases > 0 && entity.unknownCases > 0
          ? 'PARTIAL'
          : entity.closedCases > 0
            ? 'CLOSED'
            : 'UNKNOWN';
    entity.payment =
      entity.pendingCases > 0 && entity.paidCases > 0
        ? 'MIXED'
        : entity.pendingCases > 0
          ? 'PENDING'
          : entity.paidCases > 0
            ? 'PAID'
            : 'NONE';
    return entity;
  };

  const allEntities = [...entities.values()].map(finalizeEntity);
  const registerEntities = allEntities
    .filter((entity) => entity.facilityId)
    .sort((a, b) => b.recordCount - a.recordCount || a.name.localeCompare(b.name));
  const orphanEntities = allEntities
    .filter((entity) => !entity.facilityId)
    .sort((a, b) => b.recordCount - a.recordCount || a.name.localeCompare(b.name));

  /* ------------------------------------------------------------------ *
   * 6. PAB coverage and collections by year (the only place money lives)
   * ------------------------------------------------------------------ */
  const pabByYear = SOURCE_YEARS.map((year) => {
    const pabNov = pabNovRows.filter((record) => record.sourceYear === year);
    const pabOrders = pabOrderRows.filter((record) => record.sourceYear === year);
    const penalties = pabPenaltyRows.filter((record) => record.sourceYear === year);
    const erf = erfRows.filter((record) => record.sourceYear === year);
    const ra6969 = ra6969Rows.filter((record) => record.sourceYear === year);

    const paidPenalties = penalties.filter((record) => /\bPAID\b/i.test(cleanText(record.status)));
    const pendingPenalties = penalties.filter((record) => /\bPENDING\b/i.test(cleanText(record.status)));
    const paidErf = erf.filter((record) => /\bPAID\b/i.test(cleanText(record.status)));
    const pendingErf = erf.filter((record) => /\bPENDING\b/i.test(cleanText(record.status)));
    const paidRa = ra6969.filter((record) => /\bPAID\b/i.test(cleanText(record.status)));

    const sum = (rows) => rows.reduce((total, row) => total + (Number(row.amount) || 0), 0);

    return {
      year,
      coverage: PAB_COVERAGE[year].coverage,
      note: PAB_COVERAGE[year].note,
      pabNovIssued: pabNov.length,
      pabOrders: pabOrders.length,
      pabOrdersWithPenalty: pabOrders.filter((record) => /\bPENALTY\b/i.test(cleanText(record.status)) || Number(record.amount) > 0).length,
      ordersAssessed: sum(pabOrders),
      penaltyRecords: penalties.length,
      paid: paidPenalties.length,
      pending: pendingPenalties.length,
      assessed: sum(penalties),
      collected: sum(paidPenalties),
      erfRecords: erf.length,
      erfPaid: paidErf.length,
      erfPending: pendingErf.length,
      erfCollected: sum(paidErf),
      ra6969Records: ra6969.length,
      ra6969Collected: sum(paidRa),
    };
  });

  /* ------------------------------------------------------------------ *
   * 7. Candidate review queue (fuzzy suggestions only, never auto-linked)
   * ------------------------------------------------------------------ */
  const tokenIndex = new Map();
  for (const [key, entry] of keyIndex) {
    if (!entry.facilities.size) continue;
    for (const token of key.split(' ')) {
      if (token.length < 2) continue;
      const list = tokenIndex.get(token) ?? [];
      list.push({ key, entry });
      tokenIndex.set(token, list);
    }
  }

  for (const [key, bucket] of unmatchedNames) {
    if (!key) continue;
    const tokens = key.split(' ').filter((token) => token.length > 1);
    const counts = new Map();
    for (const token of tokens) {
      const list = tokenIndex.get(token) ?? [];
      if (list.length > 250) continue;
      for (const candidate of list) {
        const current = counts.get(candidate.key) ?? { entry: candidate.entry, shared: 0 };
        current.shared += 1;
        counts.set(candidate.key, current);
      }
    }
    let best = null;
    for (const [candidateKey, candidate] of counts) {
      if (candidate.shared < 2) continue;
      const [facility] = [...candidate.entry.facilities];
      if (bucket.province && facility.province && normKey(bucket.province) !== normKey(facility.province)) continue;
      const score = tokenDice(key, candidateKey);
      if (!best || score > best.score) best = { key: candidateKey, facility, score };
    }
    if (best && best.score >= 0.75) {
      candidateRows.push({
        legalName: bucket.name,
        legalKey: key,
        municipality: bucket.municipality,
        province: bucket.province,
        records: bucket.count,
        candidate: best.facility.company,
        candidateKey: best.key,
        candidateFacilityId: best.facility.id,
        score: best.score,
      });
    }
  }
  candidateRows.sort((a, b) => b.score - a.score || a.legalName.localeCompare(b.legalName));

  /* ------------------------------------------------------------------ *
   * 8. Map summaries keyed by facility id
   * ------------------------------------------------------------------ */
  const byFacility = {};
  for (const entity of registerEntities) {
    if (!entity.facilityId) continue;
    byFacility[entity.facilityId] = {
      entityId: entity.id,
      cases: entity.cases,
      records: entity.recordCount,
      open: entity.openCases,
      closed: entity.closedCases,
      pab: entity.pabNovCount + entity.pabOrderCount + entity.pabPenaltyCount,
      erf: entity.erfCount,
      complaints: entity.complaintCount,
      status: entity.status,
      payment: entity.payment,
    };
  }

  const entityMatchQuality = { exact: 0, alias: 0, manual: 0 };
  for (const entity of registerEntities) {
    entityMatchQuality[entity.matchMethod] = (entityMatchQuality[entity.matchMethod] ?? 0) + 1;
  }

  const totals = {
    entities: allEntities.length,
    matchedEntities: registerEntities.length,
    unmatchedEntities: orphanEntities.length,
    facilitiesWithLegal: registerEntities.length,
    cases: data.cases.length,
    pabNov: pabNovRows.length,
    pabNovPlaceholders: placeholderCount,
    orders: orderRows.length,
    pabOrders: pabOrderRows.length,
    erf: erfRows.length,
    pabPenalties: pabPenaltyRows.length,
    ra6969: ra6969Rows.length,
    complaints: complaintRows.length,
    openEntities: registerEntities.filter((entity) => entity.status === 'OPEN').length,
    closedEntities: registerEntities.filter((entity) => entity.status === 'CLOSED').length,
    pabCollected: pabByYear.reduce((sum, row) => sum + row.collected, 0),
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    dataDate: data.dataDate,
    fetchedAt: data.fetchedAt,
    sourceUrl: data.sourceUrl,
    scopeLabel: data.scopeLabel,
    timelineStart: data.timelineStart,
    docketYears: data.docketYears,
    matchQuality: { ...entityMatchQuality, unmatched: orphanEntities.length },
    totals,
    pabByYear,
    entities: registerEntities,
    orphans: orphanEntities,
    cases: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      type: entry.type,
      sourceYear: entry.sourceYear,
      year: entry.docketYear,
      caseNo: entry.caseNo,
      displayCaseNo: entry.displayCaseNo,
      rawCaseNo: entry.rawCaseNo,
      pabCaseNos: entry.pabCaseNos,
      iisRef: entry.iisRef,
      dateDocketed: entry.dateDocketed,
      establishment: entry.establishment,
      entityId: entry.facilityId ? `F:${entry.facilityId}` : `U:${entry.matchKey || normKey(entry.establishment) || 'UNKNOWN'}`,
      entityName: entry.entityName,
      municipality: entry.municipality,
      province: entry.province,
      address: entry.address,
      documentType: entry.documentType,
      stage: entry.stage,
      stageLabel: entry.stageLabel,
      violations: entry.violations,
      status: entry.status,
      payment: entry.payment,
      closedSignals: entry.closedSignals,
      openSignals: entry.openSignals,
      matchMethod: entry.matchMethod,
      types: entry.types,
    })),
    byFacility,
    candidateCount: candidateRows.length,
  };

  if (CHECK) {
    const problems = [];
    if (payload.totals.cases !== data.cases.length) problems.push('case count');
    if (payload.totals.pabNov !== pabNovRows.length) problems.push('PAB NOV count');
    if (payload.totals.erf !== erfRows.length) problems.push('ERF count');
    if (payload.totals.complaints !== complaintRows.length) problems.push('complaint count');
    if (!payload.entities.length) problems.push('no matched establishments');
    if (problems.length) {
      console.error(`Legal build check FAILED: ${problems.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log('Legal build check      OK');
    }
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload));
  await writeFile(
    REPORT_FILE,
    [
      'legal_name,legal_key,municipality,province,records,candidate,candidate_key,candidate_facility_id,score',
      ...candidateRows.map((row) =>
        [row.legalName, row.legalKey, row.municipality, row.province, row.records, row.candidate, row.candidateKey, row.candidateFacilityId, row.score.toFixed(3)]
          .map(csvCell)
          .join(','),
      ),
    ].join('\n'),
  );

  console.log(`Legal docket rows      ${entries.length.toLocaleString()}`);
  console.log(`Establishments matched ${registerEntities.length.toLocaleString()} (of ${allEntities.length.toLocaleString()})`);
  console.log(`Unmatched respondents  ${orphanEntities.length.toLocaleString()}`);
  console.log(
    `Match quality          ${entityMatchQuality.exact} exact · ${entityMatchQuality.alias} alias · ${entityMatchQuality.manual} manual · ${orphanEntities.length} unmatched`,
  );
  console.log(`PAB collected (2021-26) ₱${totals.pabCollected.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`);
  console.log(`Candidate review rows  ${candidateRows.length.toLocaleString()} → reports/legal-match-candidates.csv`);

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
