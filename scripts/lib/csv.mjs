/** RFC-4180 CSV parser (handles quoted fields, escaped quotes, CRLF, and newlines within quoted fields per §2.6). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else if (ch === '\r' && text[i + 1] === '\n') {
        // Handle CRLF within quoted fields (RFC 4180 §2.6) - treat as single newline
        field += '\n';
        i += 1;
      } else {
        // Inside quotes: allow all characters including newlines (RFC 4180 §2.6)
        field += ch;
      }
      continue;
    }
    // Not in quotes
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      // Row delimiter (only when not in quotes per RFC 4180 §2.6)
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // ignore, handled by \n (CRLF)
    } else {
      field += ch;
    }
  }
  // Handle trailing row without newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvToObjects(text) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    if (!cells.some((c) => c.trim() !== '')) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c] || `Column ${c + 1}`;
      obj[key] = (cells[c] ?? '').trim();
    }
    out.push(obj);
  }
  return { headers, rows: out };
}

export function toCsv(rows, headers) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers ?? Object.keys(rows[0] ?? {});
  const lines = [head.join(',')];
  for (const r of rows) lines.push(head.map((h) => esc(r[h])).join(','));
  return lines.join('\r\n');
}
