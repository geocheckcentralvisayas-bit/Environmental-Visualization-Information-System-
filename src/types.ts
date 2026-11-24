export type PermitType = 'DP' | 'PTO';
export type Lifecycle = 'Active' | 'Expiring' | 'Expired' | 'Unknown';
export type Scope = 'in' | 'out' | 'unknown';
export type ClearanceType = 'ECC' | 'CNC' | 'ECC/CNC';
export type RegisterId = 'DP' | 'PTO' | 'HW' | 'ECC' | 'CNC';

export interface SpatialFlags {
  flood?: string;
  slide?: string;
  pa?: string;
  ws?: string;
  lc?: string;
  land?: string;
}

export interface Permit {
  id: string;
  type: PermitType;
  permitNo: string;
  appNo: string;
  year: number;
  company: string;
  barangay: string;
  address: string;
  municipality: string;
  province: string;
  lguCode: string | null;
  scope: Scope;
  lat: number | null;
  lon: number | null;
  coordStatus: string;
  sourceStatus: string;
  lifecycle: Lifecycle;
  issued: string | null;
  expiry: string | null;
  paid: string | null;
  industry: string;
  psic: string;
  eccNo: string;
  waterbody: string;
  wastewater: string;
  volume: string;
  fee: string;
  pco: string;
  remarks: string;
  link: string;
  qa: string[];
  sourceSheet: string;
  sourceRow: number;
  workbook: string;
  siteId?: string;
  spatial?: SpatialFlags | null;
  risk?: number;
}

export type SiteGap =
  | 'both-active'
  | 'dp-active'
  | 'pto-active'
  | 'both-inactive'
  | 'dp-only'
  | 'pto-only'
  | 'hw-only';

export type MatchMethod = 'exact' | 'alias' | 'fuzzy' | 'core' | 'none';

export interface HwWasteCode {
  code: string;
  description: string;
  nature: string;
  catalogue: string;
  practice: string;
}

export interface HwRegistration {
  id: string;
  appNo: string;
  hwGrNo: string;
  company: string;
  municipality: string;
  province: string;
  barangay: string;
  address: string;
  lat: number | null;
  lon: number | null;
  coordStatus: string;
  scope: Scope;
  subtype: string;
  issued: string | null;
  expiry: string | null;
  lifecycle: Lifecycle;
  pco: string;
  caseHandler: string;
  pcoAccreditation: string;
  pcoAccreditationDate: string | null;
  employees: string;
  industry: string;
  psic: string;
  permitTypes: string[];
  eccNos: string[];
  cncNos: string[];
  ptoNos: string[];
  dpNos: string[];
  hwNumber: string;
  wasteCodes: HwWasteCode[];
  wasteCount: number;
  wasteRecordCounts: Record<string, number>;
  recordCount: number;
  siteId: string | null;
  matched: boolean;
  sourceRow: number;
  qa: string[];
}

export interface Clearance {
  id: string;
  number: string;
  type: ClearanceType;
  company: string;
  project?: string;
  municipality: string;
  province: string;
  barangay: string;
  address: string;
  lat: number | null;
  lon: number | null;
  scope: Scope;
  issued: string | null;
  expiry: string | null;
  lifecycle: Lifecycle;
  year: number | null;
  appNo: string;
  hwGrNo: string;
  siteId: string | null;
  siteIds?: string[];
  sources: string[];
  permitRefs: string[];
  hwCodes: string[];
}

export interface Site {
  id: string;
  company: string;
  key: string;
  municipality: string;
  province: string;
  barangay: string;
  address: string;
  lat: number | null;
  lon: number | null;
  coordStatus: string;
  dpCount: number;
  ptoCount: number;
  permitCount: number;
  years: number[];
  latestIssued: string | null;
  dpExpiry: string | null;
  ptoExpiry: string | null;
  activeDP: boolean;
  activePTO: boolean;
  gap: SiteGap;
  matchMethod: MatchMethod;
  matchType: 'both' | 'dp' | 'pto' | 'hw';
  industry: string;
  scope: Scope;
  spatial: SpatialFlags | null;
  risk: number;
  hwCount: number;
  hwGrNos: string[];
  hwExpiry: string | null;
  activeHW: boolean;
  hwCodeCount: number;
  eccNos: string[];
  cncNos: string[];
  ambiguousNos: string[];
  eccCount: number;
  cncCount: number;
  ambiguousCount: number;
  clearanceCount: number;
}

export interface CountItem {
  name: string;
  count: number;
}

