/**
 * Fetch and parse PCO Database from Excel to JSON
 * Output: data/pco-database.json
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { PCORecordSchema } from './schemas.ts';

const INPUT_FILE = 'data/PCO Database.xlsx';
const OUTPUT_FILE = 'data/pco-database.json';

function excelSerialToDate(serial) {
  if (serial === null || serial === undefined || serial === '') return null;
  const num = Number(serial);
  if (isNaN(num)) return String(serial); // Already a string date
  // Excel epoch: 1900-01-01 (but Excel incorrectly treats 1900 as leap year)
  // JavaScript epoch: 1970-01-01
  const excelEpoch = new Date(1900, 0, 1);
  const jsEpoch = new Date(1970, 0, 1);
  const daysDiff = (jsEpoch - excelEpoch) / (1000 * 60 * 60 * 24); // 25569
  const date = new Date((num - daysDiff) * 86400 * 1000);
  // Adjust for Excel's fake leap day in 1900
  if (num > 60) date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

function parsePCOExcel() {
  console.log(`Reading ${INPUT_FILE}...`);
  const wb = XLSX.readFile(INPUT_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Row 1 (index 1) has headers
  const headers = data[1];
  if (!headers || headers[0] !== 'ID') {
    throw new Error('Expected headers at row 2 (index 1), got: ' + JSON.stringify(headers));
  }

  const rows = data.slice(2).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(r => r.ID !== undefined && r.ID !== null && r.ID !== '');

  console.log(`Parsed ${rows.length} raw rows`);

  // Transform to normalized records
  const records = rows.map((r, idx) => {
    const record = {
      id: Number(r.ID),
      evaluator: String(r.EVALUATOR || '').trim(),
      pco: String(r.PCO || '').trim(),
      type: String(r.TYPE || '').trim(),
      status: String(r.STATUS || '').trim(),
      establishment: String(r.ESTABLISHMENT || '').trim(),
      address: String(r.ADDRESS || '').trim(),
      natureOfBusiness: String(r['NATURE OF BUSINESS'] || '').trim(),
      category: String(r.CATEGORY || '').trim(),
      dateCreated: excelSerialToDate(r['DATE CREATED']),
      dateApproved: excelSerialToDate(r['DATE APPROVED']),
      remarks: String(r.REMARKS || '').trim() || undefined,
    };
    return record;
  });

  // Validate with Zod
  console.log('Validating records...');
  const validated = [];
  const errors = [];

  records.forEach((r, i) => {
    const result = PCORecordSchema.safeParse(r);
    if (result.success) {
      validated.push(result.data);
    } else {
      errors.push({ index: i, record: r, errors: result.error.errors });
    }
  });

  if (errors.length > 0) {
    console.error(`Validation failed for ${errors.length} records:`);
    errors.slice(0, 10).forEach(e => console.error(`  Row ${e.index}:`, e.errors.map(err => err.message).join(', ')));
    if (errors.length > 10) console.error(`  ... and ${errors.length - 10} more`);
    throw new Error('PCO data validation failed');
  }

  console.log(`Validated ${validated.length} records`);

  // Write output
  const output = {
    generatedAt: new Date().toISOString(),
    sourceFile: INPUT_FILE,
    recordCount: validated.length,
    records: validated,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Written to ${OUTPUT_FILE}`);
}

parsePCOExcel();