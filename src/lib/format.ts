import type { LegalCoverage, LegalMatchMethod, LegalPayment, LegalStatus, Lifecycle, RegisterId, SiteGap, SpatialFlags } from '../types';

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-PH');
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-PH', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function daysUntil(value: string | null | undefined, reference = new Date()): number | null {
  if (!value) return null;
  const target = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  return Math.round((target - today) / 86400000);
}

export function relativeExpiry(value: string | null | undefined): string {
  const days = daysUntil(value);
  if (days === null) return 'No expiry';
  if (days < 0) return `${Math.abs(days).toLocaleString()} days ago`;
  if (days === 0) return 'Today';
  if (days < 60) return `in ${days} days`;
  return `in ${Math.round(days / 30)} months`;
}

export const LIFECYCLE_STYLE: Record<Lifecycle, { chip: string; dot: string; chart: string }> = {
  Active: { chip: 'chip-emerald', dot: 'bg-emerald-400', chart: '#34d399' },
  Expiring: { chip: 'chip-amber', dot: 'bg-amber-400', chart: '#fbbf24' },
  Expired: { chip: 'chip-rose', dot: 'bg-rose-400', chart: '#fb7185' },
  Unknown: { chip: 'chip-slate', dot: 'bg-slate-400', chart: '#94a3b8' },
};

export const CLEARANCE_STYLE: Record<string, { chip: string; dot: string; chart: string; label: string }> = {
  ECC: { chip: 'chip-emerald', dot: 'bg-emerald-400', chart: '#34d399', label: 'ECC' },
  CNC: { chip: 'chip-sky', dot: 'bg-sky-400', chart: '#38bdf8', label: 'CNC' },
  'ECC/CNC': { chip: 'chip-slate', dot: 'bg-slate-400', chart: '#94a3b8', label: 'ECC / CNC' },
};

export const REGISTER_META: Record<RegisterId, { label: string; color: string; chip: string }> = {
  DP: { label: 'DP', color: '#38bdf8', chip: 'chip-sky' },
  PTO: { label: 'PTO', color: '#a78bfa', chip: 'chip-violet' },
  HW: { label: 'HW', color: '#fbbf24', chip: 'chip-amber' },
  ECC: { label: 'ECC', color: '#34d399', chip: 'chip-emerald' },
  CNC: { label: 'CNC', color: '#fb7185', chip: 'chip-rose' },
};

export const REGISTER_ORDER: RegisterId[] = ['DP', 'PTO', 'HW', 'ECC', 'CNC'];

export const GAP_META: Record<SiteGap, { label: string; short: string; chip: string; color: string; description: string }> = {
  'both-active': {
    label: 'Both active',
    short: 'Both',
    chip: 'chip-emerald',
    color: '#34d399',
    description: 'Active DP and active PTO on file.',
  },
  'dp-active': {
    label: 'DP only active',
    short: 'DP only',
    chip: 'chip-sky',
    color: '#38bdf8',
    description: 'Active DP but no active PTO.',
  },
  'pto-active': {
    label: 'PTO only active',
    short: 'PTO only',
    chip: 'chip-violet',
    color: '#a78bfa',
    description: 'Active PTO but no active DP.',
  },
  'both-inactive': {
    label: 'Both inactive',
    short: 'Inactive',
    chip: 'chip-rose',
    color: '#fb7185',
    description: 'Both permits are expired or undated.',
  },
  'dp-only': {
    label: 'DP only',
    short: 'DP only',
    chip: 'chip-sky',
    color: '#0ea5e9',
    description: 'No PTO record found for this establishment.',
  },
  'pto-only': {
    label: 'PTO only',
    short: 'PTO only',
    chip: 'chip-violet',
    color: '#8b5cf6',
    description: 'No DP record found for this establishment.',
  },
  'hw-only': {
    label: 'HW only',
    short: 'HW only',
    chip: 'chip-amber',
    color: '#f59e0b',
    description: 'Hazardous-waste registration found, but no DP or PTO record.',
  },
};

export const QA_LABELS: Record<string, string> = {
  no_barangay: 'Missing barangay',
  lgu_unmatched: 'Unmatched LGU',
  no_issued_date: 'Missing issued date',
  no_industry: 'Missing industry',
  out_of_scope: 'Outside Region VII scope',
  no_expiry_date: 'Missing expiry date',
  no_coordinates: 'Missing coordinates',
  duplicate_source: 'Duplicated source row',
  invalid_coordinates: 'Invalid coordinates',
  province_unknown: 'Unknown province',
  no_address: 'Missing address',
  coordinates_suspect: 'Suspect coordinates',
  coordinates_swapped: 'Swapped coordinates',
  coordinates_corrected: 'Coordinates corrected',
  coordinates_approximate: 'Approximate coordinates',
  nonstandard_permit_no: 'Non-standard permit no.',
  expiry_before_issue: 'Expiry before issue',
  no_application_no: 'Missing application no.',
};

