import { z } from 'zod';

/**
 * Zod schemas for validating output JSON files.
 * These mirror the TypeScript types in src/types.ts and should be kept in sync.
 */

// Base schemas
export const SpatialFlagsSchema = z.object({
  flood: z.string().optional(),
  slide: z.string().optional(),
  pa: z.string().optional(),
  ws: z.string().optional(),
  lc: z.string().optional(),
  land: z.string().optional(),
}).optional();

export const PermitSchema = z.object({
  id: z.string(),
  type: z.enum(['DP', 'PTO']),
  permitNo: z.string(),
  appNo: z.string(),
  year: z.number().int(),
  company: z.string(),
  barangay: z.string(),
  address: z.string(),
  municipality: z.string(),
  province: z.string(),
  lguCode: z.string().nullable(),
  scope: z.enum(['in', 'out', 'unknown']),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  coordStatus: z.string(),
  sourceStatus: z.string(),
  lifecycle: z.enum(['Active', 'Expiring', 'Expired', 'Unknown']),
  issued: z.string().nullable(),
  expiry: z.string().nullable(),
  paid: z.string().nullable(),
  industry: z.string(),
  psic: z.string(),
  eccNo: z.string(),
  waterbody: z.string(),
  wastewater: z.string(),
  volume: z.string(),
  fee: z.string(),
  pco: z.string(),
  remarks: z.string(),
  link: z.string(),
  qa: z.array(z.string()),
  sourceSheet: z.string(),
  sourceRow: z.number().int(),
  workbook: z.string(),
  siteId: z.string().optional(),
  spatial: SpatialFlagsSchema.nullable(),
  risk: z.number().int().optional(),
});

export const HwWasteCodeSchema = z.object({
  code: z.string(),
  description: z.string(),
  nature: z.string(),
  catalogue: z.string(),
  practice: z.string(),
});

export const HwRegistrationSchema = z.object({
  id: z.string(),
  appNo: z.string(),
  hwGrNo: z.string(),
  company: z.string(),
  municipality: z.string(),
  province: z.string(),
  barangay: z.string(),
  address: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  coordStatus: z.string(),
  scope: z.enum(['in', 'out', 'unknown']),
  subtype: z.string(),
  issued: z.string().nullable(),
  expiry: z.string().nullable(),
  lifecycle: z.enum(['Active', 'Expiring', 'Expired', 'Unknown']),
  pco: z.string(),
  caseHandler: z.string(),
  pcoAccreditation: z.string(),
  pcoAccreditationDate: z.string().nullable(),
  employees: z.string(),
  industry: z.string(),
  psic: z.string(),
  permitTypes: z.array(z.string()),
  eccNos: z.array(z.string()),
  cncNos: z.array(z.string()),
  ptoNos: z.array(z.string()),
  dpNos: z.array(z.string()),
  hwNumber: z.string(),
  wasteCodes: z.array(HwWasteCodeSchema),
  wasteCount: z.number().int(),
  wasteRecordCounts: z.record(z.number().int()),
  recordCount: z.number().int(),
  siteId: z.string().nullable(),
  matched: z.boolean(),
  sourceRow: z.number().int(),
  qa: z.array(z.string()),
});

export const ClearanceSchema = z.object({
  id: z.string(),
  number: z.string(),
  type: z.enum(['ECC', 'CNC', 'ECC/CNC']),
  company: z.string(),
  municipality: z.string(),
  province: z.string(),
  barangay: z.string(),
  address: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  scope: z.enum(['in', 'out', 'unknown']),
  issued: z.string().nullable(),
  expiry: z.string().nullable(),
  lifecycle: z.enum(['Active', 'Expiring', 'Expired', 'Unknown']),
  year: z.number().int().nullable(),
  appNo: z.string(),
  hwGrNo: z.string(),
  siteId: z.string().nullable(),
  sources: z.array(z.string()),
  permitRefs: z.array(z.string()),
  hwCodes: z.array(z.string()),
});

export const SiteGapSchema = z.enum([
  'both-active', 'dp-active', 'pto-active', 'both-inactive',
  'dp-only', 'pto-only', 'hw-only',
]);

export const MatchMethodSchema = z.enum(['exact', 'alias', 'fuzzy', 'core', 'none']);

