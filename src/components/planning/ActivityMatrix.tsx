import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Eye, RotateCcw, Search,
} from 'lucide-react';
import clsx from 'clsx';
import { Chip, EmptyState, Panel } from '../ui';
import {
  FLAG_SHORT, FLAG_TONE, STATUS_ORDER, STATUS_TONE,
  type MatrixFilter, type PlanningPayload, type PlanningRecord,
} from '../../lib/planning/types';
import { cellText, downloadText, num, pct, planningCsv } from '../../lib/planning/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STICKY = { section: 118, project: 200, indicator: 300 };

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

interface QuickToggles {
  remarks: boolean;
  mov: boolean;
  over: boolean;
  text: boolean;
}

const EMPTY_QUICK: QuickToggles = { remarks: false, mov: false, over: false, text: false };

function sortValue(record: PlanningRecord, key: string): string | number {
  if (key.startsWith('targets.')) return record.targets[Number(key.split('.')[1])] ?? 0;
  if (key.startsWith('actuals.')) return record.actuals[Number(key.split('.')[1])] ?? 0;
  switch (key) {
    case 'row': return record.row;
    case 'section': return record.section;
    case 'project': return record.project;
    case 'indicator': return record.indicator;
    case 'targetsTotal': return record.targetsTotal;
    case 'actualsTotal': return record.actualsTotal;
    case 'pctToDate': return record.pctToDate ?? -1;
    case 'pctAnnual': return record.pctAnnual ?? -1;
    case 'status': return STATUS_ORDER.indexOf(record.status);
    case 'variance': return record.actualsTotal - record.targetsTotal;
    case 'remarks': return record.remarks;
    case 'mov': return record.mov;
    case 'remarks2': return record.remarks2;
    case 'flags': return record.flags.length;
    default: return '';
  }
}

