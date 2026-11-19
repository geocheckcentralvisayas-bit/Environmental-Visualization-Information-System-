import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Clock3, ExternalLink, Gauge, MapPin, Radio, RefreshCw, Wind,
} from 'lucide-react';
import clsx from 'clsx';
import { apiJson } from '../lib/api';
import { useDashboard } from '../store/useDashboard';
import { Chart, axisStyle, chartBase } from '../components/Chart';
import { AqmsMap, aqmsColor } from '../components/AqmsMap';
import { Chip, DataTable, Panel, SectionHeading, StatCard, type Column } from '../components/ui';
import { formatNumber } from '../lib/format';
import type { AqmsLivePayload, AqmsManualRecord, AqmsReading } from '../types';

type Range = '24h' | '7d' | '30d' | 'all';

const AQI_CATEGORIES = [
  { label: 'Good', range: '0–50', color: '#20A66A' },
  { label: 'Fair', range: '51–100', color: '#F4C430' },
  { label: 'Unhealthy', range: '101–150', color: '#F28C28' },
  { label: 'Very Unhealthy', range: '151–200', color: '#E9424D' },
  { label: 'Acutely Unhealthy', range: '201–300', color: '#B4232B' },
  { label: 'Emergency', range: '301+', color: '#7B3FB2' },
];

const CLEAN_AXIS = {
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: 'rgba(148,163,184,0.09)' } },
};

function stationName(id: string, stations: Array<{ id: string; name: string }>) {
  return stations.find((station) => station.id === id)?.name ?? id;
}

function latestPerStation(readings: AqmsReading[]) {
  const map = new Map<string, AqmsReading>();
  for (const reading of readings) {
    const existing = map.get(reading.station);
    if (!existing || reading.timestamp > existing.timestamp) map.set(reading.station, reading);
  }
  return [...map.values()];
}