export const SiteSchema = z.object({
  id: z.string(),
  company: z.string(),
  key: z.string(),
  municipality: z.string(),
  province: z.string(),
  barangay: z.string(),
  address: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  coordStatus: z.string(),
  dpCount: z.number().int(),
  ptoCount: z.number().int(),
  permitCount: z.number().int(),
  years: z.array(z.number().int()),
  latestIssued: z.string().nullable(),
  dpExpiry: z.string().nullable(),
  ptoExpiry: z.string().nullable(),
  activeDP: z.boolean(),
  activePTO: z.boolean(),
  gap: SiteGapSchema,
  matchMethod: MatchMethodSchema,
  matchType: z.enum(['both', 'dp', 'pto', 'hw']),
  industry: z.string(),
  scope: z.enum(['in', 'out', 'unknown']),
  spatial: SpatialFlagsSchema.nullable(),
  risk: z.number().int(),
  hwCount: z.number().int(),
  hwGrNos: z.array(z.string()),
  hwExpiry: z.string().nullable(),
  activeHW: z.boolean(),
  hwCodeCount: z.number().int(),
  eccNos: z.array(z.string()),
  cncNos: z.array(z.string()),
  ambiguousNos: z.array(z.string()),
  eccCount: z.number().int(),
  cncCount: z.number().int(),
  ambiguousCount: z.number().int(),
  clearanceCount: z.number().int(),
});

export const CountItemSchema = z.object({
  name: z.string(),
  count: z.number().int(),
});

export const SourceTabSchema = z.object({
  key: z.string(),
  workbook: z.string(),
  sheet: z.string(),
  gid: z.string().optional(),
  type: z.enum(['DP', 'PTO']).nullable(),
  rows: z.number().int(),
  columns: z.number().int().optional(),
  file: z.string().optional(),
  error: z.string().optional(),
});

export const WorkbookSchema = z.object({
  id: z.string().optional(),
  label: z.string(),
  url: z.string().optional(),
});

export const MetaSchema = z.object({
  generatedAt: z.string(),
  referenceDate: z.string(),
  sources: z.object({
    fetchedAt: z.string(),
    workbooks: z.record(WorkbookSchema),
    tabs: z.array(SourceTabSchema),
  }),
  totals: z.object({
    permits: z.number().int(),
    dp: z.number().int(),
    pto: z.number().int(),
    sites: z.number().int(),
    bothSites: z.number().int(),
    dpOnlySites: z.number().int(),
    ptoOnlySites: z.number().int(),
    hwOnlySites: z.number().int(),
    hwSites: z.number().int(),
    hwRegistrations: z.number().int(),
    hwWasteRows: z.number().int(),
    hwGenerators: z.number().int(),
    hwActive: z.number().int(),
    hwExpiring: z.number().int(),
    hwExpired: z.number().int(),
    hwUnknown: z.number().int(),
    matchedHw: z.number().int(),
    clearanceSites: z.number().int(),
    clearances: z.number().int(),
    facilities: z.number().int(),
    multiRegisterFacilities: z.number().int(),
    eccClearances: z.number().int(),
    cncClearances: z.number().int(),
    ambiguousClearances: z.number().int(),
    inScope: z.number().int(),
    outOfScope: z.number().int(),
    unknownScope: z.number().int(),
    plotted: z.number().int(),
    coordinatesKept: z.number().int(),
    coordinatesCorrected: z.number().int(),
    coordinatesApproximate: z.number().int(),
    coordinatesUnresolved: z.number().int(),
    screened: z.number().int(),
    active: z.number().int(),
    expiring: z.number().int(),
    expired: z.number().int(),
    unknownExpiry: z.number().int(),
    crossMatchedSites: z.number().int(),
    riskSites: z.number().int(),
    sourceRows: z.number().int(),
    duplicates: z.number().int(),
    skippedRows: z.number().int(),
  }),
  years: z.array(z.number().int()),
  provinces: z.array(CountItemSchema),
  lgus: z.array(z.object({
    municipality: z.string(),
    province: z.string(),
    count: z.number().int(),
  })),
  industries: z.array(CountItemSchema),
  statuses: z.array(CountItemSchema),
  lifecycles: z.array(CountItemSchema),
  qa: z.array(CountItemSchema),
  audit: z.object({
    rows: z.number().int(),
    byAction: z.array(CountItemSchema),
    byField: z.array(CountItemSchema),
  }),
  issues: z.object({
    total: z.number().int(),
    byType: z.array(CountItemSchema),
    byAction: z.array(CountItemSchema),
  }),
  reviewQueue: z.array(z.object({
    type: z.string(),
    year: z.string(),
    permitNo: z.string(),
    company: z.string(),
    municipality: z.string(),
    province: z.string(),
    issue: z.string(),
    action: z.string(),
  })),
  notes: z.array(z.string()),
  hwWasteCodes: z.array(CountItemSchema).optional(),
  hwIndustries: z.array(CountItemSchema).optional(),
  clearanceSources: z.array(CountItemSchema).optional(),
});

