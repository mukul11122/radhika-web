# Radhika Agencies website

This folder contains the website currently deployed to Vercel. The sibling GitHub checkout and the read-only `sources` directory are separate copies.

## Source layout

- Root HTML files: public website pages.
- `js/` and `css/`: browser behavior and styles. `js/vendor/` contains the licensed ExcelJS browser build.
- `api/`: Express routes and MySQL access.
- `lib/`: stock parsing, upload, allocation and email helpers.
- `tests/`: isolated order, upload and Excel regression checks. These do not send real emails or change production stock.
- `backend/`, `render.yaml`, `Dockerfile`, `fly.toml`: retained legacy hosting source/configuration; excluded from Vercel where appropriate.

## Local checks

Run `npm ci`, `npm test`, and `npm run format:check`. Use `npm run format` when editing source. Keep generated/vendor code out of formatting.

Production credentials belong in hosting environment variables. Never commit local environment files. The upload flow replaces the stock snapshot only after validating the complete file. Order reservations use database transactions and request IDs to prevent duplicate deductions.

## Deployment

Deploy from this directory with `vercel deploy --prod --yes --scope radhika-agenciesonrenderco`, then verify the public pages and API. `vercel.json` routes `/api/*` to `api/index.js`.

Historical one-time editing scripts and old deployment artifacts are retained outside this folder in `../maintenance/history`; they are not part of the active application.

## Database performance

`lib/performance-store.js` installs additive tables/indexes under a database migration lock. `stock_records` is a searchable read model; stock snapshots remain the reservation source. Upload, deduction and cancellation update both in the same transaction. An older deployment writing a snapshot is detected by revision and the read model is rebuilt before alerts are served.

Dashboard results are persisted in `dashboard_cache`, keyed by the India date, order count, newest status event and stock revision; status changes and new stock rates invalidate the result. No order or stock data is publicly cached. History uses indexed generated Store Code/mobile columns. Functions run in Mumbai (`bom1`), selected after comparison with `iad1`. The authenticated `/api/admin/performance` endpoint checks migration, row count, region and the history query index.

## Operations and recovery

Admin Operations & Backups shows recent HTTP 409/5xx failures (route/status only), email delivery below 3 recipients, possible duplicate orders in the last 24 hours (at most 2000 recent orders), and the latest 14 backups. Duplicates compare normalized Store Codes and aggregated DC/quantity; warnings never cancel orders. New audit events record the authenticated admin and restored quantity; older events are explicitly marked as lacking actor information.

Vercel Cron invokes `/api/cron/backup` daily at 00:00 UTC (05:30 IST), authenticated by the production `CRON_SECRET`. Each India date has one gzip JSON backup. Backups exclude hosting credentials and derived performance tables. Verification restores each backed-up table into temporary MySQL tables, inserts original IDs and timestamps, and compares every row including generated columns. Production business tables are never overwritten by verification. The backup endpoint permits authenticated, chunked private downloads.

Copies stored in the same database are not offsite disaster recovery. Keep downloaded files privately in a separate location. The first verified archive was independently saved in `../private-backups/`. No automatic destructive restore endpoint is exposed; a real recovery requires selecting a target database and validating schema compatibility. Backups are retained; the UI shows the latest 14.

Mobile checks: `TEST_BASE_URL=... ADMIN_TEST_PASSWORD=... node tests/check-mobile.cjs` uses isolated headless Chrome at 390px, imports a review-only CSV, blocks the actual submission route and checks the admin UI. It does not place orders or send email. Screenshots stay outside the deployed directory.

## Kendra profiles and medicine demand

`kendra.html` provides self-service profile registration/sign-in with Store Code, mobile and a six-digit PIN. PINs use salted scrypt hashes. Signed customer tokens have a dedicated scope (never admin access) and last seven days; the customer can choose persistent device storage or tab-only storage. Profile data is fetched only with this token. Login attempts are limited per Store Code/IP hash. GSTIN validation checks format; profile registration does not verify government ownership or mobile ownership through OTP.

Stock Directory uses the signed-in profile to fill Store Code/mobile and displays delivery details. At order submission the server independently verifies the token, Store Code and mobile and saves an immutable profile snapshot. Admin order cards and order Excel include that snapshot. Orders without a saved profile continue to work. PINs/tokens are not saved in orders or emails.

Unavailable medicine demand is a separate authenticated flow. Customers can choose a zero-stock item or enter an unlisted medicine, quantity and note. Requests are idempotent by request UUID and do not reserve stock, submit orders or send email. Admin Kendra & Demand provides search/pagination, profile contact details and New/Reviewing/Available/Closed status updates with notes. A code that currently has stock is rejected by the demand endpoint. New profile/demand/event tables are included in future backups.

`node tests/test-kendra.cjs` exercises isolated customer authentication, ownership, idempotency and delivery snapshots. `node tests/check-kendra-mobile.cjs` uses browser-intercepted test customer requests, so no fake Kendra profiles/demands/orders are created in production.