export function AmbientCornerPage() {
  const aqms = useDashboard((state) => state.aqms);
  const [live, setLive] = useState<AqmsLivePayload | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [range, setRange] = useState<Range>('7d');
  const [manualStation, setManualStation] = useState('all');
  const [manualYear, setManualYear] = useState('all');
  const [manualSearch, setManualSearch] = useState('');

  const refreshLive = useCallback(async () => {
    setLiveLoading(true);
    try {
      const payload = await apiJson<AqmsLivePayload>('/aqms/live');
      setLive(payload);
      setLiveError(null);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : 'Live feed unavailable');
    } finally {
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLive();
    const timer = window.setInterval(refreshLive, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshLive]);

  const allReadings = aqms?.continuous ?? [];
  const liveReadings = live?.readings ?? [];
  const recentReadings = liveReadings.length ? liveReadings : allReadings.slice(-144);

  const latest = useMemo(() => latestPerStation(liveReadings.length ? liveReadings : allReadings), [liveReadings, allReadings]);
  const lastTimestamp = useMemo(
    () => allReadings.reduce((last, row) => (row.timestamp > last ? row.timestamp : last), ''),
    [allReadings],
  );

  const continuousStations = useMemo(
    () => (aqms?.stations ?? []).filter((item) => item.type.toLowerCase().includes('continuous')),
    [aqms],
  );
  const manualStations = useMemo(
    () => (aqms?.stations ?? []).filter((item) => !item.type.toLowerCase().includes('continuous')),
    [aqms],
  );

  /* One clean series per continuous station: hourly for 24h, then 6-hourly,
   * daily and weekly means so no chart becomes a wall of spikes. */
  const continuousSeries = useMemo(() => {
    const result = new Map<string, Array<{ timestamp: string; pm25: number | null; pm10: number | null }>>();
    const bucketHours = range === '24h' ? 1 : range === '7d' ? 6 : range === '30d' ? 24 : 168;
    const bucketMs = bucketHours * 3_600_000;
    const end = lastTimestamp ? new Date(lastTimestamp).getTime() : 0;
    const rangeHours = range === '24h' ? 24 : range === '7d' ? 168 : range === '30d' ? 720 : Number.POSITIVE_INFINITY;

    for (const item of continuousStations) {
      const rows = allReadings.filter((row) => {
        if (row.station !== item.id) return false;
        if (!Number.isFinite(rangeHours)) return true;
        return new Date(row.timestamp).getTime() >= end - rangeHours * 3_600_000;
      });
      const buckets = new Map<number, { pm25: number[]; pm10: number[] }>();
      for (const row of rows) {
        const key = Math.floor(new Date(row.timestamp).getTime() / bucketMs) * bucketMs;
        const bucket = buckets.get(key) ?? { pm25: [], pm10: [] };
        if (row.pm25 !== null) bucket.pm25.push(row.pm25);
        if (row.pm10 !== null) bucket.pm10.push(row.pm10);
        buckets.set(key, bucket);
      }
      result.set(item.id, [...buckets.entries()].map(([key, bucket]) => ({
        timestamp: new Date(key).toISOString(),
        pm25: bucket.pm25.length ? bucket.pm25.reduce((a, b) => a + b, 0) / bucket.pm25.length : null,
        pm10: bucket.pm10.length ? bucket.pm10.reduce((a, b) => a + b, 0) / bucket.pm10.length : null,
      })));
    }
    return result;
  }, [allReadings, continuousStations, range, lastTimestamp]);

  /* Manual stations are shown separately: each has its own AQI history. */
  const manualSeries = useMemo(() => {
    const result = new Map<string, AqmsManualRecord[]>();
    for (const item of manualStations) {
      result.set(item.id, (aqms?.manual ?? []).filter((row) => row.station === item.id).slice(-40));
    }
    return result;
  }, [aqms, manualStations]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const reading of recentReadings) {
      const status = reading.pm25Status || 'UNKNOWN';
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [recentReadings]);

  const manualRows = useMemo(() => {
    const query = manualSearch.trim().toLowerCase();
    return (aqms?.manual ?? []).filter((row) => {
      if (manualStation !== 'all' && row.station !== manualStation) return false;
      if (manualYear !== 'all' && String(row.year) !== manualYear) return false;
      if (!query) return true;
      return [row.sourceStation, row.category, row.legend, row.date, row.address]
        .some((value) => String(value ?? '').toLowerCase().includes(query));
    });
  }, [aqms, manualStation, manualYear, manualSearch]);

  if (!aqms) {
    return (
      <div className="animate-fade-up space-y-3">
        <SectionHeading eyebrow="Ambient corner" title="Air Quality Monitoring (AQMS)" description="The air-quality dataset has not been built yet." />
        <Panel title="Dataset missing">
          <div className="flex items-start gap-2 text-[12px] leading-relaxed text-slate-400">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
            <div>Run <span className="kbd">npm run data:aqms</span> then reload.</div>
          </div>
        </Panel>
      </div>
    );
  }

  const summary = aqms.summary;
  const worst = latest.reduce((acc, row) => {
    const rank = { GOOD: 1, FAIR: 2, 'UNHEALTHY FOR SENSITIVE GROUPS': 3, 'VERY UNHEALTHY': 4, 'ACUTELY UNHEALTHY': 5 } as Record<string, number>;
    return (rank[row.pm25Status] ?? 0) > (acc ? rank[acc.pm25Status] ?? 0 : 0) ? row : acc;
  }, null as AqmsReading | null);

  const manualColumns: Column<AqmsManualRecord>[] = [
    { key: 'date', header: 'Sample date', sortValue: (row) => row.date, render: (row) => <span className="font-mono text-[10.5px] text-slate-300">{row.date}</span> },
    { key: 'station', header: 'Station', sortValue: (row) => row.sourceStation, render: (row) => (
      <div><div className="text-[11px] text-slate-200">{row.sourceStation}</div><div className="text-[9.5px] text-slate-500">{row.category} · {row.year}</div></div>
    ) },
    { key: 'aqi', header: 'AQI', sortValue: (row) => row.aqi, render: (row) => <span className="font-mono text-[11px]" style={{ color: aqmsColor(row.legend) }}>{row.aqi}</span> },
    { key: 'legend', header: 'Category', sortValue: (row) => row.legend, render: (row) => <Chip tone="slate">{row.legend}</Chip> },
    { key: 'address', header: 'Address', sortValue: (row) => row.address, render: (row) => <span className="text-[10.5px] text-slate-400">{row.address || '—'}</span> },
  ];

  return (
    <div className="animate-fade-up space-y-5">
      <SectionHeading
        eyebrow="Ambient corner"
        title="Air Quality Monitoring (AQMS)"
        description={`Continuous PM2.5 and PM10 readings from ${aqms.stations.filter((s) => s.type.toLowerCase().includes('continuous')).length} monitoring stations, plus manual AQI samples across Cebu and Bohol. Live readings are pulled from the source sheet every 60 seconds; the full ${formatNumber(summary.continuousReadings)}-record history is kept for trend analysis.`}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={liveError ? 'rose' : live?.stale ? 'amber' : live ? 'emerald' : 'slate'}>
              <Radio size={10} /> {liveError ? 'SNAPSHOT' : live?.stale ? 'STALE' : live ? 'LIVE' : 'CONNECTING'}
            </Chip>
            <Chip tone="sky"><Wind size={10} /> {formatNumber(summary.stations)} stations</Chip>
            <Chip tone="slate"><Clock3 size={10} /> {lastTimestamp ? lastTimestamp.replace('T', ' ') : '—'}</Chip>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Monitoring stations" value={formatNumber(summary.stations)} hint="4 continuous + 3 manual sites" icon={<MapPin size={17} />} accent="sky" />
        <StatCard label="Continuous readings" value={formatNumber(summary.continuousReadings)} hint="hourly PM2.5 / PM10 records" icon={<Activity size={17} />} accent="emerald" />
        <StatCard label="Manual AQI samples" value={formatNumber(summary.manualReadings)} hint="TSP and PM10, 2023–2026" icon={<Gauge size={17} />} accent="violet" />
        <StatCard
          label="Latest PM2.5"
          value={worst ? String(worst.pm25 ?? '—') : '—'}
          hint={worst ? `${stationName(worst.station, aqms.stations)} · ${worst.pm25Status}` : 'waiting for live data'}
          icon={<Wind size={17} />}
          accent="amber"
        />
        <StatCard
          label="Latest readout"
          value={live?.generatedAt ? new Date(live.generatedAt).toLocaleTimeString() : (summary.liveAt ?? '—').slice(11)}
          hint={liveError ? 'live feed unavailable — built snapshot' : live?.stale ? 'cached feed — source unreachable' : 'refreshes every 60 seconds'}
          icon={<Radio size={17} />}
          accent="slate"
        />
      </div>

      <Panel
        title="Live station status"
        subtitle={liveError
          ? `Live feed unavailable (${liveError}) — showing the last built snapshot.`
          : live?.stale
            ? `Cached readings from ${live.cachedAt ? new Date(live.cachedAt).toLocaleTimeString() : 'earlier'} — source unreachable (${live.warning ?? 'unknown error'}).`
            : live
              ? `Google Sheets live feed · ${formatNumber(live.readings.length)} recent readings`
              : 'Connecting to the live feed…'}
        action={
          <button type="button" className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void refreshLive()} disabled={liveLoading}>
            <RefreshCw size={11} className={liveLoading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
        bodyClassName="p-3"
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {latest.length === 0 && <div className="text-[11px] text-slate-500">No live readings available.</div>}
          {latest.map((reading) => (
            <div key={reading.station} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium text-slate-200">{stationName(reading.station, aqms.stations)}</div>
                  <div className="font-mono text-[9.5px] text-slate-500">{reading.timestamp.replace('T', ' ')}</div>
                </div>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: aqmsColor(reading.pm25Status) }} />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-[22px] font-semibold leading-none text-slate-100">{reading.pm25 ?? '—'}</span>
                <span className="text-[10px] text-slate-500">PM2.5 µg/m³</span>
              </div>
              <div className="mt-1 text-[10px]" style={{ color: aqmsColor(reading.pm25Status) }}>{reading.pm25Status}</div>
              <div className="mt-1 text-[10px] text-slate-500">PM10 {reading.pm10 ?? '—'} µg/m³ · {reading.pm10Status || '—'}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Air quality index guide"
        subtitle="DENR-EMB AQI categories and their concentration ranges"
        bodyClassName="p-3"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {AQI_CATEGORIES.map((item) => (
            <div key={item.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
                <span className="truncate text-[10.5px] font-semibold text-slate-200">{item.label}</span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-slate-500">{item.range}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Continuous station trends"
        subtitle="Each station has its own PM2.5 and PM10 history — no overlapping lines"
        action={
          <div className="flex rounded-lg border border-white/[0.07] bg-white/[0.02] p-0.5">
            {([['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'Full history']] as [Range, string][]).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setRange(id)} className={clsx('rounded-md px-2.5 py-1 text-[10px] font-semibold transition', range === id ? 'bg-emerald-400/15 text-emerald-300' : 'text-slate-400 hover:text-slate-200')}>{label}</button>
            ))}
          </div>
        }
        bodyClassName="p-3"
      >
        <div className="grid gap-3 xl:grid-cols-2">
          {continuousStations.map((item) => {
            const series = continuousSeries.get(item.id) ?? [];
            const current = latest.find((row) => row.station === item.id);
            return (
              <div key={item.id} className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-semibold text-slate-100">{item.name}</div>
                    <div className="text-[9.5px] text-slate-500">{item.sourceName}</div>
                  </div>
                  {current && (
                    <div className="text-right">
                      <div className="text-[18px] font-semibold leading-none text-slate-100">{current.pm25 ?? '—'}<span className="ml-1 text-[9px] font-normal text-slate-500">µg/m³ PM2.5</span></div>
                      <div className="mt-0.5 text-[10px] font-semibold" style={{ color: aqmsColor(current.pm25Status) }}>{current.pm25Status}</div>
                    </div>
                  )}
                </div>
                <Chart height={250} option={{
                  ...chartBase(),
                  animationDuration: 500,
                  legend: { show: true, top: 0, right: 0, textStyle: { color: '#94a3b8', fontSize: 9 }, icon: 'roundRect', itemHeight: 6, itemWidth: 12 },
                  grid: { left: 4, right: 8, top: 28, bottom: 4, containLabel: true },
                  tooltip: { ...chartBase().tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: 'rgba(148,163,184,0.35)' } } },
                  xAxis: { type: 'time', ...axisStyle(CLEAN_AXIS), axisLabel: { color: '#64748b', fontSize: 9, hideOverlap: true } },
                  yAxis: { type: 'value', splitNumber: 3, ...axisStyle(CLEAN_AXIS), axisLabel: { color: '#64748b', fontSize: 9 } },
                  dataZoom: [{ type: 'inside' }],
                  series: [
                    {
                      name: 'PM2.5', type: 'line', smooth: 0.35, showSymbol: false, sampling: 'lttb',
                      lineStyle: { width: 2.2, color: '#34d399' }, itemStyle: { color: '#34d399' },
                      emphasis: { focus: 'series' },
                      data: series.map((row) => [row.timestamp, row.pm25]),
                    },
                    {
                      name: 'PM10', type: 'line', smooth: 0.35, showSymbol: false, sampling: 'lttb',
                      lineStyle: { width: 1.8, color: '#38bdf8' }, itemStyle: { color: '#38bdf8' },
                      emphasis: { focus: 'series' },
                      data: series.map((row) => [row.timestamp, row.pm10]),
                    },
                  ],
                }} />
                <div className="mt-1 text-[9.5px] text-slate-500">{formatNumber(series.length)} averaged points · scroll over the chart to zoom</div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Manual station AQI trends"
        subtitle="One station per chart — TSP and PM10 samples submitted by LGUs"
        bodyClassName="p-3"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {manualStations.map((item) => {
            const rows = manualSeries.get(item.id) ?? [];
            const last = rows.at(-1);
            return (
              <div key={item.id} className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-semibold text-slate-100">{item.name}</div>
                    <div className="text-[9px] text-slate-500">{formatNumber(rows.length)} samples</div>
                  </div>
                  {last && (
                    <div className="text-right">
                      <div className="text-[15px] font-semibold leading-none" style={{ color: aqmsColor(last.legend) }}>{last.aqi}</div>
                      <div className="text-[8.5px] text-slate-500">{last.date}</div>
                    </div>
                  )}
                </div>
                <Chart height={160} option={{
                  ...chartBase(),
                  animationDuration: 400,
                  grid: { left: 2, right: 6, top: 10, bottom: 2, containLabel: true },
                  tooltip: { ...chartBase().tooltip, trigger: 'axis' },
                  xAxis: { type: 'category', data: rows.map((row) => row.date.slice(5)), ...axisStyle(CLEAN_AXIS), axisLabel: { color: '#64748b', fontSize: 8, interval: Math.max(0, Math.floor(rows.length / 5)), hideOverlap: true } },
                  yAxis: { type: 'value', splitNumber: 3, ...axisStyle(CLEAN_AXIS), axisLabel: { color: '#64748b', fontSize: 8 } },
                  series: [{
                    name: 'AQI', type: 'line', smooth: 0.3, showSymbol: false,
                    lineStyle: { width: 2, color: '#a78bfa' }, itemStyle: { color: '#a78bfa' },
                    markLine: {
                      silent: true, symbol: 'none',
                      label: { show: false },
                      lineStyle: { color: 'rgba(148,163,184,0.25)', type: 'dashed', width: 1 },
                      data: [{ yAxis: 50 }, { yAxis: 100 }, { yAxis: 150 }],
                    },
                    data: rows.map((row) => row.aqi),
                  }],
                }} />
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="PM2.5 status mix" subtitle={`Based on the ${formatNumber(recentReadings.length)} most recent readings`}>
          <Chart height={230} option={{
            ...chartBase(),
            legend: { bottom: 0, textStyle: { color: '#94a3b8', fontSize: 9 }, icon: 'circle', itemHeight: 7 },
            series: [{
              type: 'pie', radius: ['52%', '76%'], center: ['50%', '43%'],
              itemStyle: { borderColor: 'rgba(5,14,11,0.9)', borderWidth: 2 },
              label: { show: false },
              data: statusCounts.map((row) => ({ name: row.name, value: row.count, itemStyle: { color: aqmsColor(row.name) } })),
            }],
          }} />
        </Panel>
        <Panel className="xl:col-span-2" title="Manual samples by year" subtitle="TSP and PM10 submissions from the MANUAL DATUM tab">
          <Chart height={230} option={{
            ...chartBase(),
            grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
            xAxis: { type: 'category', data: (summary.manualByYear ?? []).map((row) => String(row.year)), ...axisStyle(CLEAN_AXIS) },
            yAxis: { type: 'value', splitNumber: 3, ...axisStyle(CLEAN_AXIS) },
            series: [{ name: 'Samples', type: 'bar', barMaxWidth: 38, data: (summary.manualByYear ?? []).map((row) => row.count), itemStyle: { color: '#6F3FB5', borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', color: '#8ea9a1', fontSize: 10 } }],
          }} />
        </Panel>
      </div>

      <Panel
        title="Monitoring station map"
        subtitle="Coordinates from the workbook's GEOCOORDINATES tab. Pin colour shows the latest PM2.5 / AQI category."
        action={<Chip tone="slate"><MapPin size={10} /> {aqms.stations.length} stations</Chip>}
        bodyClassName="p-3"
      >
        <AqmsMap stations={aqms.stations} readings={liveReadings.length ? liveReadings : allReadings} manual={aqms.manual} height={520} />
      </Panel>

      <Panel
        title="Manual AQI register"
        subtitle="Historical TSP / PM10 samples, 2023–2026"
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="select h-8 w-auto min-w-[130px] text-[11px]" value={manualStation} onChange={(event) => setManualStation(event.target.value)}>
              <option value="all">All stations</option>
              {aqms.stations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select className="select h-8 w-auto min-w-[90px] text-[11px]" value={manualYear} onChange={(event) => setManualYear(event.target.value)}>
              <option value="all">All years</option>
              {(summary.manualByYear ?? []).map((row) => <option key={row.year} value={row.year}>{row.year}</option>)}
            </select>
            <input className="input h-8 w-[200px] text-[11px]" placeholder="Search samples." value={manualSearch} onChange={(event) => setManualSearch(event.target.value)} />
          </div>
        }
        bodyClassName="p-3"
      >
        <DataTable rows={manualRows} columns={manualColumns} rowKey={(row) => `${row.station}-${row.date}-${row.category}`} initialSort={{ key: 'date', direction: 'desc' }} pageSize={25} maxHeight="max-h-[560px]" />
      </Panel>

      <Panel title="Source & notes" subtitle="Where these numbers come from and what to watch for" bodyClassName="p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Source</div>
            {aqms.source.name}. Hourly tabs: CITY OF TALISAY and CITY OF TOLEDO; manual tab: MANUAL DATUM; station coordinates: GEOCOORDINATES.{' '}
            <a href={aqms.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200">Open Google Sheet <ExternalLink size={10} /></a>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Live capture</div>
            The signed-in dashboard calls <span className="kbd">/api/aqms/live</span> every 60 seconds. The Worker reads the public sheet, caches it for one minute and returns the most recent readings. If the sheet is unreachable, the last built snapshot stays on screen.
          </div>
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-[11px] leading-relaxed text-amber-200/90">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300/80">Station naming</div>
            The GEOCOORDINATES tab names the Talisay-area continuous station “Metro Cebu Ambient Air Quality Monitoring Stations” and the Toledo station “CAAMS Brgy. Cabitoonan”. Readings from the hourly tabs are attached to those coordinates. Blank and <span className="font-mono">#DIV/0!</span> rows are dropped.
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Rebuild</div>
            Run <span className="kbd">npm run data:aqms</span> to refresh the entire historical snapshot from the sheet. This tab is view only — no export path is provided.
          </div>
        </div>
      </Panel>
    </div>
  );
}
