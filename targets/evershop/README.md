# R1: an unmodified EverShop as the target

Status: the harness code is written and unit-tested against a fake `pg`. **It has not been run against a real EverShop.** Nothing here installs EverShop, contacts anyone, or calls PayPal.

EverShop (https://github.com/evershopcommerce/evershop, GPL-3.0) is downloaded by `scripts/install-evershop.sh`, never copied into this repository. EchoBench does not edit it.

## Why a special recording

EverShop ignores PayPal events for orders it does not know. A MugShop recording replayed into EverShop would be ignored and look like a pass. So the recording must be made **inside EverShop's own shop**, and EchoBench checks that before it reports anything.

## Steps (you run them; plan section 5, item 10)

1. Install: `bash scripts/install-evershop.sh .evershop`, then follow EverShop's own README for its PostgreSQL setup. Note the commit id the script prints.
2. In PostgreSQL create two roles besides EverShop's own:
   - an admin role that may `CREATE DATABASE` and `DROP DATABASE` (used only for start points)
   - a **read-only** role with `SELECT` on EverShop's tables (used for every state read)
3. In EverShop's admin, add PayPal **sandbox** credentials. In your PayPal sandbox app, register a webhook whose URL is EchoBench's receiver (`<PUBLIC_URL>/hooks/paypal`, see VERIFY.md V1). Put that webhook's id into EverShop's PayPal settings (`paypalWebhookId`) and into EchoBench's `PAYPAL_WEBHOOK_ID`.
4. Fill the `EVERSHOP_*` values in `.env` (see `.env.example`), then `npm install pg` (the harness loads it only when this target is used).
5. Check the guessed column names: `node scripts/evershop-check-schema.js`. It lists every column in `targets/evershop/schema.json` that does not exist in the database (read-only). **Edit `schema.json` until the list is empty.** Only `integration_order_id` and `transaction_id` come from the plan; the rest are guesses.
6. Start a recording on the EverShop target. Buy something in EverShop's shop with a sandbox buyer, then refund it twice from EverShop's admin (4.00, then the rest). EchoBench receives each PayPal delivery, stores the exact bytes, and hands it to EverShop's webhook route (`EVERSHOP_WEBHOOK_PATH`, default `/api/paypal/webhook`, **confirm the real path in `paypalWebhook.ts` / the route files**). Between deliveries it pauses EverShop for a few seconds to copy the database to a template (`snapshot`).
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
- Not verified: the EverShop table and column names beyond the two named in the plan, the webhook route, how long a restore takes, whether EverShop's admin allows two partial refunds (its source suggests it does).
