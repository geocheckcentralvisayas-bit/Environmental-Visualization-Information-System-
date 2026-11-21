import { useEffect, useMemo, useState } from 'react';
import { Download, FileCheck2, MapPin } from 'lucide-react';
import clsx from 'clsx';
import { requestExport } from '../lib/exportGate';
import { getSession } from '../lib/auth';
import { useDashboard, useFilteredClearances } from '../store/useDashboard';
import { Chip, DataTable, Panel, SectionHeading, StatCard, type Column } from '../components/ui';
import { MapButton } from '../components/MapButton';
import { Chart, axisStyle, chartBase } from '../components/Chart';
import {
  CLEARANCE_STYLE, LIFECYCLE_STYLE, downloadCsv, formatDate, formatNumber,
} from '../lib/format';
import type { Clearance, ClearanceType } from '../types';

const KIND_FILTERS: { id: 'all' | ClearanceType; label: string }[] = [
  { id: 'all', label: 'All clearances' },
  { id: 'ECC', label: 'ECC' },
  { id: 'CNC', label: 'CNC' },
  { id: 'ECC/CNC', label: 'Unspecified' },
];

export function ClearancesPage() {
  const data = useDashboard((state) => state.data);
  const clearances = useFilteredClearances();
  const clearancesLoading = useDashboard((state) => state.clearancesLoading);
  const clearancesError = useDashboard((state) => state.clearancesError);
  const loadClearances = useDashboard((state) => state.loadClearances);
  const setPage = useDashboard((state) => state.setPage);
  const [kind, setKind] = useState<'all' | ClearanceType>('all');

  useEffect(() => {
    void loadClearances();
  }, [loadClearances]);

  const visible = useMemo(
    () => (kind === 'all' ? clearances : clearances.filter((clearance) => clearance.type === kind)),
    [clearances, kind],
  );

  const stats = useMemo(() => {
    const ecc = clearances.filter((clearance) => clearance.type === 'ECC').length;
    const cnc = clearances.filter((clearance) => clearance.type === 'CNC').length;
    const ambiguous = clearances.filter((clearance) => clearance.type === 'ECC/CNC').length;
    const linkedSites = new Set(
      clearances.flatMap((clearance) => (clearance.siteIds?.length ? clearance.siteIds : clearance.siteId ? [clearance.siteId] : [])),
    ).size;
    const linkedPermits = clearances.filter((clearance) => clearance.permitRefs.length).length;
    const linkedHw = clearances.filter((clearance) => clearance.hwGrNo || clearance.hwCodes.length).length;
    const active = clearances.filter((clearance) => clearance.lifecycle === 'Active' || clearance.lifecycle === 'Expiring').length;
    return { ecc, cnc, ambiguous, linkedSites, linkedPermits, linkedHw, active };
  }, [clearances]);

  const kindFilters = useMemo(
    () => (stats.ambiguous > 0 ? KIND_FILTERS : KIND_FILTERS.filter((entry) => entry.id !== 'ECC/CNC')),
    [stats.ambiguous],
  );

  const lguSeries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const clearance of visible) {
      const key = clearance.municipality || 'Unmatched';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).reverse();
    return { labels: top.map(([label]) => label), values: top.map(([, value]) => value) };
  }, [visible]);

  const yearSeries = useMemo(() => {
    const ecc = new Map<number, number>();
    const cnc = new Map<number, number>();
    for (const clearance of clearances) {
      if (!clearance.year) continue;
      const bucket = clearance.type === 'CNC' ? cnc : ecc;
      bucket.set(clearance.year, (bucket.get(clearance.year) ?? 0) + 1);
    }
    const years = [...new Set([...ecc.keys(), ...cnc.keys()])].sort();
    return {
      years,
      ecc: years.map((year) => ecc.get(year) ?? 0),
      cnc: years.map((year) => cnc.get(year) ?? 0),
    };
  }, [clearances]);

  const columns: Column<Clearance>[] = [
    {
      key: 'number',
      header: 'Clearance no.',
      sortValue: (row) => row.number,
      render: (row) => (
        <div className="min-w-[150px]">
          <div className="font-mono text-[10.5px] text-slate-200">{row.number}</div>
          <div className="mt-0.5 text-[9px] text-slate-600">{row.sources.join(' · ')}</div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortValue: (row) => row.type,
      render: (row) => <Chip tone={CLEARANCE_STYLE[row.type].chip.replace('chip-', '')}>{CLEARANCE_STYLE[row.type].label}</Chip>,
    },
    {
      key: 'company',
      header: 'Establishment',
      sortValue: (row) => row.company,
      render: (row) => (
        <div className="min-w-[200px] max-w-[300px]">
          <div className="truncate font-medium text-slate-200">{row.company || '—'}</div>
          <div className="mt-0.5 text-[10px] text-slate-500">{[row.barangay, row.municipality, row.province].filter(Boolean).join(', ')}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (row) => row.lifecycle,
      render: (row) => <Chip tone={LIFECYCLE_STYLE[row.lifecycle].chip.replace('chip-', '')}>{row.lifecycle}</Chip>,
    },
    {
      key: 'issued',
      header: 'Issued',
      sortValue: (row) => row.issued ?? '',
      render: (row) => <span className="whitespace-nowrap text-[10.5px] text-slate-400">{formatDate(row.issued)}</span>,
    },
    {
      key: 'expiry',
      header: 'Expiry',
      sortValue: (row) => row.expiry ?? '',
      render: (row) => <span className="whitespace-nowrap text-[10.5px] text-slate-400">{formatDate(row.expiry)}</span>,
    },
    {
      key: 'refs',
      header: 'Linked permits',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.permitRefs.slice(0, 3).map((reference) => (
            <span key={reference} className="rounded-md border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5 text-[9px] text-slate-400">{reference}</span>
          ))}
          {row.permitRefs.length > 3 && <span className="text-[9px] text-slate-600">+{row.permitRefs.length - 3}</span>}
          {!row.permitRefs.length && <span className="text-[9.5px] text-slate-600">—</span>}
        </div>
      ),
    },
    {
      key: 'hw',
      header: 'HW GR',
      sortValue: (row) => row.hwGrNo,
      render: (row) => <span className="font-mono text-[9.5px] text-amber-300">{row.hwGrNo || '—'}</span>,
    },
    {
      key: 'action',
      header: '',
      render: (row) => (
        <div className="flex items-center gap-1">
          <MapButton lat={row.lat} lon={row.lon} label={`${row.company} · ${row.number}`} siteId={row.siteId} />
          <button
            type="button"
            disabled={!row.siteId}
            title={row.siteId ? 'Open establishment details' : 'No matched establishment'}
            className="btn btn-xs whitespace-nowrap"
            onClick={(event) => {
              event.stopPropagation();
              if (row.siteId) useDashboard.getState().selectSite(row.siteId);
            }}
          >
            Details
          </button>
        </div>
      ),
    },
  ];

  const exportRows = () =>
    downloadCsv(
      `envis-clearances-${new Date().toISOString().slice(0, 10)}.csv`,
      visible.map((clearance) => ({
        clearance_no: clearance.number,
        type: clearance.type,
        establishment: clearance.company,
        barangay: clearance.barangay,
        municipality: clearance.municipality,
        province: clearance.province,
        address: clearance.address,
        issued: clearance.issued ?? '',
        expiry: clearance.expiry ?? '',
        lifecycle: clearance.lifecycle,
        app_no: clearance.appNo,
        hw_gr_no: clearance.hwGrNo,
        linked_permits: clearance.permitRefs.join('|'),
        sources: clearance.sources.join('|'),
        waste_codes: clearance.hwCodes.join('|'),
        site_id: clearance.siteId ?? '',
        latitude: clearance.lat ?? '',
        longitude: clearance.lon ?? '',
        scope: clearance.scope,
      })),
    );

  if (!data) return null;

  if (clearancesLoading && !clearances.length) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          <p className="mt-3 text-[11.5px] text-slate-500">Loading the ECC / CNC ultralist…</p>
        </div>
      </div>
    );
  }

  if (clearancesError && !clearances.length) {
    return (
      <div className="card p-6 text-center">
        <p className="text-[13px] font-semibold text-slate-200">Clearances could not be loaded</p>
        <p className="mt-1 text-[11.5px] text-slate-500">{clearancesError}</p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => void loadClearances()}>Try again</button>
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-5">
      <SectionHeading
        eyebrow="Compliance register"
        title="ECC and CNC clearances"
        description="Environmental Compliance Certificates and Certificates of Non-Coverage from the ECC / CNC Ultralist, intercrossed with discharge permits, permits to operate and hazardous-waste registrations."
        action={
          <>
            <button type="button" className="btn" onClick={() => setPage('map')}>
              <MapPin size={13} /> Map view
            </button>
            {getSession()?.role !== 'rd' && (
              <button type="button" className="btn btn-primary" onClick={() => requestExport(exportRows)}>
                <Download size={13} /> Export {formatNumber(visible.length)}
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="ECC clearances" value={formatNumber(stats.ecc)} hint="Environmental Compliance Certificates" icon={<FileCheck2 size={17} />} accent="emerald" onClick={() => setKind('ECC')} />
        <StatCard label="CNC clearances" value={formatNumber(stats.cnc)} hint="Certificates of Non-Coverage" icon={<FileCheck2 size={17} />} accent="sky" onClick={() => setKind('CNC')} />
        <StatCard label="DP / PTO-linked" value={formatNumber(stats.linkedPermits)} hint="Clearances with a linked permit reference" icon={<FileCheck2 size={17} />} accent="violet" />
        <StatCard label="Linked to sites" value={formatNumber(stats.linkedSites)} hint="Establishments matched to the ultralist" icon={<FileCheck2 size={17} />} accent="violet" />
        <StatCard label="HW-linked" value={formatNumber(stats.linkedHw)} hint={`${formatNumber(stats.active)} issued or active`} icon={<FileCheck2 size={17} />} accent="amber" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {kindFilters.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setKind(entry.id)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition',
              kind === entry.id
                ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
                : 'border-white/[0.08] bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-slate-200',
            )}
          >
            {entry.label}
            <span className="font-mono text-[9.5px] text-slate-500">
              {formatNumber(entry.id === 'all' ? clearances.length : clearances.filter((clearance) => clearance.type === entry.id).length)}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Clearances by city / municipality" subtitle="Top LGUs in the current filter">
          <Chart
            height={300}
            option={{
              ...chartBase({ tooltip: { ...chartBase().tooltip, trigger: 'axis' } }),
              grid: { left: 8, right: 16, top: 6, bottom: 4, containLabel: true },
              xAxis: { type: 'value', ...axisStyle() },
              yAxis: {
                type: 'category',
                data: lguSeries.labels,
                ...axisStyle({ splitLine: { show: false } }),
                axisLabel: { color: '#94a3b8', fontSize: 9, width: 110, overflow: 'truncate' },
              },
              series: [
                {
                  type: 'bar',
                  data: lguSeries.values,
                  barMaxWidth: 12,
                  itemStyle: { color: '#38bdf8', borderRadius: [0, 4, 4, 0] },
                  label: { show: true, position: 'right', color: '#8ea9a1', fontSize: 9 },
                },
              ],
            }}
          />
        </Panel>
        <Panel title="ECC vs CNC by year" subtitle="Clearances with a recorded issue year">
          <Chart
            height={300}
            option={{
              ...chartBase(),
              legend: { top: 0, right: 6, icon: 'roundRect', itemWidth: 10, itemHeight: 6, textStyle: { color: '#94a3b8', fontSize: 10 } },
              grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
              xAxis: { type: 'category', data: yearSeries.years, ...axisStyle({ splitLine: { show: false } }) },
              yAxis: { type: 'value', ...axisStyle() },
              series: [
                { name: 'ECC', type: 'bar', stack: 'clearances', data: yearSeries.ecc, barMaxWidth: 24, itemStyle: { color: '#34d399' } },
                { name: 'CNC', type: 'bar', stack: 'clearances', data: yearSeries.cnc, barMaxWidth: 24, itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] } },
              ],
            }}
          />
        </Panel>
      </div>

      <Panel bodyClassName="p-3" title="Clearance register" subtitle={`${formatNumber(visible.length)} clearances matching current filters`}>
        <DataTable<Clearance>
          rows={visible}
          columns={columns}
          rowKey={(row) => row.id}
          onRowClick={(row) => row.siteId && useDashboard.getState().selectSite(row.siteId)}
          pageSize={40}
          maxHeight="max-h-[620px]"
          initialSort={{ key: 'number', direction: 'asc' }}
          empty={<div className="py-12 text-center text-[12px] text-slate-500">No clearances match the current filters.</div>}
        />
      </Panel>
    </div>
  );
}
