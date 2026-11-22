#!/usr/bin/env node
/**
 * Bump the patch version in package.json and package-lock.json.
 *
 * The pre-commit hook runs this on every commit so each commit and push carries
 * a new version; pass --minor or --major to release deliberately.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const replaceVersion = (file, next, limit) => {
  const raw = readFileSync(file, 'utf8');
  let count = 0;
  const updated = raw.replace(/"version":\s*"\d+\.\d+\.\d+"/g, (match) => {
    count += 1;
    return count <= limit ? `"version": "${next}"` : match;
  });
  if (!count) throw new Error(`No version field found in ${file}`);
  writeFileSync(file, updated);
};

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const mode = process.argv[2];
const next =
  mode === '--major' ? `${major + 1}.0.0`
  : mode === '--minor' ? `${major}.${minor + 1}.0`
  : `${major}.${minor}.${patch + 1}`;

replaceVersion('package.json', next, 1);
replaceVersion('package-lock.json', next, 2);
console.log(`version ${pkg.version} -> ${next}`);
