# Setting up ENVIS on a new computer

This guide gets a fresh Windows PC from zero to a running ENVIS Dashboard.

## 0. Security first — read this before copying anything

A full backup zip contains **`CREDENTIALS.md`** (plaintext passwords) and
**`worker/.dev.vars`** / **`.env`** (local secrets). These files are
git-ignored and must **never** be committed or uploaded to cloud storage.

- Do **not** put the backup zip on Google Drive, Dropbox, OneDrive, email or chat.
- Transfer it with an encrypted USB drive or another secure channel.
- If a backup is lost or exposed, rotate the account passwords.

The recommended setup below uses a clean GitHub clone and copies only the two
secret files from the backup.

## 1. Requirements

- **Node.js 20 or newer** (the project is developed on Node 24)
- **Git**
- No Python, no database server — the local Worker uses Wrangler's bundled D1/R2.

## 2. Get the code

Preferred — clean clone from GitHub:

```bash
git clone https://github.com/geocheckcentralvisayas-bit/envis-region-vii.git
cd envis-region-vii
```

Then securely copy these two files from a backup zip into the cloned folder:

```
CREDENTIALS.md
worker/.dev.vars
```

Keep their exact names and locations. `worker/.dev.vars.example` shows the
expected `ALLOWED_ORIGINS` format if you need to recreate it.

Alternative — restore the whole backup:

1. Extract the zip to a simple path such as `F:\Projects\ENVIS Dashboard`
   (avoid deep paths and unnecessary spaces).
2. The `.git/` folder is included, so `git pull` still works.
3. Remove any old `dist/` or `node_modules/` if present; they are not needed.

## 3. Install dependencies

```bash
npm install
```

This installs the dashboard dependencies (React, Vite, Leaflet, ECharts, xlsx,
Playwright, etc.). The Pixel Office game is already built into
`public/pixel-office/`, so you do **not** need to build it just to run ENVIS.

Only if you plan to edit the Pixel Office source:

```bash
cd ENVIS-Pixel-Office
npm install
npm run build
# copy ENVIS-Pixel-Office/dist/* into public/pixel-office/
```

## 4. Initialise the local Worker data

The backup intentionally excludes `worker/.wrangler/`, which holds the local
D1 database and R2 bucket. Recreate them once:

```bash
npm run api:db
npm run api:seed
npm run api:seed:apply
npm run api:upload
```

- `api:db` creates the local D1 tables.
- `api:seed` reads `CREDENTIALS.md` and writes `worker/.local/seed.sql`
  with PBKDF2 password hashes — plaintext passwords never leave the file.
- `api:seed:apply` inserts the accounts into local D1.
- `api:upload` copies all `public/data/*.json` files into the local R2 bucket
  so the API can serve them.

Re-run `api:upload` any time `public/data/*.json` changes.

## 5. Start the app

```bash
npm run dev
```

`npm run dev` is now self-sufficient: a `predev` hook starts the local API
(Worker on port 8787) if it is not already running, then starts Vite on port
5173. Open **http://localhost:5173** and sign in with an account from
`CREDENTIALS.md`.

The API keeps running in the background after the hook exits and logs to
`logs/api-dev.log`. If you prefer to run the two services yourself, or want
both supervised with automatic restarts, use:

```bash
# Option A — one command, both services supervised
npm run live

# Option B — two terminals
npm run api:dev   # API on 8787
npm run dev       # Vite on 5173
```

Never run `npm run api:dev` while another Worker is already on port 8787:
overlapping `wrangler dev` instances corrupt the local D1 state with
`SQLITE_BUSY`.

## 6. Share the dashboard on the office LAN

```bash
npm run dev:lan
```

This binds Vite to `0.0.0.0` and prints the links to give your colleagues, for
example `http://192.168.190.21:5173`. The API stays on `127.0.0.1:8787` and is
reached through Vite's `/api` proxy, so it is never exposed to the network.
Login credentials are still required.

Two settings in `worker/.dev.vars` are needed for LAN use (both are documented
in `worker/.dev.vars.example`):

```
ALLOW_LAN_ORIGINS = "true"   # accepts private-network origins on dashboard ports
COOKIE_SECURE = "false"      # plain HTTP LAN addresses reject Secure cookies
COOKIE_SAME_SITE = "Lax"
```

`Secure` cookies work on `http://localhost` but are silently dropped on
`http://192.168.x.x`, which makes every dataset request return 401 after a
successful login. Keep these values local: **never** enable `ALLOW_LAN_ORIGINS`
or disable `COOKIE_SECURE` on a deployed Worker.

If colleagues cannot connect, allow inbound TCP port 5173 in Windows Firewall
(run this in an **elevated** PowerShell on the hosting computer):

```powershell
New-NetFirewallRule -DisplayName "ENVIS Dashboard (LAN)" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private
```

Do **not** port-forward this dev server to the internet. It is meant for a
trusted office network.

## 7. What should be visible

- Navigation includes **Overview, Ambient Corner, Pixel Office**, all permit
  and compliance tabs.
- Footer shows **Build 1.2.0 · #45 · Authorized** (the number is the commit
  count locally, or the GitHub Actions run number in CI).
- Pixel Office is visible only to `mis` and `rd` accounts and issues a
  15-minute session.

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `EBUSY` on a `data/*.csv` or `ENVIS-Pixel-Office/index.html` | Already handled in `vite.config.ts` watch ignore list. If it reappears, close Excel or the file locking it. |
| `SQLITE_BUSY` / Worker crash | More than one `wrangler dev` instance is running. Stop all Node/Wrangler processes and start one `npm run api:dev`. |
| A tab says “could not be loaded (HTTP 404)” | A JSON file is missing from the Worker allow-list in `worker/src/index.ts`, or `npm run api:upload` was not run. `npm run data:validate` checks the allow-list. |
| Login fails on the new PC | Re-run `api:seed` and `api:seed:apply`, making sure `CREDENTIALS.md` is present. |
| Pixel Office shows a broken image | Confirm `public/pixel-office/characters/` exists, or rebuild the Pixel Office app and copy its `dist` over. |
| Data looks old | Run `npm run data:all` (needs network access to the source sheets), then `npm run api:upload`. |

## 9. Keep secrets out of Git

```bash
git status          # CREDENTIALS.md and .dev.vars must not appear
```

If they ever appear as untracked or modified, add them to `.gitignore` before
committing. Only source, generated JSON and documentation belong in the repo.