export const QualityDataSchema = z.object({
  audit: z.array(z.object({
    at: z.string(),
    type: z.string(),
    year: z.string(),
    permitNo: z.string(),
    company: z.string(),
    field: z.string(),
    original: z.string(),
    clean: z.string(),
    action: z.string(),
    reason: z.string(),
  })),
  reviewQueue: MetaSchema.shape.reviewQueue,
  duplicates: z.array(z.object({
    permitNo: z.string(),
    type: z.string(),
    keptFrom: z.string(),
    droppedFrom: z.string(),
    company: z.string(),
  })),
  skipped: z.array(z.object({
    tab: z.string(),
    row: z.number().int(),
    permitNo: z.string(),
    company: z.string(),
    reason: z.string(),
  })),
});

export const LayerClassSchema = z.object({
  label: z.string(),
  color: z.string(),
  rank: z.number().int().optional(),
});

export const SpatialLayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  file: z.string(),
  geometry: z.string(),
  count: z.number().int(),
  sizeBytes: z.number().int(),
  bbox: z.array(z.number()),
  classes: z.array(z.string()),
  classMeta: z.record(LayerClassSchema).nullable(),
  style: z.object({
    kind: z.enum(['outline', 'classified']),
    color: z.string().optional(),
    weight: z.number().optional(),
    fillOpacity: z.number().optional(),
    field: z.string().optional(),
  }),
  description: z.string(),
});

export const LayerManifestSchema = z.object({
  generatedAt: z.string(),
  totalBytes: z.number().int(),
  layers: z.array(SpatialLayerSchema),
});

export const FacilitySchema = z.object({
  id: z.string(),
  company: z.string(),
  aliases: z.array(z.string()),
  key: z.string(),
  lat: z.number(),
  lon: z.number(),
  coordStatus: z.string(),
  municipality: z.string(),
  province: z.string(),
  barangay: z.string(),
  address: z.string(),
  scope: z.enum(['in', 'out', 'unknown']),
  risk: z.number().int(),
  siteId: z.string().nullable(),
  siteIds: z.array(z.string()),
  gap: SiteGapSchema.nullable(),
  matchType: z.enum(['both', 'dp', 'pto', 'hw']).nullable(),
  registers: z.array(z.enum(['DP', 'PTO', 'HW', 'ECC', 'CNC'])),
  counts: z.record(z.enum(['DP', 'PTO', 'HW', 'ECC', 'CNC']), z.number().int()),
  totalRecords: z.number().int(),
  years: z.array(z.number().int()),
  latestIssued: z.string().nullable(),
  activeDP: z.boolean(),
  activePTO: z.boolean(),
  activeHW: z.boolean(),
  clearanceNumbers: z.array(z.string()),
});

// Legal schemas
export const LegalPaymentSchema = z.enum(['PAID', 'PENDING', 'MIXED', 'NONE']);
export const LegalStatusSchema = z.enum(['CLOSED', 'OPEN', 'PARTIAL', 'UNKNOWN']);
export const LegalMatchMethodSchema = z.enum(['exact', 'alias', 'manual', 'unmatched']);
export const LegalCoverageSchema = z.enum(['full', 'partial', 'none']);

