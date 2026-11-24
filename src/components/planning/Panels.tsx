import { useMemo } from 'react';
import {
  Activity, BadgeCheck, CalendarDays, CheckCircle2, CircleAlert, Clock3, Database,
  Download, FileSpreadsheet, RefreshCw, TrendingUp, Users,
} from 'lucide-react';
import clsx from 'clsx';
import { Chart, axisStyle, chartBase } from '../Chart';
import { Chip, EmptyState, Panel, ProgressBar, SectionHeading, StatCard } from '../ui';
import {
  FLAG_SHORT, FLAG_TONE, STATUS_COLOR, STATUS_ORDER, STATUS_TONE,
  type PlanningChange, type PlanningPayload, type PlanningRecord, type PlanningSection, type PlanningStatusKey,
} from '../../lib/planning/types';
import { cellText, formatBytes, formatDateTime, num, pct, relativeTime } from '../../lib/planning/format';

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export function PlanningHeader({
  payload,
  checkedAt,
  now,
  error,
  refreshing,
  onRefresh,
  onExport,
  exportedRows,
}: {
  payload: PlanningPayload;
  checkedAt: number | null;
  now: number;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onExport: () => void;
  exportedRows: number;
}) {
  const { meta } = payload;
  const live = !error;
  const stale = checkedAt ? now - checkedAt > 45_000 : true;
  return (
    <div className="space-y-3">
      <SectionHeading
        eyebrow="Planning · CY 2026"
        title="Planning Accomplishments 2026"
        description={`Every performance indicator in the EMB 7 Accomplishment workbook, with monthly targets, accomplishments, remarks and means of verification. Data through ${meta.reportingMonthLabel} ${meta.year}.`}
        action={
          <>
            <span
              className={clsx(
                'chip gap-1.5',
                live && !stale ? 'chip-emerald' : live ? 'chip-amber' : 'chip-rose',
              )}
              title={checkedAt ? `Last checked ${formatDateTime(new Date(checkedAt).toISOString())}` : undefined}
            >
              <span className={clsx('h-1.5 w-1.5 rounded-full', live && !stale ? 'animate-pulse bg-emerald-400' : live ? 'bg-amber-400' : 'bg-rose-400')} />
              {live ? (stale ? 'Reconnecting' : 'Live') : 'Offline'}
            </span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} />
              {refreshing ? 'Checking…' : 'Refresh now'}
            </button>
            <button type="button" className="btn btn-primary btn-xs" onClick={onExport} title="Download the filtered table as CSV">
              <Download size={12} /> Export {num(exportedRows)} rows
            </button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
          Checked {relativeTime(checkedAt ? new Date(checkedAt).toISOString() : null, now)}
        </span>
        <span>Workbook saved {relativeTime(meta.source.modifiedAt, now)}</span>
        <span>Snapshot rebuilt {relativeTime(meta.generatedAt, now)}</span>
        <span className="font-mono text-slate-600">hash {meta.contentHash}</span>
        <span className="font-mono text-slate-600">{meta.source.sheet}</span>
      </div>
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-[11.5px] text-rose-200">
          <CircleAlert size={14} className="mt-0.5 shrink-0" />
          <div>
            <b>Live source unavailable.</b> Showing the last snapshot from {formatDateTime(meta.generatedAt)}. {error}
          </div>
        </div>
      )}
      {meta.changed > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-[11.5px] text-emerald-200">
          <RefreshCw size={14} className="mt-0.5 shrink-0" />
          <div>
            <b>{meta.changed} change{meta.changed === 1 ? '' : 's'} detected</b> in the workbook at{' '}
            {formatDateTime(meta.generatedAt)}. Changed rows are highlighted in the table.
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KPI strip                                                           */
/* ------------------------------------------------------------------ */

export function KpiStrip({ payload }: { payload: PlanningPayload }) {
  const { meta, sections } = payload;
  const over = payload.records.filter((record) => record.flags.includes('over-100')).length;
  const atRisk = meta.statusCounts['At Risk'] + meta.statusCounts.Delayed;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard
        label="Activities"
        value={num(meta.counts.activities)}
        hint={`${num(meta.counts.projects)} project groups across ${num(meta.counts.sections)} sections`}
        icon={<Activity size={16} />}
        accent="emerald"
      />
      <StatCard
        label="Assessed"
        value={`${num(meta.counts.assessed)}`}
        hint={`${num(meta.counts.activities - meta.counts.assessed)} without a target to date`}
        icon={<BadgeCheck size={16} />}
        accent="sky"
        footer={<ProgressBar value={meta.counts.assessed} max={meta.counts.activities} tone="bg-sky-400" />}
      />
      <StatCard
        label="Met to date"
        value={num(meta.counts.met)}
        hint={`${pct(meta.counts.overallRate)} of assessed indicators`}
        icon={<CheckCircle2 size={16} />}
        accent="emerald"
        footer={<ProgressBar value={meta.counts.met} max={Math.max(1, meta.counts.assessed)} tone="bg-emerald-400" />}
      />
      <StatCard
        label="Needs attention"
        value={num(atRisk)}
        hint={`${meta.statusCounts['At Risk']} at risk · ${meta.statusCounts.Delayed} delayed`}
        icon={<CircleAlert size={16} />}
        accent="amber"
      />
      <StatCard
        label="Over 100%"
        value={num(over)}
        hint="Indicators that exceeded their target to date"
        icon={<TrendingUp size={16} />}
        accent="violet"
      />
      <StatCard
        label="Reporting month"
        value={meta.reportingMonthLabel}
        hint={`${meta.year} · ${sections.length} sections · workbook saved ${relativeTime(meta.source.modifiedAt)}`}
        icon={<CalendarDays size={16} />}
        accent="slate"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Monthly trend                                                       */
/* ------------------------------------------------------------------ */

export function MonthlyPanel({ payload }: { payload: PlanningPayload }) {
  const { monthly } = payload;
  const option = useMemo(() => {
    const labels = monthly.map((point) => point.label);
    return chartBase({
      grid: { left: 14, right: 46, top: 40, bottom: 6, containLabel: true },
      legend: {
        top: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: '#94a3b8', fontSize: 10.5, fontFamily: 'Inter' },
        data: ['Assessed indicators', 'Met their target', 'Met rate'],
      },
      xAxis: { type: 'category', data: labels, ...axisStyle() },
      yAxis: [
        { type: 'value', name: 'Indicators', nameTextStyle: { color: '#64748b', fontSize: 9 }, ...axisStyle() },
        {
          type: 'value', name: 'Met rate', min: 0, max: 1,
          nameTextStyle: { color: '#64748b', fontSize: 9 },
          ...axisStyle({ axisLabel: { color: '#7d948d', fontSize: 10.5, formatter: (value: number) => `${Math.round(value * 100)}%` }, splitLine: { show: false } }),
        },
      ],
      series: [
        {
          name: 'Assessed indicators', type: 'bar', data: monthly.map((point) => point.assessed),
          itemStyle: { color: 'rgba(148,163,184,0.32)', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14,
        },
        {
          name: 'Met their target', type: 'bar', data: monthly.map((point) => point.met),
          itemStyle: { color: '#34d399', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14,
        },
        {
          name: 'Met rate', type: 'line', yAxisIndex: 1, smooth: true, connectNulls: false,
          data: monthly.map((point) => point.rate),
          symbolSize: 6, lineStyle: { width: 2, color: '#38bdf8' }, itemStyle: { color: '#38bdf8' },
        },
      ],
    });
  }, [monthly]);

  return (
    <Panel
      title="Monthly trend"
      subtitle="Bars count the indicators that had a monthly target (assessed) and those that met it. The line is the met rate — the share of assessed indicators that reached their target that month. Future months carry no rate."
      className="min-w-0"
      action={<span className="chip chip-sky">{payload.meta.reportingMonthLabel} reporting</span>}
    >
      <Chart option={option} height={290} ariaLabel="Monthly target and accomplishment trend" />
      <div className="mt-4 overflow-x-auto scroll-thin">
        <table className="w-full min-w-[640px] border-collapse text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-slate-500">
              <th className="px-2 py-1.5 font-semibold">Month</th>
              {monthly.map((point) => (
                <th key={point.index} className={clsx('px-2 py-1.5 text-right font-semibold', point.isFuture && 'text-slate-600')}>
                  {point.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-slate-300">
            <tr className="border-t border-white/[0.05]">
              <td className="px-2 py-1.5 text-slate-500">Assessed</td>
              {monthly.map((point) => <td key={point.index} className="px-2 py-1.5 text-right font-mono tabular-nums">{point.assessed}</td>)}
            </tr>
            <tr className="border-t border-white/[0.05]">
              <td className="px-2 py-1.5 text-slate-500">Met</td>
              {monthly.map((point) => <td key={point.index} className="px-2 py-1.5 text-right font-mono tabular-nums text-emerald-300">{point.met}</td>)}
            </tr>
            <tr className="border-t border-white/[0.05]">
              <td className="px-2 py-1.5 text-slate-500">Met rate</td>
              {monthly.map((point) => (
                <td key={point.index} className="px-2 py-1.5 text-right font-mono tabular-nums">
                  {point.isFuture ? <span className="text-slate-600">future</span> : pct(point.rate)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Status distribution                                                 */
/* ------------------------------------------------------------------ */

export function StatusPanel({ payload }: { payload: PlanningPayload }) {
  const { meta } = payload;
  const option = useMemo(() => chartBase({
    tooltip: { ...(chartBase().tooltip as object), trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['55%', '82%'],
      center: ['50%', '46%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: 'rgba(7,17,14,0.9)', borderWidth: 2 },
      label: { show: false },
      data: STATUS_ORDER.map((status) => ({
        name: status,
        value: meta.statusCounts[status],
        itemStyle: { color: STATUS_COLOR[status] },
      })),
    }],
  }), [meta.statusCounts]);

  return (
    <Panel
      title="Status distribution"
      subtitle={`${meta.counts.activities} indicators classified from the workbook's % to date.`}
    >
      <Chart option={option} height={190} ariaLabel="Status distribution donut" />
      <div className="mt-2 space-y-1.5">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="flex items-start justify-between gap-3 border-t border-white/[0.04] pt-1.5 first:border-0 first:pt-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-200">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
                {status}
              </div>
              <div className="pl-3.5 text-[10px] leading-snug text-slate-600">{meta.statusDefinitions[status]}</div>
            </div>
            <div className="shrink-0 font-mono text-[12px] tabular-nums text-slate-300">{meta.statusCounts[status]}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Section scorecards                                                  */
/* ------------------------------------------------------------------ */

export function SectionScorecards({
  sections,
  onSelect,
  activeSection,
}: {
  sections: PlanningSection[];
  onSelect: (section: string) => void;
  activeSection: string;
}) {
  return (
    <Panel
      title="Section scorecards"
      subtitle="Click a section to filter the activity table. The bar shows the median attainment across that section's assessed indicators; counts show every status."
    >
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => {
          const active = activeSection === section.section;
          return (
            <button
              key={section.section}
              type="button"
              onClick={() => onSelect(active ? '' : section.section)}
              className={clsx(
                'group rounded-xl border p-3 text-left transition',
                active
                  ? 'border-emerald-400/40 bg-emerald-400/[0.07]'
                  : 'border-white/[0.06] bg-white/[0.015] hover:border-emerald-400/25 hover:bg-white/[0.03]',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold text-slate-100">{section.section}</div>
                  <div className="mt-0.5 text-[10.5px] text-slate-500">
                    {section.activities} activities · {section.projects} projects
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[15px] font-bold tabular-nums text-slate-100">{pct(section.medianRate)}</div>
                  <div className="text-[9.5px] uppercase tracking-[0.12em] text-slate-600">median</div>
                </div>
              </div>
              <ProgressBar
                className="mt-2.5"
                value={Math.min(100, (section.medianRate ?? 0) * 100)}
                tone={(section.medianRate ?? 0) >= 1 ? 'bg-emerald-400' : (section.medianRate ?? 0) >= 0.9 ? 'bg-sky-400' : (section.medianRate ?? 0) >= 0.5 ? 'bg-amber-400' : 'bg-rose-400'}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {STATUS_ORDER.filter((status) => section.statusCounts[status] > 0).map((status) => (
                  <span key={status} className={clsx('chip px-1.5 py-0.5 text-[9.5px]', `chip-${STATUS_TONE[status]}`)}>
                    {status} {section.statusCounts[status]}
                  </span>
                ))}
              </div>
              {section.focals.length > 0 && (
                <div className="mt-2 truncate text-[10px] text-slate-600">
                  <Users size={9} className="mr-1 inline" />
                  {section.focals.map((focal) => focal.focal).filter(Boolean).join(' · ') || 'No focal assigned'}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Attainment by section                                               */
/* ------------------------------------------------------------------ */

export function SectionChart({ sections }: { sections: PlanningSection[] }) {
  const option = useMemo(() => {
    const ordered = [...sections].sort((a, b) => (a.medianRate ?? 0) - (b.medianRate ?? 0));
    return chartBase({
      grid: { left: 12, right: 46, top: 10, bottom: 4, containLabel: true },
      tooltip: { ...(chartBase().tooltip as object), trigger: 'item' },
      xAxis: { type: 'value', min: 0, max: Math.max(1.2, ...ordered.map((entry) => entry.medianRate ?? 0)), ...axisStyle({ axisLabel: { color: '#7d948d', fontSize: 10, formatter: (value: number) => `${Math.round(value * 100)}%` } }) },
      yAxis: { type: 'category', data: ordered.map((entry) => entry.section), ...axisStyle(), splitLine: { show: false } },
      series: [{
        type: 'bar',
        data: ordered.map((entry) => ({
          value: entry.medianRate,
          itemStyle: {
            color: (entry.medianRate ?? 0) >= 1 ? '#34d399' : (entry.medianRate ?? 0) >= 0.9 ? '#38bdf8' : (entry.medianRate ?? 0) >= 0.5 ? '#fbbf24' : '#fb7185',
            borderRadius: [0, 3, 3, 0],
          },
        })),
        label: { show: true, position: 'right', color: '#94a3b8', fontSize: 10, formatter: (params: any) => `${Math.round(Number(params?.value ?? 0) * 100)}%` },
        barMaxWidth: 13,
      }],
    });
  }, [sections]);
  return (
    <Panel
      title="Attainment by section"
      subtitle="Median % to date for each section. Values above 100% mean the section exceeded its targets to date."
      action={<span className="chip chip-slate">{sections.length} sections</span>}
    >
      <Chart option={option} height={Math.max(260, sections.length * 22)} ariaLabel="Attainment by section" />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Focal staff                                                         */
/* ------------------------------------------------------------------ */

export function FocalsPanel({ payload }: { payload: PlanningPayload }) {
  const rows = payload.sections.flatMap((section) =>
    section.focals.map((focal) => ({ workbookSection: section.section, ...focal })),
  );
  return (
    <Panel
      title="Focal staff"
      subtitle="Planning & Budget and Database focal persons, matched from the workbook's Focals sheet. The FY 2026 block is blank in the workbook, so the FY 2025 list is shown."
      action={<span className="chip chip-slate"><Users size={10} className="mr-1 inline" />{rows.length} assignments</span>}
    >
      {rows.length === 0 ? (
        <EmptyState title="No focal staff found" description="The Focals sheet could not be matched to any section." />
      ) : (
        <div className="scroll-thin grid max-h-[430px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-1">
          {rows.map((row, index) => (
            <div key={`${row.workbookSection}-${row.section}-${index}`} className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <div className="truncate text-[11.5px] font-semibold text-slate-200">{row.section}</div>
                {row.section !== row.workbookSection && (
                  <div className="shrink-0 text-[9.5px] text-slate-600">for {row.workbookSection}</div>
                )}
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px]">
                <div className="min-w-0">
                  <div className="text-[9px] uppercase tracking-[0.12em] text-slate-600">Planning focal</div>
                  <div className="truncate text-slate-300" title={row.focal}>{row.focal || '—'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[9px] uppercase tracking-[0.12em] text-slate-600">Alternate</div>
                  <div className="truncate text-slate-400" title={row.alternate}>{row.alternate || '—'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[9px] uppercase tracking-[0.12em] text-slate-600">Database focal</div>
                  <div className="truncate text-slate-300" title={row.database}>{row.database || '—'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[9px] uppercase tracking-[0.12em] text-slate-600">Database alternate</div>
                  <div className="truncate text-slate-400" title={row.databaseAlternate}>{row.databaseAlternate || '—'}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Data quality                                                        */
/* ------------------------------------------------------------------ */

export function QualityPanel({
  payload,
  onFilterFlag,
  onOpenRecordId,
}: {
  payload: PlanningPayload;
  onFilterFlag: (flag: string) => void;
  onOpenRecordId: (id: string) => void;
}) {
  const { quality } = payload;
  const types = Object.entries(quality.byType).sort((a, b) => b[1] - a[1]);
  const [firstFlag] = types;
  const preview = firstFlag
    ? quality.issues.filter((issue) => issue.type === firstFlag[0]).slice(0, 6)
    : [];
  return (
    <Panel
      title="Data quality"
      subtitle={`${num(quality.totalIssues)} observations across ${types.length} checks. Click a check to filter the activity table; open a row to inspect the source values.`}
      action={<span className={clsx('chip', quality.totalIssues ? 'chip-amber' : 'chip-emerald')}>{types.length} checks</span>}
    >
      <div className="flex flex-wrap gap-1.5">
        {types.map(([flag, count]) => (
          <button
            key={flag}
            type="button"
            onClick={() => onFilterFlag(flag)}
            className={clsx('chip cursor-pointer transition hover:brightness-125', `chip-${FLAG_TONE[flag] ?? 'slate'}`)}
            title="Show only rows with this flag"
          >
            {FLAG_SHORT[flag] ?? flag} <span className="ml-1 font-mono tabular-nums opacity-80">{count}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
          Examples · {FLAG_SHORT[firstFlag?.[0] ?? ''] ?? 'no issues'}
        </div>
        {quality.totalIssues === 0 && <div className="text-[11.5px] text-slate-500">No issues detected.</div>}
        {preview.map((issue) => {
          return (
            <button
              key={`${issue.id}-${issue.type}-${issue.row}`}
              type="button"
              onClick={() => onOpenRecordId(issue.id)}
              className="flex w-full items-start justify-between gap-2 rounded-lg border border-white/[0.05] bg-white/[0.015] px-2.5 py-1.5 text-left transition hover:border-white/[0.12] hover:bg-white/[0.04]"
            >
              <span className="min-w-0">
                <span className="block truncate text-[11px] text-slate-300">{issue.indicator}</span>
                <span className="text-[10px] text-slate-600">{issue.section} · row {issue.row}</span>
              </span>
              <span className="shrink-0 text-[10px] text-slate-500">inspect →</span>
            </button>
          );
        })}
        {quality.truncated && (
          <div className="pt-1 text-[10.5px] text-slate-600">
            Showing the first 600 observations; the counts above cover all of them.
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Change log                                                          */
/* ------------------------------------------------------------------ */

export function ChangeLogPanel({
  changes,
  onOpenRecordId,
}: {
  changes: PlanningChange[];
  onOpenRecordId: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, PlanningChange[]>();
    for (const change of changes) {
      const key = change.at;
      map.set(key, [...(map.get(key) ?? []), change]);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12);
  }, [changes]);

  return (
    <Panel
      title="Change log"
      subtitle="Field-level differences detected by the watcher, newest first. Up to 300 events are kept in the snapshot."
      action={<span className="chip chip-slate"><Clock3 size={10} className="mr-1 inline" />{changes.length} events</span>}
    >
      {groups.length === 0 ? (
        <EmptyState
          title="No changes recorded yet"
          description="The log fills the first time the workbook is edited after this snapshot. The watcher compares every target, actual, remark and verification field."
          icon={<Clock3 size={20} />}
        />
      ) : (
        <div className="max-h-[380px] space-y-3 overflow-y-auto scroll-thin pr-1">
          {groups.map(([at, entries]) => (
            <div key={at}>
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-slate-500">
                <span>{formatDateTime(at)}</span>
                <span>{entries.length} change{entries.length === 1 ? '' : 's'}</span>
              </div>
              <div className="space-y-1">
                {entries.slice(0, 30).map((entry, index) => {
                  return (
                    <button
                      key={`${entry.at}-${entry.id}-${entry.field ?? 'row'}-${index}`}
                      type="button"
                      onClick={() => onOpenRecordId(entry.id)}
                      className="block w-full rounded-lg border border-white/[0.05] bg-white/[0.015] px-2.5 py-1.5 text-left transition hover:border-white/[0.12]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-[11px] text-slate-300">{entry.indicator}</span>
                        <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-slate-600">{entry.kind}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                        <span className="text-slate-500">{entry.section} · row {entry.row}</span>
                        {entry.label && <span className="text-slate-400">{entry.label}</span>}
                        {entry.kind === 'updated' && (
                          <span className="font-mono text-slate-400">
                            <span className="text-rose-300/80">{cellText(entry.from)}</span>
                            {' → '}
                            <span className="text-emerald-300/90">{cellText(entry.to)}</span>
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
                {entries.length > 30 && <div className="text-[10px] text-slate-600">… {entries.length - 30} more in this build</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Workbook footer                                                     */
/* ------------------------------------------------------------------ */

export function WorkbookFooter({ payload }: { payload: PlanningPayload }) {
  const { meta } = payload;
  return (
    <Panel
      title="Workbook & pipeline"
      subtitle="How this tab stays current, and exactly what the numbers come from."
      action={<span className="chip chip-slate"><Database size={10} className="mr-1 inline" />source of truth</span>}
    >
      <div className="grid gap-4 text-[11.5px] leading-relaxed text-slate-400 md:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-start gap-2"><FileSpreadsheet size={13} className="mt-0.5 shrink-0 text-emerald-400/80" /><div><b className="text-slate-300">{meta.source.fileName}</b><div className="break-all text-[10.5px] text-slate-600">{meta.source.path}</div></div></div>
          <div>Sheet: <span className="font-mono text-slate-300">{meta.source.sheet}</span> · {formatBytes(meta.source.bytes)}</div>
          <div>Workbook saved: <span className="text-slate-300">{formatDateTime(meta.source.modifiedAt)}</span></div>
          <div>Snapshot rebuilt: <span className="text-slate-300">{formatDateTime(meta.generatedAt)}</span></div>
          <div>Content hash: <span className="font-mono text-slate-300">{meta.contentHash}</span></div>
        </div>
        <div className="space-y-1.5">
          <div><b className="text-slate-300">Live detection.</b> The watcher reads the workbook every 5 seconds and rebuilds this snapshot only when the file's content changes. The page checks for a new snapshot every 10 seconds while it is open.</div>
          <div><b className="text-slate-300">Latency.</b> Updates arrive as soon as OneDrive syncs the SharePoint workbook to this PC — usually seconds, occasionally about a minute.</div>
          <div><b className="text-slate-300">Units.</b> Each indicator has its own unit, so totals are only summed inside a worksheet column. Section comparisons use the median attainment, never a sum of mixed units.</div>
          <div><b className="text-slate-300">Nothing hidden.</b> Every worksheet column is in the activity table, the row drawer and the CSV export, including the undocumented AL/AM and AS–AV columns.</div>
        </div>
      </div>
    </Panel>
  );
}

export function StatusLegend({ meta }: { meta: PlanningPayload['meta'] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUS_ORDER.map((status: PlanningStatusKey) => (
        <span key={status} className={clsx('chip', `chip-${STATUS_TONE[status]}`)} title={meta.statusDefinitions[status]}>
          {status} {meta.statusCounts[status]}
        </span>
      ))}
    </div>
  );
}
