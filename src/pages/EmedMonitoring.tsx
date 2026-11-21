import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, ClipboardList, FileSpreadsheet, Search, Target, Users } from 'lucide-react';
import clsx from 'clsx';
import { apiJson } from '../lib/api';
import { Stagger, StaggerItem } from '../components/Motion';
import { useSafeMotion } from '../hooks/use-safe-motion';
import { motionConfig, motionTokens, springs } from '../lib/motion-tokens';
import { Chart, axisStyle, chartBase } from '../components/Chart';
import { Chip, DataTable, EmptyState, Panel, SectionHeading, StatCard, type Column } from '../components/ui';
import { formatNumber } from '../lib/format';

interface Ratio { label: string; value: number }
interface Sector {
  name: string;
  target: number[];
  accomplished: number[];
  targetTotal: number;
  accomplishedTotal: number;
  ratio: number | null;
}
interface EmedDashboard {
  asOf: string | null;
  ratios: Ratio[];
  monitoring: { target: number; accomplished: number };
  survey: { target: number; accomplished: number };
  complaints: number;
  sectors: Sector[];
}
interface Performance {
  kraNames: string[];
  inspectors: { name: string; initial: string; values: number[]; total: number }[];
}
interface NumericColumn { name: string; sum: number; max: number; count: number }
interface CategoryValue { name: string; count: number }
interface Sheet {
  name: string;
  description: string;
  file: string;
  headerRow: number;
  columns: string[];
  totalRows: number;
  numericColumns: NumericColumn[];
  categoricalColumns: { name: string; values: CategoryValue[] }[];
  monthly: { months: string[]; totals: number[] } | null;
}
interface SheetDetail extends Sheet {
  rows: (string | number)[][];
}
interface EmedPayload {
  generatedAt: string;
  sourceUrl: string;
  title: string;
  dashboard: EmedDashboard;
  performance: Performance;
  categories: { id: string; label: string; sheets: string[] }[];
  sheets: Sheet[];
  notes: string[];
}

type Section = 'overview' | 'inspectors' | 'worksheets';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const PALETTE = ['#34D399', '#38BDF8', '#FBBF24', '#F472B6', '#A78BFA', '#FB923C', '#2DD4BF', '#94A3B8'];

const categoriesOf = (payload: EmedPayload | null) => payload?.categories ?? [];

function pct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function SheetTable({ sheet }: { sheet: SheetDetail }) {
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return sheet.rows;
    return sheet.rows.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(needle)));
  }, [search, sheet.rows]);

  const columns = useMemo<Column<(string | number)[]>[]>(() => sheet.columns.map((header, index) => ({
    key: String(index),
    header: <span className="whitespace-nowrap">{header}</span>,
    sortValue: (row) => (typeof row[index] === 'number' ? row[index] : String(row[index] ?? '').toLowerCase()),
    render: (row) => {
      const value = row[index];
      if (value === '' || value === null || value === undefined) return <span className="text-slate-700">—</span>;
      if (typeof value === 'boolean') return <Chip tone={value ? 'emerald' : 'slate'}>{String(value)}</Chip>;
      return <span className="text-slate-300">{String(value)}</span>;
    },
  })), [sheet.columns]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input h-8 w-full pl-9 text-[11px]"
            aria-label={`Search ${sheet.name} rows`}
            placeholder={`Search ${sheet.name}…`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className="text-[10.5px] text-slate-500">
          {formatNumber(rows.length)} of {formatNumber(sheet.totalRows)} rows · {sheet.columns.length} columns
        </span>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => JSON.stringify(row)}
        pageSize={12}
        empty={<EmptyState title="No matching rows" description="Try a different search term." />}
      />
    </div>
  );
}