/**
 * One map marker: every register held by an establishment at one location.
 * Grouped at build time from sites plus orphan clearances.
 */
export interface Facility {
  id: string;
  company: string;
  aliases: string[];
  key: string;
  lat: number;
  lon: number;
  coordStatus: string;
  municipality: string;
  province: string;
  barangay: string;
  address: string;
  scope: Scope;
  risk: number;
  siteId: string | null;
  siteIds: string[];
  gap: SiteGap | null;
  matchType: 'both' | 'dp' | 'pto' | 'hw' | null;
  registers: RegisterId[];
  counts: Record<RegisterId, number>;
  totalRecords: number;
  years: number[];
  latestIssued: string | null;
  activeDP: boolean;
  activePTO: boolean;
  activeHW: boolean;
  clearanceNumbers: string[];
}

export interface SourceTab {
  key: string;
  workbook: string;
  sheet: string;
  gid?: string;
  type: PermitType | null;
  rows: number;
  columns?: number;
  file?: string;
  error?: string;
}

export interface Meta {
  generatedAt: string;
  referenceDate: string;
  sources: {
    fetchedAt: string;
    workbooks: Record<string, { id: string; label: string; url: string }>;
    tabs: SourceTab[];
  };
  totals: {
    permits: number;
    dp: number;
    pto: number;
    sites: number;
    bothSites: number;
    dpOnlySites: number;
    ptoOnlySites: number;
    inScope: number;
    outOfScope: number;
    unknownScope: number;
    plotted: number;
    screened: number;
    active: number;
    expiring: number;
    expired: number;
    unknownExpiry: number;
    crossMatchedSites: number;
    riskSites: number;
    sourceRows: number;
    duplicates: number;
    skippedRows: number;
    hwOnlySites: number;
    hwSites: number;
    hwRegistrations: number;
    hwWasteRows: number;
    hwGenerators: number;
    hwActive: number;
    hwExpiring: number;
    hwExpired: number;
    hwUnknown: number;
    matchedHw: number;
    clearanceSites: number;
    clearances: number;
    eccClearances: number;
    cncClearances: number;
    ambiguousClearances: number;
    facilities: number;
    multiRegisterFacilities: number;
    coordinatesKept: number;
    coordinatesCorrected: number;
    coordinatesApproximate: number;
    coordinatesUnresolved: number;
  };
  years: number[];
  provinces: CountItem[];
  lgus: { municipality: string; province: string; count: number }[];
  industries: CountItem[];
  statuses: CountItem[];
  lifecycles: CountItem[];
  qa: CountItem[];
  audit: { rows: number; byAction: CountItem[]; byField: CountItem[] };
  issues: { total: number; byType: CountItem[]; byAction: CountItem[] };
  reviewQueue: {
    type: string;
    year: string;
    permitNo: string;
    company: string;
    municipality: string;
    province: string;
    issue: string;
    action: string;
  }[];
  notes: string[];
  hwWasteCodes?: CountItem[];
  hwIndustries?: CountItem[];
  clearanceSources?: CountItem[];
  clearanceByLgu?: { municipality: string; province: string; count: number }[];
}

export interface QualityData {
  audit: {
    at: string;
    type: string;
    year: string;
    permitNo: string;
    company: string;
    field: string;
    original: string;
    clean: string;
    action: string;
    reason: string;
  }[];
  reviewQueue: Meta['reviewQueue'];
  duplicates: {
    permitNo: string;
    type: string;
    keptFrom: string;
    droppedFrom: string;
    company: string;
  }[];
  skipped: {
    tab: string;
    row: number;
    permitNo: string;
    company: string;
    reason: string;
  }[];
}

export interface LayerClass {
  label: string;
  color: string;
  rank?: number;
}

export interface SpatialLayer {
  id: string;
  name: string;
  group: string;
  file: string;
  geometry: string;
  count: number;
  sizeBytes: number;
  bbox: number[];
  classes: string[];
  classMeta: Record<string, LayerClass> | null;
  style: {
    kind: 'outline' | 'classified';
    color?: string;
    weight?: number;
    fillOpacity?: number;
    field?: string;
  };
  description: string;
}

export interface LayerManifest {
  generatedAt: string;
  totalBytes: number;
  layers: SpatialLayer[];
}

export interface Dataset {
  permits: Permit[];
  sites: Site[];
  meta: Meta;
  quality: QualityData;
  layers: LayerManifest;
  hw: HwRegistration[];
  clearances: Clearance[];
  facilities: Facility[];
}

