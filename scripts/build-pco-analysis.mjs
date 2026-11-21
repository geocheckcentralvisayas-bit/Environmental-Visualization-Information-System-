/**
 * Build PCO Analysis - Cross-reference PCO database with permits, HW, clearances
 * Output: public/data/pco-analysis.json
 */
import fs from 'fs';
import path from 'path';
import { PCOAnalysisSchema, PCORecordSchema } from './schemas.ts';

// Load data files
const DATA_DIRS = ['public/data', 'data', '.'];

function loadJSON(file) {
  for (const dir of DATA_DIRS) {
    const fullPath = path.join(dir, file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      return JSON.parse(content);
    }
  }
  throw new Error(`File not found: ${file} in any of ${DATA_DIRS.join(', ')}`);
}

function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .toUpperCase()
    .replace(/[.,']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fuzzyMatch(str1, str2, threshold = 0.8) {
  const n1 = normalizeName(str1);
  const n2 = normalizeName(str2);
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1;
  if (n1.includes(n2) || n2.includes(n1)) return 0.9;
  // Simple token overlap
  const tokens1 = new Set(n1.split(' ').filter(t => t.length > 2));
  const tokens2 = new Set(n2.split(' ').filter(t => t.length > 2));
  const intersection = [...tokens1].filter(t => tokens2.has(t)).length;
  const union = tokens1.size + tokens2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function daysUntilExpiry(expiryDate) {
  if (!expiryDate) return null;
  const expiry = new Date(expiryDate);
  const today = new Date();
  const diff = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
  return diff;
}

function isExpiringSoon(expiryDate, daysThreshold = 90) {
  const days = daysUntilExpiry(expiryDate);
  return days !== null && days >= 0 && days <= daysThreshold;
}

function buildPCOAnalysis() {
  console.log('Loading data files...');

  const pcoData = loadJSON('pco-database.json');
  const permitsData = loadJSON('permits.json');
  const hwData = loadJSON('hw.json');
  const clearancesData = loadJSON('clearances.json');
  const sitesData = loadJSON('sites.json');

  const pcoRecords = pcoData.records.filter(r => {
    const addr = (r.address || '').toLowerCase();
    return !addr.includes('negros') && !addr.includes('siquijor');
  });
  const permits = Array.isArray(permitsData) ? permitsData : (permitsData.permits || []);
  const hwRegistrations = Array.isArray(hwData) ? hwData : (hwData.hwRegistrations || hwData.records || []);
  const clearances = Array.isArray(clearancesData) ? clearancesData : (clearancesData.clearances || clearancesData.records || []);

  console.log(`Loaded: ${pcoRecords.length} PCO records, ${permits.length} permits, ${hwRegistrations.length} HW, ${clearances.length} clearances`);

  // Build lookup maps
  const permitsByCompany = new Map();
  permits.forEach(p => {
    const key = normalizeName(p.company);
    if (!permitsByCompany.has(key)) permitsByCompany.set(key, []);
    permitsByCompany.get(key).push(p);
  });

  const hwByCompany = new Map();
  hwRegistrations.forEach(h => {
    const key = normalizeName(h.company);
    if (!hwByCompany.has(key)) hwByCompany.set(key, []);
    hwByCompany.get(key).push(h);
  });

  const clearancesByCompany = new Map();
  clearances.forEach(c => {
    const key = normalizeName(c.company);
    if (!clearancesByCompany.has(key)) clearancesByCompany.set(key, []);
    clearancesByCompany.get(key).push(c);
  });

  // Group PCO records by PCO name
  const pcoGroups = new Map();
  pcoRecords.forEach(r => {
    const key = normalizeName(r.pco);
    if (!pcoGroups.has(key)) pcoGroups.set(key, { pco: r.pco, evaluator: r.evaluator, records: [] });
    pcoGroups.get(key).records.push(r);
  });

  // Build PCO company summaries
  const byPCO = [];
  const crossReferences = [];
  const unmatchedPCOs = [];

  pcoGroups.forEach((group, pcoKey) => {
    const records = group.records;
    const establishments = records.map(r => r.establishment).filter(Boolean);
    const uniqueEstablishments = [...new Set(establishments)];

    const municipalities = [...new Set(records.map(r => {
      const addr = r.address || '';
      const match = addr.match(/(?:Cebu|Mandaue|Lapu-Lapu|Toledo|Talisay|Naga|Carcar|Danao|Bogo)\s*City/i);
      return match ? match[0] : addr.split(',').pop()?.trim() || '';
    }).filter(Boolean))];

    const industries = [...new Set(records.map(r => r.natureOfBusiness).filter(Boolean))];

    byPCO.push({
      pco: group.pco,
      evaluator: group.evaluator,
      totalRecords: records.length,
      newCount: records.filter(r => r.type === 'New').length,
      renewalCount: records.filter(r => r.type === 'Renewal').length,
      companies: uniqueEstablishments.length,
      establishments: records.map(r => ({
        establishment: r.establishment,
        address: r.address,
        natureOfBusiness: r.natureOfBusiness,
        category: r.category,
        type: r.type,
        dateApproved: r.dateApproved,
      })),
      municipalities,
      industries,
    });

    // Cross-reference each establishment
    records.forEach(r => {
      const estName = normalizeName(r.establishment);
      const companyKey = estName;

      // Find matching permits
      let matchedPermits = permitsByCompany.get(companyKey) || [];
      if (matchedPermits.length === 0) {
        // Try fuzzy match
        for (const [key, perms] of permitsByCompany) {
          if (fuzzyMatch(key, companyKey) >= 0.75) {
            matchedPermits = perms;
            break;
          }
        }
      }

      // Find matching HW
      let matchedHW = hwByCompany.get(companyKey) || [];
      if (matchedHW.length === 0) {
        for (const [key, hws] of hwByCompany) {
          if (fuzzyMatch(key, companyKey) >= 0.75) {
            matchedHW = hws;
            break;
          }
        }
      }

      // Find matching clearances
      let matchedClearances = clearancesByCompany.get(companyKey) || [];
      if (matchedClearances.length === 0) {
        for (const [key, clrs] of clearancesByCompany) {
          if (fuzzyMatch(key, companyKey) >= 0.75) {
            matchedClearances = clrs;
            break;
          }
        }
      }

      const hasMatches = matchedPermits.length > 0 || matchedHW.length > 0 || matchedClearances.length > 0;

      if (!hasMatches) {
        unmatchedPCOs.push({
          pco: group.pco,
          establishment: r.establishment,
          reason: 'No matching permit, HW registration, or clearance found',
        });
        return;
      }

      // Determine match confidence
      let confidence = 'low';
      if (matchedPermits.some(p => normalizeName(p.company) === companyKey) ||
          matchedHW.some(h => normalizeName(h.company) === companyKey) ||
          matchedClearances.some(c => normalizeName(c.company) === companyKey)) {
        confidence = 'high';
      } else if (matchedPermits.length > 0 || matchedHW.length > 0 || matchedClearances.length > 0) {
        confidence = 'medium';
      }

      // Add cross-reference for each permit
      matchedPermits.forEach(p => {
        crossReferences.push({
          pco: group.pco,
          company: r.establishment,
          establishment: r.establishment,
          permitType: p.type,
          permitNo: p.permitNo,
          permitStatus: p.lifecycle,
          permitExpiry: p.expiry,
          hwRegistrations: matchedHW.map(h => ({
            hwGrNo: h.hwGrNo,
            hwStatus: h.lifecycle,
            hwExpiry: h.expiry,
          })),
          clearances: matchedClearances.map(c => ({
            number: c.number,
            type: c.type,
            status: c.lifecycle,
          })),
          matchConfidence: confidence,
        });
      });

      // If no permits but has HW/clearances, still add entry
      if (matchedPermits.length === 0 && (matchedHW.length > 0 || matchedClearances.length > 0)) {
        crossReferences.push({
          pco: group.pco,
          company: r.establishment,
          establishment: r.establishment,
          permitType: 'DP', // placeholder
          permitNo: 'N/A',
          permitStatus: 'N/A',
          permitExpiry: null,
          hwRegistrations: matchedHW.map(h => ({
            hwGrNo: h.hwGrNo,
            hwStatus: h.lifecycle,
            hwExpiry: h.expiry,
          })),
          clearances: matchedClearances.map(c => ({
            number: c.number,
            type: c.type,
            status: c.lifecycle,
          })),
          matchConfidence: confidence,
        });
      }
    });
  });

  // Build expiring soon list
  const expiringSoon = [];
  const referenceDate = new Date();

  // PCO accreditation expiries (approximate 3 years from dateApproved)
  pcoRecords.forEach(r => {
    if (r.dateApproved) {
      const approved = new Date(r.dateApproved);
      const expiry = new Date(approved);
      expiry.setFullYear(expiry.getFullYear() + 3);
      const days = Math.ceil((expiry - referenceDate) / (1000 * 60 * 60 * 24));
      if (days >= 0 && days <= 90) {
        expiringSoon.push({
          pco: r.pco,
          establishment: r.establishment,
          type: 'pco-accreditation',
          expiryDate: expiry.toISOString().split('T')[0],
          daysUntilExpiry: days,
        });
      }
    }
  });

  // Permit expiries
  crossReferences.forEach(cr => {
    if (cr.permitExpiry && cr.permitExpiry !== 'N/A') {
      const days = daysUntilExpiry(cr.permitExpiry);
      if (days !== null && days >= 0 && days <= 90) {
        expiringSoon.push({
          pco: cr.pco,
          establishment: cr.establishment,
          type: 'permit',
          expiryDate: cr.permitExpiry,
          daysUntilExpiry: days,
        });
      }
    }
    cr.hwRegistrations.forEach(hw => {
      if (hw.hwExpiry) {
        const days = daysUntilExpiry(hw.hwExpiry);
        if (days !== null && days >= 0 && days <= 90) {
          expiringSoon.push({
            pco: cr.pco,
            establishment: cr.establishment,
            type: 'hw',
            expiryDate: hw.hwExpiry,
            daysUntilExpiry: days,
          });
        }
      }
    });
  });

  // Sort expiring by days
  expiringSoon.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  // Totals
  const categoryCounts = pcoRecords.reduce((acc, r) => {
    if (r.category === 'Category A') acc.A++;
    else if (r.category === 'Category B') acc.B++;
    return acc;
  }, { A: 0, B: 0 });

  const analysis = {
    generatedAt: new Date().toISOString(),
    referenceDate: referenceDate.toISOString().split('T')[0],
    totals: {
      pcoRecords: pcoRecords.length,
      uniquePCOs: pcoGroups.size,
      uniqueEvaluators: [...new Set(pcoRecords.map(r => r.evaluator).filter(Boolean))].length,
      uniqueEstablishments: [...new Set(pcoRecords.map(r => r.establishment).filter(Boolean))].length,
      newAccreditations: pcoRecords.filter(r => r.type === 'New').length,
      renewals: pcoRecords.filter(r => r.type === 'Renewal').length,
      categoryA: categoryCounts.A,
      categoryB: categoryCounts.B,
    },
    byPCO,
    crossReferences,
    unmatchedPCOs,
    expiringSoon,
  };

  // Validate
  const result = PCOAnalysisSchema.safeParse(analysis);
  if (!result.success) {
    console.error('Validation failed:', result.error.errors);
    throw new Error('PCO Analysis validation failed');
  }

  fs.mkdirSync('public/data', { recursive: true });
  fs.writeFileSync('public/data/pco-analysis.json', JSON.stringify(result.data, null, 2));
  console.log('Written to public/data/pco-analysis.json');
  console.log(`Summary: ${byPCO.length} PCOs, ${crossReferences.length} cross-references, ${unmatchedPCOs.length} unmatched, ${expiringSoon.length} expiring soon`);
}

buildPCOAnalysis();