export const LegalEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  legalNames: z.array(z.string()),
  facilityId: z.string().nullable(),
  siteId: z.string().nullable(),
  municipality: z.string(),
  province: z.string(),
  barangay: z.string(),
  registers: z.array(z.enum(['DP', 'PTO', 'HW', 'ECC', 'CNC'])),
  matchMethod: LegalMatchMethodSchema,
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  coordStatus: z.string().nullable(),
  cases: z.number().int(),
  novCount: z.number().int(),
  pabNovCount: z.number().int(),
  orderCount: z.number().int(),
  pabOrderCount: z.number().int(),
  erfCount: z.number().int(),
  pabPenaltyCount: z.number().int(),
  complaintCount: z.number().int(),
  ra6969Count: z.number().int(),
  recordCount: z.number().int(),
  paidCases: z.number().int(),
  pendingCases: z.number().int(),
  openCases: z.number().int(),
  closedCases: z.number().int(),
  unknownCases: z.number().int(),
  years: z.array(z.string()),
  caseNos: z.array(z.string()),
  latestYear: z.string().nullable(),
  status: LegalStatusSchema,
  payment: LegalPaymentSchema,
});

export const LegalCaseSchema = z.object({
  id: z.string(),
  kind: z.string(),
  type: z.string(),
  sourceYear: z.string(),
  year: z.string(),
  caseNo: z.string(),
  displayCaseNo: z.string(),
  rawCaseNo: z.string(),
  pabCaseNos: z.array(z.string()),
  iisRef: z.string(),
  dateDocketed: z.string(),
  establishment: z.string(),
  entityId: z.string(),
  entityName: z.string().nullable(),
  municipality: z.string(),
  province: z.string(),
  address: z.string(),
  documentType: z.string(),
  stage: z.string(),
  stageLabel: z.string(),
  violations: z.array(z.string()),
  status: LegalStatusSchema,
  payment: LegalPaymentSchema,
  closedSignals: z.array(z.string()),
  openSignals: z.array(z.string()),
  matchMethod: LegalMatchMethodSchema,
  types: z.object({
    nov: z.number().int(),
    pabNov: z.number().int(),
    order: z.number().int(),
    pabOrder: z.number().int(),
    erf: z.number().int(),
    pabPenalty: z.number().int(),
    complaint: z.number().int(),
    ra6969: z.number().int(),
  }),
});

export const LegalPabYearSchema = z.object({
  year: z.string(),
  coverage: LegalCoverageSchema,
  note: z.string(),
  pabNovIssued: z.number(),
  pabOrders: z.number(),
  pabOrdersWithPenalty: z.number(),
  ordersAssessed: z.number(),
  penaltyRecords: z.number(),
  paid: z.number(),
  pending: z.number(),
  assessed: z.number(),
  collected: z.number(),
  erfRecords: z.number(),
  erfPaid: z.number(),
  erfPending: z.number(),
  erfCollected: z.number(),
  ra6969Records: z.number(),
  ra6969Collected: z.number(),
});

export const LegalFacilitySummarySchema = z.object({
  entityId: z.string(),
  cases: z.number().int(),
  records: z.number().int(),
  open: z.number().int(),
  closed: z.number().int(),
  pab: z.number().int(),
  erf: z.number().int(),
  complaints: z.number().int(),
  status: LegalStatusSchema,
  payment: LegalPaymentSchema,
});

export const LegalDataSchema = z.object({
  generatedAt: z.string(),
  dataDate: z.string(),
  fetchedAt: z.string(),
  sourceUrl: z.string(),
  scopeLabel: z.string(),
  timelineStart: z.string(),
  docketYears: z.array(z.string()),
  matchQuality: z.object({
    exact: z.number().int(),
    alias: z.number().int(),
    manual: z.number().int(),
    unmatched: z.number().int(),
  }),
  totals: z.object({
    entities: z.number().int(),
    matchedEntities: z.number().int(),
    unmatchedEntities: z.number().int(),
    facilitiesWithLegal: z.number().int(),
    cases: z.number().int(),
    pabNov: z.number().int(),
    pabNovPlaceholders: z.number().int(),
    orders: z.number().int(),
    pabOrders: z.number().int(),
    erf: z.number().int(),
    pabPenalties: z.number().int(),
    ra6969: z.number().int(),
    complaints: z.number().int(),
    openEntities: z.number().int(),
    closedEntities: z.number().int(),
    pabCollected: z.number(),
  }),
  pabByYear: z.array(LegalPabYearSchema),
  entities: z.array(LegalEntitySchema),
  orphans: z.array(LegalEntitySchema),
  cases: z.array(LegalCaseSchema),
  byFacility: z.record(LegalFacilitySummarySchema),
  candidateCount: z.number().int(),
});