function WorksheetView({ sheet, detail, loading, error }: { sheet: Sheet; detail: SheetDetail | null; loading: boolean; error: string | null }) {
  const numeric = sheet.numericColumns.slice(0, 8);
  const category = sheet.categoricalColumns[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="sky"><FileSpreadsheet size={10} /> {formatNumber(sheet.totalRows)} rows</Chip>
        <Chip tone="violet">{sheet.columns.length} columns</Chip>
        <Chip tone="slate">Header row {sheet.headerRow}</Chip>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel
          title={sheet.monthly ? 'Monthly totals' : 'Numeric fields'}
          subtitle={sheet.monthly ? 'Sum of numeric entries by month' : 'Largest totals across the worksheet'}
        >
          {sheet.monthly ? (
            <Chart
              height={250}
              ariaLabel={`${sheet.name} chart`}
              option={chartBase({
                xAxis: { type: 'category', data: sheet.monthly.months, ...axisStyle() },
                yAxis: { type: 'value', ...axisStyle() },
                series: [{
                  type: 'bar',
                  name: 'Total',
                  data: sheet.monthly.totals,
                  itemStyle: { color: '#34D399', borderRadius: [3, 3, 0, 0] },
                }],
              })}
            />
          ) : numeric.length ? (
            <Chart
              height={250}
              ariaLabel={`${sheet.name} chart`}
              option={chartBase({
                grid: { left: 12, right: 24, top: 12, bottom: 8, containLabel: true },
                xAxis: { type: 'value', ...axisStyle() },
                yAxis: { type: 'category', data: numeric.map((item) => item.name).reverse(), ...axisStyle({ axisLabel: { color: '#7d948d', fontSize: 10, width: 130, overflow: 'truncate' } }) },
                series: [{
                  type: 'bar',
                  data: numeric.map((item) => item.sum).reverse(),
                  itemStyle: { color: '#38BDF8', borderRadius: [0, 3, 3, 0] },
                }],
              })}
            />
          ) : <EmptyState title="No numeric fields" description="This worksheet is a text log." />}
        </Panel>

        <Panel title="Category mix" subtitle={category ? `Distribution of ${category.name}` : 'No categorical field detected'}>
          {category ? (
            <Chart
              height={250}
              ariaLabel={`${sheet.name} chart`}
              option={chartBase({
                grid: { left: 12, right: 20, top: 12, bottom: 8, containLabel: true },
                xAxis: { type: 'value', ...axisStyle() },
                yAxis: { type: 'category', data: category.values.map((item) => item.name).reverse(), ...axisStyle({ axisLabel: { color: '#7d948d', fontSize: 10, width: 130, overflow: 'truncate' } }) },
                series: [{
                  type: 'bar',
                  data: category.values.map((item) => item.count).reverse(),
                  itemStyle: { color: '#A78BFA', borderRadius: [0, 3, 3, 0] },
                }],
              })}
            />
          ) : <EmptyState title="No categories" description="Nothing to chart for this worksheet." />}
        </Panel>
      </div>

      <Panel title={`${sheet.name} — complete table`} subtitle="All rows and columns; very long cells are shortened">
        {loading ? (
          <div className="py-12 text-center text-[12px] text-slate-500">Loading {formatNumber(sheet.totalRows)} rows…</div>
        ) : error || !detail ? (
          <EmptyState title="Table unavailable" description={error ?? 'Could not load this worksheet.'} />
        ) : (
          <SheetTable key={detail.file} sheet={detail} />
        )}
      </Panel>
    </div>
  );
}

