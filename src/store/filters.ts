import type { Clearance, Facility, Filters, HwRegistration, Permit, Site, SiteGap } from '../types';

/**
 * Shared filter utilities - single source of truth for all filtering logic.
 * Used by both useFiltersStore and useDashboard to ensure consistent filtering.
 */

export const DEFAULT_FILTERS: Filters = {
  year: 'all',
  province: 'all',
  lifecycle: 'all',
  scope: 'in',
  type: 'all',
  search: '',
};

/** Valid lifecycle values for filtering */
const VALID_LIFECYCLES = new Set(['all', 'Active', 'Expiring', 'Expired', 'Unknown']);

/** Valid scope values for filtering */
const VALID_SCOPES = new Set(['in', 'all', 'out']);

/** Valid type values for filtering */
const VALID_TYPES = new Set(['all', 'DP', 'PTO']);

/**
 * Sanitize a filter patch, keeping only valid keys and values.
 * Invalid values fall back to DEFAULT_FILTERS.
 */
export function sanitizeFiltersPatch(patch: Partial<Filters>): Partial<Filters> {
  const sanitized: Partial<Filters> = {};

  if (patch.year !== undefined) {
    sanitized.year = typeof patch.year === 'number' && patch.year > 0 ? patch.year : 'all';
  }
  if (patch.province !== undefined) {
    sanitized.province = typeof patch.province === 'string' ? patch.province : 'all';
  }
  if (patch.lifecycle !== undefined) {
    sanitized.lifecycle = VALID_LIFECYCLES.has(patch.lifecycle) ? patch.lifecycle : 'all';
  }
  if (patch.scope !== undefined) {
    sanitized.scope = VALID_SCOPES.has(patch.scope) ? patch.scope : 'in';
  }
  if (patch.type !== undefined) {
    sanitized.type = VALID_TYPES.has(patch.type) ? patch.type : 'all';
  }
  if (patch.search !== undefined) {
    sanitized.search = typeof patch.search === 'string' ? patch.search : '';
  }

  return sanitized;
}

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
      [clearance.number, clearance.type, clearance.company, clearance.municipality, clearance.province, clearance.hwGrNo, clearance.permitRefs.join(' '), clearance.sources.join(' ')],
      filters.search,
    );
  });
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