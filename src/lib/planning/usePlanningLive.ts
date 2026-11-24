import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import type { PlanningChange, PlanningPayload } from './types';

const POLL_MS = 10_000;
const HIGHLIGHT_MS = 20_000;

export interface PlanningLiveState {
  payload: PlanningPayload | null;
  loading: boolean;
  error: string | null;
  checkedAt: number | null;
  refreshing: boolean;
  latestChanges: PlanningChange[];
  highlighted: Set<string>;
  now: number;
  refresh: () => Promise<void>;
  dismissChanges: () => void;
}

/**
 * Loads the planning payload and keeps it in sync with the watcher.
 *
 * Polling is intentionally short (10 s) because the watcher already does the
 * expensive work: a change is a 304 until the workbook is actually edited.
 */
export function usePlanningLive(): PlanningLiveState {
  const [payload, setPayload] = useState<PlanningPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [latestChanges, setLatestChanges] = useState<PlanningChange[]>([]);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  const hashRef = useRef('');
  const highlightTimer = useRef<number | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async (force = false) => {
    try {
      const response = await apiFetch(`/data/planning.json${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Planning data could not be loaded (HTTP ${response.status}).`);
      }
      const next = (await response.json()) as PlanningPayload;
      if (!aliveRef.current) return;
      setCheckedAt(Date.now());
      setError(null);
      if (next.meta.contentHash !== hashRef.current) {
        const firstLoad = !hashRef.current;
        hashRef.current = next.meta.contentHash;
        setPayload(next);
        if (!firstLoad) {
          const fresh = (next.meta.changeLog ?? []).filter((entry) => entry.at === next.meta.generatedAt);
          setLatestChanges(fresh);
          setHighlighted(new Set(fresh.map((entry) => entry.id)));
          if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
          highlightTimer.current = window.setTimeout(() => setHighlighted(new Set()), HIGHLIGHT_MS);
        }
      }
    } catch (caught) {
      if (!aliveRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Planning data could not be loaded.');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      aliveRef.current = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const dismissChanges = useCallback(() => setLatestChanges([]), []);

  return { payload, loading, error, checkedAt, refreshing, latestChanges, highlighted, now, refresh, dismissChanges };
}
