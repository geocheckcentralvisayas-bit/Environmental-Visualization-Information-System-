import { useMemo, useState } from 'react';
import { Download, FlaskConical, MapPin, Recycle } from 'lucide-react';
import clsx from 'clsx';
import { requestExport } from '../lib/exportGate';
import { getSession } from '../lib/auth';
import { useDashboard, useFilteredHw } from '../store/useDashboard';
import { Chip, DataTable, Panel, SectionHeading, StatCard, type Column } from '../components/ui';
import { MapButton } from '../components/MapButton';
import { Chart, axisStyle, chartBase } from '../components/Chart';
import {
  CLEARANCE_STYLE, GAP_META, LIFECYCLE_STYLE, RISK_LABELS, downloadCsv, formatDate, formatNumber, riskColor,
} from '../lib/format';
import type { HwRegistration } from '../types';

export function HazardousWastePage() {
  const data = useDashboard((state) => state.data);
  const hw = useFilteredHw();
  const sites = useDashboard((state) => state.data?.sites ?? []);
  const setPage = useDashboard((state) => state.setPage);
  const [showCodes, setShowCodes] = useState(false);

  const stats = useMemo(() => {
    const active = hw.filter((registration) => registration.lifecycle === 'Active').length;
    const expiring = hw.filter((registration) => registration.lifecycle === 'Expiring').length;
    const expired = hw.filter((registration) => registration.lifecycle === 'Expired').length;
    const matched = hw.filter((registration) => registration.matched).length;
    const records = hw.reduce((total, registration) => total + registration.recordCount, 0);
    const codes = new Set(hw.flatMap((registration) => registration.wasteCodes.map((code) => code.code)));
    const ecc = hw.reduce((total, registration) => total + registration.eccNos.length, 0);
    const cnc = hw.reduce((total, registration) => total + registration.cncNos.length, 0);
    return { active, expiring, expired, matched, records, codes: codes.size, ecc, cnc };
  }, [hw]);

  const wasteSeries = useMemo(() => {
    const labels = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const registration of hw) {
      for (const code of registration.wasteCodes) {
        if (!labels.has(code.code)) labels.set(code.code, `${code.code} · ${code.description || 'Unspecified'}`);
      }
      for (const [code, count] of Object.entries(registration.wasteRecordCounts ?? {})) {
        counts.set(code, (counts.get(code) ?? 0) + count);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).reverse();
    return {
      labels: top.map(([code]) => labels.get(code) ?? code),
      values: top.map(([, value]) => value),
    };
  }, [hw]);

  const subtypeSeries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const registration of hw) {
      const key = registration.subtype || 'Unspecified';
      counts.set(key, (counts.get(key) ?? 0) + registration.recordCount);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [hw]);

  const yearSeries = useMemo(() => {
    const counts = new Map<number, number>();
    for (const registration of hw) {
      if (registration.issued) {
        const year = Number(registration.issued.slice(0, 4));
        counts.set(year, (counts.get(year) ?? 0) + registration.recordCount);
      }
    }
    const years = [...counts.keys()].sort();
    return { years, values: years.map((year) => counts.get(year) ?? 0) };
  }, [hw]);

  const handlerSeries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const registration of hw) {
      const key = registration.caseHandler ? `${registration.caseHandler}` : 'Unassigned';
      counts.set(key, (counts.get(key) ?? 0) + registration.recordCount);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).reverse();
  }, [hw]);

  const columns: Column<HwRegistration>[] = [
    {
      key: 'company',
      header: 'Establishment',
      sortValue: (row) => row.company,
      render: (row) => (
        <div className="min-w-[220px] max-w-[320px]">
          <div className="truncate font-medium text-slate-200">{row.company}</div>
          <div className="mt-0.5 text-[10px] text-slate-500">{[row.barangay, row.municipality, row.province].filter(Boolean).join(', ')}</div>
        </div>
      ),
    },
    {
      key: 'gr',
      header: 'HW GR no.',
      sortValue: (row) => row.hwGrNo,
      render: (row) => <span className="font-mono text-[10.5px] text-amber-300">{row.hwGrNo || '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (row) => row.lifecycle,
      render: (row) => <Chip tone={LIFECYCLE_STYLE[row.lifecycle].chip.replace('chip-', '')}>{row.lifecycle}</Chip>,
    },
    {
      key: 'subtype',
      header: 'Filing',
      sortValue: (row) => row.subtype,
      render: (row) => <span className="text-[10.5px] text-slate-400">{row.subtype}</span>,
    },
    {
      key: 'records',
      header: 'Records',
      sortValue: (row) => row.recordCount,
      render: (row) => <span className="font-mono text-[10.5px] text-slate-400">{formatNumber(row.recordCount)}</span>,
    },
    {
      key: 'handler',
      header: 'Case handler',
      sortValue: (row) => row.caseHandler,
      render: (row) => <span className="text-[10.5px] text-slate-400">{row.caseHandler || '—'}</span>,
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
      key: 'codes',
      header: 'Waste codes',
      sortValue: (row) => row.wasteCount,
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.wasteCodes.slice(0, 3).map((code) => (
            <span key={code.code} className="rounded-md border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5 text-[9px] text-slate-400">{code.code}</span>
          ))}
          {row.wasteCodes.length > 3 && <span className="text-[9px] text-slate-600">+{row.wasteCodes.length - 3}</span>}
        </div>
      ),
    },
    {
      key: 'clearances',
      header: 'ECC / CNC',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.eccNos.map((number) => <Chip key={number} tone="emerald">{number}</Chip>)}
          {row.cncNos.map((number) => <Chip key={number} tone="sky">{number}</Chip>)}
          {!row.eccNos.length && !row.cncNos.length && <span className="text-[9.5px] text-slate-600">—</span>}
        </div>
      ),
    },
    {
      key: 'match',
      header: 'Register match',
      sortValue: (row) => (row.matched ? 'matched' : 'hw-only'),
      render: (row) => (
        <Chip tone={row.matched ? 'emerald' : 'amber'}>{row.matched ? 'DP / PTO' : 'HW only'}</Chip>
      ),
    },
    {
      key: 'action',
      header: '',
      render: (row) => (
        <div className="flex items-center gap-1">
          <MapButton
            lat={row.lat}
            lon={row.lon}
            label={`${row.company} · ${row.hwGrNo || row.appNo}`}
            siteId={row.siteId}
          />
          <button
            type="button"
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
      `envis-hazardous-waste-${new Date().toISOString().slice(0, 10)}.csv`,
      hw.map((registration) => ({
        app_no: registration.appNo,
        hw_gr_no: registration.hwGrNo,
        establishment: registration.company,
        barangay: registration.barangay,
        municipality: registration.municipality,
        province: registration.province,
        address: registration.address,
        subtype: registration.subtype,
        issued: registration.issued ?? '',
        expiry: registration.expiry ?? '',
        lifecycle: registration.lifecycle,
        case_handler: registration.caseHandler,
        pco: registration.pco,
        pco_accreditation: registration.pcoAccreditation,
        employees: registration.employees,
        industry: registration.industry,
        psic: registration.psic,
        ecc_nos: registration.eccNos.join('|'),
        cnc_nos: registration.cncNos.join('|'),
        pto_nos: registration.ptoNos.join('|'),
        dp_nos: registration.dpNos.join('|'),
        waste_codes: registration.wasteCodes.map((code) => code.code).join('|'),
        waste_descriptions: registration.wasteCodes.map((code) => code.description).join('; '),
        waste_practice: registration.wasteCodes.map((code) => code.practice).filter(Boolean).join('; '),
        record_count: registration.recordCount,
        matched_to_site: registration.matched ? 'yes' : 'no',
        site_id: registration.siteId ?? '',
        latitude: registration.lat ?? '',
        longitude: registration.lon ?? '',
        scope: registration.scope,
        qa_flags: registration.qa.join('|'),
      })),
    );

  if (!data) return null;

  return (
    <div className="animate-fade-up space-y-5">
      <SectionHeading
        eyebrow="Compliance register"
        title="Hazardous waste generators"
        description="Hazardous-waste generator registrations from the DENR-EMB Region VII register, de-duplicated by application number and intercrossed with DP, PTO and ECC / CNC references."
        action={
          <>
            <button type="button" className="btn" onClick={() => setPage('map')}>
              <MapPin size={13} /> Map
            </button>
            <button type="button" className="btn" onClick={() => setShowCodes((value) => !value)}>
              {showCodes ? 'Hide waste codes' : 'Show waste codes'}
            </button>
            {getSession()?.role !== 'rd' && (
              <button type="button" className="btn btn-primary" onClick={() => requestExport(exportRows)}>
                <Download size={13} /> Export {formatNumber(hw.length)}
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="HW registrations" value={formatNumber(hw.length)} hint={`${formatNumber(data.meta.totals.hwGenerators)} unique HW GR numbers`} icon={<FlaskConical size={17} />} accent="amber" />
        <StatCard label="HW records" value={formatNumber(stats.records)} hint={`${formatNumber(stats.codes)} distinct waste codes`} icon={<Recycle size={17} />} accent="emerald" />
        <StatCard label="Active" value={formatNumber(stats.active)} hint={`${formatNumber(stats.expiring)} expiring Â· ${formatNumber(stats.expired)} expired`} icon={<FlaskConical size={17} />} accent="emerald" />
        <StatCard label="Linked to DP / PTO" value={formatNumber(stats.matched)} hint={`${formatNumber(hw.length - stats.matched)} HW-only generators`} icon={<FlaskConical size={17} />} accent="sky" footer={<div className="text-[10px] text-slate-500">{hw.length ? Math.round((stats.matched / hw.length) * 100) : 0}% matched</div>} />
        <StatCard label="ECC / CNC refs" value={formatNumber(stats.ecc + stats.cnc)} hint={`${formatNumber(stats.ecc)} ECC Â· ${formatNumber(stats.cnc)} CNC`} icon={<FlaskConical size={17} />} accent="violet" />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Top hazardous waste streams" subtitle="Most frequently reported waste codes in the current filter">
          <Chart
            height={300}
            option={{
              ...chartBase({ tooltip: { ...chartBase().tooltip, trigger: 'axis' } }),
              grid: { left: 8, right: 16, top: 6, bottom: 4, containLabel: true },
              xAxis: { type: 'value', ...axisStyle() },
              yAxis: {
                type: 'category',
                data: wasteSeries.labels,
                ...axisStyle({ splitLine: { show: false } }),
                axisLabel: { color: '#94a3b8', fontSize: 9, width: 220, overflow: 'truncate' },
              },
              series: [
                {
                  type: 'bar',
                  data: wasteSeries.values,
                  barMaxWidth: 12,
                  itemStyle: { color: '#f59e0b', borderRadius: [0, 4, 4, 0] },
                  label: { show: true, position: 'right', color: '#8ea9a1', fontSize: 9 },
                },
              ],
            }}
          />
        </Panel>
        <Panel title="Filing mix" subtitle="New vs amendment registrations">
          <div className="space-y-2.5">
            {subtypeSeries.map(([label, count]) => (
              <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11.5px]">
                <span className="text-slate-300">{label}</span>
                <span className="font-mono text-slate-400">{formatNumber(count)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-[10.5px] leading-relaxed text-slate-500">
            <b className="text-slate-300">Records</b> are the register's waste-stream rows, so one application can contribute several records (one per declared HW code).
          </div>
        </Panel>
      </div>

      {showCodes && (
        <Panel title="Waste code detail" subtitle="Distinct waste codes reported by the filtered generators">
          <div className="flex flex-wrap gap-1.5">
            {[...new Set(hw.flatMap((registration) => registration.wasteCodes.map((code) => code.code)))].sort().map((code) => (
              <span key={code} className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1 text-[10px] text-slate-400">{code}</span>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="HW records by year" subtitle="Waste-stream records by application year (Cebu + Bohol)">
          <Chart
            height={260}
            option={{
              ...chartBase({ tooltip: { ...chartBase().tooltip, trigger: 'axis' } }),
              grid: { left: 8, right: 16, top: 6, bottom: 4, containLabel: true },
              xAxis: { type: 'category', data: yearSeries.years, ...axisStyle({ splitLine: { show: false } }) },
              yAxis: { type: 'value', ...axisStyle() },
              series: [{ type: 'bar', data: yearSeries.values, barMaxWidth: 24, itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', color: '#8ea9a1', fontSize: 9 } }],
            }}
          />
        </Panel>
        <Panel title="HW by sub type" subtitle="New vs amendment waste-stream records">
          <Chart
            height={260}
            option={{
              ...chartBase({ tooltip: { trigger: 'item' } }),
              legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { color: '#94a3b8', fontSize: 10 } },
              series: [{
                type: 'pie',
                radius: ['45%', '72%'],
                center: ['50%', '42%'],
                itemStyle: { borderColor: '#07110e', borderWidth: 3 },
                label: { show: false },
                data: subtypeSeries.map(([name, value]) => ({ name, value, itemStyle: { color: name.toLowerCase().includes('amend') ? '#38bdf8' : '#f59e0b' } })),
              }],
            }}
          />
        </Panel>
      </div>

      <Panel title="Records by case handler" subtitle="Waste-stream records per DENR-EMB case handler">
        <Chart
          height={260}
          option={{
            ...chartBase({ tooltip: { ...chartBase().tooltip, trigger: 'axis' } }),
            grid: { left: 8, right: 16, top: 6, bottom: 4, containLabel: true },
            xAxis: { type: 'value', ...axisStyle() },
            yAxis: { type: 'category', data: handlerSeries.map(([label]) => label), ...axisStyle({ splitLine: { show: false } }), axisLabel: { color: '#94a3b8', fontSize: 9, width: 160, overflow: 'truncate' } },
            series: [{ type: 'bar', data: handlerSeries.map(([, value]) => value), barMaxWidth: 12, itemStyle: { color: '#a78bfa', borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: '#8ea9a1', fontSize: 9 } }],
          }}
        />
      </Panel>

      <Panel bodyClassName="p-3" title="PCO accreditation directory - hazardous waste only" subtitle={`${formatNumber(hw.length)} registrations matching current filters`}>
        <DataTable
          rows={hw}
          columns={[
            { key: 'company', header: 'Company', sortValue: (row) => row.company, render: (row) => <span className="block max-w-[220px] truncate font-medium text-slate-200">{row.company}</span> },
            { key: 'address', header: 'Company address', render: (row) => <span className="block max-w-[220px] truncate text-[10px] text-slate-500">{row.address}</span> },
            { key: 'lgu', header: 'Municipality / City', sortValue: (row) => row.municipality, render: (row) => <span className="text-[10.5px] text-slate-400">{row.municipality}, {row.province}</span> },
            { key: 'handler', header: 'Case handler', sortValue: (row) => row.caseHandler, render: (row) => <span className="text-[10.5px] text-slate-400">{row.caseHandler || '—'}</span> },
            { key: 'pco', header: 'PCO name', sortValue: (row) => row.pco, render: (row) => <span className="text-[10.5px] text-slate-400">{row.pco || '—'}</span> },
            { key: 'accred', header: 'PCO accreditation no.', render: (row) => <span className="font-mono text-[9.5px] text-slate-500">{row.pcoAccreditation || '—'}</span> },
            { key: 'date', header: 'Accreditation date', sortValue: (row) => row.pcoAccreditationDate ?? '', render: (row) => <span className="whitespace-nowrap text-[10.5px] text-slate-400">{formatDate(row.pcoAccreditationDate)}</span> },
          ]}
          rowKey={(row) => row.id}
          pageSize={25}
          maxHeight="max-h-[520px]"
          initialSort={{ key: 'company', direction: 'asc' }}
          empty={<div className="py-12 text-center text-[12px] text-slate-500">No contacts match the current filters.</div>}
        />
      </Panel>

      <Panel bodyClassName="p-3" title="Hazardous-waste register" subtitle={`${formatNumber(hw.length)} generators matching current filters`}>
        <DataTable<HwRegistration>
          rows={hw}
          columns={columns}
          rowKey={(row) => row.id}
          onRowClick={(row) => row.siteId && useDashboard.getState().selectSite(row.siteId)}
          pageSize={40}
          maxHeight="max-h-[620px]"
          initialSort={{ key: 'company', direction: 'asc' }}
          empty={<div className="py-12 text-center text-[12px] text-slate-500">No hazardous-waste registrations match the current filters.</div>}
        />
      </Panel>
    </div>
  );
}




