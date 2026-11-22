# ENVIS Dashboard — Environmental Permits Monitoring System

[![Build](https://img.shields.io/badge/build-passing-2ea44f)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6)](#)
[![React](https://img.shields.io/badge/React-19-61dafb)](#)
[![License](https://img.shields.io/badge/license-MIS%20Credit-blue)](#)

**ENVIS Region VII** is a browser-based environmental permits and compliance
intelligence platform for **DENR-EMB Region VII**. It brings the region's
discharge permits, permits to operate, hazardous-waste registrations, ECC/CNC
clearances and legal docket into one searchable, map-driven view for Cebu and
Bohol.

![ENVIS executive overview](docs/screenshots/overview.png)

---

## What ENVIS is

Environmental regulation produces many separate registers. A single
establishment can appear in the discharge-permit register, the permit-to-operate
register, the hazardous-waste register, the ECC/CNC clearance list and the legal
docket — often under slightly different names and addresses. Reading those
registers one at a time makes it hard to answer basic questions:

- Does this establishment hold both a discharge permit and a permit to operate?
- Which facilities are operating with only one of the two?
- Which permits are expiring, and which have already lapsed?
- Which establishments sit inside flood, landslide, protected-area or watershed
  constraints?
- Which facilities have environmental cases, and what is the status of each case?

ENVIS answers those questions in one place. It is a monitoring and decision-support
aid, not a replacement for official records, permits or clearances.

## Why it matters

- **One establishment, one view.** Registers are intercrossed so a facility is
  assessed as a whole rather than as disconnected rows in different sheets.
- **Coverage gaps become visible.** DP-only and PTO-only establishments are
  surfaced instead of being hidden by separate reports.
- **Enforcement is better targeted.** Spatial screening and the legal docket show
  where environmental risk and case history coincide.
- **Field and front-desk work is faster.** Search, filters and a clustered map
  replace manual cross-referencing across year tabs.
- **The evidence trail is preserved.** Data-quality flags, review queues and
  source counts make it clear what was matched, what was skipped and what still
  needs review.
- **EMED performance is visible in one place.** Monthly KRA targets and
  accomplishments, division attainment and individual inspector workload are
  charted beside the full 50-sheet monitoring workbook.

## What it covers

| Register | Scope |
| --- | --- |
| Discharge Permits (DP) | 2019–2026 year tabs, Cebu and Bohol |
| Permits to Operate (PTO) | 2020–2026 year tabs, Cebu and Bohol |
| Hazardous waste | Generator registrations intercrossed with DP and PTO |
| ECC / CNC | Environmental Compliance Certificates and Certificates of Non-Coverage |
| ECC / CNC Ultralist | ECC OL, ECC Manual, CAT C and CNC OL records for Cebu and Bohol |
| Legal docket | NOV, PAB, ERF and complaint records |
| PCO Corner | Pollution Control Officer registry and analysis |
| Ambient Corner (AQMS) | Live and historical PM2.5 / PM10 from two continuous stations, manual AQI samples and a station map; view-only |
| Solid Waste Management (SWM) | MRF register, ECC/CNC disposal approvals, WACS analysis, current and archived annual compliance summaries, LGU contact directory and workbook reference lists — Cebu and Bohol only; view-only, with its own map and points on the Spatial Map |
| EMED Monitoring Dashboards | CY 2026 KRA performance, monthly target vs accomplishment, division ratios, inspector workload and every sheet of the EMED monitoring workbook; restricted to RD, EMED and MIS accounts |
| Spatial layers | Flood, landslide, protected areas, watersheds, land cover, land classification, boundaries |

## How it works

ENVIS is a React dashboard backed by an authenticated **Cloudflare Worker API**.
All heavy work happens before publication, so the API only streams pre-compiled
JSON from private object storage to signed-in accounts — the browser filters and
renders that data locally.

```mermaid
flowchart LR
    A[Source registers] --> B[Normalise and de-duplicate]
    B --> C[Establishment matching]
    C --> D[Spatial screening and risk index]
    D --> E[Legal docket matching]
    E --> F[Static JSON]
    F --> R[(Private R2 storage)]
    R --> W[Cloudflare Worker API]
    D1[(D1: accounts, sessions, audit)] --- W
    W --> G[React + Vite dashboard]
    G --> H[Browser: filter, search, map]
```

1. **Normalise.** Permit rows are mapped to a shared schema; names, dates,
   provinces, LGUs, barangays and coordinates are cleaned and every change is
   logged.
2. **De-duplicate.** Permit numbers are reconciled so the same permit from
   multiple sources becomes one record.
3. **Build establishments.** Records are grouped by LGU and normalised company
   name, with alias and guarded fuzzy matching. A match is rejected when branch
   markers, parenthetical names or coordinates conflict.
4. **Screen spatially.** Establishments are tested against simplified hazard and
   protected-area layers, and a transparent additive risk index is derived.
5. **Match the legal docket.** NOV, PAB, ERF and complaint respondents are linked
   to establishments by exact or reviewed names only — never by automatic fuzzy
   matching.
6. **Publish and explore.** The Worker serves compact JSON from private storage;
   the browser provides search, filters, tables, charts and a clustered Leaflet
   map.

## Highlights

- **Establishment intercross** — DP, PTO, hazardous-waste and clearance records
  merged by normalised name and LGU, with coverage-gap detection and alias/fuzzy
  matching guards.
- **Geospatial intelligence** — clustered map, key-less basemaps, on-demand
  overlays (flood, landslide, protected areas, watersheds, land cover and land
  classification), zoom-to-layer and a transparent additive risk index (0–10).
- **ECC / CNC Ultralist** — approved EIA clearances consolidated from the ECC OL,
  ECC Manual, CAT C and CNC OL tabs, limited to Cebu and Bohol and intercrossed
  with DP, PTO and hazardous-waste records.
- **Legal docket module** — NOV, PAB, ERF and complaint records matched to
  establishments by exact and reviewed names only; paid/pending and closed/open
  status per case; PAB coverage and yearly collections reported without exposing
  amounts on individual records.
- **Renewal watch** — permits approaching expiry and already-lapsed permits are
  grouped so follow-up work can be prioritised.
- **Data quality first** — QA flags, audit trails, review queues, duplicate
  sources and skipped-row reporting; nothing is imputed silently.
- **Role-based access** — a login gate with role-specific visibility and export
  permissions; the Regional Director has full visibility but no export controls.
  All sessions, including the Regional Director's, expire after 8 hours.
- **MIS administration** — the MIS account manages accounts, resets passwords,
  activates or deactivates users and reviews sign-in, export and account-change
  activity from the in-app Accounts & Activity page.
- **Light and dark themes** — a DENR-themed interface that stays readable in
  bright field conditions.
- **Static and portable** — the UI files can be hosted at a domain root or in a
  subfolder (GitHub Pages, S3, IIS, nginx), but the published build talks to the
  authenticated Worker API; a build without `VITE_API_BASE` is an unauthenticated
  static snapshot and must not be published with private data.

## Screenshots

### Sign in

![Sign-in screen](docs/screenshots/login.png)

### Spatial map

One marker per establishment; rings show which registers the facility holds.

![Establishment and permit map](docs/screenshots/spatial-map.png)

### DP · PTO intercross

![DP and PTO establishment intercross](docs/screenshots/dp-pto-intercross.png)

### ECC / CNC Ultralist

![ECC and CNC Ultralist](docs/screenshots/ecc-cnc-ultralist.png)

### Legal docket

![NOV and legal cases](docs/screenshots/legal-docket.png)

### EMED Monitoring Dashboards

Executive overview: overall attainment, monitoring and survey totals, division
attainment and a KRA scorecard. Each chart can be filtered by program.

![EMED performance overview](docs/screenshots/emed-overview.png)

Inspector performance: ranked report lines, KRA totals and a selectable
individual KRA profile.

![EMED inspector performance](docs/screenshots/emed-inspector-performance.png)

Worksheet explorer: all 50 tabs from the source workbook, grouped by category,
with charts and the complete sortable/searchable table for the selected sheet.

![EMED worksheet explorer](docs/screenshots/emed-worksheets.png)

Refresh the EMED dataset with `npm run data:emed` (it re-downloads the workbook;
`node scripts/build-emed.mjs` reuses the local cache). Publish with
`npm run api:upload` locally or `npm run api:upload:remote` for the deployed API.

### About & License

Author, license, the full DENR-EMB Region VII contact directory and build
version history live in the **About & License** page.

![About and license](docs/screenshots/about-license.png)

![DENR-EMB Region VII contact directory](docs/screenshots/contact-directory.png)

## Roles and access

| Role | Visibility | Export |
| --- | --- | --- |
| Data extraction | Full dashboard | CSV / JSON |
| Regional Director | Full dashboard, including reports | None |
| EMED | Monitoring and enforcement views | None |
| CPD | Clearance and permitting views | None |
| MIS | Full dashboard and administration | CSV / JSON |
| GIS | Spatial and map views | GeoJSON |
| Viewer | Read-only dashboard | None |

Accounts, sessions and the audit trail are stored centrally in Cloudflare D1, so
a sign-in or export recorded on one device appears on every device. Sessions
expire after 8 hours; changing a password revokes every existing session for that
account.

## Data quality and limitations

- Register rows are not unique facilities; use establishment counts for site-level
  reporting.
- Some rows lack barangay, industry or expiry, and some coordinates are suspect.
  These are flagged, not corrected silently.
- Fuzzy establishment matches and simplified screening polygons are decision
  support, not an official determination.
- Legal status is only as complete as the source registers; cases with no closing
  or pending signal are shown as *no status*, not assumed resolved.
- PAB collections are yearly totals only; no payment amount is attributed to an
  individual establishment or case.
- The dashboard is a monitoring aid and does not replace official records,
  permits or clearances.

## Local development and API

The dashboard front end and the API run as two processes in development:

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars   # local CORS origins
npm run api:db          # apply D1 migrations locally
npm run api:seed        # build hashed accounts from CREDENTIALS.md
npm run api:seed:apply  # load the hashes into local D1
npm run api:upload      # copy public/data into local R2
npm run api:dev         # Worker API on http://localhost:8787
npm run dev             # Vite on http://localhost:5173 (proxies /api)
```

On Windows, `npm run live:autostart` registers a logon task that keeps **both**
processes running and restarts them if they exit. Use `npm run live:status` to
check them and `npm run live:restart` after changing Worker code.

`worker/.dev.vars` is git-ignored. Production `ALLOWED_ORIGINS` in
`worker/wrangler.toml` lists only the Pages origin; localhost is never allowed
on the deployed Worker.

`CREDENTIALS.md` is git-ignored and is the only place plaintext passwords exist.
`npm run api:seed` writes a git-ignored SQL file with PBKDF2 hashes; it never
prints passwords. Local D1/R2 state lives in `worker/.wrangler` and can be reset
by deleting that folder and re-running the four setup commands above.

For a published build set the API base URL at build time. On GitHub Actions, set
it as the `VITE_API_BASE` repository variable; the deploy workflow refuses to
upload a Pages artifact when it is missing.

```bash
VITE_API_BASE=https://envis-region-vii-api.<account>.workers.dev/api npm run build
```

Until the Worker is deployed, the build keeps using the `/api` proxy path. See
[worker/README.md](worker/README.md) for the deploy checklist and the cutover that
removes `public/data` from the published bundle.

## Versioning and releases

Every push to `main` triggers the deploy workflow in GitHub Actions. The build
embeds the `package.json` version, the Actions build number and the short commit
SHA. After a successful deployment the workflow creates a GitHub release tagged
`v<version>-b<build>`, so every change has a traceable version.

The deployed identity is shown in the sidebar footer, the page footer and the
**About & License → Version & releases** tab, with direct links to the GitHub
Actions runs and releases.

## Security

- Login names and passwords are **not** stored in plaintext in the repository or
  the published bundle. Built-in accounts are seeded with opaque keys and salted
  PBKDF2-SHA256 password hashes held only in D1.
- The session lives in an `HttpOnly`, `Secure`, `SameSite=None` cookie; the
  browser never reads it and no token is written to local storage. Account data
  written by the pre-API build is deleted on first load.
- State-changing API calls require an allowed `Origin`, so a hostile site cannot
  ride the `SameSite=None` cookie (CSRF).
- Unknown usernames pay the same PBKDF2 cost as real ones, preventing timing-based
  username enumeration.
- Every dataset request goes through the Worker. Anonymous requests to
  `/api/data/*` return **401**, and raw JSON is no longer published as a static
  file. Authenticated responses are `no-store` and are not kept in the browser
  cache.
- Login throttling locks an IP/username pair after repeated failures, and
  privileged actions require re-authentication.
- Role changes, deactivation, deletion and password resets revoke existing
  sessions for that account.
- Source maps are disabled in production, so the shipped bundle does not expose
  application source files. A build with `VITE_API_BASE` also removes `dist/data`.
- CSV/JSON exports and GeoJSON downloads are gated behind role-based login and
  recorded server-side in the shared audit log.
- CSV export is hardened against formula injection.
- The deploy workflow fails if `CREDENTIALS.md`, `.dev.vars`, `.env` or
  `worker/.local` is ever tracked in git.
- The error boundary renders a generic message; no stack traces reach end users.

## About the author

**Kent Agbayani (K3nt-Bytes)** — developer and maintainer  
Email: [Liquidkentagbayani@proton.me](mailto:Liquidkentagbayani@proton.me)  
Repository: [geocheckcentralvisayas-bit/envis-region-vii](https://github.com/geocheckcentralvisayas-bit/envis-region-vii)

## License

Released under the **MIS Credit License**. See [LICENSE](LICENSE).

Copyright © 2026 **Kent Agbayani (K3nt-Bytes)**.

Permit data belongs to DENR-EMB Region VII. Basemaps are provided by Esri, CARTO
and OpenStreetMap contributors. Boundaries follow PSA / PSGC 2026 for
administrative units and DENR Region VII for hazard and protected-area layers.

## Contact

**DENR-EMB Region VII**  
DENR Compound, Greenplains Subdivision, Banilad, Mandaue City  
Trunkline: (032) 260 9777  
Email: r7records@emb.gov.ph  
Website: [r7.emb.gov.ph](https://r7.emb.gov.ph/)

The complete division directory — section emails, local extensions, mobile
numbers and related concerns — is available in the dashboard under
**About & License → Contact directory**.
