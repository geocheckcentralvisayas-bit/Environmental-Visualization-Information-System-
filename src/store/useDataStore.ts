import { create } from 'zustand';
import type { Clearance, Dataset, Facility, HwRegistration, LayerManifest, LegalData, Meta, PCOAnalysis, PCORecord, Permit, QualityData, Site } from '../types';

interface DataState {
  data: Dataset | null;
  pcoRecords: PCORecord[];
  pcoAnalysis: PCOAnalysis | null;
  loading: boolean;
  progress: string;
  error: string | null;
  optionalErrors: string[];
  setData: (data: Dataset) => void;
  setPCOData: (records: PCORecord[], analysis: PCOAnalysis) => void;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: string) => void;
  setError: (error: string | null) => void;
  setOptionalErrors: (errors: string[]) => void;
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

export const useDataStore = create<DataState>((set) => ({
  data: null,
  pcoRecords: [],
  pcoAnalysis: null,
  loading: false,
  progress: '',
  error: null,
  optionalErrors: [],

  setData: (data) => set({ data }),
  setPCOData: (records, analysis) => set({ pcoRecords: records, pcoAnalysis: analysis }),
  setLoading: (loading) => set({ loading }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setOptionalErrors: (optionalErrors) => set({ optionalErrors }),
}));

export const selectData = (state: DataState) => state.data;
export const selectLoading = (state: DataState) => state.loading;
export const selectProgress = (state: DataState) => state.progress;
export const selectError = (state: DataState) => state.error;
export const selectOptionalErrors = (state: DataState) => state.optionalErrors;
export const selectPermits = (state: DataState) => state.data?.permits ?? [];
export const selectSites = (state: DataState) => state.data?.sites ?? [];
export const selectMeta = (state: DataState) => state.data?.meta;
export const selectQuality = (state: DataState) => state.data?.quality;
export const selectLayers = (state: DataState) => state.data?.layers;
export const selectHw = (state: DataState) => state.data?.hw ?? [];
export const selectClearances = (state: DataState) => state.data?.clearances ?? [];
export const selectFacilities = (state: DataState) => state.data?.facilities ?? [];
export const selectLegal = (state: DataState) => state.data?.legal;
export const selectPCORecords = (state: DataState) => state.pcoRecords;
export const selectPCOAnalysis = (state: DataState) => state.pcoAnalysis;