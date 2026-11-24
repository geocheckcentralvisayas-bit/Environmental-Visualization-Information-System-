import { useEffect, useMemo } from 'react';
import { ClipboardCopy, Download, Filter, X } from 'lucide-react';
import clsx from 'clsx';
import { Chart, axisStyle, chartBase } from '../Chart';
import { Chip } from '../ui';
import {
  FLAG_SHORT, FLAG_TONE, STATUS_COLOR, STATUS_TONE,
  type PlanningRecord,
} from '../../lib/planning/types';
import { downloadText, num, pct, planningCsv } from '../../lib/planning/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function RecordDrawer({
  record,
  onClose,
  onFilterSection,
}: {
  record: PlanningRecord | null;
  onClose: () => void;
  onFilterSection: (section: string) => void;
}) {
  useEffect(() => {
    if (!record) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [record, onClose]);

  const option = useMemo(() => {
    if (!record) return null;
    return chartBase({
      grid: { left: 8, right: 8, top: 26, bottom: 4, containLabel: true },
      legend: { top: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: '#94a3b8', fontSize: 10 }, data: ['Target', 'Actual'] },
      xAxis: { type: 'category', data: MONTHS, ...axisStyle() },
      yAxis: { type: 'value', ...axisStyle() },
      series: [
        { name: 'Target', type: 'bar', data: record.targets, itemStyle: { color: 'rgba(148,163,184,0.35)', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 12 },
        { name: 'Actual', type: 'bar', data: record.actuals, itemStyle: { color: STATUS_COLOR[record.status], borderRadius: [3, 3, 0, 0] }, barMaxWidth: 12 },
      ],
    });
  }, [record]);

  if (!record) return null;

  const copy = () => {
    void navigator.clipboard?.writeText(`${record.section} · ${record.project}\n${record.indicator}`).catch(() => undefined);
  };

  return (
    <div className="fixed inset-0 z-[950] flex justify-end">
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[600px] flex-col border-l border-white/10 bg-ink-900 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3.5">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Chip tone={STATUS_TONE[record.status]}>{record.status}</Chip>
              <Chip tone="slate">{record.section}</Chip>
              <span className="font-mono text-[10px] text-slate-600">worksheet row {record.row}</span>
            </div>
            <h2 className="text-[13.5px] font-semibold leading-snug text-slate-100">{record.indicator}</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">{record.project || 'No project label (carried forward)'}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>

        <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['% to date', pct(record.pctToDate)],
              ['% annual', pct(record.pctAnnual)],
              ['Target total', num(record.targetsTotal, 2)],
              ['Accomplished', num(record.actualsTotal, 2)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
                <div className="mt-1 font-mono text-[16px] font-bold tabular-nums text-slate-100">{value}</div>
              </div>
            ))}
          </div>

          {option && <Chart option={option} height={180} ariaLabel="Monthly target and accomplishment" />}

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Monthly breakdown</div>
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[440px] border-collapse text-[10.5px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-[0.1em] text-slate-500">
                    <th className="px-1.5 py-1 text-left">Month</th>
                    <th className="px-1.5 py-1 text-right">Target</th>
                    <th className="px-1.5 py-1 text-right">Actual</th>
                    <th className="px-1.5 py-1 text-right">Variance</th>
                    <th className="px-1.5 py-1 text-left">Cell note</th>
                  </tr>
                </thead>
                <tbody>
                  {MONTHS.map((month, index) => {
                    const target = record.targets[index];
                    const actual = record.actuals[index];
                    const note = record.targetText[index] || record.actualText[index];
                    const variance = actual - target;
                    return (
                      <tr key={month} className="border-t border-white/[0.05]">
                        <td className="px-1.5 py-1 text-slate-400">{month}</td>
                        <td className="px-1.5 py-1 text-right font-mono tabular-nums text-slate-300">{target === 0 ? '·' : num(target, 2)}</td>
                        <td className="px-1.5 py-1 text-right font-mono tabular-nums text-emerald-300">{actual === 0 ? '·' : num(actual, 2)}</td>
                        <td className={clsx('px-1.5 py-1 text-right font-mono tabular-nums', variance >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                          {target === 0 && actual === 0 ? '·' : num(variance, 2)}
                        </td>
                        <td className="px-1.5 py-1 text-[10px] text-amber-200/80">{note || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2.5">
            {[
              ['Remarks (column AG)', record.remarks],
              ['Means of verification (column AH)', record.mov],
              ['Second remarks column (AI)', record.remarks2],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
                <div className="whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11.5px] leading-relaxed text-slate-300">
                  {value || <span className="text-slate-600">Empty in the workbook</span>}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">All worksheet values</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px]">
              {[
                ['Target total (P)', num(record.targetsTotal, 2)],
                ['Accomplished total (AD)', num(record.actualsTotal, 2)],
                ['% to date (AE)', pct(record.pctToDate)],
                ['% annual (AF)', pct(record.pctAnnual)],
                ['Computed rate from monthly cells', pct(record.rate)],
                ['YTD target (Jan–reporting month)', num(record.ytdTarget, 2)],
                ['YTD accomplished', num(record.ytdActual, 2)],
                ['Quarter target (AS)', num(record.working.quarterTarget, 2)],
                ['To-date target (AT)', num(record.working.toDateTarget, 2)],
                ['Quarter accomplished (AU)', num(record.working.quarterActual, 2)],
                ['To-date accomplished (AV)', num(record.working.toDateActual, 2)],
                ['AL (undocumented worksheet column)', num(record.working.a, 2)],
                ['AM (undocumented worksheet column)', num(record.working.b, 2)],
                ['Source', `${record.id} · worksheet row ${record.row}`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-2 border-b border-white/[0.04] py-0.5 last:border-0">
                  <span className="text-slate-500">{label}</span>
                  <span className="shrink-0 font-mono tabular-nums text-slate-300">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {record.flags.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Data-quality flags</div>
              <div className="flex flex-wrap gap-1.5">
                {record.flags.map((flag) => (
                  <span key={flag} className={clsx('chip', `chip-${FLAG_TONE[flag] ?? 'slate'}`)}>{FLAG_SHORT[flag] ?? flag}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => onFilterSection(record.section)}>
              <Filter size={11} /> Filter to {record.section}
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={copy}>
              <ClipboardCopy size={11} /> Copy
            </button>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={() => downloadText(`planning-row-${record.row}.csv`, planningCsv([record]))}
          >
            <Download size={11} /> Export this row
          </button>
        </footer>
      </aside>
    </div>
  );
}