export type LegalPayment = 'PAID' | 'PENDING' | 'MIXED' | 'NONE';
export type LegalStatus = 'CLOSED' | 'OPEN' | 'PARTIAL' | 'UNKNOWN';
export type LegalMatchMethod = 'exact' | 'alias' | 'manual' | 'unmatched';
export type LegalCoverage = 'full' | 'partial' | 'none';

export interface LegalEntity {
  id: string;
  name: string;
  legalNames: string[];
  facilityId: string | null;
  siteId: string | null;
  municipality: string;
  province: string;
  barangay: string;
  registers: RegisterId[];
  matchMethod: LegalMatchMethod;
  lat: number | null;
  lon: number | null;
  coordStatus: string | null;
  cases: number;
  novCount: number;
  pabNovCount: number;
  orderCount: number;
  pabOrderCount: number;
  erfCount: number;
  pabPenaltyCount: number;
  complaintCount: number;
  ra6969Count: number;
  recordCount: number;
  paidCases: number;
  pendingCases: number;
  openCases: number;
  closedCases: number;
  unknownCases: number;
  years: string[];
  caseNos: string[];
  latestYear: string | null;
  status: LegalStatus;
  payment: LegalPayment;
}

export interface LegalCase {
  id: string;
  kind: string;
  type: string;
  sourceYear: string;
  year: string;
  caseNo: string;
  displayCaseNo: string;
  rawCaseNo: string;
  pabCaseNos: string[];
  iisRef: string;
  dateDocketed: string;
  establishment: string;
  entityId: string;
  entityName: string | null;
  municipality: string;
  province: string;
  address: string;
  documentType: string;
  stage: string;
  stageLabel: string;
  violations: string[];
  status: LegalStatus;
  payment: LegalPayment;
  closedSignals: string[];
  openSignals: string[];
  matchMethod: LegalMatchMethod;
  types: {
    nov: number;
    pabNov: number;
    order: number;
    pabOrder: number;
    erf: number;
    pabPenalty: number;
    complaint: number;
    ra6969: number;
  };
}

export interface LegalPabYear {
  year: string;
  coverage: LegalCoverage;
  note: string;
  pabNovIssued: number;
  pabOrders: number;
  pabOrdersWithPenalty: number;
  ordersAssessed: number;
  penaltyRecords: number;
  paid: number;
  pending: number;
  assessed: number;
  collected: number;
  erfRecords: number;
  erfPaid: number;
  erfPending: number;
  erfCollected: number;
  ra6969Records: number;
  ra6969Collected: number;
}

export interface LegalFacilitySummary {
  entityId: string;
  cases: number;
  records: number;
  open: number;
  closed: number;
  pab: number;
  erf: number;
  complaints: number;
  status: LegalStatus;
  payment: LegalPayment;
}

export interface LegalData {
  generatedAt: string;
  dataDate: string;
  fetchedAt: string;
  sourceUrl: string;
  scopeLabel: string;
  timelineStart: string;
  docketYears: string[];
  matchQuality: { exact: number; alias: number; manual: number; unmatched: number };
  totals: {
    entities: number;
    matchedEntities: number;
    unmatchedEntities: number;
    facilitiesWithLegal: number;
    cases: number;
    pabNov: number;
    pabNovPlaceholders: number;
    orders: number;
    pabOrders: number;
    erf: number;
    pabPenalties: number;
    ra6969: number;
    complaints: number;
    openEntities: number;
    closedEntities: number;
    pabCollected: number;
  };
  pabByYear: LegalPabYear[];
  entities: LegalEntity[];
  orphans: LegalEntity[];
  cases: LegalCase[];
  byFacility: Record<string, LegalFacilitySummary>;
  candidateCount: number;
}

export type EccUltraKind = 'ECC' | 'CNC';
export type EccUltraMatchMethod = 'number' | 'exact' | 'alias' | 'none';

export interface EccUltraRecord {
  id: string;
  kind: EccUltraKind;
  number: string;
  project: string;
  proponent: string;
  address: string;
  barangay: string;
  municipality: string;
  province: string;
  region: string;
  issued: string | null;
  year: number | null;
  status: string;
  applicationType: string;
  projectType: string;
  sizeAmount: string;
  sizeUnit: string;
  landArea: string;
  lat: number | null;
  lon: number | null;
  coordSource: string;
  withinPa: string;
  government: string;
  amendment: string;
  plotted: string;
  remarks: string;
  iis: string;
  sources: string[];
  matchMethod: EccUltraMatchMethod;
  matched: boolean;
  siteIds: string[];
  siteCount: number;
  permitNos: string[];
  hwNos: string[];
  dpCount: number;
  ptoCount: number;
  hwCount: number;
  rowCount: number;
}

