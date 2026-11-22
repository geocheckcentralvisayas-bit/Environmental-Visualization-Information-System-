import { useDataStore, selectData, selectLoading } from './useDataStore';
import type { PCORecord, PCOAnalysis } from '../types';

import { dataUrl } from '../lib/api';

// Call sites: dataLoader.ts exports loadDashboardData used by src/store/index.ts (legacy useDashboard hook)
// Data schemas: uses useDataStore.setState to write { loading, error, progress, data, pcoRecords, pcoAnalysis, optionalErrors }
// User instruction: "continue to fix the critical bugs , high bugs, medium bugs, and low bugs now from the bug audit report"

const optionalFailures: string[] = [];

async function fetchJson<T>(file: string): Promise<T> {
  const response = await fetch(dataUrl(file), { credentials: 'include' });
  if (!response.ok) throw new Error(`Could not load ${file} (HTTP ${response.status})`);
  return (await response.json()) as T;
}

async function fetchOptionalJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return await fetchJson<T>(file);
  } catch (error) {
    optionalFailures.push(`${file}: ${error instanceof Error ? error.message : 'unknown error'}`);
    return fallback;
  }
}

const EMPTY_LEGAL: any = {
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

export async function loadDashboardData(): Promise<void> {
  const { loading, data } = useDataStore.getState();
  if (loading || data) return;

  optionalFailures.length = 0;
  useDataStore.setState({ loading: true, error: null, optionalErrors: [], progress: 'Opening registers…' });
  try {
    const meta = await fetchJson<any>('meta.json');
    useDataStore.setState({ progress: 'Loading permit records…' });
    const permits = await fetchJson<any[]>('permits.json');
    useDataStore.setState({ progress: 'Cross-matching establishments…' });
    const sites = await fetchJson<any[]>('sites.json');
    const [quality, layers, hw, clearances, facilities, legal] = await Promise.all([
      fetchJson<any>('quality.json'),
      fetchJson<any>('geojson/layers.json'),
      fetchJson<any[]>('hw.json'),
      fetchJson<any[]>('clearances.json'),
      fetchJson<any[]>('facilities.json'),
      fetchOptionalJson<any>('legal.json', EMPTY_LEGAL),
    ]);
    useDataStore.setState({
      data: { meta, permits, sites, quality, layers, hw, clearances, facilities, legal },
      loading: false,
      progress: 'Ready',
    });
    // Fetch PCO data separately
    try {
      const [pcoRecords, pcoAnalysis] = await Promise.all([
        fetchOptionalJson<{ records: PCORecord[] }>('pco-database.json', { records: [] }),
        fetchOptionalJson<PCOAnalysis | null>('pco-analysis.json', null),
      ]);
      useDataStore.setState({
        pcoRecords: pcoRecords?.records ?? [],
        pcoAnalysis,
      });
    } catch {
      // PCO data is optional; ignore errors
    }
    useDataStore.setState({ optionalErrors: [...optionalFailures] });
  } catch (error) {
    useDataStore.setState({
      loading: false,
      error: error instanceof Error ? error.message : 'Failed to load the dashboard dataset.',
    });
  }
}