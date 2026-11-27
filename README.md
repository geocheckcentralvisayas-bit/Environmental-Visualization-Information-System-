# ENVIS Dashboard — Environmental Permits Monitoring System

[![Version](https://img.shields.io/badge/version-1.4.0-emerald)](#)
[![Build](https://img.shields.io/badge/build-passing-2ea44f)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6)](#)
[![React](https://img.shields.io/badge/React-19-61dafb)](#)
[![License](https://img.shields.io/badge/license-MIS%20Credit-blue)](#)

**Download the Windows app:** [ENVIS Dashboard Setup.exe (v1.4.0)](https://github.com/geocheckcentralvisayas-bit/Environmental-Visualization-Information-System-/releases/download/v1.4.0/ENVIS%20Dashboard%20Setup.exe)

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
| Planning Accomplishments 2026 | Every performance indicator from the EMB 7 Accomplishment workbook: twelve monthly targets and accomplishments, remarks, means of verification, data-quality checks, focal staff and a field-level change log; refreshes from the locally synced workbook |
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
- **Planning Accomplishments 2026** — every indicator from the CY 2026 planning
  workbook with twelve monthly targets and accomplishments, status derivation,
  data-quality checks, focal staff and a live change log driven by the locally
  synced workbook.
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

## Screenshots and feature showcase

### Sign in and offline showcase

The desktop app's sign-in screen has two tabs. **Offline password** needs only
the MIS-issued offline password (no username) and works with no internet;
**Online sign in** uses your ENVIS account and prefers the office host.

![Offline and online sign-in tabs](docs/screenshots/offline-login.png)

The live dashboard sign-in screen used in a browser:

![Sign-in screen](docs/screenshots/login.png)

### Installer

The setup window and the finish panel, including the **Quick start** guide and
the LAN sync token field. A full guide is also written to `START HERE.txt`.

| Setup | Finished |
| --- | --- |
| <img src="docs/screenshots/installer-setup.png" alt="ENVIS installer setup" width="420"> | <img src="docs/screenshots/installer-complete.png" alt="ENVIS installer complete" width="420"> |

### Feature tabs

Every tab in the dashboard has a screenshot. Click a thumbnail to open it.

| Tab | Showcase | Tab | Showcase |
| --- | --- | --- | --- |
| Overview | <img src="docs/screenshots/overview.png" alt="Overview" width="260"> | Ambient Corner | <img src="docs/screenshots/ambient.png" alt="Ambient Corner" width="260"> |
| EMED Monitoring | <img src="docs/screenshots/emed.png" alt="EMED Monitoring" width="260"> | Planning Accomplishments | <img src="docs/screenshots/planning.png" alt="Planning" width="260"> |
| Discharge Permits | <img src="docs/screenshots/dp.png" alt="Discharge Permits" width="260"> | Permit to Operate | <img src="docs/screenshots/pto.png" alt="Permit to Operate" width="260"> |
| Renewal Watch | <img src="docs/screenshots/renewal.png" alt="Renewal Watch" width="260"> | DP · PTO Intercross | <img src="docs/screenshots/sites.png" alt="Intercross" width="260"> |
| Spatial Map | <img src="docs/screenshots/map.png" alt="Spatial Map" width="260"> | Layers & Overlays | <img src="docs/screenshots/spatial.png" alt="Layers" width="260"> |
| Spatial Screening | <img src="docs/screenshots/screening.png" alt="Screening" width="260"> | Data Quality | <img src="docs/screenshots/quality.png" alt="Data Quality" width="260"> |
| Data Tables | <img src="docs/screenshots/tables.png" alt="Data Tables" width="260"> | Reports & Export | <img src="docs/screenshots/reports.png" alt="Reports" width="260"> |
| Hazardous Waste | <img src="docs/screenshots/hw.png" alt="Hazardous Waste" width="260"> | Solid Waste (SWM) | <img src="docs/screenshots/swm.png" alt="SWM" width="260"> |
| ECC & CNC | <img src="docs/screenshots/clearances.png" alt="ECC and CNC" width="260"> | ECC / CNC Ultralist | <img src="docs/screenshots/ecc-ultralist.png" alt="Ultralist" width="260"> |
| NOV & Legal Cases | <img src="docs/screenshots/legal.png" alt="Legal" width="260"> | PCO Corner | <img src="docs/screenshots/pco-corner.png" alt="PCO Corner" width="260"> |
| Accounts & Activity | <img src="docs/screenshots/admin.png" alt="Accounts and Activity" width="260"> | About & License | <img src="docs/screenshots/about.png" alt="About" width="260"> |

Older detailed captures remain available:
[EMED overview](docs/screenshots/emed-overview.png),
[EMED inspector](docs/screenshots/emed-inspector-performance.png),
[EMED worksheets](docs/screenshots/emed-worksheets.png),
[spatial map](docs/screenshots/spatial-map.png),
[DP · PTO intercross](docs/screenshots/dp-pto-intercross.png),
[ECC / CNC Ultralist](docs/screenshots/ecc-cnc-ultralist.png),
[legal docket](docs/screenshots/legal-docket.png),
[about and license](docs/screenshots/about-license.png),
[contact directory](docs/screenshots/contact-directory.png).

Refresh the EMED dataset with `npm run data:emed`; publish with
`npm run api:upload` locally or `npm run api:upload:remote` for the deployed API.

### Planning evidence

Live screenshots of the **Planning Accomplishments 2026** page, which reads the
EMB 7 Accomplishment workbook:

| Planning evidence | |
| --- | --- |
| <img src="docs/screenshots/planning-evidence/01-planning-accomplishments.png" alt="Planning indicators and KPIs" width="420"> | <img src="docs/screenshots/planning-evidence/02-planning-details.png" alt="Planning details" width="420"> |
| <img src="docs/screenshots/planning-evidence/03-planning-summary.png" alt="Planning summary" width="420"> | |

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

### Offline maps and shared office use

`npm run data:tiles` downloads the Region VII streets and satellite basemap
(zoom 7-12, about 23 MB) into `offline-tiles\`. The dev server serves that pack
at `/tiles`, so the map keeps working with no internet; the app caches any extra
tile opened while online. Keep `offline-tiles\` with the project when you copy it
to another PC. Esri/OpenStreetMap attribution still applies.

One PC is the **host**: it runs the services and holds the newest data and
tiles. Colleagues install the desktop app in client mode and point it at the
host's LAN address (`http://<host-ip>:5173`). Their app starts nothing locally,
so every rebuilt dataset or workbook change is visible to everyone at once,
without internet and without copying files. The host address is shown in the
app's tray → Status.

The installer also carries a **static offline copy** of the dashboard: the app,
every built dataset and the Region VII tiles. Whenever a client is on the
office LAN it uses the host's live data and refreshes that copy automatically
(on launch and every 15 minutes). Anywhere else — at home or on another
network — it opens the offline copy with the last synced data and maps. The
offline copy is read-only (viewer role): exports and GIS downloads need the
live host.

The offline copy asks for one password before it opens, and only an MIS user can
create or change it: sign in on the live dashboard as MIS and use
**Administration → Offline access**. The hashed value is stored in
`offline-access.json` beside the project, so it travels with the installer snapshot and
with every LAN sync. Users choose **Offline password** (no username, MIS-issued)
or **Online sign in** at the sign-in screen. **Online sign in** returns to this
PC's own dashboard when it is the host, otherwise it tries the office host first,
then the optional public dashboard URL set during installation, so a PC with
internet can open the newest dashboard build; with none reachable, the offline
copy stays open.

### Windows desktop app

`desktop\` turns the dashboard into a real window (WinForms + WebView2) that
starts the same three services and lives in the notification area, with no
terminal. Building it produces both a portable exe and an installer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build.ps1
```

- `desktop\dist\ENVIS Dashboard.exe` — portable, no install.
- `desktop\dist\ENVIS Dashboard Setup.exe` — installer with Start Menu/Desktop
  shortcuts, Apps & Features entry and uninstaller. It installs per user (no
  admin) and records where this project lives.

Both need Node.js 20+, the project's `node_modules`, and the WebView2 runtime
(included with Windows 11/Edge). See [desktop/README.md](desktop/README.md) for
the tray menu, silent install flags, logs and uninstall steps.

#### Install and sign in (v1.4.0)

1. Run `ENVIS Dashboard Setup.exe`. Accept the license, pick a folder, click Install.
   The finish screen shows a short guide and creates `START HERE.txt` in that folder.
2. On the **host** PC leave *Shared dashboard server* blank. On other PCs enter
   the host's LAN address, for example `http://192.168.1.31:5173` (shown in the
   host's tray → Status). *Public dashboard URL* is optional and only applies
   once that site is deployed.
3. Open the app. **Online sign in** takes your ENVIS username and password and
   uses the office host first, then the optional public site. **Offline password**
   takes only the MIS-issued offline password — no username — and works offline.
4. Only MIS can set that offline password: sign in to the live dashboard as MIS,
   open **Administration → Offline access**, and enter **New offline password**.
   It is a separate password, not any account password; its hash is saved to
   `offline-access.json` and reaches clients on the next LAN sync.
   On the host PC the app also refreshes its own offline gate whenever it opens
   the offline copy.
5. Use the tray icon to switch between the live dashboard and the offline copy
   at any time. On the office LAN the live data and offline copy update
   automatically; elsewhere the last synced copy remains available.

#### Security notes (v1.4.0 hardening)

- The LAN host no longer serves `public/data/**` as static files: `/data/*`
  returns 404. Data is available only through the authenticated Worker API.
- `/sync/*` now requires a shared bearer token. Set a strong secret on the host
  as `ENVIS_SYNC_TOKEN` (or `syncToken` in `%LOCALAPPDATA%\ENVIS Dashboard\config.json`)
  and give client PCs the same value in Setup's **LAN sync token** field or
  `/SYNC:<token>`. Without a matching token, sync is refused (403).
- The offline password hash now lives in `offline-access.json` at the project
  root, outside the served/synced data tree. The offline build copies it into
  the snapshot explicitly.
- LAN responses carry a CSP and security headers; GitHub Pages gets the same
  headers from `public/_headers`.
- The app window only navigates to the current dashboard, the installed copy
  or the configured public site, and its file mapping uses `DenyCors`.
- Launcher and uninstall scripts reject shell metacharacters in configured paths.
- `desktop\dist\SHA256SUMS.txt` publishes hashes of both exes. **Code signing is
  still required** for real provenance; it needs a code-signing certificate.
- Residual risks: the offline snapshot is still plaintext, so the password gate
  is a UI lock, not encryption — control who receives `Setup.exe` and use
  BitLocker on client PCs. GIS layer files remain readable by every signed-in
  role because the map needs them; the GIS-only rule governs the audited
  download through `/api/verify`. `xlsx` stays at 0.18.x because npm has no
  fixed release; the data pipeline parses only trusted local workbooks.

### Planning Accomplishments live source

The **Planning Accomplishments 2026** tab reads the `Main (for CO)` sheet of
`EMB 7 Accomplishment 2026 - ALL SECTIONS.xlsx`. Because the SharePoint copy is
sign-in gated, the pipeline watches the **locally synced OneDrive workbook**:

```
%USERPROFILE%\OneDrive - Environmental Management Bureau\EMB Office Files\
  10 Reports (Annual, Monthly, Quarterly)\2026 Monthly Accomplishment\
  ORD-PLANNING\EMB 7 Accomplishment 2026 - ALL SECTIONS.xlsx
```

- `npm run data:planning` rebuilds `public/data/planning.json` once from the
  workbook (set `PLANNING_WORKBOOK` to use a different path, or copy the file to
  `data/EMB 7 Accomplishment 2026 - ALL SECTIONS.xlsx`).
- `npm run planning:serve` runs the watcher on `http://127.0.0.1:8788`. It hashes
  the workbook every 5 seconds and rebuilds only when the bytes change.
- `npm run dev` and `npm run live` start the watcher automatically. In
  `worker/.dev.vars`, `PLANNING_LIVE_URL` points the Worker at the watcher so
  `/api/data/planning.json` is proxied live. Without it, the Worker serves the
  last uploaded R2 snapshot.
- The page checks for a new snapshot every 10 seconds. Actual latency is the
  OneDrive sync delay — usually seconds, occasionally about a minute. The live
  proxy is development/LAN only; never set `PLANNING_LIVE_URL` on a deployed
  Worker.

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
