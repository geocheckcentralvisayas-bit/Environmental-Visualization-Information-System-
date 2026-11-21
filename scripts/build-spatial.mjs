import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { constants } from 'node:fs';

const require = createRequire(import.meta.url);
const mapshaperBin = require.resolve('mapshaper/bin/mapshaper');

const SRC = 'spatial-src';
const OUT = 'public/data/geojson';

export const LAYERS = [
  {
    id: 'provincial_boundary',
    name: 'Provincial Boundary',
    group: 'Administrative',
    src: 'R7_PROVINCIAL_BOUNDARY.geojson',
    out: 'provincial_boundary.geojson',
    fields: ['province', 'region'],
    simplify: '8%',
    style: { kind: 'outline', color: '#7dd3fc', weight: 2, fillOpacity: 0.02 },
    description: 'Central Visayas provincial boundary (Cebu and Bohol).',
  },
  {
    id: 'districts',
    name: 'Legislative Districts',
    group: 'Administrative',
    src: 'R7_DISTRICTS.geojson',
    out: 'districts.geojson',
    fields: ['NAME_2'],
    simplify: '8%',
    style: { kind: 'outline', color: '#c4b5fd', weight: 1.4, fillOpacity: 0.02 },
    description: 'Provincial and legislative district boundaries.',
  },
  {
    id: 'protected_areas',
    name: 'Protected Areas',
    group: 'Environment',
    src: 'Protected_Area.geojson',
    out: 'protected_areas.geojson',
    fields: ['PA_NAME', 'CATEGORY', 'PROVINCE'],
    simplify: '8%',
    style: { kind: 'outline', color: '#34d399', weight: 1.4, fillOpacity: 0.12 },
    description: 'NIPAS protected areas and conservation sites.',
  },
  {
    id: 'watersheds',
    name: 'Watersheds',
    group: 'Environment',
    src: 'Watersheds.geojson',
    out: 'watersheds.geojson',
    fields: ['WATERSHED'],
    simplify: '8%',
    style: { kind: 'outline', color: '#22d3ee', weight: 1.2, fillOpacity: 0.08 },
    description: 'Major river watersheds and sub-watersheds.',
  },
  {
    id: 'flooding',
    name: 'Flood Susceptibility',
    group: 'Hazards',
    src: 'flooding.geojson',
    out: 'flooding.geojson',
    dissolve: 'FloodSusc',
    fields: ['FloodSusc'],
    simplify: '6%',
    style: { kind: 'classified', field: 'FloodSusc' },
    description: 'Flood hazard susceptibility (very high to low).',
  },
  {
    id: 'landslide',
    name: 'Landslide Susceptibility',
    group: 'Hazards',
    src: 'landslide.geojson',
    out: 'landslide.geojson',
    dissolve: 'LndslideSu',
    fields: ['LndslideSu'],
    simplify: '4%',
    style: { kind: 'classified', field: 'LndslideSu' },
    description: 'Rain-induced landslide susceptibility (very high to low).',
  },
  {
    id: 'land_cover',
    name: 'Land Cover 2025 (Cebu)',
    group: 'Land',
    src: 'LCM_2025_CBU_UTMZ51N_PRS92.geojson',
    out: 'land_cover.geojson',
    dissolve: 'LCM_CLASS',
    fields: ['LCM_CLASS'],
    simplify: '2.5%',
    style: { kind: 'classified', field: 'LCM_CLASS' },
    description: '2025 land cover map for the province of Cebu.',
  },
  {
    id: 'land_cover_bohol',
    name: 'Land Cover 2025 (Bohol)',
    group: 'Land',
    src: 'Land_Cover_2025_Bohol.geojson',
    out: 'land_cover_bohol.geojson',
    dissolve: 'LCM_CLASS',
    fields: ['LCM_CLASS'],
    simplify: '2.5%',
    style: { kind: 'classified', field: 'LCM_CLASS' },
    description: '2025 land cover map for the province of Bohol.',
  },
  {
    id: 'land_classification',
    name: 'Land Classification',
    group: 'Land',
    src: 'replotted_lcmap_wgs84.geojson',
    out: 'land_classification.geojson',
    dissolve: 'CLASSIFIC_',
    fields: ['CLASSIFIC_'],
    simplify: '5%',
    style: { kind: 'classified', field: 'CLASSIFIC_' },
    description: 'Forestland / alienable and disposable land classification.',
  },
  {
    id: 'river_networks',
    name: 'River Networks',
    group: 'Environment',
    src: 'Rivers_Networks.geojson',
    out: 'river_networks.geojson',
    simplify: '4%',
    style: { kind: 'outline', color: '#38bdf8', weight: 1.1, fillOpacity: 0 },
    description: 'River and stream network overlay (Region VII).',
  },
  {
    id: 'river_networks_buffered',
    name: 'River Networks (Buffered)',
    group: 'Environment',
    src: 'river_networks_buffered_lc2025.geojson',
    out: 'river_networks_buffered.geojson',
    dissolve: 'zone',
    fields: ['zone'],
    simplify: '2%',
    style: { kind: 'classified', field: 'zone' },
    description: 'River network riparian buffers derived from Land Cover 2025 (Cebu & Bohol): 3 m in urban (Built-up), 20 m in agricultural (Annual/Perennial Crop), 40 m in forest (Open/Closed/Mangrove Forest).',
  },
];

