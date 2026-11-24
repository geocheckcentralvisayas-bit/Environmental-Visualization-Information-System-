import type { PlanningRecord } from './types';

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function cellText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Every worksheet column, so the export matches what the table shows. */
export function planningCsv(records: PlanningRecord[]): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const header = [
    'Row', 'Section', 'Project', 'Indicator',
    ...months.map((month) => `${month} target`),
    'Target total',
    ...months.map((month) => `${month} actual`),
    'Actual total',
    '% to date', '% annual', 'Status', 'Computed rate',
    'Remarks', 'Means of verification', 'Remarks (AI)',
    'AL (worksheet)', 'AM (worksheet)',
    'Quarter target (AS)', 'To-date target (AT)', 'Quarter actual (AU)', 'To-date actual (AV)',
    'Flags',
  ];
  const lines = records.map((record) => [
    record.row, record.section, record.project, record.indicator,
    ...record.targets,
    record.targetsTotal,
    ...record.actuals,
    record.actualsTotal,
    record.pctToDate ?? '', record.pctAnnual ?? '', record.status, record.rate ?? '',
    record.remarks, record.mov, record.remarks2,
    record.working.a ?? '', record.working.b ?? '',
    record.working.quarterTarget ?? '', record.working.toDateTarget ?? '',
    record.working.quarterActual ?? '', record.working.toDateActual ?? '',
    record.flags.join('; '),
  ]);
  return [header, ...lines].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadText(fileName: string, text: string, contentType = 'text/csv;charset=utf-8') {
  const blob = new Blob([`\uFEFF${text}`], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
