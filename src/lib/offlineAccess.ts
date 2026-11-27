/**
 * MIS-controlled gate for the static offline copy.
 *
 * The live dashboard is the only place the password can be created: an MIS
 * user sets it from Administration → Offline access, and the hashed value is
 * written to `offline-access.json` beside the project, which the offline snapshot and
 * every LAN sync carry along. The offline copy can therefore verify it but
 * never create or change it.
 */
import { OFFLINE } from './api';
import { verifyPasswordHash, type OfflinePasswordHash } from './offlineHash';

export interface OfflineAccessStatus {
  configured: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

interface OfflineAccessFile extends OfflineAccessStatus, OfflinePasswordHash {}

const UNLOCK_KEY = 'envis.offline.unlocked';

async function readFile(): Promise<OfflineAccessFile | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/offline-access.json`, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as OfflineAccessFile;
  } catch {
    return null;
  }
}

export async function offlineAccessStatus(): Promise<OfflineAccessStatus> {
  if (OFFLINE) {
    const file = await readFile();
    return file ? { configured: true, updatedAt: file.updatedAt, updatedBy: file.updatedBy } : { configured: false };
  }
  const response = await fetch('/offline-access', { cache: 'no-store' });
  if (!response.ok) throw new Error('This dashboard build cannot manage offline access.');
  return (await response.json()) as OfflineAccessStatus;
}

/** MIS-only: stores the password that unlocks the offline copy on every PC. */
export async function setOfflinePassword(input: {
  username: string;
  password: string;
  newPassword: string;
}): Promise<void> {
  const response = await fetch('/offline-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Offline access was not saved (HTTP ${response.status}).`);
  }
}

export async function verifyOfflinePassword(password: string): Promise<boolean> {
  const file = await readFile();
  if (!file) return false;
  return verifyPasswordHash(password, file);
}

export function isOfflineUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function unlockOffline(): void {
  try {
    sessionStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    // Private mode with storage disabled: the viewer stays gated for this tab.
  }
}

export function lockOffline(): void {
  try {
    sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    // Nothing to clear.
  }
}
