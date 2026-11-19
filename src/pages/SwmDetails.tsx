import { useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, Building2, ContactRound, FileCheck2, Mail, Phone, Recycle, Scale, Users,
} from 'lucide-react';
import clsx from 'clsx';
import { useDashboard } from '../store/useDashboard';
import { Chart, axisStyle, chartBase } from '../components/Chart';
import { Chip, DataTable, Panel, StatCard, type Column } from '../components/ui';
import { formatNumber } from '../lib/format';
import type {
  SwmComplianceRecord, SwmContact, SwmWacsRecord,
} from '../types';

export type SwmSection = 'overview' | 'wacs' | 'compliance' | 'contacts' | 'database';

const TONE = {
  Compliant: 'emerald',
  'Non-Compliant': 'rose',
  'Not stated': 'slate',
} as const;

const CRITERIA_TONE = {
  compliant: 'emerald',
  'non-compliant': 'rose',
  na: 'slate',
} as const;

function inScope(row: { province: string; lgu: string; lguKey?: string }, province: string, lgu: string, search: string) {
  if (province !== 'all' && row.province !== province) return false;
  if (lgu !== 'all' && row.lgu.toLowerCase() !== lgu.toLowerCase()) return false;
  if (!search.trim()) return true;
  const query = search.trim().toLowerCase();
  return Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(query));
}

