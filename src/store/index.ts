// Re-export all stores for backward compatibility
export { useDataStore, selectData, selectLoading, selectProgress, selectError, selectOptionalErrors, selectPermits, selectSites, selectMeta, selectQuality, selectLayers, selectHw, selectClearances, selectFacilities, selectLegal, selectPCORecords, selectPCOAnalysis } from './useDataStore';
export { useFiltersStore, useFilteredPermits, useFilteredSites, useFilteredHw, useFilteredClearances, useFilteredFacilities } from './useFiltersStore';
export { filterPermits, filterSites, filterHw, filterClearances, filterFacilities, matchesSearch } from './filters';
export { useUIStore, selectPage, selectSelectedSiteId, selectFocus, selectLegalFocus, selectSession } from './useUIStore';
export { loadDashboardData } from './dataLoader';

// Combined hook for components that need multiple stores (gradual migration)
import { useDataStore, selectData, selectLoading, selectProgress, selectError, selectOptionalErrors, selectPCORecords, selectPCOAnalysis } from './useDataStore';
import { useFiltersStore } from './useFiltersStore';
import { useUIStore, selectPage, selectSelectedSiteId, selectFocus, selectLegalFocus, selectSession } from './useUIStore';
import { loadDashboardData } from './dataLoader';
import type { Dataset, Filters, MapFocus, FocusTarget, Session, PageId, SiteGap, PCORecord, PCOAnalysis } from '../types';

// Type re-exports
export type { Dataset, Filters, MapFocus, FocusTarget, Session, PageId, SiteGap, PCORecord, PCOAnalysis } from '../types';

// Legacy combined interface for gradual migration
export interface DashboardState {
  data: Dataset | null;
  loading: boolean;
  progress: string;
  error: string | null;
  optionalErrors: string[];
  page: PageId;
  filters: Filters;
  siteGap: SiteGap | 'all' | 'match-only';
  selectedSiteId: string | null;
  focus: MapFocus | null;
  legalFocus: { entityId: string; nonce: number } | null;
  session: Session | null;
  load: () => Promise<void>;
  setPage: (page: PageId) => void;
  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  setSiteGap: (gap: SiteGap | 'all' | 'match-only') => void;
  selectSite: (id: string | null) => void;
  openMapAt: (target: FocusTarget) => void;
  openLegalEntity: (entityId: string) => void;
  setSession: (session: Session | null) => void;
}

// Legacy hook - wraps the three stores for backward compatibility
export function useDashboard(): DashboardState {
  const data = useDataStore(selectData);
  const loading = useDataStore(selectLoading);
  const progress = useDataStore(selectProgress);
  const error = useDataStore(selectError);
  const optionalErrors = useDataStore(selectOptionalErrors);
  const page = useUIStore(selectPage);
  const filters = useFiltersStore((state) => state.filters);
  const siteGap = useFiltersStore((state) => state.siteGap);
  const selectedSiteId = useUIStore(selectSelectedSiteId);
  const focus = useUIStore(selectFocus);
  const legalFocus = useUIStore(selectLegalFocus);
  const session = useUIStore(selectSession);

  return {
    data,
    loading,
    progress,
    error,
    optionalErrors,
    page,
    filters,
    siteGap,
    selectedSiteId,
    focus,
    legalFocus,
    session,
    load: loadDashboardData,
    setPage: useUIStore.getState().setPage,
    setFilters: useFiltersStore.getState().setFilters,
    resetFilters: useFiltersStore.getState().resetFilters,
    setSiteGap: useFiltersStore.getState().setSiteGap,
    selectSite: useUIStore.getState().selectSite,
    openMapAt: useUIStore.getState().openMapAt,
    openLegalEntity: useUIStore.getState().openLegalEntity,
    setSession: useUIStore.getState().setSession,
  };
}