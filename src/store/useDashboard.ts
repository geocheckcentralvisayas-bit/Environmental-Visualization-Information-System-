import { create } from 'zustand';
import { useMemo } from 'react';
import type { AqmsDataset, Clearance, EccUltraData, EccUltraRecord, Facility, HwRegistration, LayerManifest, LegalData, Meta, PageId, PCOAnalysis, PCORecord, Permit, QualityData, Site, SiteGap, SwmDataset } from '../types';
import type { Session } from '../lib/auth';
import { dataUrl } from '../lib/api';

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

const DEFAULT_FILTERS: Filters = {
  year: 'all',
  province: 'all',
  lifecycle: 'all',
  scope: 'in',
  type: 'all',
  search: '',
};

async function fetchJson<T>(file: string): Promise<T> {
  const response = await fetch(dataUrl(file), { credentials: 'include' });
  if (!response.ok) throw new Error(`Could not load ${file} (HTTP ${response.status})`);
  return (await response.json()) as T;
}

/** Optional datasets keep the dashboard usable before their build step runs. */
async function fetchOptionalJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(file);
  } catch {
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
  page: (window.location.hash.replace('#/', '') as PageId) || 'overview',
  filters: DEFAULT_FILTERS,
  siteGap: 'all',
  selectedSiteId: null,
  focus: null,
  legalFocus: null,
  session: null,

  load: async () => {
    if (get().loading || get().data) return;
    set({ loading: true, error: null, progress: 'Opening registers…' });
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
      set({ swm, aqms });
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

  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
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

export function matchesSearch(haystack: Array<string | number | null | undefined>, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return haystack.some((value) => String(value ?? '').toLowerCase().includes(query));
}

export function filterPermits(permits: Permit[], filters: Filters): Permit[] {
  return permits.filter((permit) => {
    if (filters.year !== 'all' && permit.year !== filters.year) return false;
    if (filters.province !== 'all' && permit.province !== filters.province) return false;
    if (filters.lifecycle !== 'all' && permit.lifecycle !== filters.lifecycle) return false;
    if (filters.type !== 'all' && permit.type !== filters.type) return false;
    if (filters.scope === 'in' && permit.scope !== 'in') return false;
    if (filters.scope === 'out' && permit.scope === 'in') return false;
    return matchesSearch(
      [permit.company, permit.permitNo, permit.municipality, permit.province, permit.barangay, permit.industry, permit.address],
      filters.search,
    );
  });
}

export function filterSites(sites: Site[], filters: Filters, gap: SiteGap | 'all' | 'match-only'): Site[] {
  return sites.filter((site) => {
    if (filters.year !== 'all' && !site.years.includes(filters.year)) return false;
    if (filters.province !== 'all' && site.province !== filters.province) return false;
    if (filters.scope === 'in' && site.scope !== 'in') return false;
    if (filters.scope === 'out' && site.scope === 'in') return false;
    if (filters.type === 'DP' && site.dpCount === 0) return false;
    if (filters.type === 'PTO' && site.ptoCount === 0) return false;
    if (gap === 'match-only' && site.matchType !== 'both') return false;
    if (gap !== 'all' && gap !== 'match-only' && site.gap !== gap) return false;
    if (filters.lifecycle === 'Active' && !(site.activeDP || site.activePTO || site.activeHW)) return false;
    if (filters.lifecycle === 'Expired' && (site.activeDP || site.activePTO || site.activeHW)) return false;
    return matchesSearch(
      [site.company, site.municipality, site.province, site.barangay, site.address, site.industry, site.hwGrNos.join(' '), site.eccNos.join(' '), site.cncNos.join(' ')],
      filters.search,
    );
  });
}

export function useFilteredPermits(): Permit[] {
  const data = useDashboard((state) => state.data);
  const filters = useDashboard((state) => state.filters);
  return useMemo(() => (data ? filterPermits(data.permits, filters) : []), [data, filters]);
}

export function useFilteredSites(): Site[] {
  const data = useDashboard((state) => state.data);
  const filters = useDashboard((state) => state.filters);
  const siteGap = useDashboard((state) => state.siteGap);
  return useMemo(() => (data ? filterSites(data.sites, filters, siteGap) : []), [data, filters, siteGap]);
}

export function filterHw(registrations: HwRegistration[], filters: Filters): HwRegistration[] {
  return registrations.filter((registration) => {
    if (filters.year !== 'all') {
      const year = registration.issued ? Number(registration.issued.slice(0, 4)) : null;
      if (year !== filters.year) return false;
    }
    if (filters.province !== 'all' && registration.province !== filters.province) return false;
    if (filters.lifecycle !== 'all' && registration.lifecycle !== filters.lifecycle) return false;
    if (filters.scope === 'in' && registration.scope !== 'in') return false;
    if (filters.scope === 'out' && registration.scope === 'in') return false;
    return matchesSearch(
      [registration.company, registration.hwGrNo, registration.appNo, registration.caseHandler, registration.municipality, registration.province, registration.barangay, registration.address, registration.industry, registration.eccNos.join(' '), registration.cncNos.join(' '), registration.wasteCodes.map((code) => `${code.code} ${code.description}`).join(' ')],
      filters.search,
    );
  });
}

export function filterClearances(clearances: Clearance[], filters: Filters): Clearance[] {
  return clearances.filter((clearance) => {
    if (filters.year !== 'all' && clearance.year !== filters.year) return false;
    if (filters.province !== 'all' && clearance.province !== filters.province) return false;
    if (filters.lifecycle !== 'all' && clearance.lifecycle !== filters.lifecycle) return false;
    if (filters.scope === 'in' && clearance.scope !== 'in') return false;
    if (filters.scope === 'out' && clearance.scope === 'in') return false;
    return matchesSearch(
      [clearance.number, clearance.type, clearance.company, clearance.project, clearance.municipality, clearance.province, clearance.barangay, clearance.hwGrNo, clearance.permitRefs.join(' '), clearance.sources.join(' '), clearance.hwCodes.join(' ')],
      filters.search,
    );
  });
}

export function useFilteredHw(): HwRegistration[] {
  const data = useDashboard((state) => state.data);
  const filters = useDashboard((state) => state.filters);
  return useMemo(() => (data ? filterHw(data.hw, filters) : []), [data, filters]);
}

export function useFilteredClearances(): Clearance[] {
  const data = useDashboard((state) => state.data);
  const filters = useDashboard((state) => state.filters);
  return useMemo(() => (data ? filterClearances(data.clearances, filters) : []), [data, filters]);
}

export function filterFacilities(facilities: Facility[], filters: Filters): Facility[] {
  return facilities.filter((facility) => {
    if (filters.year !== 'all' && !facility.years.includes(filters.year)) return false;
    if (filters.province !== 'all' && facility.province !== filters.province) return false;
    if (filters.scope === 'in' && facility.scope !== 'in') return false;
    if (filters.scope === 'out' && facility.scope === 'in') return false;
    if (filters.type === 'DP' && facility.counts.DP === 0) return false;
    if (filters.type === 'PTO' && facility.counts.PTO === 0) return false;
    const active = facility.activeDP || facility.activePTO || facility.activeHW;
    if (filters.lifecycle === 'Active' && !active) return false;
    if (filters.lifecycle === 'Expired' && active) return false;
    return matchesSearch(
      [
        facility.company,
        facility.aliases.join(' '),
        facility.municipality,
        facility.province,
        facility.barangay,
        facility.address,
        facility.registers.join(' '),
        facility.clearanceNumbers.join(' '),
      ],
      filters.search,
    );
  });
}

export function useFilteredFacilities(): Facility[] {
  const data = useDashboard((state) => state.data);
  const filters = useDashboard((state) => state.filters);
  return useMemo(() => (data ? filterFacilities(data.facilities, filters) : []), [data, filters]);
}

export function useSwm(): SwmDataset | null {
  return useDashboard((state) => state.swm);
}

export function useAqms(): AqmsDataset | null {
  return useDashboard((state) => state.aqms);
}
