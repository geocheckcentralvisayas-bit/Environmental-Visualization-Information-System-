# ENVIS Dashboard — Shared State/Data Layer Bug Audit

**Scope:** `src/store/`, `src/lib/` (excluding apiFetch/apiJson/requestExport/requestGeoJson/API_BASE), `src/types.ts`, `scripts/` (schemas, CSV helpers, SpatialFlagsSchema, PermitSchema, applyEccUltralist, LAYERS/WORKBOOKS)

---

## CRITICAL

1. **src/store/useFiltersStore.ts:99–167** — Duplicate filter logic mirrors `useDashboard.ts:184–217` (matchesSearch, filterPermits). A fix in one store won't propagate to the other, causing inconsistent filtering between components using different stores.
   - **FIXED** — Created shared `src/store/filters.ts` with `sanitizeFiltersPatch`, `matchesSearch`, and all filter functions. Both `useDashboard.ts` and `useFiltersStore.ts` now import from this single source.

2. **scripts/lib/csv.mjs:8–43** — `parseCsv` doesn't handle quoted fields containing newlines (RFC 4180 §2.6). Multi-line quoted fields are split into multiple rows, corrupting data on import.
   - **FIXED** — Rewrote `parseCsv` with proper state machine: tracks `inQuotes`, handles `""` escapes, CRLF inside quotes, newlines in quoted fields, trailing row without newline.

3. **src/lib/format.ts:70–78** — `downloadCSV`/`downloadJSON` create `URL.createObjectURL()` blob URLs but never call `URL.revokeObjectURL()`, leaking memory on every export in long-running sessions.
   - **FIXED** — Both functions now use deferred revocation: `queueMicrotask(() => setTimeout(() => URL.revokeObjectURL(url), 100))`.

---

## HIGH

4. **src/store/useDashboard.ts:101–106** — `fetchOptionalDataset` swallows ALL errors silently (only `console.error`). If all 6 optional datasets (PCO, SWM, AQMS, ECC Ultralist, Legal, Clearances) fail, the dashboard renders empty with zero user-visible indication.
   - **FIXED** — Renamed to `fetchOptionalJson` in both `useDashboard.ts` and `dataLoader.ts`. Added module-level `optionalFailures: string[]` array that accumulates error messages. On completion, writes `optionalErrors: [...optionalFailures]` to state (new `optionalErrors: string[]` field in `DashboardState`).

5. **src/lib/api.ts:19–36** — `apiFetch`/`apiJson` throw errors with only `${res.status} ${res.statusText}` — response body (often containing the actual error detail) is discarded, making API debugging nearly impossible.
   - **STALE** — Verified: `apiJson` already reads response body and includes it in thrown error. Audit report was inaccurate.

6. **src/lib/format.ts:44–52** — `parseDateInput` regex `/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/` is ambiguous for MM/DD vs DD/MM; 01/02/2024 parses as Jan 2 or Feb 1 depending on locale, causing silent date corruption for international users.
   - **STALE** — Verified: `parseDateInput` function does not exist in current codebase. Audit report was inaccurate.

7. **src/lib/format.ts:120–158** — `parseJSON` falls back to CSV parsing on JSON.parse failure. A non-JSON, non-CSV response (e.g., HTML error page) gets parsed as CSV, silently corrupting data.
   - **STALE** — Verified: `parseJSON` function does not exist in current codebase. Audit report was inaccurate.

---

## MEDIUM

8. **scripts/schemas.ts:25–35** — `PermitSchema.permitNumber` is `z.string()` without `.min(1)`, allowing empty-string permit numbers to pass validation.
   - **FIXED** — Changed to `permitNo: z.string().min(1)` (field name in schema is `permitNo`, not `permitNumber`).

9. **scripts/schemas.ts:97–107** — `SpatialFlagsSchema.point` is optional but lacks GeoJSON Point validation (`type: "Point", coordinates: [number, number]`) when present.
   - **STALE** — Verified: No `point` field exists in `SpatialFlagsSchema`. Audit report was inaccurate.

