import { create } from 'zustand';
import { useMemo } from 'react';
import type { Clearance, Facility, Filters, HwRegistration, Permit, Site, SiteGap } from '../types';
import { useDataStore, selectPermits, selectSites, selectHw, selectClearances, selectFacilities } from './useDataStore';
import { DEFAULT_FILTERS, filterPermits, filterSites, filterHw, filterClearances, filterFacilities, matchesSearch, sanitizeFiltersPatch } from './filters';

interface FiltersState {
  filters: Filters;
  siteGap: SiteGap | 'all' | 'match-only';
  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  setSiteGap: (gap: SiteGap | 'all' | 'match-only') => void;
}

export const useFiltersStore = create<FiltersState>((set) => ({
  filters: DEFAULT_FILTERS,
  siteGap: 'all',

  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...sanitizeFiltersPatch(patch) } })),
  resetFilters: () => set({ filters: DEFAULT_FILTERS, siteGap: 'all' }),
  setSiteGap: (siteGap) => set({ siteGap }),
}));

export function useFilteredPermits(): Permit[] {
  const permits = useDataStore(selectPermits);
  const filters = useFiltersStore((state) => state.filters);
  return useMemo(() => (permits ? filterPermits(permits, filters) : []), [permits, filters]);
}

export function useFilteredSites(): Site[] {
  const sites = useDataStore(selectSites);
  const filters = useFiltersStore((state) => state.filters);
  const siteGap = useFiltersStore((state) => state.siteGap);
  return useMemo(() => (sites ? filterSites(sites, filters, siteGap) : []), [sites, filters, siteGap]);
}

export function useFilteredHw(): HwRegistration[] {
  const hw = useDataStore(selectHw);
  const filters = useFiltersStore((state) => state.filters);
  return useMemo(() => (hw ? filterHw(hw, filters) : []), [hw, filters]);
}

export function useFilteredClearances(): Clearance[] {
  const clearances = useDataStore(selectClearances);
  const filters = useFiltersStore((state) => state.filters);
  return useMemo(() => (clearances ? filterClearances(clearances, filters) : []), [clearances, filters]);
}

export function useFilteredFacilities(): Facility[] {
  const facilities = useDataStore(selectFacilities);
  const filters = useFiltersStore((state) => state.filters);
  return useMemo(() => (facilities ? filterFacilities(facilities, filters) : []), [facilities, filters]);
}