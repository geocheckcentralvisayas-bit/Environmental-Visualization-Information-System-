import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../worker/src/auth.ts';

test('password hashing accepts the correct password and rejects a wrong one', async () => {
  const stored = await hashPassword('correct horse battery staple');
  assert.match(stored, /^pbkdf2\$210000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(await verifyPassword('correct horse battery staple', stored), true);
  assert.equal(await verifyPassword('wrong password', stored), false);
});
