import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PermitSchema } from '../scripts/schemas.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('permits.json passes the strict PermitSchema (non-empty permitNo)', () => {
  const permits = JSON.parse(readFileSync(path.join(ROOT, 'public/data/permits.json'), 'utf8'));
  const failures = permits.flatMap((permit: unknown, index: number) => {
    const result = PermitSchema.safeParse(permit);
    return result.success ? [] : [{ index, issues: result.error.issues }];
  });
  assert.deepEqual(failures.slice(0, 5), [], `strict PermitSchema rejected ${failures.length} of ${permits.length} records`);
});