export interface EccUltraSourceStat {
  key: string;
  sheet: string;
  fetchedRows: number;
  keptRows: number;
  excludedNegros: number;
  excludedSiquijor: number;
  excludedOther: number;
  excludedBlank: number;
}

export interface EccUltraData {
  generatedAt: string;
  referenceDate: string;
  sourceUrl: string;
  scopeLabel: string;
  sources: EccUltraSourceStat[];
  totals: {
    records: number;
    ecc: number;
    cnc: number;
    cebu: number;
    bohol: number;
    matched: number;
    unmatched: number;
    linkedDp: number;
    linkedPto: number;
    linkedHw: number;
    linkedSites: number;
    active: number;
  };
  matchQuality: { number: number; exact: number; alias: number; none: number };
  byYear: { year: number; ecc: number; cnc: number }[];
  byMunicipality: { municipality: string; province: string; count: number }[];
  byProjectType: CountItem[];
  byStatus: CountItem[];
  bySource: CountItem[];
  fields?: string[];
  records: EccUltraRecord[];
  notes: string[];
}

export type PageId =
  | 'overview'
  | 'sites'
  | 'dp'
  | 'pto'
  | 'renewal'
  | 'map'
  | 'spatial'
  | 'screening'
  | 'quality'
  | 'tables'
  | 'reports'
  | 'about'
  | 'hw'
  | 'clearances'
  | 'ecc-ultralist'
  | 'admin'
  | 'legal'
  | 'pco-corner'
  | 'swm'
  | 'ambient'
  | 'emed'
  | 'planning'
  | 'pixel-office';

export type Role = 'extraction' | 'rd' | 'emed' | 'cpd' | 'mis' | 'viewer' | 'gis';

export interface Session {
  username: string;
  role: Role;
  displayName: string;
  division: string;
  at: number;
}

// PCO Types
export interface PCORecord {
  id: number;
  evaluator: string;
  pco: string;
  type: 'New' | 'Renewal';
  status: string;
  establishment: string;
  address: string;
  natureOfBusiness: string;
  category: string;
  dateCreated: string | null;
  dateApproved: string | null;
  remarks?: string;
}

export interface PCOCompanySummary {
  pco: string;
  evaluator: string;
  totalRecords: number;
  newCount: number;
  renewalCount: number;
  companies: number;
  establishments: {
    establishment: string;
    address: string;
    natureOfBusiness: string;
    category: string;
    type: 'New' | 'Renewal';
    dateApproved: string | null;
  }[];
  municipalities: string[];
  industries: string[];
}

export interface PCOPermitCrossRef {
  pco: string;
  company: string;
  establishment: string;
  permitType: 'DP' | 'PTO';
  permitNo: string;
  permitStatus: string;
  permitExpiry: string | null;
  hwRegistrations: {
    hwGrNo: string;
    hwStatus: string;
    hwExpiry: string | null;
  }[];
  clearances: {
    number: string;
    type: string;
    status: string;
  }[];
  matchConfidence: 'high' | 'medium' | 'low';
}

export interface PCOAnalysis {
  generatedAt: string;
  referenceDate: string;
  totals: {
    pcoRecords: number;
    uniquePCOs: number;
    uniqueEvaluators: number;
    uniqueEstablishments: number;
    newAccreditations: number;
    renewals: number;
    categoryA: number;
    categoryB: number;
  };
  byPCO: PCOCompanySummary[];
  crossReferences: PCOPermitCrossRef[];
  unmatchedPCOs: {
    pco: string;
    establishment: string;
    reason: string;
  }[];
  expiringSoon: {
    pco: string;
    establishment: string;
    type: 'permit' | 'hw' | 'pco-accreditation';
    expiryDate: string;
    daysUntilExpiry: number;
  }[];
}

export interface Dataset {
  permits: Permit[];
  sites: Site[];
  meta: Meta;
  quality: QualityData;
  layers: LayerManifest;
  hw: HwRegistration[];
  clearances: Clearance[];
  facilities: Facility[];
  legal: LegalData;
}

export interface Filters {
  year: number | 'all';
  province: string | 'all';
  lifecycle: string | 'all';
  scope: 'in' | 'all' | 'out';
  type: 'all' | 'DP' | 'PTO';
  search: string;
}

