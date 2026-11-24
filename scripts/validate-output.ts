import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DatasetSchema, PCOAnalysisSchema, PCORecordSchema } from './schemas.ts';

const OUT_DIR = 'public/data';

const FILES = [
  'permits.json',
  'sites.json',
  'meta.json',
  'quality.json',
  'hw.json',
  'clearances.json',
  'facilities.json',
  'geojson/layers.json',
  'legal.json',
  'pco-database.json',
  'pco-analysis.json',
  'aqms.json',
  'swm.json',
  'ecc-ultralist.json',
  'emed.json',
  'planning.json',
];

async function validateFile(file: string, schema: any) {
  const filePath = path.join(OUT_DIR, file);
  try {
    const content = await readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    const result = schema.safeParse(data);
    if (!result.success) {
      console.error(`\n❌ ${file} validation failed:`);
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`);
      }
      return false;
    }
    console.log(`✅ ${file} valid`);
    return true;
  } catch (error) {
    console.error(`\n❌ ${file} error: ${error.message}`);
    return false;
  }
}

/**
 * The Worker only serves data paths in ROOT_DATA_FILES. A new root-level JSON
 * that is missing from that allow-list returns HTTP 404 to the browser, so
 * catch the mistake at build time instead of at runtime.
 */
async function validateWorkerAllowList() {
  const source = await readFile('worker/src/index.ts', 'utf8');
  const block = source.match(/const ROOT_DATA_FILES = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
  const allowed = new Set([...block.matchAll(/'([^']+)'/g)].map((match) => match[1]));
  const entries = await readdir(OUT_DIR, { recursive: true }) as string[];
  const isNestedAllowed = (name: string) =>
    /^emed\/sheet-\d{2}\.json$/i.test(name) || /^geojson\/[a-z0-9][a-z0-9_.-]*\.geojson$/i.test(name);
  const missing = entries
    .map((name) => name.replace(/\\/g, '/'))
    .filter((name) => name.endsWith('.json') && !allowed.has(name) && !isNestedAllowed(name));
  if (missing.length) {
    console.error(`\nWorker allow-list is missing: ${missing.join(', ')}`);
    return false;
  }
  console.log('Worker allow-list covers all root JSON files');
  return true;
}

async function main() {
  console.log('Validating output JSON files...\n');

  const looseDataset = z.object({
    generatedAt: z.string().optional(),
    records: z.array(z.unknown()).optional(),
    sheets: z.array(z.unknown()).optional(),
  }).passthrough();
  const schemas: Record<string, any> = {
    'permits.json': DatasetSchema.shape.permits,
    'sites.json': DatasetSchema.shape.sites,
    'meta.json': DatasetSchema.shape.meta,
    'quality.json': DatasetSchema.shape.quality,
    'hw.json': DatasetSchema.shape.hw,
    'clearances.json': DatasetSchema.shape.clearances,
    'facilities.json': DatasetSchema.shape.facilities,
    'geojson/layers.json': DatasetSchema.shape.layers,
    'legal.json': DatasetSchema.shape.legal,
    'pco-database.json': z.object({
      generatedAt: z.string(),
      sourceFile: z.string(),
      recordCount: z.number().int(),
      records: z.array(PCORecordSchema),
    }),
    'pco-analysis.json': PCOAnalysisSchema,
    'aqms.json': looseDataset,
    'swm.json': looseDataset,
    'ecc-ultralist.json': looseDataset,
    'emed.json': looseDataset,
    'planning.json': z.object({
      meta: z.object({
        generatedAt: z.string(),
        contentHash: z.string(),
        reportingMonth: z.number().int().min(1).max(12),
        source: z.object({
          path: z.string(),
          fileName: z.string(),
          sheet: z.string(),
          modifiedAt: z.string(),
          bytes: z.number(),
        }),
        counts: z.object({
          activities: z.number().int().positive(),
          sections: z.number().int().positive(),
          projects: z.number().int(),
          assessed: z.number().int(),
          met: z.number().int(),
          overallRate: z.number().nullable(),
        }),
      }).passthrough(),
      monthly: z.array(z.object({
        index: z.number().int(),
        label: z.string(),
        assessed: z.number().int(),
        met: z.number().int(),
      }).passthrough()).length(12),
      sections: z.array(z.object({
        section: z.string(),
        activities: z.number().int().positive(),
      }).passthrough()).min(1),
      records: z.array(z.object({
        id: z.string(),
        row: z.number().int().positive(),
        section: z.string(),
        indicator: z.string(),
        targets: z.array(z.number()).length(12),
        actuals: z.array(z.number()).length(12),
        status: z.string(),
        flags: z.array(z.string()),
      }).passthrough()).min(1),
      quality: z.object({
        totalIssues: z.number().int(),
        byType: z.record(z.string(), z.number().int()),
        issues: z.array(z.unknown()),
      }).passthrough(),
    }).passthrough(),
  };

  let allValid = await validateWorkerAllowList();
  for (const file of FILES) {
    const schema = schemas[file];
    if (!schema) {
      console.log(`⚠️  ${file}: no schema defined`);
      continue;
    }
    const valid = await validateFile(file, schema);
    if (!valid) allValid = false;
  }

  // Also validate the combined dataset if all individual files are valid
  if (allValid) {
    console.log('\nValidating combined dataset structure...');
    try {
      const dataset = {
        permits: JSON.parse(await readFile(path.join(OUT_DIR, 'permits.json'), 'utf8')),
        sites: JSON.parse(await readFile(path.join(OUT_DIR, 'sites.json'), 'utf8')),
        meta: JSON.parse(await readFile(path.join(OUT_DIR, 'meta.json'), 'utf8')),
        quality: JSON.parse(await readFile(path.join(OUT_DIR, 'quality.json'), 'utf8')),
        hw: JSON.parse(await readFile(path.join(OUT_DIR, 'hw.json'), 'utf8')),
        clearances: JSON.parse(await readFile(path.join(OUT_DIR, 'clearances.json'), 'utf8')),
        facilities: JSON.parse(await readFile(path.join(OUT_DIR, 'facilities.json'), 'utf8')),
        layers: JSON.parse(await readFile(path.join(OUT_DIR, 'geojson/layers.json'), 'utf8')),
        legal: JSON.parse(await readFile(path.join(OUT_DIR, 'legal.json'), 'utf8')),
      };
      const result = DatasetSchema.safeParse(dataset);
      if (!result.success) {
        console.error('❌ Combined dataset validation failed:');
        for (const issue of result.error.issues) {
          console.error(`  ${issue.path.join('.')}: ${issue.message}`);
        }
        allValid = false;
      } else {
        console.log('✅ Combined dataset valid');
      }
    } catch (error) {
      console.error(`❌ Combined dataset error: ${error.message}`);
      allValid = false;
    }
  }

  console.log(allValid ? '\n✅ All validations passed' : '\n❌ Some validations failed');
  process.exit(allValid ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});