export function SwmDetails({ section }: { section: Exclude<SwmSection, 'overview'> }) {
  const workbook = useDashboard((state) => state.swm?.workbook ?? null);
  const [version, setVersion] = useState<'current' | 'old'>('current');
  const [showAllLists, setShowAllLists] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [province, setProvince] = useState('all');
  const [search, setSearch] = useState('');

  const wacsRows = useMemo(
    () => (workbook?.wacs.records ?? []).filter((row) => inScope(row, province, 'all', search)),
    [workbook, province, search],
  );
  const contactRows = useMemo(
    () => (workbook?.contacts.records ?? []).filter((row) => inScope(row, province, 'all', search)),
    [workbook, province, search],
  );
  const complianceSet = version === 'current' ? workbook?.compliance.current : workbook?.compliance.old;
  const complianceRows = useMemo(
    () => (complianceSet?.records ?? []).filter((row) => inScope(row, province, 'all', search)),
    [complianceSet, province, search],
  );

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-ink-850/60 px-3 py-2.5">
      <select className="select h-8 w-auto min-w-[140px] text-[11px]" value={province} onChange={(event) => setProvince(event.target.value)}>
        <option value="all">All provinces</option>
        <option value="Cebu">Cebu</option>
        <option value="Bohol">Bohol</option>
      </select>
      <div className="relative min-w-[220px] flex-1">
        <Recycle size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input className="input h-8 pl-7 text-[11px]" placeholder="Search LGU or any field in this section." value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <span className="text-[10.5px] text-slate-500">{formatNumber(wacsRows.length || complianceRows.length || contactRows.length)} matching LGUs</span>
    </div>
  );

  if (!workbook?.available) {
    return (
      <Panel title="SWM Overall Database not loaded">
        <div className="flex items-start gap-2 text-[12px] leading-relaxed text-slate-400">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
          <div>{workbook?.note ?? 'Add data/SWM Overall Database.xlsx and rerun npm run data:swm.'}</div>
        </div>
      </Panel>
    );
  }

  /* ---------------------------------------------------------------- */
  /* WACS                                                              */
  /* ---------------------------------------------------------------- */
  if (section === 'wacs') {
    const summary = workbook.wacs.summary;
    const total = wacsRows.reduce((sum, row) => sum + (row.totalKgDay ?? 0), 0);
    const projected = wacsRows.reduce((sum, row) => sum + (row.projected2025KgDay ?? 0), 0);
    const population = wacsRows.reduce((sum, row) => sum + (row.population2015 ?? 0), 0);
    const composition = {
      bio: wacsRows.reduce((sum, row) => sum + (row.bioKgDay ?? 0), 0),
      recyclable: wacsRows.reduce((sum, row) => sum + (row.recyclableKgDay ?? 0), 0),
      residual: wacsRows.reduce((sum, row) => sum + (row.residualKgDay ?? 0), 0),
      special: wacsRows.reduce((sum, row) => sum + (row.specialKgDay ?? 0), 0),
    };
    const byProvince = ['Cebu', 'Bohol'].map((name) => {
      const rows = wacsRows.filter((row) => row.province === name);
      return { name, lgus: rows.length, total: rows.reduce((sum, row) => sum + (row.totalKgDay ?? 0), 0) };
    });
    const byDisposal = Object.entries(
      wacsRows.reduce<Record<string, { name: string; lgus: number; total: number }>>((acc, row) => {
        const name = row.disposalFacility || 'Not stated';
        acc[name] ??= { name, lgus: 0, total: 0 };
        acc[name].lgus += 1;
        acc[name].total += row.totalKgDay ?? 0;
        return acc;
      }, {}),
    ).map(([, value]) => value).sort((a, b) => b.lgus - a.lgus);

    const columns: Column<SwmWacsRecord>[] = [
      { key: 'lgu', header: 'LGU', sortValue: (row) => row.lgu, render: (row) => (
        <div><div className="text-[11.5px] font-medium text-slate-200">{row.lgu}</div><div className="text-[10px] text-slate-500">{row.province}</div></div>
      ) },
      { key: 'year', header: 'WACS year', sortValue: (row) => row.wacsYear ?? 0, render: (row) => <span className="font-mono text-[10.5px] text-slate-400">{row.wacsYear ?? '—'}</span> },
      { key: 'total', header: 'Generation (kg/day)', sortValue: (row) => row.totalKgDay ?? 0, render: (row) => <span className="font-mono text-[10.5px] text-emerald-300">{formatNumber(Math.round(row.totalKgDay ?? 0))}</span> },
      { key: 'projected', header: '2025 projected (kg/day)', sortValue: (row) => row.projected2025KgDay ?? 0, render: (row) => <span className="font-mono text-[10.5px] text-sky-300">{formatNumber(Math.round(row.projected2025KgDay ?? 0))}</span> },
      { key: 'pcg', header: 'PCG (kg/day)', sortValue: (row) => row.pcgKgDay ?? 0, render: (row) => <span className="font-mono text-[10.5px] text-slate-400">{row.pcgKgDay ?? '—'}</span> },
      { key: 'population', header: 'Population (2015)', sortValue: (row) => row.population2015 ?? 0, render: (row) => <span className="font-mono text-[10.5px] text-slate-400">{formatNumber(row.population2015 ?? 0)}</span> },
      { key: 'disposal', header: 'Disposal facility', sortValue: (row) => row.disposalFacility, render: (row) => <span className="text-[10.5px] text-slate-300">{row.disposalFacility || '—'}</span> },
    ];

    return (
      <div className="animate-fade-up space-y-4">
        {filterBar}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="LGUs with WACS" value={formatNumber(wacsRows.length)} hint={`of ${summary?.lgus ?? 0} in scope`} icon={<Users size={17} />} accent="sky" />
          <StatCard label="Generation" value={formatNumber(Math.round(total))} hint="kg/day, reported WACS" icon={<Scale size={17} />} accent="emerald" />
          <StatCard label="2025 projected" value={formatNumber(Math.round(projected))} hint="kg/day, workbook projection" icon={<Recycle size={17} />} accent="violet" />
          <StatCard label="Population (2015)" value={formatNumber(population)} hint="PSA 2015 base" icon={<Building2 size={17} />} accent="amber" />
          <StatCard label="Avg PCG" value={summary?.avgPcgKgDay?.toFixed(2) ?? '—'} hint="kg/day per capita" icon={<Scale size={17} />} accent="slate" />
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          <Panel title="Waste composition" subtitle="Reported kg/day in the current filter">
            <Chart height={260} option={{
              ...chartBase(),
              legend: { bottom: 0, textStyle: { color: '#94a3b8', fontSize: 10 }, icon: 'circle', itemHeight: 7 },
              series: [{
                type: 'pie', radius: ['52%', '76%'], center: ['50%', '43%'],
                itemStyle: { borderColor: 'rgba(5,14,11,0.9)', borderWidth: 2 },
                label: { show: false },
                data: [
                  { name: 'Biodegradable', value: Math.round(composition.bio), itemStyle: { color: '#34d399' } },
                  { name: 'Recyclable', value: Math.round(composition.recyclable), itemStyle: { color: '#38bdf8' } },
                  { name: 'Residual', value: Math.round(composition.residual), itemStyle: { color: '#fb7185' } },
                  { name: 'Special', value: Math.round(composition.special), itemStyle: { color: '#fbbf24' } },
                ],
              }],
            }} />
          </Panel>
          <Panel className="xl:col-span-2" title="Generation by province" subtitle="Reported and projected kg/day">
            <Chart height={260} option={{
              ...chartBase(),
              legend: { top: 0, textStyle: { color: '#94a3b8', fontSize: 10 }, icon: 'roundRect', itemHeight: 7 },
              grid: { left: 8, right: 16, top: 34, bottom: 4, containLabel: true },
              xAxis: { type: 'category', data: byProvince.map((entry) => entry.name), ...axisStyle({ splitLine: { show: false } }) },
              yAxis: { type: 'value', ...axisStyle() },
              series: [
                { name: 'Reported kg/day', type: 'bar', barMaxWidth: 46, data: byProvince.map((entry) => Math.round(entry.total)), itemStyle: { color: '#34d399', borderRadius: [4, 4, 0, 0] } },
                { name: '2025 projected kg/day', type: 'bar', barMaxWidth: 46, data: byProvince.map((entry) => Math.round(wacsRows.filter((row) => row.province === entry.name).reduce((sum, row) => sum + (row.projected2025KgDay ?? 0), 0))), itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] } },
              ],
            }} />
          </Panel>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <Panel title="WACS year coverage" subtitle="LGUs by year the study was conducted">
            <Chart height={240} option={{
              ...chartBase(),
              grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
              xAxis: { type: 'category', data: (summary?.byYear ?? []).map((entry) => String(entry.year)), ...axisStyle({ splitLine: { show: false } }) },
              yAxis: { type: 'value', ...axisStyle() },
              series: [{ type: 'bar', barMaxWidth: 32, data: (summary?.byYear ?? []).map((entry) => entry.lgus), itemStyle: { color: '#a78bfa', borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', color: '#8ea9a1', fontSize: 10 } }],
            }} />
          </Panel>
          <Panel title="Disposal facility mix" subtitle="LGUs by reported current disposal facility">
            <Chart height={240} option={{
              ...chartBase(),
              grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
              xAxis: { type: 'value', ...axisStyle() },
              yAxis: { type: 'category', data: byDisposal.map((entry) => entry.name), ...axisStyle({ splitLine: { show: false } }), axisLabel: { color: '#94a3b8', fontSize: 9.5, width: 130, overflow: 'truncate' } },
              series: [{ type: 'bar', barMaxWidth: 15, data: byDisposal.map((entry) => entry.lgus), itemStyle: { color: '#fbbf24', borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: '#8ea9a1', fontSize: 9 } }],
            }} />
          </Panel>
        </div>

        <Panel title="WACS register" subtitle="Waste analysis and characterisation study, Cebu and Bohol" bodyClassName="p-3">
          <DataTable rows={wacsRows} columns={columns} rowKey={(row) => row.lguKey} initialSort={{ key: 'total', direction: 'desc' }} pageSize={25} maxHeight="max-h-[560px]" />
        </Panel>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Annual compliance summary (current + archived)                    */
  /* ---------------------------------------------------------------- */
  if (section === 'compliance') {
    const summary = complianceSet?.summary;
    const compliant = complianceRows.filter((row) => row.overall === 'Compliant').length;
    const nonCompliant = complianceRows.filter((row) => row.overall === 'Non-Compliant').length;
    const byProvince = ['Cebu', 'Bohol'].map((name) => {
      const rows = complianceRows.filter((row) => row.province === name);
      return {
        name,
        compliant: rows.filter((row) => row.overall === 'Compliant').length,
        nonCompliant: rows.filter((row) => row.overall === 'Non-Compliant').length,
        other: rows.filter((row) => !['Compliant', 'Non-Compliant'].includes(row.overall)).length,
      };
    });
    const criteria = (summary?.criteria ?? []).map((criterion) => {
      const withRows = complianceRows.filter((row) => row.criteria.some((item) => item.key === criterion.key));
      return {
        label: criterion.label,
        compliant: withRows.filter((row) => row.criteria.find((item) => item.key === criterion.key)?.status === 'compliant').length,
        nonCompliant: withRows.filter((row) => row.criteria.find((item) => item.key === criterion.key)?.status === 'non-compliant').length,
      };
    });

    const columns: Column<SwmComplianceRecord>[] = [
      { key: 'lgu', header: 'LGU', sortValue: (row) => row.lgu, render: (row) => (
        <div><div className="text-[11.5px] font-medium text-slate-200">{row.lgu}</div><div className="text-[10px] text-slate-500">{row.province} · {row.district}</div></div>
      ) },
      { key: 'overall', header: 'Overall', sortValue: (row) => row.overall, render: (row) => <Chip tone={TONE[row.overall as keyof typeof TONE] ?? 'slate'}>{row.overall}</Chip> },
      { key: 'disposal', header: 'Current disposal', sortValue: (row) => row.disposalFacility, render: (row) => <span className="text-[10.5px] text-slate-300">{row.disposalFacility || '—'}</span> },
      { key: 'plan', header: '10-year plan', sortValue: (row) => row.planStatus, render: (row) => <span className="text-[10.5px] text-slate-300">{row.planStatus || '—'}</span> },
      { key: 'dumpsite', header: 'Dumpsite status', sortValue: (row) => row.dumpsiteStatus, render: (row) => <span className="text-[10.5px] text-slate-300">{row.dumpsiteStatus || '—'}</span> },
      { key: 'scrp', header: 'SCRP', sortValue: (row) => row.scrpStatus, render: (row) => <span className="text-[10.5px] text-slate-300">{row.scrpStatus || '—'}</span> },
      ...(version === 'old' ? [
        { key: 'planStart', header: 'Plan period', sortValue: (row: SwmComplianceRecord) => row.planStart ?? 0, render: (row: SwmComplianceRecord) => <span className="font-mono text-[10.5px] text-slate-400">{row.planStart ?? '—'}{row.planEnd ? `–${row.planEnd}` : ''}</span> },
      ] : [
        { key: 'equipment', header: 'SWM equipment', sortValue: (row: SwmComplianceRecord) => row.equipmentStatus ?? '', render: (row: SwmComplianceRecord) => <span className="text-[10.5px] text-slate-300">{row.equipmentStatus || '—'}</span> },
      ]),
    ];

    return (
      <div className="animate-fade-up space-y-4">
        {filterBar}
        <Panel
          title="Annual compliance summary"
          subtitle="Switch between the current summary and the archived older version from the SWM workbook."
          action={
            <div className="flex rounded-lg border border-white/[0.07] bg-white/[0.02] p-0.5">
              {([['current', 'Current'], ['old', 'Old / archived']] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setVersion(id)} className={clsx('rounded-md px-2.5 py-1 text-[10.5px] font-semibold transition', version === id ? 'bg-emerald-400/15 text-emerald-300' : 'text-slate-400 hover:text-slate-200')}>{label}</button>
              ))}
            </div>
          }
          bodyClassName="p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="LGUs assessed" value={formatNumber(complianceRows.length)} hint={`${version === 'old' ? 'archived' : 'current'} summary`} icon={<Users size={17} />} accent="sky" />
            <StatCard label="Compliant" value={formatNumber(compliant)} hint="overall status" icon={<FileCheck2 size={17} />} accent="emerald" />
            <StatCard label="Non-compliant" value={formatNumber(nonCompliant)} hint="overall status" icon={<AlertTriangle size={17} />} accent="rose" />
            <StatCard label="Compliance rate" value={`${complianceRows.length ? Math.round((compliant / complianceRows.length) * 100) : 0}%`} hint="of assessed LGUs in filter" icon={<Scale size={17} />} accent="amber" />
          </div>
        </Panel>

        <div className="grid gap-3 xl:grid-cols-2">
          <Panel title="Compliance by province" subtitle="Overall status from the selected summary">
            <Chart height={250} option={{
              ...chartBase(),
              legend: { top: 0, textStyle: { color: '#94a3b8', fontSize: 10 }, icon: 'roundRect', itemHeight: 7 },
              grid: { left: 8, right: 16, top: 34, bottom: 4, containLabel: true },
              xAxis: { type: 'category', data: byProvince.map((entry) => entry.name), ...axisStyle({ splitLine: { show: false } }) },
              yAxis: { type: 'value', ...axisStyle() },
              series: [
                { name: 'Compliant', type: 'bar', stack: 'status', barMaxWidth: 54, data: byProvince.map((entry) => entry.compliant), itemStyle: { color: '#34d399' } },
                { name: 'Non-compliant', type: 'bar', stack: 'status', barMaxWidth: 54, data: byProvince.map((entry) => entry.nonCompliant), itemStyle: { color: '#fb7185' } },
                { name: 'Other', type: 'bar', stack: 'status', barMaxWidth: 54, data: byProvince.map((entry) => entry.other), itemStyle: { color: '#64748b' } },
              ],
            }} />
          </Panel>
          <Panel title="Criterion pass rate" subtitle="LGUs meeting each compliance criterion in the current filter">
            <Chart height={250} option={{
              ...chartBase(),
              grid: { left: 8, right: 20, top: 16, bottom: 4, containLabel: true },
              xAxis: { type: 'value', max: complianceRows.length || 1, ...axisStyle() },
              yAxis: { type: 'category', data: criteria.map((entry) => entry.label), ...axisStyle({ splitLine: { show: false } }), axisLabel: { color: '#94a3b8', fontSize: 9.5, width: 120, overflow: 'truncate' } },
              series: [
                { name: 'Compliant', type: 'bar', stack: 'c', barMaxWidth: 13, data: criteria.map((entry) => entry.compliant), itemStyle: { color: '#34d399' } },
                { name: 'Non-compliant', type: 'bar', stack: 'c', barMaxWidth: 13, data: criteria.map((entry) => entry.nonCompliant), itemStyle: { color: '#fb7185', borderRadius: [0, 4, 4, 0] } },
              ],
            }} />
          </Panel>
        </div>

        <Panel title={version === 'old' ? 'Archived annual compliance summary' : 'Current annual compliance summary'} subtitle="One row per LGU · Cebu and Bohol" bodyClassName="p-3">
          <DataTable rows={complianceRows} columns={columns} rowKey={(row) => row.id} initialSort={{ key: 'overall', direction: 'desc' }} pageSize={25} maxHeight="max-h-[600px]" />
        </Panel>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* LGU contact details                                               */
  /* ---------------------------------------------------------------- */
  if (section === 'contacts') {
    const summary = workbook.contacts.summary;
    const columns: Column<SwmContact>[] = [
      { key: 'lgu', header: 'LGU', sortValue: (row) => row.lgu, render: (row) => (
        <div className="min-w-[150px]"><div className="text-[11.5px] font-medium text-slate-200">{row.lgu}</div><div className="text-[10px] text-slate-500">{row.province} · {row.district}</div></div>
      ) },
      { key: 'mayor', header: 'Mayor', sortValue: (row) => row.mayor, render: (row) => (
        <div className="min-w-[170px]"><div className="text-[11px] text-slate-200">{row.mayor || '—'}</div>{row.mayorContact && <div className="flex items-center gap-1 text-[10px] text-slate-400"><Phone size={9} /> {row.mayorContact}</div>}{row.mayorEmail && <div className="flex items-center gap-1 text-[10px] text-sky-300"><Mail size={9} /> {row.mayorEmail}</div>}</div>
      ) },
      { key: 'vice', header: 'Vice mayor', sortValue: (row) => row.viceMayor, render: (row) => (
        <div className="min-w-[170px]"><div className="text-[11px] text-slate-200">{row.viceMayor || '—'}</div>{row.viceMayorContact && <div className="flex items-center gap-1 text-[10px] text-slate-400"><Phone size={9} /> {row.viceMayorContact}</div>}{row.viceMayorEmail && <div className="flex items-center gap-1 text-[10px] text-sky-300"><Mail size={9} /> {row.viceMayorEmail}</div>}</div>
      ) },
      { key: 'focal', header: 'MENRO / SWM focal', sortValue: (row) => row.focal, render: (row) => (
        <div className="min-w-[190px]"><div className="text-[11px] text-slate-200">{row.focal || '—'}</div><div className="text-[9.5px] text-slate-500">{row.focalPosition}</div>{row.focalContact && <div className="flex items-center gap-1 text-[10px] text-slate-400"><Phone size={9} /> {row.focalContact}</div>}{row.focalEmail && <div className="flex items-center gap-1 text-[10px] text-sky-300"><Mail size={9} /> {row.focalEmail}</div>}</div>
      ) },
      { key: 'address', header: 'Mailing address', sortValue: (row) => row.address, render: (row) => <span className="text-[10.5px] text-slate-400">{row.address || '—'}{row.zip ? ` · ${row.zip}` : ''}</span> },
      { key: 'class', header: 'Income class', sortValue: (row) => row.incomeClass, render: (row) => <span className="font-mono text-[10.5px] text-slate-400">{row.incomeClass || '—'}</span> },
      { key: 'brgys', header: 'Barangays', sortValue: (row) => row.barangays ?? 0, render: (row) => <span className="font-mono text-[10.5px] text-slate-400">{formatNumber(row.barangays ?? 0)}</span> },
    ];

    return (
      <div className="animate-fade-up space-y-4">
        {filterBar}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="LGUs in directory" value={formatNumber(contactRows.length)} hint={`of ${summary?.lgus ?? 0} in scope`} icon={<ContactRound size={17} />} accent="sky" />
          <StatCard label="Mayor with contact" value={formatNumber(summary?.withMayor ?? 0)} hint="LGUs with a mayor contact number" icon={<Phone size={17} />} accent="emerald" />
          <StatCard label="Vice mayor with contact" value={formatNumber(summary?.withViceMayor ?? 0)} hint="LGUs with a vice mayor contact number" icon={<Users size={17} />} accent="violet" />
          <StatCard label="SWM focal with contact" value={formatNumber(summary?.withFocal ?? 0)} hint="LGUs with a focal contact number" icon={<Mail size={17} />} accent="amber" />
        </div>
        <Panel title="LGU contact directory" subtitle="Mayor, vice mayor and MENRO/SWM focal contacts from the SWM workbook" bodyClassName="p-3">
          <DataTable rows={contactRows} columns={columns} rowKey={(row) => row.lguKey} initialSort={{ key: 'lgu', direction: 'asc' }} pageSize={25} maxHeight="max-h-[640px]" />
        </Panel>
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-[10.5px] leading-relaxed text-amber-200/90">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>Contacts are reproduced from the SWM Overall Database for official coordination. Verify names and numbers against the current LGU roster before relying on them. This directory is available only to signed-in dashboard users.</span>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Reference database                                                */
  /* ---------------------------------------------------------------- */
  const lists = workbook.database.lists.filter((list) => {
    const curated = !/^Reference list \d+$/.test(list.label);
    if (!showAllLists && !curated) return false;
    if (!listSearch.trim()) return true;
    const query = listSearch.trim().toLowerCase();
    return list.label.toLowerCase().includes(query) || list.values.some((value) => value.toLowerCase().includes(query));
  });

  return (
    <div className="animate-fade-up space-y-4">
      {filterBar}
      <Panel
        title="SWM reference database"
        subtitle="Lookup lists and controlled values from the Database tab of the SWM Overall Database workbook."
        action={
          <button type="button" className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => setShowAllLists((value) => !value)}>
            {showAllLists ? 'Show key lists' : `Show all ${workbook.database.lists.length} lists`}
          </button>
        }
        bodyClassName="p-4"
      >
        <input
          className="input h-8 w-full text-[11px]"
          placeholder="Search a list name or value."
          value={listSearch}
          onChange={(event) => setListSearch(event.target.value)}
        />
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {lists.map((list) => (
            <div key={list.key} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200"><BookOpen size={11} className="text-emerald-300" /> {list.label}</div>
                <Chip tone="slate">{list.values.length}</Chip>
              </div>
              <div className="flex flex-wrap gap-1">
                {list.values.slice(0, listSearch ? 60 : 24).map((value) => <span key={value} className="rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-slate-400">{value}</span>)}
                {list.values.length > (listSearch ? 60 : 24) && <span className="text-[9.5px] text-slate-500">+{list.values.length - (listSearch ? 60 : 24)} more</span>}
              </div>
            </div>
          ))}
        </div>
        {lists.length === 0 && <div className="py-10 text-center text-[11px] text-slate-500">No reference list matches that search.</div>}
      </Panel>
    </div>
  );
}