export interface MapFocus {
  lat: number;
  lon: number;
  label: string;
  siteId: string | null;
  nonce: number;
}

export interface FocusTarget {
  lat: number | null | undefined;
  lon: number | null | undefined;
  label: string;
  siteId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Solid Waste Management (MRF register)                               */
/* ------------------------------------------------------------------ */

export type SwmStatus = 'Operational' | 'Non-Operational';
export type SwmCoordStatus = 'ok' | 'missing' | 'invalid';

export interface SwmRecord {
  id: string;
  province: string;
  lgu: string;
  lguKey: string;
  barangay: string;
  status: SwmStatus;
  txn: string;
  lat: number | null;
  lon: number | null;
  coordStatus: SwmCoordStatus;
  coordNote: string | null;
  facilityKey: string;
}

export interface SwmFacility {
  key: string;
  province: string;
  lgu: string;
  lguKey: string;
  status: SwmStatus;
  lat: number | null;
  lon: number | null;
  coordStatus: SwmCoordStatus;
  coordNote: string | null;
  barangays: string[];
  recordCount: number;
}

export interface SwmLgu {
  province: string;
  name: string;
  key: string;
  records: number;
  operational: number;
  nonOperational: number;
  facilities: number;
  coverage: 'operational' | 'non-operational' | 'none';
  inUniverse: boolean;
}

export interface SwmProvinceSummary {
  name: string;
  lgusTotal: number;
  lgusWithRecords: number;
  lgusWithOperational: number;
  lgusZeroOperational: number;
  records: number;
  operational: number;
  nonOperational: number;
  facilities: number;
}

export interface SwmSummary {
  records: number;
  facilities: number;
  operational: number;
  nonOperational: number;
  operationalRate: number;
  multiBarangayFacilities: number;
  lgusTotal: number;
  lgusWithRecords: number;
  lgusWithOperational: number;
  lgusZeroOperational: number;
  lgusWithoutRecords: number;
  missingCoordinates: number;
  sharedCoordinateFacilities: number;
}

export interface SwmDataset {
  generatedAt: string;
  source: {
    file: string;
    workbook: string;
    system: string;
    scope: string;
    rowsParsed: number;
    recordsKept: number;
    pivotRowsRemoved: number;
    excludedByProvince: Record<string, number>;
    note: string;
  };
  summary: SwmSummary;
  provinces: SwmProvinceSummary[];
  lgus: SwmLgu[];
  facilities: SwmFacility[];
  records: SwmRecord[];
  unmatched: string[];
  disposal: SwmDisposal;
  workbook: SwmWorkbook;
}

/* ------------------------------------------------------------------ */
/* SWM Overall Database workbook (WACS, compliance, contacts, lookups)  */
/* ------------------------------------------------------------------ */

export type SwmComplianceFlag = 'compliant' | 'non-compliant' | 'na';

export interface SwmWacsRecord {
  province: string;
  lgu: string;
  lguKey: string;
  bioKgDay: number | null;
  recyclableKgDay: number | null;
  diversionKgDay: number | null;
  residualKgDay: number | null;
  specialKgDay: number | null;
  totalKgDay: number | null;
  population2015: number | null;
  growthRate: number | null;
  pcgKgDay: number | null;
  wacsYear: number | null;
  projected2025KgDay: number | null;
  projectedBioKgDay: number | null;
  projectedRecyclableKgDay: number | null;
  projectedResidualKgDay: number | null;
  projectedSpecialKgDay: number | null;
  disposalFacility: string;
}

export interface SwmWacsSummary {
  lgus: number;
  totalKgDay: number;
  projected2025KgDay: number;
  population2015: number;
  avgPcgKgDay: number;
  composition: { bio: number; recyclable: number; residual: number; special: number };
  byProvince: Array<{ name: string; lgus: number; totalKgDay: number; projected2025KgDay: number; population2015: number }>;
  byYear: Array<{ year: number | string; lgus: number; totalKgDay: number }>;
  byDisposal: Array<{ name: string; lgus: number; totalKgDay: number }>;
}

export interface SwmContact {
  province: string;
  lgu: string;
  lguKey: string;
  type: string;
  district: string;
  mayor: string;
  mayorContact: string;
  mayorEmail: string;
  mayorParty: string;
  viceMayor: string;
  viceMayorContact: string;
  viceMayorEmail: string;
  focal: string;
  focalPosition: string;
  focalContact: string;
  focalEmail: string;
  incomeClass: string;
  barangays: number | null;
  address: string;
  zip: string;
}

export interface SwmComplianceCriterion {
  key: string;
  label: string;
  status: SwmComplianceFlag;
}

export interface SwmComplianceRecord {
  id: string;
  province: string;
  lgu: string;
  lguKey: string;
  district: string;
  type: string;
  hall: string;
  location: string;
  zip: string;
  dumpsiteStatus: string;
  scrpStatus: string;
  disposalFacility: string;
  disposalAddress: string;
  planStatus: string;
  overall: string;
  criteria: SwmComplianceCriterion[];
  fundedMrfStatus?: string;
  fundedMrfLocation?: string;
  equipment?: string;
  equipmentStatus?: string;
  planStart?: number | null;
  planEnd?: number | null;
  equipment2020?: string;
  equipment2021?: string;
  equipment2022?: string;
  overallStatus?: string;
}

export interface SwmComplianceSummary {
  lgus: number;
  byStatus: Record<string, number>;
  byProvince: Array<{ name: string; lgus: number }>;
  compliant: number;
  nonCompliant: number;
  criteria: Array<{ key: string; label: string; compliant: number; 'non-compliant': number; na: number }>;
}

export interface SwmComplianceSet {
  available: boolean;
  records: SwmComplianceRecord[];
  summary: SwmComplianceSummary | null;
}

export interface SwmReferenceList {
  key: string;
  label: string;
  values: string[];
}

export interface SwmWorkbook {
  available: boolean;
  note: string;
  wacs: { available: boolean; records: SwmWacsRecord[]; summary: SwmWacsSummary | null };
  compliance: { current: SwmComplianceSet; old: SwmComplianceSet };
  contacts: {
    available: boolean;
    records: SwmContact[];
    summary: {
      lgus: number;
      byProvince: Array<{ name: string; lgus: number }>;
      withMayor: number;
      withViceMayor: number;
      withFocal: number;
    } | null;
  };
  database: { available: boolean; lists: SwmReferenceList[] };
}

/* ------------------------------------------------------------------ */
/* Ambient air quality monitoring (AQMS)                               */
/* ------------------------------------------------------------------ */

export interface AqmsStation {
  id: string;
  name: string;
  type: string;
  address: string;
  sourceName: string;
  lat: number;
  lon: number;
  status: string;
}

export interface AqmsReading {
  station: string;
  date: string;
  hour: number;
  timestamp: string;
  pm25: number | null;
  pm25Status: string;
  pm10: number | null;
  pm10Status: string;
}

export interface AqmsManualRecord {
  station: string;
  sourceStation: string;
  category: string;
  address: string;
  year: number;
  month: string;
  date: string;
  aqi: number;
  legend: string;
}

export interface AqmsStationSummary {
  readings: number;
  avgPm25: number | null;
  avgPm10: number | null;
  latest: AqmsReading | null;
}

export interface AqmsDataset {
  generatedAt: string;
  source: {
    name: string;
    sheetId: string;
    url: string;
    tabs: string[];
    note: string;
  };
  summary: {
    stations: number;
    continuousReadings: number;
    manualReadings: number;
    from: string | null;
    to: string | null;
    liveAt: string | null;
    byStatus: Array<{ name: string; count: number }>;
    byStation: Record<string, AqmsStationSummary>;
    manualByStation: Array<{ name: string; count: number }>;
    manualByYear: Array<{ year: number; count: number }>;
  };
  stations: AqmsStation[];
  continuous: AqmsReading[];
  manual: AqmsManualRecord[];
}

export interface AqmsLivePayload {
  generatedAt: string;
  source: string;
  readings: AqmsReading[];
  stale?: boolean;
  cachedAt?: string;
  warning?: string;
}

export type SwmDisposalCategory = 'landfill' | 'dumpsite' | 'transfer';

export interface SwmDisposalProject {
  id: string;
  category: SwmDisposalCategory;
  name: string;
  proponent: string;
  lgu: string;
  province: string;
  barangay: string;
  kind: string;
  ref: string;
  status: string;
  year: number | null;
  lat: number | null;
  lon: number | null;
  mapped: boolean;
}

export interface SwmDisposalCategorySummary {
  key: SwmDisposalCategory;
  label: string;
  tone: string;
  count: number;
  mapped: number;
}

export interface SwmDisposal {
  available: boolean;
  source: string;
  coverage: Record<string, 'covered' | 'no-data'>;
  categories: SwmDisposalCategorySummary[];
  projects: SwmDisposalProject[];
  note: string;
}