export const QA_HELP: Record<string, string> = {
  no_barangay: 'The address did not contain a recognisable barangay marker.',
  lgu_unmatched: 'The city/municipality text could not be resolved against the PSGC locality index.',
  no_issued_date: 'The source row has no usable issuance date.',
  no_industry: 'No industry classification was recorded for the permit.',
  out_of_scope: 'Province falls outside the Cebu–Bohol scope of the 2026 Region VII definition.',
  no_expiry_date: 'No expiry date was recorded, so lifecycle status cannot be derived.',
  no_coordinates: 'The register has no usable latitude/longitude for this record.',
  duplicate_source: 'A later or more complete copy of the same permit was kept.',
  invalid_coordinates: 'Coordinates were non-numeric or outside the Philippine bounding box.',
  province_unknown: 'Neither the province field nor the address resolved to a known province.',
  no_address: 'No project address was recorded in the source row.',
  coordinates_suspect: 'Coordinates fall outside the broad bounds for the assigned province.',
  coordinates_swapped: 'Latitude and longitude were reversed and have been corrected.',
  coordinates_corrected: 'The register coordinate was in the sea, on another island or far from the stated address; the marker was moved to the barangay / city centre from the address.',
  coordinates_approximate: 'The register had no usable coordinate; the marker is an approximate barangay / city centre taken from the address.',
  nonstandard_permit_no: 'Permit number does not follow the R07-YY-NNNNN pattern.',
  expiry_before_issue: 'Expiry date precedes the issuance date; both dates need review.',
  no_application_no: 'No application number was recorded.',
};

export const RISK_LABELS = ['None', 'Very low', 'Low', 'Guarded', 'Elevated', 'High', 'Very high', 'Severe', 'Critical', 'Extreme', 'Extreme'];

export function riskColor(risk: number): string {
  if (risk >= 8) return '#dc2626';
  if (risk >= 6) return '#f97316';
  if (risk >= 4) return '#f59e0b';
  if (risk >= 2) return '#eab308';
  return '#34d399';
}

export function spatialSummary(spatial: SpatialFlags | null | undefined): string {
  if (!spatial) return 'No spatial flags';
  const bits: string[] = [];
  if (spatial.flood) bits.push(`Flood ${spatial.flood}`);
  if (spatial.slide) bits.push(`Landslide ${spatial.slide}`);
  if (spatial.pa) bits.push('Protected area');
  if (spatial.ws) bits.push('Watershed');
  return bits.length ? bits.join(' · ') : 'No hazard flags';
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const quote = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
    return /[",\r\n]/.test(safe) ? `${safe.replace(/"/g, '""')}` : safe;
  };
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => quote(row[header])).join(','))].join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Deferred revocation: synchronous revoke can abort the download in Firefox/Safari.
  // Use queueMicrotask to wait for the download to start, then setTimeout as a fallback.
  queueMicrotask(() => {
    setTimeout(() => URL.revokeObjectURL(url), 100);
  });
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  queueMicrotask(() => {
    setTimeout(() => URL.revokeObjectURL(url), 100);
  });
}

export function titleCase(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

export const PALETTE = ['#34d399', '#22d3ee', '#818cf8', '#fbbf24', '#fb7185', '#a78bfa', '#2dd4bf', '#f472b6', '#facc15', '#60a5fa'];

export function formatPeso(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `₱${Math.round(value).toLocaleString('en-PH')}`;
}

export const LEGAL_STATUS_STYLE: Record<LegalStatus, { label: string; chip: string; color: string; description: string }> = {
  CLOSED: { label: 'Closed', chip: 'chip-emerald', color: '#34d399', description: 'Every linked case has a closing signal (compliance status, order outcome or LBC closure).' },
  OPEN: { label: 'Open', chip: 'chip-rose', color: '#fb7185', description: 'At least one linked case still has a pending action, payment or resolution.' },
  PARTIAL: { label: 'Partly closed', chip: 'chip-amber', color: '#fbbf24', description: 'Some cases are closed while others have no closing signal on file.' },
  UNKNOWN: { label: 'No status', chip: 'chip-slate', color: '#94a3b8', description: 'The source registers carry no status for these cases.' },
};

export const LEGAL_PAYMENT_STYLE: Record<LegalPayment, { label: string; chip: string; color: string }> = {
  PAID: { label: 'Paid', chip: 'chip-emerald', color: '#34d399' },
  PENDING: { label: 'Pending', chip: 'chip-amber', color: '#fbbf24' },
  MIXED: { label: 'Mixed', chip: 'chip-violet', color: '#a78bfa' },
  NONE: { label: 'No record', chip: 'chip-slate', color: '#94a3b8' },
};

export const LEGAL_MATCH_LABEL: Record<LegalMatchMethod, string> = {
  exact: 'Exact name',
  alias: 'Normalised name',
  manual: 'Reviewed alias',
  unmatched: 'Not in register',
};

export const LEGAL_COVERAGE_STYLE: Record<LegalCoverage, { label: string; chip: string }> = {
  full: { label: 'Full coverage', chip: 'chip-emerald' },
  partial: { label: 'Partial coverage', chip: 'chip-amber' },
  none: { label: 'Not in source', chip: 'chip-slate' },
};
