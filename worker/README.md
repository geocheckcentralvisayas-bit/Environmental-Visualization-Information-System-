# ENVIS Region VII API

Authenticated data API for the ENVIS dashboard. It keeps the compiled dataset in
a private R2 bucket, accounts and the audit trail in D1, and returns data only to
signed-in accounts.

```
Browser ──cookie──► Worker ──► D1   (accounts, sessions, activity, throttling)
                       └─────► R2   (data/*.json, data/geojson/*.geojson)
```

## Endpoints

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/health` | public |
| `POST` | `/api/login` | public (throttled) |
| `POST` | `/api/logout` | any session |
| `GET` | `/api/session` | any session |
| `POST` | `/api/verify` | session + password re-check; `purpose=export\|geojson` |
| `GET` | `/api/data/:file` | any signed-in role |
| `GET/POST` | `/api/admin/accounts` | MIS |
| `PATCH/DELETE` | `/api/admin/accounts/:username` | MIS |
| `POST` | `/api/admin/accounts/:username/password` | MIS |
| `POST` | `/api/admin/accounts/import` | MIS |
| `GET/DELETE` | `/api/admin/activity` | MIS |

Data paths are allow-listed: the known root JSON files plus
`geojson/<name>.geojson`. Traversal and arbitrary object keys return 404.

## Local development

Run from the repository root:

```bash
cp worker/.dev.vars.example worker/.dev.vars
npm run api:db
npm run api:seed
npm run api:seed:apply
npm run api:upload
npm run api:dev
```

`worker/.dev.vars` is git-ignored and overrides `ALLOWED_ORIGINS` for local
development only. The committed `worker/wrangler.toml` value lists just the
Pages origin, so a deployed Worker will not accept requests from localhost.

The Worker listens on `http://localhost:8787`; Vite proxies `/api` to it. Local
state is stored under `worker/.wrangler` (git-ignored). Delete that folder and
repeat the commands above whenever `worker/migrations` changes.

`npm run api:seed` reads the untracked `CREDENTIALS.md` and writes
`worker/.local/seed.sql` containing PBKDF2 hashes. Passwords are never printed or
committed.

## Deploy checklist

Requirements: a Cloudflare account, `wrangler login` (or `CLOUDFLARE_API_TOKEN`),
and the target Pages origin in `ALLOWED_ORIGINS`.

1. Create the resources and record the ids Wrangler prints:

   ```bash
   npx wrangler d1 create envis
   npx wrangler r2 bucket create envis-data
   ```

2. Replace the placeholder `database_id` in `worker/wrangler.toml`, then set
   `ALLOWED_ORIGINS` to the exact Pages origins (scheme + host, no trailing
   slash).

3. Apply the schema and seed accounts on the remote database:

   ```bash
   npx wrangler d1 migrations apply envis --remote --config worker/wrangler.toml
   npm run api:seed
   npx wrangler d1 execute envis --remote --config worker/wrangler.toml --file=worker/.local/seed.sql
   ```

4. Upload the dataset:

   ```bash
   npm run api:upload:remote
   ```

5. Deploy the Worker:

   ```bash
   npx wrangler deploy --config worker/wrangler.toml
   ```

6. Set the `VITE_API_BASE` repository variable on GitHub to
   `https://<worker-host>/api`, then build the dashboard against the deployed API:

   ```bash
   VITE_API_BASE=https://<worker-host>/api npm run build
   ```

   The deploy workflow refuses to publish when the variable is missing, so the
   static site cannot go live pointing at a non-existent `/api` path.

## Cutover

After the Worker is live and the Pages site is built with `VITE_API_BASE`:

- `VITE_API_BASE=https://<worker-host>/api npm run build` also removes
  `dist/data`, so the Pages artifact never contains the JSON even if `public/data`
  is still present in the repository.
- keep `public/data` in the repository only as the pipeline output that
  `npm run api:upload` copies into private R2;
- confirm `/data/permits.json` on the Pages host returns 404 while
  `/api/data/permits.json` returns 401 without a session.

## Operational notes

- Sessions last `SESSION_TTL_HOURS` (8). Passwords are PBKDF2-SHA256 with 210,000
  iterations; lower that only if the Workers CPU limit is exceeded on the free
  plan.
- State-changing requests from an `Origin` outside `ALLOWED_ORIGINS` are rejected
  with **403**, which covers the `SameSite=None` cookie needed for Pages.
- Unknown usernames still pay the PBKDF2 cost, so response timing does not reveal
  whether an account exists.
- Dataset responses use `Cache-Control: no-store`, so authenticated JSON is not
  left in the browser cache after sign-out.
- Role changes, deactivation, deletion and password resets revoke that account's
  sessions immediately.
- Responses carry HSTS, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and a restrictive
  `Permissions-Policy`.
- Activity is trimmed to the most recent 2,000 rows on a sampled basis.
- The client cannot write audit entries; exports and GeoJSON downloads are logged
  server-side by `/api/verify`.
- Cookies are `HttpOnly; Secure; SameSite=None` because the UI and API are on
  different origins. HTTPS is required in production.
- Rotate a built-in password by updating `CREDENTIALS.md`, re-running the seed
  steps, then asking users to sign in again. Changing a password through the
  admin panel revokes that account's sessions immediately.
