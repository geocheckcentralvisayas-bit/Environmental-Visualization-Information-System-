export type PlanningStatusKey =
  | 'Met'
  | 'On Track'
  | 'At Risk'
  | 'Delayed'
  | 'Not Started'
  | 'No Target';

export interface PlanningWorkingColumns {
  a: number | null;
  b: number | null;
  quarterTarget: number | null;
  toDateTarget: number | null;
  quarterActual: number | null;
  toDateActual: number | null;
}

export interface PlanningRecord {
  id: string;
  row: number;
  section: string;
  project: string;
  indicator: string;
  targets: number[];
  actuals: number[];
  targetText: string[];
  actualText: string[];
  targetsTotal: number;
  actualsTotal: number;
  pctToDate: number | null;
  pctAnnual: number | null;
  remarks: string;
  mov: string;
  remarks2: string;
  working: PlanningWorkingColumns;
  flags: string[];
  status: PlanningStatusKey;
  rate: number | null;
  ytdTarget: number;
  ytdActual: number;
}

export interface PlanningMonth {
  index: number;
  label: string;
  longLabel: string;
  target: number;
  actual: number;
  assessed: number;
  met: number;
  rate: number | null;
  isReportingMonth: boolean;
  isFuture: boolean;
}

export interface PlanningFocal {
  section: string;
  focal: string;
  alternate: string;
  database: string;
  databaseAlternate: string;
}

export interface PlanningSection {
  section: string;
  activities: number;
  projects: number;
  medianRate: number | null;
  meanRate: number | null;
  assessed: number;
  statusCounts: Record<PlanningStatusKey, number>;
  metMonths: number;
  assessedMonths: number;
  focals: PlanningFocal[];
}

export interface PlanningChange {
  at: string;
  kind: 'added' | 'removed' | 'updated';
  row: number;
  id: string;
  section: string;
  indicator: string;
  field?: string;
  label?: string;
  from?: string | number | null;
  to?: string | number | null;
}

export interface PlanningQualityIssue {
  row: number;
  id: string;
  section: string;
  indicator: string;
  type: string;
  label: string;
}

export interface PlanningMeta {
  generatedAt: string;
  contentHash: string;
  year: number;
  reportingMonth: number;
  reportingMonthLabel: string;
  source: {
    path: string;
    fileName: string;
    sheet: string;
    modifiedAt: string;
    bytes: number;
  };
  monthLabels: string[];
  statusDefinitions: Record<PlanningStatusKey, string>;
  counts: {
    activities: number;
    sections: number;
    projects: number;
    assessed: number;
    met: number;
    overallRate: number | null;
  };
  statusCounts: Record<PlanningStatusKey, number>;
  changeLog: PlanningChange[];
  changed: number;
  previousGeneratedAt: string | null;
}

export interface PlanningPayload {
  meta: PlanningMeta;
  monthly: PlanningMonth[];
  sections: PlanningSection[];
  records: PlanningRecord[];
  focals: PlanningFocal[];
  quality: {
    totalIssues: number;
    byType: Record<string, number>;
    issues: PlanningQualityIssue[];
    truncated: boolean;
  };
  changes: PlanningChange[];
}

export const FLAG_SHORT: Record<string, string> = {
  'missing-project': 'No project label',
  'no-target': 'No target',
  'actual-without-target': 'Actual without target',
  'over-100': 'Over 100%',
  'text-in-months': 'Text in month cell',
  'total-mismatch': 'Total mismatch',
  'no-remarks': 'No remarks',
  'no-mov': 'No MOV',
  'future-actual': 'Future actual',
  'dash-rate': 'No % to date',
  'rate-mismatch': '% mismatch',
  'missing-indicator': 'No indicator',
};

export const FLAG_TONE: Record<string, string> = {
  'missing-project': 'amber',
  'no-target': 'slate',
  'actual-without-target': 'amber',
  'over-100': 'violet',
  'text-in-months': 'rose',
  'total-mismatch': 'rose',
  'no-remarks': 'amber',
  'no-mov': 'slate',
  'future-actual': 'rose',
  'dash-rate': 'slate',
  'rate-mismatch': 'amber',
  'missing-indicator': 'rose',
};

export const STATUS_TONE: Record<PlanningStatusKey, string> = {
  Met: 'emerald',
  'On Track': 'sky',
  'At Risk': 'amber',
  Delayed: 'rose',
  'Not Started': 'slate',
  'No Target': 'slate',
};

export const STATUS_COLOR: Record<PlanningStatusKey, string> = {
  Met: '#34d399',
  'On Track': '#38bdf8',
  'At Risk': '#fbbf24',
  Delayed: '#fb7185',
  'Not Started': '#94a3b8',
  'No Target': '#64748b',
};

export const STATUS_ORDER: PlanningStatusKey[] = [
  'Met',
  'On Track',
  'At Risk',
  'Delayed',
  'Not Started',
  'No Target',
];

export interface MatrixFilter {
  section: string;
  status: string;
  flag: string;
  search: string;
}

export const EMPTY_MATRIX_FILTER: MatrixFilter = {
  section: '',
  status: '',
  flag: '',
  search: '',
};
