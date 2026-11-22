import { create } from 'zustand';
import { useMemo } from 'react';
import type { AqmsDataset, Clearance, EccUltraData, EccUltraRecord, Facility, HwRegistration, LayerManifest, LegalData, Meta, PageId, PCOAnalysis, PCORecord, Permit, QualityData, Site, SiteGap, SwmDataset } from '../types';
import type { Session } from '../lib/auth';
import { dataUrl } from '../lib/api';
import { filterPermits, filterSites, filterHw, filterClearances, filterFacilities, matchesSearch, DEFAULT_FILTERS, sanitizeFiltersPatch } from './filters';

export interface Filters {
  year: number | 'all';
  province: string | 'all';
  lifecycle: string | 'all';
  scope: 'in' | 'all' | 'out';
  type: 'all' | 'DP' | 'PTO';
  search: string;
}

export interface Dataset {
  permits: Permit[];
  sites: Site[];
  meta: Meta;
  quality: QualityData;
  layers: LayerManifest;
  hw: HwRegistration[];
  clearances: Clearance[];
  facilities: Facility[];
  legal: LegalData;
}

export interface MapFocus {
  lat: number;
  lon: number;
  label: string;
  siteId: string | null;
  nonce: number;
}

export interface FocusTarget {
  lat: number | null | undefined;
  lon: number | null | undefined;
  label: string;
  siteId?: string | null;
}

interface DashboardState {
  data: Dataset | null;
  pcoRecords: PCORecord[];
  pcoAnalysis: PCOAnalysis | null;
  eccUltralist: EccUltraData | null;
  eccUltralistLoading: boolean;
  eccUltralistError: string | null;
  swm: SwmDataset | null;
  aqms: AqmsDataset | null;
  clearancesLoading: boolean;
  clearancesError: string | null;
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
  loadEccUltralist: () => Promise<void>;
  loadClearances: () => Promise<void>;
}

async function fetchJson<T>(file: string): Promise<T> {
  const response = await fetch(dataUrl(file), { credentials: 'include' });
  if (!response.ok) throw new Error(`Could not load ${file} (HTTP ${response.status})`);
  return (await response.json()) as T;
}

const optionalFailures: string[] = [];

/** Optional datasets keep the dashboard usable before their build step runs. */
async function fetchOptionalJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(file);
  } catch (error) {
    optionalFailures.push(`${file}: ${error instanceof Error ? error.message : 'unknown error'}`);
    return fallback;
  }
}

const EMPTY_LEGAL: LegalData = {
  generatedAt: '',
  dataDate: '',
  fetchedAt: '',
  sourceUrl: '',
  scopeLabel: '',
  timelineStart: '',
  docketYears: [],
  matchQuality: { exact: 0, alias: 0, manual: 0, unmatched: 0 },
  totals: {
    entities: 0, matchedEntities: 0, unmatchedEntities: 0, facilitiesWithLegal: 0,
    cases: 0, pabNov: 0, pabNovPlaceholders: 0, orders: 0, pabOrders: 0, erf: 0,
    pabPenalties: 0, ra6969: 0, complaints: 0, openEntities: 0, closedEntities: 0, pabCollected: 0,
  },
  pabByYear: [],
  entities: [],
  orphans: [],
  cases: [],
  byFacility: {},
  candidateCount: 0,
};