// PCO schemas
export const PCORecordSchema = z.object({
  id: z.number().int(),
  evaluator: z.string(),
  pco: z.string(),
  type: z.enum(['New', 'Renewal']),
  status: z.string(),
  establishment: z.string(),
  address: z.string(),
  natureOfBusiness: z.string(),
  category: z.string(),
  dateCreated: z.union([z.number().int(), z.string()]).nullable(),
  dateApproved: z.union([z.number().int(), z.string()]).nullable(),
  remarks: z.string().optional(),
});

export const PCOCompanySummarySchema = z.object({
  pco: z.string(),
  evaluator: z.string(),
  totalRecords: z.number().int(),
  newCount: z.number().int(),
  renewalCount: z.number().int(),
  companies: z.number().int(),
  establishments: z.array(z.object({
    establishment: z.string(),
    address: z.string(),
    natureOfBusiness: z.string(),
    category: z.string(),
    type: z.enum(['New', 'Renewal']),
    dateApproved: z.string().nullable(),
  })),
  municipalities: z.array(z.string()),
  industries: z.array(z.string()),
});

export const PCOPermitCrossRefSchema = z.object({
  pco: z.string(),
  company: z.string(),
  establishment: z.string(),
  permitType: z.enum(['DP', 'PTO']),
  permitNo: z.string(),
  permitStatus: z.string(),
  permitExpiry: z.string().nullable(),
  hwRegistrations: z.array(z.object({
    hwGrNo: z.string(),
    hwStatus: z.string(),
    hwExpiry: z.string().nullable(),
  })),
  clearances: z.array(z.object({
    number: z.string(),
    type: z.string(),
    status: z.string(),
  })),
  matchConfidence: z.enum(['high', 'medium', 'low']),
});

export const PCOAnalysisSchema = z.object({
  generatedAt: z.string(),
  referenceDate: z.string(),
  totals: z.object({
    pcoRecords: z.number().int(),
    uniquePCOs: z.number().int(),
    uniqueEvaluators: z.number().int(),
    uniqueEstablishments: z.number().int(),
    newAccreditations: z.number().int(),
    renewals: z.number().int(),
    categoryA: z.number().int(),
    categoryB: z.number().int(),
  }),
  byPCO: z.array(PCOCompanySummarySchema),
  crossReferences: z.array(PCOPermitCrossRefSchema),
  unmatchedPCOs: z.array(z.object({
    pco: z.string(),
    establishment: z.string(),
    reason: z.string(),
  })),
  expiringSoon: z.array(z.object({
    pco: z.string(),
    establishment: z.string(),
    type: z.enum(['permit', 'hw', 'pco-accreditation']),
    expiryDate: z.string(),
    daysUntilExpiry: z.number().int(),
  })),
});

// Dataset schema
export const DatasetSchema = z.object({
  permits: z.array(PermitSchema),
  sites: z.array(SiteSchema),
  meta: MetaSchema,
  quality: QualityDataSchema,
  layers: LayerManifestSchema,
  hw: z.array(HwRegistrationSchema),
  clearances: z.array(ClearanceSchema),
  facilities: z.array(FacilitySchema),
  legal: LegalDataSchema,
});

// Export types for use in validation scripts
export type Permit = z.infer<typeof PermitSchema>;
export type HwRegistration = z.infer<typeof HwRegistrationSchema>;
export type Clearance = z.infer<typeof ClearanceSchema>;
export type Site = z.infer<typeof SiteSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type QualityData = z.infer<typeof QualityDataSchema>;
export type LayerManifest = z.infer<typeof LayerManifestSchema>;
export type Facility = z.infer<typeof FacilitySchema>;
export type LegalData = z.infer<typeof LegalDataSchema>;
export type PCORecord = z.infer<typeof PCORecordSchema>;
export type PCOCompanySummary = z.infer<typeof PCOCompanySummarySchema>;
export type PCOPermitCrossRef = z.infer<typeof PCOPermitCrossRefSchema>;
export type PCOAnalysis = z.infer<typeof PCOAnalysisSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;