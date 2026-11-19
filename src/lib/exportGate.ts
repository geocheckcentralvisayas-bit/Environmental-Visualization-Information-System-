import { verifyCredentials } from './auth';

export type GateKind = 'export' | 'geojson';

type Pending = { kind: GateKind; action: () => void } | null;
let pending: Pending = null;
const listeners = new Set<(state: { open: boolean; kind: GateKind | null }) => void>();

function requestGate(kind: GateKind, action: () => void): void {
  // Always prompt for credentials, even for already-authorised sessions, so
  // exports/downloads are never one-click from a logged-in browser.
  pending = { kind, action };
  listeners.forEach((l) => l({ open: true, kind }));
}

export function requestExport(action: () => void): void {
  requestGate('export', action);
}

export function requestGeoJson(action: () => void): void {
  requestGate('geojson', action);
}

export function resolveGate(): void {
  const current = pending;
  pending = null;
  listeners.forEach((l) => l({ open: false, kind: null }));
  if (current) current.action();
}

export function cancelGate(): void {
  pending = null;
  listeners.forEach((l) => l({ open: false, kind: null }));
}

export function subscribeGate(listener: (state: { open: boolean; kind: GateKind | null }) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPendingKind(): GateKind | null {
  return pending?.kind ?? null;
}

/**
 * Re-authenticate without replacing the current dashboard session. The API
 * checks that the supplied account is allowed to perform the pending action
 * and records the event in the shared activity log.
 */
export async function tryGateLogin(username: string, password: string): Promise<boolean> {
  const kind = getPendingKind();
  if (!kind) return false;
  const result = await verifyCredentials(username, password, kind);
  return result.ok;
}
