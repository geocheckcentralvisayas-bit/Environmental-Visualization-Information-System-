import { useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, CheckCircle2, Factory, Layers3, MapPin, MapPinOff, Recycle, Search, Trash2, XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useDashboard } from '../store/useDashboard';
import { Chart, axisStyle, chartBase } from '../components/Chart';
import { SwmMap } from '../components/SwmMap';
import { SwmDetails, type SwmSection } from './SwmDetails';
import { Chip, DataTable, Panel, SectionHeading, StatCard, type Column } from '../components/ui';
import { formatNumber } from '../lib/format';
import type { SwmDisposalProject, SwmFacility, SwmLgu, SwmRecord } from '../types';

const STATUS_TONE = { Operational: 'emerald', 'Non-Operational': 'rose' } as const;
const COVERAGE_TONE = { operational: 'emerald', 'non-operational': 'amber', none: 'slate' } as const;
const COVERAGE_LABEL = { operational: 'Operational MRF', 'non-operational': 'Non-operational only', none: 'No MRF record' } as const;

type View = 'records' | 'facilities' | 'lgus';

export function SolidWastePage() {
  const swm = useDashboard((state) => state.swm);
  const [province, setProvince] = useState('all');
  const [lgu, setLgu] = useState('all');
  const [status, setStatus] = useState<'all' | 'Operational' | 'Non-Operational'>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('records');
  const [section, setSection] = useState<SwmSection>('overview');

  const lguOptions = useMemo(() => {
    if (!swm) return [];
    return swm.lgus
      .filter((entry) => entry.province === province)
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }, [swm, province]);

  const records = useMemo(() => {
    if (!swm) return [];
    const query = search.trim().toLowerCase();
    return swm.records.filter((record) => {
      if (province !== 'all' && record.province !== province) return false;
      if (lgu !== 'all' && record.lgu !== lgu) return false;
      if (status !== 'all' && record.status !== status) return false;
      if (!query) return true;
      return [record.lgu, record.province, record.barangay, record.txn, record.status]
        .some((value) => String(value ?? '').toLowerCase().includes(query));
    });
  }, [swm, province, lgu, status, search]);

  const facilities = useMemo(() => {
    if (!swm) return [];
    const allowed = new Set(records.map((record) => record.facilityKey));
    return swm.facilities.filter((facility) => allowed.has(facility.key));
  }, [swm, records]);

  const disposalProjects = useMemo(() => {
    const projects = swm?.disposal.projects ?? [];
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (province !== 'all' && project.province !== province) return false;
      if (lgu !== 'all' && project.lgu !== lgu) return false;
      if (!query) return true;
      return [project.name, project.lgu, project.province, project.ref, project.status]
        .some((value) => String(value ?? '').toLowerCase().includes(query));
    });
  }, [swm, province, lgu, search]);

  const lguRows = useMemo(() => {
    if (!swm) return [];
    const query = search.trim().toLowerCase();
    return swm.lgus.filter((entry) => {
      if (province !== 'all' && entry.province !== province) return false;
      if (lgu !== 'all' && entry.name !== lgu) return false;
      if (status !== 'all' && entry.operational === 0 && status === 'Operational') return false;
      if (status === 'Non-Operational' && entry.operational > 0) return false;
      if (!query) return true;
      return [entry.name, entry.province, entry.coverage].some((value) => String(value).toLowerCase().includes(query));
    });
  }, [swm, province, lgu, status, search]);

  const charts = useMemo(() => {
    const operational = records.filter((record) => record.status === 'Operational').length;
    const nonOperational = records.length - operational;

    const provinceData = province === 'all'
      ? (swm?.provinces ?? [])
      : (swm?.provinces ?? []).filter((entry) => entry.name === province);

    const lguTotals = new Map<string, { name: string; province: string; op: number; non: number }>();
    for (const record of records) {
      const key = `${record.province}|${record.lgu}`;
      const entry = lguTotals.get(key) ?? { name: record.lgu, province: record.province, op: 0, non: 0 };
      if (record.status === 'Operational') entry.op += 1;
      else entry.non += 1;
      lguTotals.set(key, entry);
    }
    const topLgus = [...lguTotals.values()]
      .sort((a, b) => (b.op + b.non) - (a.op + a.non))
      .slice(0, 12)
      .reverse();

    const buckets = { '1 barangay': 0, '2 barangays': 0, '3–5 barangays': 0, '6+ barangays': 0 };
    for (const facility of facilities) {
      const count = facility.barangays.length || 1;
      if (count <= 1) buckets['1 barangay'] += 1;
      else if (count === 2) buckets['2 barangays'] += 1;
      else if (count <= 5) buckets['3–5 barangays'] += 1;
      else buckets['6+ barangays'] += 1;
    }

    const zeroOperational = (swm?.lgus ?? [])
      .filter((entry) => entry.inUniverse && entry.records > 0 && entry.operational === 0)
      .filter((entry) => province === 'all' || entry.province === province)
      .sort((a, b) => b.nonOperational - a.nonOperational);

    return { operational, nonOperational, provinceData, topLgus, buckets, zeroOperational };
  }, [records, facilities, swm, province]);

  if (!swm) {
    return (
      <div className="animate-fade-up space-y-3">
        <SectionHeading
          eyebrow="Solid waste management"
          title="MRF register"
          description="The solid waste dataset has not been built yet."
        />
        <Panel title="Dataset missing">
          <div className="flex items-start gap-2 text-[12px] leading-relaxed text-slate-400">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              Place <span className="kbd">SWM OVERALL DASHBOARDS.csv</span> in <span className="kbd">data/</span> and run{' '}
              <span className="kbd">npm run data:swm</span>, then reload.
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  const summary = swm.summary;
  const filteredOperational = charts.operational;
  const filteredNonOperational = charts.nonOperational;

  const recordColumns: Column<SwmRecord>[] = [
    {
      key: 'lgu',
      header: 'LGU',
      sortValue: (row) => row.lgu,
      render: (row) => (
        <div className="min-w-[150px]">
          <div className="text-[11.5px] font-medium text-slate-200">{row.lgu}</div>
          <div className="text-[10px] text-slate-500">{row.province}</div>
        </div>
      ),
    },
    {
      key: 'barangay',
      header: 'Barangay / location',
      sortValue: (row) => row.barangay,
      render: (row) => <span className="text-[11px] text-slate-300">{row.barangay || '—'}</span>,
    },
    {
      key: 'status',
      header: 'MRF status',
      sortValue: (row) => row.status,
      render: (row) => <Chip tone={STATUS_TONE[row.status]}>{row.status}</Chip>,
    },
    {
      key: 'txn',
      header: 'IIS transaction',
      sortValue: (row) => row.txn,
      render: (row) => <span className="font-mono text-[10.5px] text-sky-300">{row.txn || '—'}</span>,
    },
    {
      key: 'coord',
      header: 'Coordinates',
      render: (row) => (
        <div className="text-[10.5px]">
          {row.lat !== null && row.lon !== null ? (
            <span className="font-mono text-slate-400">{row.lat.toFixed(4)}, {row.lon.toFixed(4)}</span>
          ) : (
            <span className="text-amber-300">not mapped</span>
          )}
          {row.coordNote && <div className="max-w-[240px] text-[9.5px] text-amber-300/80">{row.coordNote}</div>}
        </div>
      ),
    },
  ];

  const facilityColumns: Column<SwmFacility>[] = [
    {
      key: 'lgu',
      header: 'LGU',
      sortValue: (row) => row.lgu,
      render: (row) => (
        <div className="min-w-[150px]">
          <div className="text-[11.5px] font-medium text-slate-200">{row.lgu}</div>
          <div className="text-[10px] text-slate-500">{row.province}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (row) => row.status,
      render: (row) => <Chip tone={STATUS_TONE[row.status]}>{row.status}</Chip>,
    },
    {
      key: 'barangays',
      header: 'Barangays served',
      sortValue: (row) => row.barangays.length,
      render: (row) => (
        <div className="min-w-[180px] max-w-[280px]">
          <div className="text-[11px] text-slate-300">{row.barangays.length} barangay{row.barangays.length === 1 ? '' : 's'}</div>
          <div className="truncate text-[10px] text-slate-500">{row.barangays.join(', ') || '—'}</div>
        </div>
      ),
    },
    {
      key: 'records',
      header: 'Register rows',
      sortValue: (row) => row.recordCount,
      render: (row) => <span className="font-mono text-[10.5px] text-slate-400">{row.recordCount}</span>,
    },
    {
      key: 'txn',
      header: 'IIS transaction',
      sortValue: (row) => row.key,
      render: (row) => <span className="font-mono text-[10.5px] text-sky-300">{row.key}</span>,
    },
    {
      key: 'coord',
      header: 'Coordinates',
      render: (row) => (
        <div className="text-[10.5px]">
          {row.lat !== null && row.lon !== null ? (
            <span className="font-mono text-slate-400">{row.lat.toFixed(4)}, {row.lon.toFixed(4)}</span>
          ) : (
            <span className="text-amber-300">not mapped</span>
          )}
          {row.coordNote && <div className="max-w-[240px] text-[9.5px] text-amber-300/80">{row.coordNote}</div>}
        </div>
      ),
    },
  ];

  const lguColumns: Column<SwmLgu>[] = [
    {
      key: 'lgu',
      header: 'LGU',
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="min-w-[160px]">
          <div className="text-[11.5px] font-medium text-slate-200">{row.name}</div>
          <div className="text-[10px] text-slate-500">{row.province}</div>
        </div>
      ),
    },
    {
      key: 'coverage',
      header: 'Coverage',
      sortValue: (row) => ({ none: 0, 'non-operational': 1, operational: 2 })[row.coverage],
      render: (row) => <Chip tone={COVERAGE_TONE[row.coverage]}>{COVERAGE_LABEL[row.coverage]}</Chip>,
    },
    {
      key: 'records',
      header: 'Rows',
      sortValue: (row) => row.records,
      render: (row) => <span className="font-mono text-[10.5px] text-slate-400">{row.records}</span>,
    },
    {
      key: 'operational',
      header: 'Operational',
      sortValue: (row) => row.operational,
      render: (row) => (
        <span className={clsx('font-mono text-[10.5px]', row.operational > 0 ? 'text-emerald-300' : 'text-slate-500')}>
          {row.operational}
        </span>
      ),
    },
    {
      key: 'non',
      header: 'Non-operational',
      sortValue: (row) => row.nonOperational,
      render: (row) => (
        <span className={clsx('font-mono text-[10.5px]', row.nonOperational > 0 ? 'text-rose-300' : 'text-slate-500')}>
          {row.nonOperational}
        </span>
      ),
    },
    {
      key: 'facilities',
      header: 'Facilities',
      sortValue: (row) => row.facilities,
      render: (row) => <span className="font-mono text-[10.5px] text-slate-400">{row.facilities}</span>,
    },
  ];

  const resetFilters = () => {
    setProvince('all');
    setLgu('all');
    setStatus('all');
    setSearch('');
  };

  return (
    <div className="animate-fade-up space-y-5">
      <SectionHeading
        eyebrow="Solid waste management"
        title="Solid Waste Management (SWM)"
        description={`Central Visayas (Cebu and Bohol) solid waste register from the IIS transaction system, covering Materials Recovery Facilities (MRFs) and ECC/CNC-approved landfills, dumpsites and transfer stations. One row is a barangay-level MRF entry; rows are grouped into unique facilities by transaction number, so ${formatNumber(summary.records)} register rows describe ${formatNumber(summary.facilities)} facilities.`}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="emerald"><CheckCircle2 size={10} /> {formatNumber(summary.operational)} operational</Chip>
            <Chip tone="rose"><XCircle size={10} /> {formatNumber(summary.nonOperational)} non-operational</Chip>
            <Chip tone="sky"><Building2 size={10} /> {formatNumber(summary.facilities)} facilities</Chip>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.06] bg-ink-850/60 p-1">
        {([
          ['overview', 'MRF & facility overview'],
          ['wacs', 'WACS analysis'],
          ['compliance', 'Annual compliance'],
          ['contacts', 'LGU contacts'],
          ['database', 'Reference database'],
        ] as [SwmSection, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-[11px] font-semibold transition',
              section === id ? 'bg-emerald-400/15 text-emerald-300' : 'text-slate-400 hover:text-slate-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {section !== 'overview' ? <SwmDetails section={section} /> : (
      <>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard
          label="MRF facilities"
          value={formatNumber(summary.facilities)}
          hint={`${formatNumber(summary.records)} barangay-level register rows`}
          icon={<Building2 size={17} />}
          accent="sky"
        />
        <StatCard
          label="Operational"
          value={formatNumber(summary.operational)}
          hint={`${summary.operationalRate}% of register rows`}
          icon={<CheckCircle2 size={17} />}
          accent="emerald"
        />
        <StatCard
          label="Non-operational"
          value={formatNumber(summary.nonOperational)}
          hint={`${summary.facilities - new Set(swm.facilities.filter((f) => f.status === 'Operational').map((f) => f.key)).size} facilities need attention`}
          icon={<XCircle size={17} />}
          accent="rose"
        />
        <StatCard
          label="LGU coverage"
          value={`${summary.lgusWithRecords}/${summary.lgusTotal}`}
          hint={`${summary.lgusWithoutRecords} LGUs have no MRF record`}
          icon={<MapPin size={17} />}
          accent="violet"
          footer={
            <div className="text-[10px] text-slate-500">
              {Math.round((summary.lgusWithRecords / summary.lgusTotal) * 100)}% of Cebu & Bohol LGUs
            </div>
          }
        />
        <StatCard
          label="Zero operational"
          value={formatNumber(summary.lgusZeroOperational)}
          hint="LGUs with records but no working MRF"
          icon={<AlertTriangle size={17} />}
          accent="amber"
        />
        <StatCard
          label="Unmapped"
          value={formatNumber(summary.missingCoordinates)}
          hint={`${summary.sharedCoordinateFacilities} facilities share a coordinate with another LGU`}
          icon={<Layers3 size={17} />}
          accent="slate"
        />
      </div>

      <div data-testid="swm-filters">
      <Panel
        title="Filters"
        subtitle="Applies to the charts, map and tables below."
        action={
          <button type="button" className="btn btn-ghost h-7 px-2 text-[10px]" onClick={resetFilters}>
            Clear
          </button>
        }
        bodyClassName="p-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="select h-8 w-auto min-w-[130px] text-[11px]"
            value={province}
            onChange={(event) => {
              setProvince(event.target.value);
              setLgu('all');
            }}
          >
            <option value="all">All provinces</option>
            {swm.provinces.map((entry) => (
              <option key={entry.name} value={entry.name}>{entry.name}</option>
            ))}
          </select>
          <select className="select h-8 w-auto min-w-[150px] text-[11px]" value={lgu} onChange={(event) => setLgu(event.target.value)}>
            <option value="all">All LGUs</option>
            {lguOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <select
            className="select h-8 w-auto min-w-[130px] text-[11px]"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">All statuses</option>
            <option value="Operational">Operational</option>
            <option value="Non-Operational">Non-operational</option>
          </select>
          <div className="relative min-w-[200px] flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="input h-8 pl-7 text-[11px]"
              placeholder="Search LGU, barangay or IIS transaction."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <span className="ml-auto text-[10.5px] text-slate-500">
            {formatNumber(records.length)} rows · {formatNumber(facilities.length)} facilities
          </span>
        </div>
      </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Status mix" subtitle="Register rows in the current filter">
          <Chart
            height={260}
            option={{
              ...chartBase(),
              tooltip: { ...chartBase().tooltip, trigger: 'item' },
              legend: { bottom: 0, textStyle: { color: '#94a3b8', fontSize: 10 }, icon: 'circle', itemHeight: 7 },
              series: [
                {
                  type: 'pie',
                  radius: ['52%', '76%'],
                  center: ['50%', '44%'],
                  avoidLabelOverlap: true,
                  itemStyle: { borderColor: 'rgba(5,14,11,0.9)', borderWidth: 2 },
                  label: { show: false },
                  data: [
                    { name: 'Operational', value: filteredOperational, itemStyle: { color: '#34d399' } },
                    { name: 'Non-operational', value: filteredNonOperational, itemStyle: { color: '#fb7185' } },
                  ],
                },
              ],
              graphic: [
                {
                  type: 'text',
                  left: 'center',
                  top: '38%',
                  style: {
                    text: `${filteredOperational + filteredNonOperational}`,
                    fill: '#f1f5f9',
                    fontSize: 26,
                    fontWeight: 700,
                    fontFamily: 'Inter',
                  },
                },
                {
                  type: 'text',
                  left: 'center',
                  top: '50%',
                  style: { text: 'rows', fill: '#64748b', fontSize: 10, fontFamily: 'Inter' },
                },
              ],
            }}
          />
        </Panel>

        <Panel className="xl:col-span-2" title="Operational vs non-operational by province" subtitle="Register rows, grouped by MRF status">
          <Chart
            height={260}
            option={{
              ...chartBase(),
              legend: { top: 0, textStyle: { color: '#94a3b8', fontSize: 10 }, icon: 'roundRect', itemHeight: 7 },
              grid: { left: 8, right: 16, top: 34, bottom: 4, containLabel: true },
              xAxis: { type: 'category', data: charts.provinceData.map((entry) => entry.name), ...axisStyle({ splitLine: { show: false } }) },
              yAxis: { type: 'value', ...axisStyle() },
              series: [
                {
                  name: 'Operational',
                  type: 'bar',
                  stack: 'total',
                  barMaxWidth: 42,
                  data: charts.provinceData.map((entry) => entry.operational),
                  itemStyle: { color: '#34d399', borderRadius: [0, 0, 0, 0] },
                  label: { show: true, position: 'inside', color: '#052e1c', fontSize: 10, fontWeight: 600 },
                },
                {
                  name: 'Non-operational',
                  type: 'bar',
                  stack: 'total',
                  barMaxWidth: 42,
                  data: charts.provinceData.map((entry) => entry.nonOperational),
                  itemStyle: { color: '#fb7185', borderRadius: [4, 4, 0, 0] },
                  label: { show: true, position: 'inside', color: '#450a0a', fontSize: 10, fontWeight: 600 },
                },
              ],
            }}
          />
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Top LGUs by MRF register rows" subtitle="Stacked by status — Panglao, Bogo and Daanbantayan carry the most rows because one facility can serve several barangays">
          <Chart
            height={330}
            option={{
              ...chartBase(),
              legend: { top: 0, textStyle: { color: '#94a3b8', fontSize: 10 }, icon: 'roundRect', itemHeight: 7 },
              grid: { left: 8, right: 20, top: 30, bottom: 4, containLabel: true },
              xAxis: { type: 'value', ...axisStyle() },
              yAxis: {
                type: 'category',
                data: charts.topLgus.map((entry) => entry.name),
                ...axisStyle({ splitLine: { show: false } }),
                axisLabel: { color: '#94a3b8', fontSize: 9.5, width: 120, overflow: 'truncate' },
              },
              series: [
                {
                  name: 'Operational',
                  type: 'bar',
                  stack: 'total',
                  barMaxWidth: 13,
                  data: charts.topLgus.map((entry) => entry.op),
                  itemStyle: { color: '#34d399', borderRadius: [0, 0, 0, 0] },
                },
                {
                  name: 'Non-operational',
                  type: 'bar',
                  stack: 'total',
                  barMaxWidth: 13,
                  data: charts.topLgus.map((entry) => entry.non),
                  itemStyle: { color: '#fb7185', borderRadius: [0, 4, 4, 0] },
                  label: {
                    show: true,
                    position: 'right',
                    color: '#8ea9a1',
                    fontSize: 9,
                    formatter: (params: { dataIndex: number }) => {
                      const entry = charts.topLgus[params.dataIndex];
                      return String(entry.op + entry.non);
                    },
                  },
                },
              ],
            }}
          />
        </Panel>

        <Panel title="Coverage gaps" subtitle="LGUs with register rows but no operational MRF — the rehabilitation shortlist">
          {charts.zeroOperational.length === 0 ? (
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2.5 text-[11px] text-emerald-200">
              No LGU in this filter is entirely without an operational MRF.
            </div>
          ) : (
            <div className="scroll-thin max-h-[280px] space-y-1.5 overflow-y-auto pr-1">
              {charts.zeroOperational.map((entry) => (
                <div key={`${entry.province}|${entry.name}`} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-slate-200">{entry.name}</div>
                    <div className="text-[9.5px] text-slate-500">{entry.province}</div>
                  </div>
                  <Chip tone="rose">{entry.nonOperational} non-op</Chip>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
            {summary.lgusWithoutRecords} of {summary.lgusTotal} LGUs have no MRF register row at all. Coverage is measured against the {summary.lgusTotal} LGUs of Cebu and Bohol, not only the submitted rows.
          </div>
        </Panel>
      </div>

      <Panel
        title="Landfills & disposal facilities"
        subtitle={`Not part of the MRF register — these come from the ${swm.disposal.source}. They record approvals, not whether a facility is still operating.`}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            {swm.disposal.categories.map((category) => (
              <Chip key={category.key} tone={category.tone}>
                {category.label} {formatNumber(category.count)}
              </Chip>
            ))}
          </div>
        }
        bodyClassName="p-4"
      >
        {!swm.disposal.available ? (
          <div className="flex items-start gap-2 text-[12px] leading-relaxed text-slate-400">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              The ECC/CNC ultralist is not built yet, so landfills and dumpsites cannot be listed. Run{' '}
              <span className="kbd">npm run data:ecc</span> then <span className="kbd">npm run data:swm</span>.
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <div>
              <div className="grid gap-2 sm:grid-cols-3">
                {swm.disposal.categories.map((category) => (
                  <div key={category.key} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      <Factory size={10} />
                      {category.label}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-[20px] font-semibold leading-none text-slate-100">{formatNumber(category.count)}</span>
                      <span className="text-[10px] text-slate-500">{category.mapped} mapped</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="scroll-thin mt-3 max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
                {disposalProjects.length === 0 ? (
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11px] text-slate-400">
                    No disposal facility matches the current province, LGU or search filter.
                  </div>
                ) : (
                  disposalProjects.map((project) => (
                    <div
                      key={`${project.id}-${project.ref}`}
                      className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[11px] text-slate-200">{project.name}</div>
                        <div className="text-[9.5px] text-slate-500">
                          {project.lgu} · {project.province}
                          {project.year ? ` · ${project.year}` : ''}
                          {project.kind ? ` · ${project.kind}` : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {!project.mapped && (
                          <span title="No coordinate in the ECC/CNC record"><MapPinOff size={11} className="text-amber-300/70" /></span>
                        )}
                        <span
                          className={clsx(
                            'h-2 w-2 rounded-full',
                            project.category === 'landfill' && 'bg-amber-400',
                            project.category === 'dumpsite' && 'bg-orange-400',
                            project.category === 'transfer' && 'bg-violet-400',
                          )}
                        />
                        <span className="font-mono text-[9px] text-slate-500">{project.status || '—'}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[10.5px] leading-relaxed text-slate-400">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Coverage</div>
                {Object.entries(swm.disposal.coverage).map(([name, state]) => (
                  <div key={name} className="flex items-center justify-between gap-2 py-0.5">
                    <span>{name}</span>
                    {state === 'covered' ? (
                      <Chip tone="emerald">covered</Chip>
                    ) : (
                      <Chip tone="amber">no data</Chip>
                    )}
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-[10.5px] leading-relaxed text-amber-200/90">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300/80">Read with care</div>
                {swm.disposal.note}
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Solid waste map"
        subtitle="One pin per IIS transaction, plus ECC/CNC disposal approvals. Larger MRF pins serve multiple barangays; use the MRF / Disposal toggles to isolate a layer."
        action={<Chip tone="slate"><Trash2 size={10} /> {formatNumber(facilities.length)} facilities in view</Chip>}
        bodyClassName="p-3"
      >
        <SwmMap facilities={facilities} disposal={disposalProjects} height={540} />
      </Panel>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Barangays served per facility" subtitle="Most MRFs serve a single barangay; a few central facilities cover many">
          <Chart
            height={240}
            option={{
              ...chartBase(),
              grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
              xAxis: { type: 'category', data: Object.keys(charts.buckets), ...axisStyle({ splitLine: { show: false } }) },
              yAxis: { type: 'value', ...axisStyle() },
              series: [
                {
                  type: 'bar',
                  barMaxWidth: 38,
                  data: Object.values(charts.buckets),
                  itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] },
                  label: { show: true, position: 'top', color: '#8ea9a1', fontSize: 10 },
                },
              ],
            }}
          />
        </Panel>

        <Panel className="xl:col-span-2" title="Data quality and source" subtitle="What the register can and cannot support">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Source</div>
              {swm.source.system}. {formatNumber(swm.source.rowsParsed)} rows parsed, {formatNumber(swm.source.pivotRowsRemoved)} pivot rows removed, {formatNumber(swm.source.recordsKept)} register rows kept. Scope: {swm.source.scope}.
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Limits</div>
              {swm.source.note}
            </div>
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-[11px] leading-relaxed text-amber-200/90">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300/80">Coordinates</div>
              {summary.missingCoordinates} facilities have no coordinate.
              {summary.sharedCoordinateFacilities > 0
                ? ` ${summary.sharedCoordinateFacilities} share a coordinate with a facility in another LGU — likely copy/paste in the source, so those pins may be displaced.`
                : ' No coordinate is shared between different LGUs within the Cebu and Bohol scope.'}
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Grouping</div>
              Rows are grouped by IIS transaction. {summary.multiBarangayFacilities} facilities list two or more barangays, which is why facility counts differ from register rows.
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        title="SWM register"
        subtitle="Browse register rows, unique facilities or LGU coverage."
        action={
          <div className="flex rounded-lg border border-white/[0.07] bg-white/[0.02] p-0.5">
            {([
              ['records', `Records (${records.length})`],
              ['facilities', `Facilities (${facilities.length})`],
              ['lgus', `LGUs (${lguRows.length})`],
            ] as [View, string][]).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={clsx(
                  'rounded-md px-2.5 py-1 text-[10.5px] font-semibold transition',
                  view === id ? 'bg-emerald-400/15 text-emerald-300' : 'text-slate-400 hover:text-slate-200',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
        bodyClassName="p-3"
      >
        {view === 'records' && (
          <DataTable
            rows={records}
            columns={recordColumns}
            rowKey={(row) => row.id}
            initialSort={{ key: 'lgu', direction: 'asc' }}
            pageSize={25}
            maxHeight="max-h-[560px]"
          />
        )}
        {view === 'facilities' && (
          <DataTable
            rows={facilities}
            columns={facilityColumns}
            rowKey={(row) => row.key}
            initialSort={{ key: 'lgu', direction: 'asc' }}
            pageSize={25}
            maxHeight="max-h-[560px]"
          />
        )}
        {view === 'lgus' && (
          <DataTable
            rows={lguRows}
            columns={lguColumns}
            rowKey={(row) => `${row.province}|${row.key}`}
            initialSort={{ key: 'coverage', direction: 'asc' }}
            pageSize={25}
            maxHeight="max-h-[560px]"
          />
        )}
      </Panel>
      </>
      )}
    </div>
  );
}
