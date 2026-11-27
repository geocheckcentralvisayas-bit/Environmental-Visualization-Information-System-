import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';

import {
  base64ToBytes,
  bytesToBase64,
  hashOfflinePassword,
  verifyPasswordHash,
} from '../src/lib/offlineHash';

test('base64 helpers round-trip', () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252]);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test('the offline hash matches the host pbkdf2Sync output', async () => {
  const salt = new TextEncoder().encode('0123456789abcdef');
  const iterations = 1000;
  const expected = pbkdf2Sync('envis-offline-test', salt, iterations, 32, 'sha256').toString('base64');
  assert.equal(await hashOfflinePassword('envis-offline-test', salt, iterations), expected);
});

test('verification accepts the right password only', async () => {
  const salt = new TextEncoder().encode('0123456789abcdef');
  const stored = {
    salt: bytesToBase64(salt),
    iterations: 1000,
    hash: await hashOfflinePassword('correct horse', salt, 1000),
  };

  assert.equal(await verifyPasswordHash('correct horse', stored), true);
  assert.equal(await verifyPasswordHash('correct horsE', stored), false);
  assert.equal(await verifyPasswordHash('', stored), false);
});