export const useDashboard = create<DashboardState>((set, get) => ({
  data: null,
  pcoRecords: [],
  pcoAnalysis: null,
  eccUltralist: null,
  eccUltralistLoading: false,
  eccUltralistError: null,
  swm: null,
  aqms: null,
  clearancesLoading: false,
  clearancesError: null,
  loading: false,
  progress: '',
  error: null,
  optionalErrors: [],
  page: (window.location.hash.replace('#/', '') as PageId) || 'overview',
  filters: DEFAULT_FILTERS,
  siteGap: 'all',
  selectedSiteId: null,
  focus: null,
  legalFocus: null,
  session: null,

  load: async () => {
    if (get().loading || get().data) return;
    optionalFailures.length = 0;
    set({ loading: true, error: null, optionalErrors: [], progress: 'Opening registers…' });
    try {
      const meta = await fetchJson<Meta>('meta.json');
      set({ progress: 'Loading permit records…' });
      const permits = await fetchJson<Permit[]>('permits.json');
      set({ progress: 'Cross-matching establishments…' });
      const sites = await fetchJson<Site[]>('sites.json');
      const [quality, layers, hw, facilities, legal] = await Promise.all([
        fetchJson<QualityData>('quality.json'),
        fetchJson<LayerManifest>('geojson/layers.json'),
        fetchJson<HwRegistration[]>('hw.json'),
        fetchJson<Facility[]>('facilities.json'),
        fetchOptionalJson<LegalData>('legal.json', EMPTY_LEGAL),
      ]);
      set({ data: { meta, permits, sites, quality, layers, hw, clearances: [], facilities, legal }, loading: false, progress: 'Ready' });
      // Fetch PCO data separately
      try {
        const [pcoRecords, pcoAnalysis] = await Promise.all([
          fetchOptionalJson<{ records: PCORecord[] }>('pco-database.json', { records: [] }),
          fetchOptionalJson<PCOAnalysis | null>('pco-analysis.json', null),
        ]);
        set({ pcoRecords: pcoRecords?.records ?? [], pcoAnalysis });
      } catch {
        // PCO data is optional; ignore errors
      }
      // Solid waste (MRF) register is optional so a missing build cannot block
      // the rest of the dashboard.
      const [swm, aqms] = await Promise.all([
        fetchOptionalJson<SwmDataset | null>('swm.json', null),
        fetchOptionalJson<AqmsDataset | null>('aqms.json', null),
      ]);
      set({ swm, aqms, optionalErrors: [...optionalFailures] });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load the dashboard dataset.',
      });
    }
  },

  setPage: (page) => {
    if (window.location.hash !== `#/${page}`) window.location.hash = `#/${page}`;
    set({ page, selectedSiteId: null, focus: null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...sanitizeFiltersPatch(patch) } })),
  resetFilters: () => set({ filters: DEFAULT_FILTERS, siteGap: 'all' }),
  setSiteGap: (siteGap) => set({ siteGap }),
  selectSite: (selectedSiteId) => set({ selectedSiteId }),

  openMapAt: (target) => {
    if (window.location.hash !== '#/map') window.location.hash = '#/map';
    set((state) => {
      const hasCoordinate = target.lat !== null && target.lat !== undefined && target.lon !== null && target.lon !== undefined;
      return {
        page: 'map' as PageId,
        selectedSiteId: null,
        focus: hasCoordinate
          ? {
              lat: target.lat as number,
              lon: target.lon as number,
              label: target.label,
              siteId: target.siteId ?? null,
              nonce: (state.focus?.nonce ?? 0) + 1,
            }
          : null,
      };
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  openLegalEntity: (entityId) => {
    if (window.location.hash !== '#/legal') window.location.hash = '#/legal';
    set((state) => ({
      page: 'legal' as PageId,
      selectedSiteId: null,
      focus: null,
      legalFocus: { entityId, nonce: (state.legalFocus?.nonce ?? 0) + 1 },
    }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  setSession: (session) => set({ session }),

  loadEccUltralist: async () => {
    if (get().eccUltralist || get().eccUltralistLoading) return;
    set({ eccUltralistLoading: true, eccUltralistError: null });
    try {
      const raw = await fetchJson<{
        fields: string[];
        records: unknown[][];
      } & Omit<EccUltraData, 'records' | 'fields'>>('ecc-ultralist.json');
      const fields = raw.fields ?? [];
      const records = raw.records.map((row) => {
        const record: Record<string, unknown> = {};
        fields.forEach((field, index) => {
          record[field] = row[index];
        });
        return record as unknown as EccUltraRecord;
      });
      set({ eccUltralist: { ...raw, fields, records }, eccUltralistLoading: false });
    } catch (error) {
      set({
        eccUltralistLoading: false,
        eccUltralistError: error instanceof Error ? error.message : 'Could not load the ECC / CNC ultralist.',
      });
    }
  },

  loadClearances: async () => {
    const state = get();
    if (!state.data || state.data.clearances.length || state.clearancesLoading) return;
    set({ clearancesLoading: true, clearancesError: null });
    try {
      const clearances = await fetchJson<Clearance[]>('clearances.json');
      set((current) => ({
        data: current.data ? { ...current.data, clearances } : current.data,
        clearancesLoading: false,
      }));
    } catch (error) {
      set({
        clearancesLoading: false,
        clearancesError: error instanceof Error ? error.message : 'Could not load the ECC / CNC clearances.',
      });
    }
  },
}));

export function useFilteredPermits(): Permit[] {
  const permits = useDashboard((state) => state.data?.permits);
  const filters = useDashboard((state) => state.filters);
  return useMemo(() => (permits ? filterPermits(permits, filters) : []), [permits, filters]);
}

export function useFilteredSites(): Site[] {
  const sites = useDashboard((state) => state.data?.sites);
  const filters = useDashboard((state) => state.filters);
  const siteGap = useDashboard((state) => state.siteGap);
  return useMemo(() => (sites ? filterSites(sites, filters, siteGap) : []), [sites, filters, siteGap]);
}

export function useFilteredHw(): HwRegistration[] {
  const hw = useDashboard((state) => state.data?.hw);
  const filters = useDashboard((state) => state.filters);
  return useMemo(() => (hw ? filterHw(hw, filters) : []), [hw, filters]);
}

export function useFilteredClearances(): Clearance[] {
  const clearances = useDashboard((state) => state.data?.clearances);
  const filters = useDashboard((state) => state.filters);
  return useMemo(() => (clearances ? filterClearances(clearances, filters) : []), [clearances, filters]);
}

export function useFilteredFacilities(): Facility[] {
  const facilities = useDashboard((state) => state.data?.facilities);
  const filters = useDashboard((state) => state.filters);
  return useMemo(() => (facilities ? filterFacilities(facilities, filters) : []), [facilities, filters]);
}

export function useSwm(): SwmDataset | null {
  return useDashboard((state) => state.swm);
}

export function useAqms(): AqmsDataset | null {
  return useDashboard((state) => state.aqms);
}