export function EmedMonitoringPage() {
  const [payload, setPayload] = useState<EmedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('overview');
  const [sector, setSector] = useState('ALL');
  const [inspector, setInspector] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sheetSearch, setSheetSearch] = useState('');
  const [sheetName, setSheetName] = useState('DASHBOARD');
  const [details, setDetails] = useState<Record<string, SheetDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const sectionMotion = useSafeMotion(motionTokens.distance.sm);
  const animateUi = motionConfig.shouldAnimate();

  useEffect(() => {
    apiJson<EmedPayload>('/data/emed.json')
      .then(setPayload)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Dataset unavailable'));
  }, []);

  const visibleSheets = (payload?.sheets ?? []).filter((sheet) => {
    const inCategory = !categoryId || categoriesOf(payload).find((category) => category.id === categoryId)?.sheets.includes(sheet.name);
    const needle = sheetSearch.trim().toLowerCase();
    return inCategory && (!needle || sheet.name.toLowerCase().includes(needle));
  });
  const selectedSheet = visibleSheets.find((sheet) => sheet.name === sheetName) ?? visibleSheets[0] ?? payload?.sheets[0];
  const selectedName = selectedSheet?.name ?? '';

  useEffect(() => {
    const meta = payload?.sheets.find((item) => item.name === selectedName);
    setDetailError(null);
    if (section !== 'worksheets' || !meta) {
      setDetailLoading(false);
      return;
    }
    if (details[meta.file]) {
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    apiJson<SheetDetail>(`/data/${meta.file}`)
      .then((detail) => { if (!cancelled) setDetails((previous) => ({ ...previous, [meta.file]: detail })); })
      .catch((cause: unknown) => { if (!cancelled) setDetailError(cause instanceof Error ? cause.message : 'Could not load table'); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [section, selectedName, payload, details]);

  const sectorSeries = useMemo(() => {
    const sectors = payload?.dashboard.sectors ?? [];
    if (sector === 'ALL') {
      return {
        target: MONTHS.map((_, index) => sectors.reduce((sum, item) => sum + (item.target[index] ?? 0), 0)),
        accomplished: MONTHS.map((_, index) => sectors.reduce((sum, item) => sum + (item.accomplished[index] ?? 0), 0)),
      };
    }
    const item = sectors.find((entry) => entry.name === sector);
    return { target: item?.target ?? [], accomplished: item?.accomplished ?? [] };
  }, [payload, sector]);

  const inspectors = payload?.performance.inspectors ?? [];
  const rankedInspectors = inspectors.slice(0, 12).reverse();
  const selectedPerson = inspectors.find((item) => item.initial === inspector);
  const kraTotals = (payload?.performance.kraNames ?? []).map((name, index) => ({
    name,
    total: inspectors.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
  })).sort((a, b) => b.total - a.total);

  if (error || !payload) {
    return (
      <div className="animate-fade-up space-y-4">
        <SectionHeading eyebrow="EMED" title="EMED Monitoring Dashboards" />
        <Panel title="Dataset could not be loaded">
          <p className="text-[12px] text-slate-400">{error ?? 'Loading…'}</p>
          <p className="mt-2 text-[11px] text-slate-500">
            Run <span className="kbd">npm run data:emed</span> then <span className="kbd">npm run api:upload</span>.
          </p>
        </Panel>
      </div>
    );
  }

  const { dashboard, performance, sheets, categories } = payload;
  const activeSheet = selectedSheet as Sheet;
  const overall = dashboard.ratios.find((ratio) => ratio.label === 'Overall')?.value ?? null;
  const achieving = dashboard.sectors.filter((item) => item.ratio !== null && item.ratio >= 1).length;
  const activeCategory = categoryId;
  const selectedDetail = details[activeSheet.file] ?? null;

  return (
    <div className="animate-fade-up space-y-5">
      <SectionHeading
        eyebrow="EMED · Region VII"
        title="EMED Monitoring Dashboards"
        description={`Environmental Monitoring & Enforcement performance for CY 2026 — ${dashboard.sectors.length} KRA programs, ${performance.inspectors.length} inspectors and all ${sheets.length} worksheets from the source workbook.`}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="emerald">As of {dashboard.asOf ?? 'latest'}</Chip>
            <Chip tone="sky"><BarChart3 size={10} /> {sheets.length} sheets</Chip>
            <a className="btn btn-ghost h-7 px-2 text-[10px]" href={payload.sourceUrl} target="_blank" rel="noreferrer">
              Source workbook ↗
            </a>
          </div>
        }
      />

      <div role="tablist" aria-label="EMED dashboard sections" className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.06] bg-ink-850/60 p-1">
        {([
          ['overview', 'Performance overview', BarChart3],
          ['inspectors', 'Inspector performance', Users],
          ['worksheets', 'All worksheets', FileSpreadsheet],
        ] as [Section, string, typeof BarChart3][]).map(([id, label, Icon]) => (
          <motion.button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            whileHover={animateUi ? { scale: motionTokens.scale.pop } : undefined}
            whileTap={animateUi ? { scale: motionTokens.scale.press } : undefined}
            transition={springs.snappy}
            className={clsx(
              'relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition',
              section === id ? 'text-emerald-300' : 'text-slate-400 hover:text-slate-200',
            )}
          >
            {section === id && (
              <motion.span
                layoutId="emed-tab-pill"
                className="absolute inset-0 rounded-lg bg-emerald-400/15 ring-1 ring-emerald-400/10"
                transition={springs.gentle}
              />
            )}
            <Icon size={13} className="relative" /> <span className="relative">{label}</span>
          </motion.button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={section}
        initial={sectionMotion.initial}
        animate={sectionMotion.enter}
        exit={sectionMotion.exit}
        transition={{ duration: motionTokens.duration.normal, ease: motionTokens.easing.smooth }}
      >
      {section === 'overview' && (
        <>
          <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StaggerItem><StatCard label="Overall performance" value={pct(overall)} hint="Target attainment ratio" icon={<Target size={17} />} accent="emerald" /></StaggerItem>
            <StaggerItem><StatCard label="Firms monitored" value={formatNumber(dashboard.monitoring.accomplished)} hint={`${formatNumber(dashboard.monitoring.target)} target · ${formatNumber(dashboard.monitoring.target - dashboard.monitoring.accomplished)} balance`} icon={<ClipboardList size={17} />} accent="sky" /></StaggerItem>
            <StaggerItem><StatCard label="Firms surveyed" value={formatNumber(dashboard.survey.accomplished)} hint={`${formatNumber(dashboard.survey.target)} target`} icon={<Target size={17} />} accent="violet" /></StaggerItem>
            <StaggerItem><StatCard label="Programs on target" value={`${achieving}/${dashboard.sectors.length}`} hint={`${formatNumber(dashboard.complaints)} complaints handled`} icon={<BarChart3 size={17} />} accent="amber" /></StaggerItem>
          </Stagger>

          <div className="grid gap-3 xl:grid-cols-2">
            <Panel title="Division attainment" subtitle="Accomplishment ÷ target by program area">
              <Chart
                height={290}
                ariaLabel={`Division attainment: ${dashboard.ratios.map((ratio) => `${ratio.label} ${(ratio.value * 100).toFixed(1)}%`).join(', ')}`}
                option={chartBase({
                  grid: { left: 12, right: 30, top: 20, bottom: 8, containLabel: true },
                  xAxis: { type: 'value', max: Math.max(150, ...dashboard.ratios.map((ratio) => ratio.value * 100)), ...axisStyle() },
                  yAxis: { type: 'category', data: dashboard.ratios.map((ratio) => ratio.label).reverse(), ...axisStyle() },
                  series: [{
                    type: 'bar',
                    data: dashboard.ratios.map((ratio) => Number((ratio.value * 100).toFixed(1))).reverse(),
                    itemStyle: { color: (params: { dataIndex: number }) => PALETTE[params.dataIndex % PALETTE.length], borderRadius: [0, 3, 3, 0] },
                    label: { show: true, position: 'right', formatter: '{c}%', color: '#94a3b8', fontSize: 10 },
                    markLine: { silent: true, symbol: 'none', label: { show: false }, data: [{ xAxis: 100 }], lineStyle: { color: 'rgba(248,113,113,0.6)', type: 'dashed' } },
                  }],
                })}
              />
            </Panel>

            <Panel
              title="Monthly output — target vs accomplished"
              subtitle="Pick a KRA program to compare its monthly performance"
              action={
                <select aria-label="KRA program" className="select h-7 w-auto max-w-[180px] text-[10px]" value={sector} onChange={(event) => setSector(event.target.value)}>
                  <option value="ALL">All programs</option>
                  {dashboard.sectors.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                </select>
              }
            >
              <Chart
                height={290}
                ariaLabel={`${sector === 'ALL' ? 'All programs' : sector}: monthly targets ${sectorSeries.target.join(', ')}; accomplished ${sectorSeries.accomplished.join(', ')}`}
                option={chartBase({
                  legend: { data: ['Target', 'Accomplished'], top: 0, textStyle: { color: '#94a3b8', fontSize: 10 } },
                  xAxis: { type: 'category', data: MONTHS, ...axisStyle() },
                  yAxis: { type: 'value', ...axisStyle() },
                  series: [
                    { name: 'Target', type: 'bar', data: sectorSeries.target, itemStyle: { color: 'rgba(56,189,248,0.55)', borderRadius: [3, 3, 0, 0] } },
                    { name: 'Accomplished', type: 'bar', data: sectorSeries.accomplished, itemStyle: { color: '#34D399', borderRadius: [3, 3, 0, 0] } },
                  ],
                })}
              />
            </Panel>
          </div>

          <Panel title="KRA program scorecard" subtitle="Ranked by accomplishment-to-target ratio as of the latest reporting cut-off">
            <DataTable
              pageSize={12}
              rowKey={(row) => row.name}
              initialSort={{ key: 'ratio', direction: 'desc' }}
              rows={dashboard.sectors}
              columns={[
                { key: 'name', header: 'Program', render: (row) => <span className="font-semibold text-slate-200">{row.name}</span>, sortValue: (row) => row.name },
                { key: 'targetTotal', header: 'Target', render: (row) => formatNumber(row.targetTotal), sortValue: (row) => row.targetTotal },
                { key: 'accomplishedTotal', header: 'Accomplished', render: (row) => formatNumber(row.accomplishedTotal), sortValue: (row) => row.accomplishedTotal },
                { key: 'balance', header: 'Balance', render: (row) => <span className={row.accomplishedTotal - row.targetTotal >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{formatNumber(row.accomplishedTotal - row.targetTotal)}</span>, sortValue: (row) => row.accomplishedTotal - row.targetTotal },
                { key: 'ratio', header: 'Attainment', render: (row) => <span className={row.ratio !== null && row.ratio >= 1 ? 'text-emerald-300' : 'text-amber-300'}>{pct(row.ratio)}</span>, sortValue: (row) => row.ratio ?? -1 },
              ]}
            />
          </Panel>
        </>
      )}

      {section === 'inspectors' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Inspectors" value={formatNumber(performance.inspectors.length)} hint="With KRA totals in the IPCR matrix" icon={<Users size={17} />} accent="sky" />
            <StatCard label="KRA lines" value={formatNumber(performance.kraNames.length)} hint="Tracked per inspector" icon={<ClipboardList size={17} />} accent="violet" />
            <StatCard label="Top performer" value={performance.inspectors[0]?.initial ?? '—'} hint={`${performance.inspectors[0]?.name ?? ''} · ${formatNumber(performance.inspectors[0]?.total ?? 0)} report lines`} icon={<Target size={17} />} accent="emerald" />
          </div>

          <Panel title="Accomplishment by inspector" subtitle="Top 12 by total KRA report lines">
            <Chart
              height={340}
              ariaLabel={`Top inspectors by report lines: ${rankedInspectors.map((item) => `${item.name} ${item.total}`).join(', ')}`}
              option={chartBase({
                grid: { left: 12, right: 24, top: 12, bottom: 8, containLabel: true },
                xAxis: { type: 'value', ...axisStyle() },
                yAxis: { type: 'category', data: rankedInspectors.map((item) => item.name), ...axisStyle({ axisLabel: { color: '#7d948d', fontSize: 10, width: 150, overflow: 'truncate' } }) },
                series: [{ type: 'bar', data: rankedInspectors.map((item) => item.total), itemStyle: { color: '#34D399', borderRadius: [0, 3, 3, 0] } }],
              })}
            />
          </Panel>

          <div className="grid gap-3 xl:grid-cols-2">
            <Panel title="KRA report lines" subtitle="Total across all inspectors">
              <Chart
                height={330}
                option={chartBase({
                  grid: { left: 12, right: 24, top: 12, bottom: 8, containLabel: true },
                  xAxis: { type: 'value', ...axisStyle() },
                  yAxis: { type: 'category', data: kraTotals.slice(0, 14).map((item) => item.name).reverse(), ...axisStyle({ axisLabel: { color: '#7d948d', fontSize: 10, width: 110, overflow: 'truncate' } }) },
                  series: [{ type: 'bar', data: kraTotals.slice(0, 14).map((item) => item.total).reverse(), itemStyle: { color: '#38BDF8', borderRadius: [0, 3, 3, 0] } }],
                })}
              />
            </Panel>
            <Panel
              title="Individual KRA profile"
              subtitle="Select an inspector to see their report mix"
              action={
                <select aria-label="Inspector" className="select h-7 w-auto max-w-[190px] text-[10px]" value={inspector} onChange={(event) => setInspector(event.target.value)}>
                  <option value="">Choose inspector…</option>
                  {performance.inspectors.map((item) => <option key={item.initial} value={item.initial}>{item.name}</option>)}
                </select>
              }
            >
              {selectedPerson ? (
                <Chart
                  height={330}
                  ariaLabel={`${selectedPerson.name} KRA profile: ${performance.kraNames.slice(0, 20).map((name, index) => `${name} ${selectedPerson.values[index] ?? 0}`).join(', ')}`}
                  option={chartBase({
                    grid: { left: 12, right: 24, top: 12, bottom: 8, containLabel: true },
                    xAxis: { type: 'value', ...axisStyle() },
                    yAxis: { type: 'category', data: performance.kraNames.slice(0, 20).reverse(), ...axisStyle({ axisLabel: { color: '#7d948d', fontSize: 10, width: 110, overflow: 'truncate' } }) },
                    series: [{ type: 'bar', data: selectedPerson.values.slice(0, 20).reverse(), itemStyle: { color: '#A78BFA', borderRadius: [0, 3, 3, 0] } }],
                  })}
                />
              ) : <EmptyState title="No inspector selected" description="Choose an inspector from the list above." icon={<Users size={19} />} />}
            </Panel>
          </div>
        </>
      )}

      {section === 'worksheets' && (
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <Panel title={`Worksheets (${sheets.length})`} subtitle="Every tab in the source workbook" bodyClassName="p-2" className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-6rem)]">
            <div className="relative mb-2">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input aria-label="Find a worksheet" className="input h-8 w-full pl-9 text-[11px]" placeholder="Find a worksheet…" value={sheetSearch} onChange={(event) => setSheetSearch(event.target.value)} />
            </div>
            <div className="scroll-thin flex flex-wrap gap-1 border-b border-white/[0.05] px-1 pb-2">
              <button
                type="button"
                title="Show every worksheet"
                onClick={() => setCategoryId('')}
                className={clsx('rounded-md px-2 py-1 text-[10px] font-semibold transition', !activeCategory ? 'bg-emerald-400/15 text-emerald-300' : 'text-slate-500 hover:text-slate-300')}
              >
                All {sheets.length}
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  title={category.label}
                  onClick={() => setCategoryId(category.id)}
                  className={clsx('rounded-md px-2 py-1 text-[10px] font-semibold transition', activeCategory === category.id ? 'bg-emerald-400/15 text-emerald-300' : 'text-slate-500 hover:text-slate-300')}
                >
                  {category.label}
                </button>
              ))}
            </div>
            <div className="scroll-thin mt-2 max-h-[60vh] space-y-0.5 overflow-y-auto pr-1">
              {visibleSheets.map((sheet) => (
                <button
                  key={sheet.name}
                  type="button"
                  onClick={() => setSheetName(sheet.name)}
                  className={clsx(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] transition',
                    sheetName === sheet.name ? 'bg-emerald-400/15 text-emerald-300' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
                  )}
                >
                  <span className="truncate">{sheet.name}</span>
                  <span className="shrink-0 text-[9.5px] text-slate-600">{formatNumber(sheet.totalRows)}</span>
                </button>
              ))}
              {!visibleSheets.length && <div className="px-2 py-4 text-[11px] text-slate-500">No worksheets match.</div>}
            </div>
          </Panel>
          <div className="min-w-0 space-y-3">
            <SectionHeading
              eyebrow={`Worksheet · ${categories.find((category) => category.id === activeCategory)?.label ?? `all ${sheets.length} tabs`}`}
              title={activeSheet.name}
              description={activeSheet.description}
            />
            <WorksheetView sheet={activeSheet} detail={selectedDetail} loading={detailLoading} error={detailError} />
          </div>
        </div>
      )}
      </motion.div>
      </AnimatePresence>

      <p className="text-[10px] leading-relaxed text-slate-600">
        Source: EMED Monitoring workbook · built {new Date(payload.generatedAt).toLocaleString()} · {payload.notes[0]}
      </p>
    </div>
  );
}
