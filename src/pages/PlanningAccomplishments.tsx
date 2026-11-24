import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, Loader2, RefreshCw } from 'lucide-react';
import { Panel } from '../components/ui';
import { ActivityMatrix } from '../components/planning/ActivityMatrix';
import { RecordDrawer } from '../components/planning/RecordDrawer';
import {
  ChangeLogPanel, FocalsPanel, KpiStrip, MonthlyPanel, PlanningHeader, QualityPanel,
  SectionChart, SectionScorecards, StatusPanel, WorkbookFooter,
} from '../components/planning/Panels';
import { usePlanningLive } from '../lib/planning/usePlanningLive';
import { EMPTY_MATRIX_FILTER, type MatrixFilter } from '../lib/planning/types';
import { downloadText, planningCsv } from '../lib/planning/format';

function scrollToMatrix() {
  window.setTimeout(() => {
    document.getElementById('planning-matrix')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}

export function PlanningAccomplishmentsPage() {
  const { payload, loading, error, checkedAt, refreshing, latestChanges, highlighted, now, refresh, dismissChanges } = usePlanningLive();
  const [filter, setFilter] = useState<MatrixFilter>(EMPTY_MATRIX_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dismissedChanges, setDismissedChanges] = useState(false);

  const selected = useMemo(
    () => payload?.records.find((record) => record.id === selectedId) ?? null,
    [payload, selectedId],
  );

  useEffect(() => {
    if (latestChanges.length > 0) setDismissedChanges(false);
  }, [latestChanges]);

  const patchFilter = useCallback((patch: Partial<MatrixFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
  }, []);

  const resetFilter = useCallback(() => setFilter(EMPTY_MATRIX_FILTER), []);

  const filterToSection = useCallback((section: string) => {
    setFilter((current) => ({
      ...EMPTY_MATRIX_FILTER,
      section: current.section === section ? '' : section,
    }));
    scrollToMatrix();
  }, []);

  const filterToFlag = useCallback((flag: string) => {
    setFilter({ ...EMPTY_MATRIX_FILTER, flag });
    scrollToMatrix();
  }, []);

  const openById = useCallback((id: string) => setSelectedId(id), []);

  if (!payload) {
    return (
      <Panel>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          {loading ? (
            <>
              <Loader2 size={22} className="animate-spin text-emerald-400" />
              <div className="text-[13px] font-semibold text-slate-200">Reading the accomplishment workbook…</div>
              <p className="max-w-md text-[11.5px] text-slate-500">
                The planning watcher extracts all 214 indicators from the consolidated sheet. This only takes a moment.
              </p>
            </>
          ) : (
            <>
              <CircleAlert size={22} className="text-rose-300" />
              <div className="text-[13px] font-semibold text-slate-200">Planning data is not available yet</div>
              <p className="max-w-lg text-[11.5px] leading-relaxed text-slate-500">
                {error ?? 'The workbook snapshot has not been built.'} Start the watcher with{' '}
                <code className="kbd">npm run planning:serve</code>, or build the snapshot once with{' '}
                <code className="kbd">npm run data:planning</code>.
              </p>
              <button type="button" className="btn btn-primary btn-xs" onClick={() => void refresh()}>
                <RefreshCw size={12} /> Try again
              </button>
            </>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <PlanningHeader
        payload={payload}
        checkedAt={checkedAt}
        now={now}
        error={error}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onExport={() => downloadText(`planning-accomplishments-2026-all.csv`, planningCsv(payload.records))}
        exportedRows={payload.records.length}
      />

      {latestChanges.length > 0 && !dismissedChanges && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] px-3 py-2 text-[11.5px] text-emerald-100">
          <div>
            <b>{latestChanges.length} field change{latestChanges.length === 1 ? '' : 's'} detected.</b>{' '}
            {latestChanges.slice(0, 3).map((change) => (
              <span key={`${change.id}-${change.field ?? change.kind}-${change.at}`} className="mr-2 inline-block">
                {change.section}: {change.label ?? change.kind}
                {change.kind === 'updated' && <> {String(change.from ?? '—')} → {String(change.to ?? '—')}</>}
              </span>
            ))}
            {latestChanges.length > 3 && <span>and {latestChanges.length - 3} more.</span>}
          </div>
          <button type="button" className="btn btn-ghost btn-xs shrink-0" onClick={() => { setDismissedChanges(true); dismissChanges(); }}>
            Dismiss
          </button>
        </div>
      )}

      <KpiStrip payload={payload} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2"><MonthlyPanel payload={payload} /></div>
        <StatusPanel payload={payload} />
      </div>

      <SectionScorecards sections={payload.sections} onSelect={filterToSection} activeSection={filter.section} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2"><SectionChart sections={payload.sections} /></div>
        <FocalsPanel payload={payload} />
      </div>

      <ActivityMatrix
        payload={payload}
        filter={filter}
        onFilterChange={patchFilter}
        onReset={resetFilter}
        highlighted={highlighted}
        onOpenRecord={(record) => setSelectedId(record.id)}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <QualityPanel payload={payload} onFilterFlag={filterToFlag} onOpenRecordId={openById} />
        <ChangeLogPanel changes={payload.meta.changeLog ?? []} onOpenRecordId={openById} />
      </div>

      <WorkbookFooter payload={payload} />

      <RecordDrawer
        record={selected}
        onClose={() => setSelectedId(null)}
        onFilterSection={(section) => {
          setFilter({ ...EMPTY_MATRIX_FILTER, section });
          setSelectedId(null);
          scrollToMatrix();
        }}
      />
    </div>
  );
}
