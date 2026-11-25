#!/usr/bin/env node
/**
 * Downloads the Region VII basemap once so the dashboard works without internet.
 *
 * Writes `offline-tiles/<style>/<z>/<x>/<y>.jpg`; the Vite middleware in
 * `vite.config.ts` serves that folder at `/tiles` and caches any extra tile
 * opened while online. Re-run safely: existing tiles are skipped.
 *
 *   npm run data:tiles
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'offline-tiles');

// Cebu, Bohol, Negros Oriental, Siquijor with a margin.
const BBOX = { west: 122.2, south: 9.0, east: 124.7, north: 11.7 };
const ZOOMS = [7, 8, 9, 10, 11, 12];
const STYLES = {
  streets: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile',
};
const CONCURRENCY = 8;
const RETRIES = 3;

function tileRange(zoom) {
  const size = 2 ** zoom;
  const project = (lon, lat) => {
    const x = Math.floor(((lon + 180) / 360) * size);
    const radians = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * size);
    return { x, y };
  };
  const topLeft = project(BBOX.west, BBOX.north);
  const bottomRight = project(BBOX.east, BBOX.south);
  return { minX: topLeft.x, maxX: bottomRight.x, minY: topLeft.y, maxY: bottomRight.y };
}

const jobs = [];
for (const style of Object.keys(STYLES)) {
  for (const zoom of ZOOMS) {
    const { minX, maxX, minY, maxY } = tileRange(zoom);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        jobs.push({ style, zoom, x, y, file: join(outDir, style, String(zoom), String(x), `${y}.jpg`) });
      }
    }
  }
}

const pending = jobs.filter((job) => !existsSync(job.file));
console.log(`offline tiles: ${jobs.length} in range, ${pending.length} to download -> ${outDir}`);

let done = 0;
let failed = 0;
const failures = [];

async function download(job) {
  const url = `${STYLES[job.style]}/${job.zoom}/${job.y}/${job.x}`;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const image = Buffer.from(await response.arrayBuffer());
      mkdirSync(dirname(job.file), { recursive: true });
      writeFileSync(job.file, image);
      return;
    } catch (error) {
      if (attempt === RETRIES) {
        failed += 1;
        failures.push(`${url}: ${error.message}`);
        return;
      }
      await new Promise((wait) => setTimeout(wait, 400 * attempt));
    }
  }
}

let cursor = 0;
async function worker() {
  while (cursor < pending.length) {
    const job = pending[cursor];
    cursor += 1;
    await download(job);
    done += 1;
    if (done % 100 === 0 || done === pending.length) {
      console.log(`  ${done}/${pending.length}`);
    }
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (failed) {
  console.warn(`offline tiles: ${failed} tile(s) failed after ${RETRIES} attempts:`);
  for (const message of failures.slice(0, 10)) console.warn(`  ${message}`);
}
console.log(`offline tiles: finished in ${Math.round((Date.now() - started) / 1000)}s.`);
if (!failed) console.log('Offline maps are ready. Copy the offline-tiles folder with the project.');