const CLASS_META = {
  flooding: {
    VHF: { label: 'Very High', color: '#991b1b', rank: 4 },
    HF: { label: 'High', color: '#ef4444', rank: 3 },
    MF: { label: 'Moderate', color: '#f59e0b', rank: 2 },
    LF: { label: 'Low', color: '#facc15', rank: 1 },
  },
  landslide: {
    VHL: { label: 'Very High', color: '#7f1d1d', rank: 4 },
    HL: { label: 'High', color: '#dc2626', rank: 3 },
    ML: { label: 'Moderate', color: '#f97316', rank: 2 },
    LL: { label: 'Low', color: '#eab308', rank: 1 },
    DF: { label: 'Debris Flow', color: '#94a3b8', rank: 2 },
  },
  land_cover: {
    'Annual Crop': { label: 'Annual Crop', color: '#eab308' },
    'Perennial Crop': { label: 'Perennial Crop', color: '#a3e635' },
    'Built-up': { label: 'Built-up', color: '#f87171' },
    'Brush/Shrubs': { label: 'Brush / Shrubs', color: '#84cc16' },
    'Mangrove Forest': { label: 'Mangrove Forest', color: '#059669' },
    Grassland: { label: 'Grassland', color: '#d9f99d' },
    'Open/Barren': { label: 'Open / Barren', color: '#d6d3d1' },
    Fishpond: { label: 'Fishpond', color: '#67e8f9' },
    'Inland Water': { label: 'Inland Water', color: '#38bdf8' },
    'Open Forest': { label: 'Open Forest', color: '#15803d' },
    'Closed Forest': { label: 'Closed Forest', color: '#14532d' },
  },
  land_cover_bohol: {
    'Annual Crop': { label: 'Annual Crop', color: '#eab308' },
    'Perennial Crop': { label: 'Perennial Crop', color: '#a3e635' },
    'Built-up': { label: 'Built-up', color: '#f87171' },
    'Brush/Shrubs': { label: 'Brush / Shrubs', color: '#84cc16' },
    'Mangrove Forest': { label: 'Mangrove Forest', color: '#059669' },
    Grassland: { label: 'Grassland', color: '#d9f99d' },
    'Open/Barren': { label: 'Open / Barren', color: '#d6d3d1' },
    Fishpond: { label: 'Fishpond', color: '#67e8f9' },
    'Inland Water': { label: 'Inland Water', color: '#38bdf8' },
    'Open Forest': { label: 'Open Forest', color: '#15803d' },
    'Closed Forest': { label: 'Closed Forest', color: '#14532d' },
  },
  land_classification: {
    Forestland: { label: 'Forestland', color: '#16a34a' },
    'A&D': { label: 'Alienable & Disposable', color: '#f59e0b' },
    Nipas: { label: 'NIPAS', color: '#22c55e' },
    'Unclassified PF': { label: 'Unclassified Public Forest', color: '#94a3b8' },
  },
  river_networks_buffered: {
    urban: { label: 'Urban · 3 m', color: '#f97316' },
    agricultural: { label: 'Agricultural · 20 m', color: '#84cc16' },
    forest: { label: 'Forest · 40 m', color: '#16a34a' },
  },
};

function runMapshaper(args) {
  execFileSync(process.execPath, [mapshaperBin, ...args], { stdio: 'pipe' });
}

function bboxOfGeoJson(geojson) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      minX = Math.min(minX, coords[0]);
      maxX = Math.max(maxX, coords[0]);
      minY = Math.min(minY, coords[1]);
      maxY = Math.max(maxY, coords[1]);
    } else {
      for (const c of coords) visit(c);
    }
  };
  for (const feature of geojson.features) if (feature.geometry) visit(feature.geometry.coordinates);
  return [minX, minY, maxX, maxY].map((n) => Number(n.toFixed(5)));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const manifest = [];
  const missing = [];

  for (const layer of LAYERS) {
    const src = path.join(SRC, layer.src);
    const out = path.join(OUT, layer.out);
    try {
      await access(src, constants.R_OK);
    } catch {
      missing.push(src);
      console.warn(`  • ${layer.name} … missing ${src}`);
      continue;
    }
    const args = ['-i', src];
    if (layer.dissolve) args.push('-dissolve', layer.dissolve);
    if (layer.simplify) args.push('-simplify', layer.simplify, 'keep-shapes');
    if (layer.fields?.length) args.push('-filter-fields', layer.fields.join(','));
    args.push('-o', out, 'format=geojson', 'precision=0.00001');

    process.stdout.write(`  • ${layer.name} … `);
    try {
      runMapshaper(args);
    } catch (error) {
      console.error(`\n    mapshaper failed: ${String(error.stderr || error.message).slice(0, 500)}`);
      throw error;
    }

    const geojson = JSON.parse(await readFile(out, 'utf8'));
    const size = (await stat(out)).size;
    const classes = new Set();
    if (layer.style.kind === 'classified') {
      for (const f of geojson.features) {
        const v = f.properties?.[layer.style.field];
        if (v) classes.add(String(v));
      }
    }
    manifest.push({
      ...layer,
      file: layer.out,
      src: undefined,
      out: undefined,
      geometry: geojson.features[0]?.geometry?.type ?? 'Unknown',
      count: geojson.features.length,
      sizeBytes: size,
      bbox: bboxOfGeoJson(geojson),
      classes: [...classes].sort(),
      classMeta: CLASS_META[layer.id] ?? null,
    });
    console.log(`${geojson.features.length} features, ${(size / 1024 / 1024).toFixed(2)} MB`);
  }

  if (missing.length) throw new Error(`Missing spatial sources — refusing to publish incomplete layers: ${missing.join(', ')}`);
  const total = manifest.reduce((sum, l) => sum + l.sizeBytes, 0);
  await writeFile(
    path.join(OUT, 'layers.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), totalBytes: total, layers: manifest }, null, 2),
    'utf8',
  );
  console.log(`\nSpatial bundle: ${(total / 1024 / 1024).toFixed(2)} MB across ${manifest.length} layers.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
