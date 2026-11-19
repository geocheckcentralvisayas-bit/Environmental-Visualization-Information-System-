import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import clsx from 'clsx';

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('card flex min-w-0 flex-col', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.055] px-4 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[13px] font-semibold tracking-tight text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={clsx('min-h-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

const ACCENTS: Record<string, { bg: string; text: string; ring: string; bar: string }> = {
  emerald: { bg: 'bg-emerald-400/10', text: 'text-emerald-300', ring: 'ring-emerald-400/20', bar: 'bg-emerald-400' },
  sky: { bg: 'bg-sky-400/10', text: 'text-sky-300', ring: 'ring-sky-400/20', bar: 'bg-sky-400' },
  amber: { bg: 'bg-amber-400/10', text: 'text-amber-300', ring: 'ring-amber-400/20', bar: 'bg-amber-400' },
  rose: { bg: 'bg-rose-400/10', text: 'text-rose-300', ring: 'ring-rose-400/20', bar: 'bg-rose-400' },
  violet: { bg: 'bg-violet-400/10', text: 'text-violet-300', ring: 'ring-violet-400/20', bar: 'bg-violet-400' },
  slate: { bg: 'bg-slate-400/10', text: 'text-slate-300', ring: 'ring-slate-400/20', bar: 'bg-slate-400' },
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = 'emerald',
  footer,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: keyof typeof ACCENTS;
  footer?: ReactNode;
  onClick?: () => void;
}) {
  const tone = ACCENTS[accent] ?? ACCENTS.emerald;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'card group relative overflow-hidden p-4 text-left transition',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-emerald-400/25 hover:shadow-glow',
        !onClick && 'cursor-default',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</div>
          <div className="mt-2 font-sans text-[30px] font-bold leading-none tracking-tight text-slate-50">{value}</div>
          {hint && <div className="mt-2 text-[11.5px] leading-snug text-slate-500">{hint}</div>}
        </div>
        {icon && (
          <div className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1', tone.bg, tone.text, tone.ring)}>
            {icon}
          </div>
        )}
      </div>
      {footer && <div className="mt-3 border-t border-white/[0.055] pt-2.5">{footer}</div>}
    </button>
  );
}

export function Chip({ tone = 'slate', children, className }: { tone?: string; children: ReactNode; className?: string }) {
  return <span className={clsx('chip', `chip-${tone}`, className)}>{children}</span>;
}

export function ProgressBar({ value, max = 100, tone = 'bg-emerald-400', className, color }: { value: number; max?: number; tone?: string; className?: string; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]', className)}>
      <div className={clsx('h-full rounded-full transition-all duration-500', tone)} style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />
    </div>
  );
}

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        {eyebrow && <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-400/80">{eyebrow}</div>}
        <h1 className="text-[22px] font-bold tracking-tight text-slate-50 sm:text-[26px]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-slate-400">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ title = 'No records match', description, icon }: { title?: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.04] text-slate-500">{icon ?? <Inbox size={20} />}</div>
      <div className="text-sm font-semibold text-slate-300">{title}</div>
      {description && <div className="max-w-md text-[12px] text-slate-500">{description}</div>}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
  headerClassName?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  initialSort,
  pageSize = 0,
  maxHeight = 'max-h-[560px]',
  empty,
  footer,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; direction: 'asc' | 'desc' };
  pageSize?: number;
  maxHeight?: string;
  empty?: ReactNode;
  footer?: ReactNode;
}) {
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((entry) => entry.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = column.sortValue!(a);
      const vb = column.sortValue!(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * factor;
    });
  }, [rows, sort, columns]);

  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = pageSize > 0 ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;

  const toggle = (column: Column<T>) => {
    if (!column.sortValue) return;
    setPage(0);
    setSort((current) => {
      if (!current || current.key !== column.key) return { key: column.key, direction: 'asc' };
      if (current.direction === 'asc') return { key: column.key, direction: 'desc' };
      return null;
    });
  };

  if (!rows.length) return <div className="rounded-xl border border-white/[0.06]">{empty ?? <EmptyState />}</div>;

  return (
    <div>
      <div className={clsx('table-wrap scroll-thin', maxHeight)}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={column.headerClassName}>
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(column)}
                      className="inline-flex cursor-pointer items-center gap-1 hover:text-slate-200"
                    >
                      {column.header}
                      {sort?.key === column.key &&
                        (sort.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1">{column.header}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr
                key={`${rowKey(row)}::${index}`}
                onClick={() => onRowClick?.(row)}
                className={clsx(onRowClick && 'cursor-pointer')}
              >
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(footer || pageSize > 0) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-500">
          <div>{footer ?? <>Showing {visible.length.toLocaleString()} of {rows.length.toLocaleString()} records</>}</div>
          {pageSize > 0 && pageCount > 1 && (
            <div className="flex items-center gap-1.5">
              <button type="button" className="btn btn-xs" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                <ChevronLeft size={12} /> Prev
              </button>
              <span className="px-1 tabular-nums text-slate-400">
                {safePage + 1} / {pageCount}
              </span>
              <button type="button" className="btn btn-xs" disabled={safePage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>
                Next <ChevronRight size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MetricRow({ label, value, max, tone, color, hint }: { label: ReactNode; value: number; max: number; tone?: string; color?: string; hint?: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="truncate text-[12px] text-slate-300">{label}</span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400">{value.toLocaleString()}</span>
      </div>
      <ProgressBar value={value} max={max} tone={tone} color={color} />
      {hint && <div className="mt-1 text-[10.5px] text-slate-600">{hint}</div>}
    </div>
  );
}
