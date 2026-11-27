/**
 * Password hashing shared by the live host (Node `pbkdf2Sync`) and the offline
 * copy (WebCrypto). Pure and dependency-free so it can be unit tested.
 *
 * The live dashboard's Vite middleware writes the hash; this module verifies it
 * in the installed offline copy.
 */

export interface OfflinePasswordHash {
  salt: string;
  iterations: number;
  hash: string;
}

export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export async function hashOfflinePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    material,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

/** Compares in constant time so a wrong password does not leak how close it was. */
export async function verifyPasswordHash(password: string, stored: OfflinePasswordHash): Promise<boolean> {
  if (!stored?.hash || !stored.salt) return false;
  const derived = await hashOfflinePassword(password, base64ToBytes(stored.salt), stored.iterations);
  if (derived.length !== stored.hash.length) return false;
  let difference = 0;
  for (let index = 0; index < derived.length; index += 1) {
    difference |= derived.charCodeAt(index) ^ stored.hash.charCodeAt(index);
  }
  return difference === 0;
}