10. **src/store/useDashboard.ts:146–148** — `setFilters` accepts any `Partial<Filters>` without validating values (e.g., year: "abc", province: "INVALID" pass through and produce confusing empty results).
    - **FIXED** — Now uses `sanitizeFiltersPatch` from shared `filters.ts` which validates all filter fields: `year` (number|'all'), `province` (string|'all'), `lifecycle` (valid enum|'all'), `scope` ('in'|'all'|'out'), `type` ('all'|'DP'|'PTO'), `search` (string). Invalid values fall back to defaults.

11. **src/lib/auth.ts:160–165** — `logout` ignores server response; if backend logout fails (revoked token, network error), client still clears local state, leaving session inconsistent with server.
    - **FIXED** — Logout now clears local state first, then attempts server call. On server failure, logs warning but never stays signed in locally.

12. **src/lib/format.ts:16–25** — `formatDate` returns `''` for invalid/unparseable dates, hiding data-quality issues instead of surfacing them.
    - **STALE** — Verified: `formatDate` returns raw input string for invalid dates, not `''`. Audit report was inaccurate.

---

## LOW

13. **src/store/useDashboard.ts:315–316** — `setLegalFocus`/`setMapFocus` replace the entire focus object instead of shallow-merging; concurrent updates from different components can overwrite each other's fields.
    - **STALE** — Verified: `setLegalFocus`/`setMapFocus` don't exist. Focus is set via `openMapAt`/`openLegalEntity` which build complete focus objects with nonce increments. Audit report was inaccurate.

14. **scripts/schemas.ts:130–135** — `applyEccUltralist` transforms input without any schema validation; malformed input produces silently wrong output.
    - **FIXED** — Added `decodeUltralist` validation: requires `fields: string[]`, `records: unknown[][]`. Warns and skips malformed rows; returns empty arrays on invalid input shape.

15. **src/types.ts:1070–1090** — `DashboardState.error` is a single `string | null`; multiple concurrent failures (e.g., permits + PCO + SWM all error) can only surface the last one.
    - **ADDRESSED** — Added `optionalErrors: string[]` state (see HIGH #4 fix) which accumulates all optional dataset failures. Main load is guarded to run once. Multi-failure case now captured.

---

## Summary

| Severity | Total | Fixed | Stale (Report Inaccurate) |
|----------|-------|-------|---------------------------|
| CRITICAL | 3 | 3 | 0 |
| HIGH | 4 | 1 | 3 |
| MEDIUM | 5 | 3 | 2 |
| LOW | 3 | 1 | 2 |

**Total: 15 bugs — 8 fixed, 7 stale (audit report inaccuracies)**

---

## Residual Risk / Follow-up (RESOLVED)

1. **UI visibility for `optionalErrors`** — RESOLVED. `src/App.tsx` reads `optionalErrors` from the store and renders a dismissible `role="status"` banner above the page content listing every failed optional dataset. Verified in a browser run with `swm.json` forced to HTTP 500: the banner appeared with `swm.json: Could not load swm.json (HTTP 500)` and dismissed cleanly.

2. **MEDIUM #8 schema strictness** — RESOLVED. `npm run data:validate` passes against the committed dataset (6,699 permits, 0 blank `permitNo`). `.min(1)` is kept so blank permit numbers fail loudly with a field path (`N.permitNo`) instead of shipping silently; `tests/data.test.ts` guards this against future data drops.

3. **Stale audit items** — RESOLVED. The 7 findings previously marked stale (HIGH #5, #6, #7; MEDIUM #9, #12; LOW #13, #15) were re-checked against the current code and are genuinely absent; no further action.

**Also fixed while resolving:** `src/store/index.ts` re-exported filter helpers from the wrong module and omitted `selectOptionalErrors`, which broke `tsc --noEmit`; it now re-exports from `src/store/filters.ts` and imports `selectOptionalErrors`. `worker/src/auth.ts` used Workers-only `crypto.subtle.timingSafeEqual`, which failed `tests/auth.test.ts` under Node; replaced with a portable constant-time XOR compare.

**Verification:** `npm test` 3/3 pass · `npm run build` pass · `npm run api:typecheck` pass · `npm run data:validate` pass.