# R1: an unmodified EverShop as the target

Status (2026-11-12): **run against a real, unmodified EverShop 2.4.0 (commit 25cf1e8) on the local PayPal stand-in.** Not yet run on the PayPal sandbox (that needs the public receiver of VERIFY V1). Nothing here contacts anyone.

## What was run (local stand-in)

1. `bash scripts/evershop-local-setup.sh`: clones EverShop into `.evershop/` (via `install-evershop.sh`), `npm install`, `compile`, `build`, a local PostgreSQL 18 from the `embedded-postgres` npm package in `.evershop-pg/` (port 54329, no system install, no sudo), the database, one start for EverShop's migrations, a read-only role `echobench_ro`, and `.evershop-pg/evershop.env` with the `EVERSHOP_*` values. Both folders are git-ignored. Then it runs the schema check: every column in `schema.json` exists.
2. `node --env-file=.evershop-pg/evershop.env scripts/record-evershop.js`: EchoBench starts EverShop with `DB_*` and `NODE_CONFIG` (`system.paypal`: status 1, the proxy as `environment`, the stand-in's client id, secret and webhook id). No EverShop file is edited. Through EverShop's own admin REST API it adds a shipping zone, a flat-rate method, a package and a 12.00 product (the calls EverShop's own release check makes); an admin user is inserted with EverShop's password helper and a random in-memory password. Through the storefront REST API a guest places an order paid with PayPal, `POST /api/paypal/orders` creates the PayPal order, the stand-in approves it, EverShop's own return page `/paypal/processing/:order_id` captures, and the admin refunds 4.00 and 8.00 through `POST /api/orders/:id/refunds`. Recorded: approved, completed, refund1, refund2 (EverShop answered 200 to each), start points SP0 to SP3 as template databases. Precheck: ok.
3. `FORCE_MOCK=1 node --env-file=.evershop-pg/evershop.env scripts/run-ab.js`: every scenario first restores EverShop's database from the template and checks the state (`resetOk` on every run, 3.4 to 11 s per run). Results in `builtin/ab-runs.json`, shown in the A/B tab (also where EverShop is not installed, as recorded results).

| Scenario | EverShop |
|---|---|
| S0 to S3 | green: the one capture is booked once. EverShop ships by hand (its merchant creates shipments), so for this target I1 checks the booked capture instead of a shipment (`shipsByHand` capability) |
| S5b | green: both refunds booked, 12.00 |
| S6 | green: 3 forged events rejected, state unchanged |
| S7 | amber: the old event answered 200 and changed nothing |
| S5 | red: a refund made outside the shop whose webhook is lost is not picked up within the 6 s window; EverShop relies on PayPal's redelivery and does not re-read PayPal |
| S4, D1, contract rows | N/A: no buyer return path EchoBench can race, no dispute in this recording, no refund entry EchoBench can call |

Found while running: captures and refunds both have `transaction_type` `online`; `payment_action` (`capture` / `refund`) tells them apart, so `schema.json` now uses it. EverShop starts an event and a cron child process that hold database connections, so the target now runs EverShop in its own process group and stops the whole group before copying a template.

These results are measured and pending maintainer review (see "If a run finds a defect"); nothing was sent to anyone.

EverShop (https://github.com/evershopcommerce/evershop, GPL-3.0) is downloaded by `scripts/install-evershop.sh`, never copied into this repository. EchoBench does not edit it.

## Why a special recording

EverShop ignores PayPal events for orders it does not know. A MugShop recording replayed into EverShop would be ignored and look like a pass. So the recording must be made **inside EverShop's own shop**, and EchoBench checks that before it reports anything.

## Steps for the sandbox run (plan section 5, item 10)

1. Install: `bash scripts/install-evershop.sh .evershop`, then follow EverShop's own README for its PostgreSQL setup. Note the commit id the script prints.
2. In PostgreSQL create two roles besides EverShop's own:
   - an admin role that may `CREATE DATABASE` and `DROP DATABASE` (used only for start points)
   - a **read-only** role with `SELECT` on EverShop's tables (used for every state read)
3. In EverShop's admin, add PayPal **sandbox** credentials. In your PayPal sandbox app, register a webhook whose URL is EchoBench's receiver (`<PUBLIC_URL>/hooks/paypal`, see VERIFY.md V1). Put that webhook's id into EverShop's PayPal settings (`paypalWebhookId`) and into EchoBench's `PAYPAL_WEBHOOK_ID`.
4. Fill the `EVERSHOP_*` values in `.env` (see `.env.example`), then `npm install pg` (the harness loads it only when this target is used).
5. Check the column names: `node scripts/evershop-check-schema.js`. It lists every column in `targets/evershop/schema.json` that does not exist in the database (read-only). On EverShop 2.4.0 the list is empty.
6. Start a recording on the EverShop target. Buy something in EverShop's shop with a sandbox buyer, then refund it twice from EverShop's admin (4.00, then the rest). EchoBench receives each PayPal delivery, stores the exact bytes, and hands it to EverShop's webhook route (`EVERSHOP_WEBHOOK_PATH`, default `/api/paypal/webhook`, confirmed on 2.4.0). Between deliveries it pauses EverShop for a few seconds to copy the database to a template (`snapshot`).
7. Match check (read-only): `GET /api/recordings/<id>/precheck?targetId=evershop`. It looks up the recorded PayPal order id in `order.integration_order_id` and the capture id in `payment_transaction.transaction_id`. If either is missing the run stops with "match failed". Do not work around it.
8. Run: `node scripts/run-ab.js <recording-id>`. Every scenario first drops EverShop's database, recreates it from the right template and restarts EverShop. It then checks the state equals the saved start point. If not, it reports "Reset failed" and delivers nothing.

Scenarios that need a buyer return path, an EchoBench refund entry point, or the contract payment show `N/A` for EverShop. S5 needs the admin to have refunded twice; if EverShop's admin cannot, mark S5 N/A and judge a single partial refund with I2.

## If a run finds a defect

Do not commit anything from `targets/evershop/runs/` or the `data/` folder (both are git-ignored). The plan's disclosure steps, all of which need **your approval before anything is sent**:

- Details (reproduction, the forgery method for S6) go by private email to the maintainer contact published in EverShop's repository (README and CODE_OF_CONDUCT.md list `support@evershop.io`). EverShop has no `SECURITY.md` and private vulnerability reporting is off.
- A public issue, if you open one, says only that a webhook handling problem was measured and asks where security reports should go. No reproduction, no forgery method, no recording.
- Drafts stay outside this repository.
- Until that has happened, the video and write-up say "measured, results pending maintainer review" and give the date the maintainers were told.

## What was and was not verified

- Unit tests (`test/evershop.test.js`): read-only SQL guard, READ ONLY transactions on the read-only connection, precheck as a database lookup, template database snapshot and restore statements, identifier checking, schema check.
- Verified on the local run: the table and column names, the webhook route `/api/paypal/webhook`, a restore takes a few seconds, EverShop's admin refunds twice (4.00, then 8.00). Not verified: the same on the PayPal sandbox.