function HeaderButton({
  label, sortKey, sort, onSort, align = 'left', title,
}: {
  label: React.ReactNode;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  align?: 'left' | 'right' | 'center';
  title?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title={title ?? `Sort by ${typeof label === 'string' ? label : sortKey}`}
      className={clsx(
        'inline-flex w-full items-center gap-1 hover:text-slate-100',
        align === 'right' && 'justify-end',
        align === 'center' && 'justify-center',
        active && 'text-emerald-300',
      )}
    >
      <span className="leading-tight">{label}</span>
      {active ? (sort?.dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={9} className="opacity-30" />}
    </button>
  );
}

export function ActivityMatrix({
  payload,
  filter,
  onFilterChange,
  onReset,
  highlighted,
  onOpenRecord,
}: {
  payload: PlanningPayload;
  filter: MatrixFilter;
  onFilterChange: (patch: Partial<MatrixFilter>) => void;
  onReset: () => void;
  highlighted: Set<string>;
  onOpenRecord: (record: PlanningRecord) => void;
}) {
  const [sort, setSort] = useState<SortState>({ key: 'row', dir: 'asc' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [project, setProject] = useState('');
  const [quick, setQuick] = useState<QuickToggles>(EMPTY_QUICK);
  const [wrap, setWrap] = useState(true);

  const flagOptions = useMemo(
    () => Object.entries(payload.quality.byType).sort((a, b) => b[1] - a[1]),
    [payload.quality.byType],
  );

  const projectOptions = useMemo(() => {
    const set = new Set(
      payload.records
        .filter((record) => !filter.section || record.section === filter.section)
        .map((record) => record.project)
        .filter(Boolean),
    );
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [payload.records, filter.section]);

  const filtered = useMemo(() => {
    const query = filter.search.trim().toLowerCase();
    return payload.records.filter((record) => {
      if (filter.section && record.section !== filter.section) return false;
      if (filter.status && record.status !== filter.status) return false;
      if (filter.flag && !record.flags.includes(filter.flag)) return false;
      if (project && record.project !== project) return false;
      if (quick.remarks && !record.remarks) return false;
      if (quick.mov && !record.mov) return false;
      if (quick.over && !record.flags.includes('over-100')) return false;
      if (quick.text && !record.flags.includes('text-in-months')) return false;
      if (query) {
        const haystack = `${record.section} ${record.project} ${record.indicator} ${record.remarks} ${record.mov} ${record.remarks2}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [payload.records, filter, project, quick]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const direction = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = sortValue(a, sort.key);
      const right = sortValue(b, sort.key);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
    });
  }, [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => { setProject(''); }, [filter.section]);
  useEffect(() => { setPage(0); }, [filter, project, quick, sort, pageSize]);

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: 'asc' };
      if (current.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  };

  const activeFilters =
    (filter.section ? 1 : 0) + (filter.status ? 1 : 0) + (filter.flag ? 1 : 0) +
    (filter.search.trim() ? 1 : 0) + (project ? 1 : 0) + Object.values(quick).filter(Boolean).length;

  const resetAll = () => {
    setProject('');
    setQuick(EMPTY_QUICK);
    setSort({ key: 'row', dir: 'asc' });
    onReset();
  };

  const exportRows = () => {
    downloadText(`planning-accomplishments-2026-${new Date().toISOString().slice(0, 10)}.csv`, planningCsv(sorted));
  };

  const monthCell = (value: number, tone: 'target' | 'actual', record: PlanningRecord, month: number) => {
    const note = tone === 'target' ? record.targetText[month] : record.actualText[month];
    if (note && tone === 'actual' && value === 0) {
      return (
        <span className="block max-w-[52px] truncate text-[10px] text-amber-300/90" title={note}>
          note*
        </span>
      );
    }
    return (
      <span
        className={clsx(
          'font-mono tabular-nums',
          value === 0 ? 'text-slate-600' : tone === 'target' ? 'text-slate-300' : 'text-emerald-300',
        )}
        title={note ? `${value}\nNote: ${note}` : undefined}
      >
        {value === 0 ? '·' : num(value, 2)}
        {note && tone === 'target' && <span className="text-amber-400">*</span>}
        {note && tone === 'actual' && value !== 0 && <span className="text-amber-400">*</span>}
      </span>
    );
  };

  return (
    <div id="planning-matrix">
    <Panel
      title="Activity matrix — every worksheet column"
      subtitle="All 214 indicators with all twelve target months, all twelve accomplishment months, totals, percentages, remarks, means of verification and data-quality flags. Every column sorts; every filter is always visible."
      className="min-w-0"
      action={
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setWrap((value) => !value)} title="Toggle full or single-line text in the remarks columns">
            <Eye size={12} /> {wrap ? 'Full text' : 'Compact'}
          </button>
          <button type="button" className="btn btn-primary btn-xs" onClick={exportRows} title="Download exactly the rows currently shown">
            <Download size={12} /> Export filtered
          </button>
        </div>
      }
    >
      <div className="mb-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <label className="relative block">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="input h-8 w-full pl-8 text-[11.5px]"
              placeholder="Search section, project, indicator, remarks, MOV…"
              value={filter.search}
              onChange={(event) => onFilterChange({ search: event.target.value })}
            />
          </label>
          <select className="select h-8 text-[11.5px]" value={filter.section} onChange={(event) => onFilterChange({ section: event.target.value })}>
            <option value="">All sections ({payload.meta.counts.sections})</option>
            {payload.sections.map((section) => (
              <option key={section.section} value={section.section}>{section.section} ({section.activities})</option>
            ))}
          </select>
          <select className="select h-8 text-[11.5px]" value={project} onChange={(event) => setProject(event.target.value)}>
            <option value="">All projects ({projectOptions.length})</option>
            {projectOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select className="select h-8 text-[11.5px]" value={filter.status} onChange={(event) => onFilterChange({ status: event.target.value })}>
            <option value="">All statuses</option>
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>{status} ({payload.meta.statusCounts[status]})</option>
            ))}
          </select>
          <select className="select h-8 text-[11.5px]" value={filter.flag} onChange={(event) => onFilterChange({ flag: event.target.value })}>
            <option value="">All data-quality flags</option>
            {flagOptions.map(([flag, count]) => (
              <option key={flag} value={flag}>{FLAG_SHORT[flag] ?? flag} ({count})</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            ['remarks', 'Has remarks'],
            ['mov', 'Has MOV'],
            ['over', 'Over 100%'],
            ['text', 'Text in month cell'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={quick[key]}
              onClick={() => setQuick((current) => ({ ...current, [key]: !current[key] }))}
              className={clsx('chip cursor-pointer transition', quick[key] ? 'chip-emerald' : 'chip-slate hover:brightness-125')}
            >
              {label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/10" />
          <span className="text-[11px] text-slate-500">
            <b className="font-mono text-slate-300">{sorted.length}</b> of {payload.records.length} rows
            {activeFilters > 0 && <> · {activeFilters} filter{activeFilters === 1 ? '' : 's'}</>}
          </span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={resetAll} disabled={activeFilters === 0}>
            <RotateCcw size={11} /> Reset filters
          </button>
          {highlighted.size > 0 && (
            <span className="chip chip-emerald"><span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />{highlighted.size} changed</span>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No indicators match these filters" description="Clear a filter or search for another term." />
      ) : (
        <>
          <div className="table-wrap scroll-thin max-h-[720px]">
            <table className="data-table min-w-[1500px] border-separate border-spacing-0">
              <thead>
                <tr>
                  {[
                    ['Section', 'section', STICKY.section, 0],
                    ['Project / activity', 'project', STICKY.project, STICKY.section],
                    ['Performance indicator', 'indicator', STICKY.indicator, STICKY.section + STICKY.project],
                  ].map(([label, key, width, left]) => (
                    <th
                      key={key as string}
                      rowSpan={2}
                      className="sticky z-20 bg-ink-850 align-bottom"
                      style={{ left: left as number, minWidth: width as number, maxWidth: width as number }}
                    >
                      <HeaderButton label={label as string} sortKey={key as string} sort={sort} onSort={toggleSort} />
                    </th>
                  ))}
                  <th colSpan={12} className="border-l border-white/[0.08] text-center">Monthly targets · D–O</th>
                  <th rowSpan={2} className="align-bottom"><HeaderButton label="Total P" sortKey="targetsTotal" sort={sort} onSort={toggleSort} align="right" /></th>
                  <th colSpan={12} className="border-l border-white/[0.08] text-center">Monthly accomplishments · R–AC</th>
                  <th rowSpan={2} className="align-bottom"><HeaderButton label="Total AD" sortKey="actualsTotal" sort={sort} onSort={toggleSort} align="right" /></th>
                  <th rowSpan={2} className="align-bottom"><HeaderButton label="% to date AE" sortKey="pctToDate" sort={sort} onSort={toggleSort} align="right" /></th>
                  <th rowSpan={2} className="align-bottom"><HeaderButton label="% annual AF" sortKey="pctAnnual" sort={sort} onSort={toggleSort} align="right" /></th>
                  <th rowSpan={2} className="align-bottom"><HeaderButton label="Status" sortKey="status" sort={sort} onSort={toggleSort} /></th>
                  <th rowSpan={2} className="align-bottom"><HeaderButton label="Variance AD−P" sortKey="variance" sort={sort} onSort={toggleSort} align="right" /></th>
                  <th rowSpan={2} className="align-bottom"><HeaderButton label="Remarks AG" sortKey="remarks" sort={sort} onSort={toggleSort} /></th>
                  <th rowSpan={2} className="align-bottom"><HeaderButton label="MOV AH" sortKey="mov" sort={sort} onSort={toggleSort} /></th>
                  <th rowSpan={2} className="align-bottom"><HeaderButton label="Remarks AI" sortKey="remarks2" sort={sort} onSort={toggleSort} /></th>
                  <th rowSpan={2} className="align-bottom"><HeaderButton label="Flags" sortKey="flags" sort={sort} onSort={toggleSort} /></th>
                </tr>
                <tr>
                  {MONTHS.map((month, index) => (
                    <th key={`t-${month}`} className="min-w-[46px] border-l border-white/[0.05] text-right first:border-l-0">
                      <HeaderButton label={month} sortKey={`targets.${index}`} sort={sort} onSort={toggleSort} align="right" />
                    </th>
                  ))}
                  {MONTHS.map((month, index) => (
                    <th key={`a-${month}`} className="min-w-[46px] border-l border-white/[0.05] text-right">
                      <HeaderButton label={month} sortKey={`actuals.${index}`} sort={sort} onSort={toggleSort} align="right" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((record) => {
                  const changed = highlighted.has(record.id);
                  return (
                    <tr
                      key={record.id}
                      onClick={() => onOpenRecord(record)}
                      className={clsx('cursor-pointer', changed && 'bg-emerald-400/[0.06]')}
                    >
                      <td
                        className={clsx('sticky z-10 bg-ink-850 align-top', changed && 'border-l-2 border-emerald-400')}
                        style={{ left: 0, minWidth: STICKY.section, maxWidth: STICKY.section }}
                      >
                        <div className="text-[11px] font-medium text-slate-200">{record.section}</div>
                        <div className="font-mono text-[9.5px] text-slate-600">row {record.row}</div>
                      </td>
                      <td className="sticky z-10 bg-ink-850 align-top" style={{ left: STICKY.section, minWidth: STICKY.project, maxWidth: STICKY.project }}>
                        <div className={clsx('text-[11px] text-slate-300', !wrap && 'truncate')}>{record.project || '—'}</div>
                      </td>
                      <td className="sticky z-10 bg-ink-850 align-top" style={{ left: STICKY.section + STICKY.project, minWidth: STICKY.indicator, maxWidth: STICKY.indicator }}>
                        <div className={clsx('text-[11px] leading-snug text-slate-200', !wrap && 'truncate')}>{record.indicator}</div>
                      </td>
                      {record.targets.map((value, month) => (
                        <td key={`t-${month}`} className="border-l border-white/[0.04] text-right align-top">
                          {monthCell(value, 'target', record, month)}
                        </td>
                      ))}
                      <td className="border-l border-white/[0.08] text-right align-top font-mono tabular-nums text-slate-300">{num(record.targetsTotal, 2)}</td>
                      {record.actuals.map((value, month) => (
                        <td key={`a-${month}`} className="border-l border-white/[0.04] text-right align-top">
                          {monthCell(value, 'actual', record, month)}
                        </td>
                      ))}
                      <td className="border-l border-white/[0.08] text-right align-top font-mono tabular-nums text-emerald-300">{num(record.actualsTotal, 2)}</td>
                      <td className="text-right align-top font-mono tabular-nums text-slate-200">{pct(record.pctToDate)}</td>
                      <td className="text-right align-top font-mono tabular-nums text-slate-400">{pct(record.pctAnnual)}</td>
                      <td className="align-top">
                        <Chip tone={STATUS_TONE[record.status]}>{record.status}</Chip>
                      </td>
                      <td className={clsx('text-right align-top font-mono tabular-nums', record.actualsTotal - record.targetsTotal >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                        {num(record.actualsTotal - record.targetsTotal, 2)}
                      </td>
                      <td className="align-top">
                        <div className={clsx('max-w-[240px] text-[10.5px] leading-snug text-slate-300', !wrap && 'truncate')}>
                          {cellText(record.remarks)}
                        </div>
                      </td>
                      <td className="align-top">
                        <div className={clsx('max-w-[220px] text-[10.5px] leading-snug text-slate-400', !wrap && 'truncate')}>
                          {cellText(record.mov)}
                        </div>
                      </td>
                      <td className="align-top">
                        <div className={clsx('max-w-[220px] text-[10.5px] leading-snug text-slate-400', !wrap && 'truncate')}>
                          {cellText(record.remarks2)}
                        </div>
                      </td>
                      <td className="align-top">
                        <div className="flex max-w-[180px] flex-wrap gap-1">
                          {record.flags.length === 0 && <span className="text-[10px] text-slate-600">clean</span>}
                          {record.flags.slice(0, 2).map((flag) => (
                            <span key={flag} className={clsx('chip px-1 py-0 text-[9px]', `chip-${FLAG_TONE[flag] ?? 'slate'}`)} title={FLAG_SHORT[flag] ?? flag}>
                              {FLAG_SHORT[flag] ?? flag}
                            </span>
                          ))}
                          {record.flags.length > 2 && (
                            <span className="chip chip-slate px-1 py-0 text-[9px]" title={record.flags.map((flag) => FLAG_SHORT[flag] ?? flag).join('; ')}>
                              +{record.flags.length - 2}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-500">
            <div>
              Showing <b className="font-mono text-slate-300">{visible.length}</b> of <b className="font-mono text-slate-300">{sorted.length}</b> filtered rows
              {' '}({payload.records.length} in the workbook) · sorted by <span className="text-slate-400">{sort ? `${sort.key} ${sort.dir}` : 'source order'}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                Rows
                <select className="select h-7 text-[11px]" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  {[10, 25, 50, 100, 214].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              <button type="button" className="btn btn-xs" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                <ChevronLeft size={12} /> Prev
              </button>
              <span className="font-mono tabular-nums text-slate-400">{safePage + 1} / {pageCount}</span>
              <button type="button" className="btn btn-xs" disabled={safePage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>
                Next <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </>
      )}
    </Panel>
    </div>
  );
}
