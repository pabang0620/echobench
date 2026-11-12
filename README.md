# EchoBench

**A replay lab for PayPal webhooks.** It can record the PayPal sandbox deliveries that reach it (recording real deliveries needs a public URL and has not been run yet, VERIFY.md V1; the built-in recording comes from a local PayPal stand-in). The SDK reads, the refund retry and a contract payment have been measured on the real sandbox (V4, V5, V8, V11), and the Contract tab's two refund promises were run on real sandbox payments, green on the fixed shop and red on the contrast copy (V5b, see below). It shakes the recorded deliveries (duplicated, at the same time, reordered, dropped, replayed late, forged), and judges your handler by comparing the shop's books with PayPal's own records. When something fails, an AI step explains why and writes a patch that EchoBench itself type-checks and re-runs on a copy before you can apply it. The default run, with no keys, uses a mock model for that step and says so on screen. Two real runs of that step (Claude Sonnet through a local Claude Code account, 2026-11-12, on scenarios S1 and S5b) ship with the app and replay without a key as "Recorded run".

Built for the PayPal AI Hackathon 2026. Target prize: Best Use of APIMatic.

> The APIMatic Context Plugin makes your coding agent write down what your PayPal API calls promise (no duplicate writes, unknown outcomes settled). EchoBench tests those promises against concurrent calls and dropped API responses, and tests the webhooks the plugin's table doesn't cover by replaying recorded PayPal deliveries duplicated, reordered, delayed or dropped, plus forgeries it crafts itself. It checks your app against PayPal's own records through the APIMatic SDK (plain REST stays as a switch to run the same scenario both ways; the sandbox checks are in VERIFY.md), then an AI step (Claude, mocked in the default run; two real runs from 2026-11-12 are recorded and replayable) explains each failure and writes a type-checked fix that EchoBench re-runs to green before it can be applied.

## Why

PayPal gives developers two test tools for webhooks. The simulator sends mock events that "do not belong to any App and can be generated on demand purely for development and testing purposes", and postback verification "is not supported for mock events" ([PayPal webhooks docs](https://developer.paypal.com/api/rest/webhooks/rest/)); it sends a sample payload, not your shop's orders. The resend API ([Webhooks v1](https://developer.paypal.com/docs/api/webhooks/v1/)) re-delivers one real event at a time and does not tell you whether your shop ended up right. Meanwhile a listener that does not answer 2xx gets each delivery retried "up to 25 times over 3 days" (same docs page), so repeats are normal traffic. Between the two there is nothing that asks: *does my real order flow still end up the same as PayPal's records when events repeat, arrive in another order, or go missing?* Developers find out from a duplicate order in production, for example [woocommerce-paypal-payments #4173](https://github.com/woocommerce/woocommerce-paypal-payments/issues/4173) or [opencollective #5644](https://github.com/opencollective/opencollective/issues/5644) (a 2022 record of two transactions 0.07 s apart).

## Run it (no keys needed)

Node 22.18 or newer.

```
npm install
npm run build        # the UI; skip it and use "npm run dev:client" while developing
npm start            # http://127.0.0.1:3101
npm test
```

With no keys, PayPal is a **local stand-in** (response shapes follow the Orders v2, Payments v2 and Webhooks v1 docs and it signs its webhooks the way PayPal does) and the AI step is **mocked model output**. The header says so in two badges. What is real even then: the replay engine, the state resets, the judge, the contract reader, the proxy that cuts replies, `tsc` on the patch, and the re-runs.

## Testing instructions (about 3 minutes)

`npm start` as above, or `npm run demo:video` for a clean start (empty `data/video`, planted MugShop, stand-in and no key; the state the video in `docs/VIDEO_SCRIPT.md` is recorded in).

1. Open the app. The target is **MugShop (planted bugs)**: a small shop whose webhook handler has three bugs put there on purpose (list below). The built-in recording is one purchase with two partial refunds and a dispute, recorded against the local PayPal stand-in (the first screen says so).
2. Press **Shake all**. The first screen shows two lines, PayPal's records on top and the shop's books under them, with the broken cells in red, and three rows: *the mug shipped twice*, *PayPal refunded 12.00 but the shop books 8.00*, *forged events were rejected*.
3. Click the first row. The card shows each rule's verdict and the evidence. Press **Explain and fix**: without a key this replays a recorded real Claude Sonnet run (labeled "Recorded run", see "The AI step"; the S5b row has its own recording). The AI step reads the failure, the recorded event and the handler, tries a patch on a copy, runs `tsc`, then re-runs the scenario and all others on the copy. Read the plain-words cause and the diff.
4. Press **Apply to the MugShop working copy**, then **Shake all** again. It goes green and the target is now called **MugShop (your patched copy)**. (The repository's source is never edited; the working copy is under `data/workspace`.) To go back to the red start, press **Reset to planted bugs** next to Shake all: one click restores the three bugs. A hosted copy can start every process from the planted source with `RESET_WORKSPACE_ON_START=1`.
5. Open the **Contract** tab. At the top it shows what was **measured on the real PayPal sandbox on 2026-11-12** (labeled "not re-run now"), then a side-by-side of the plan's promises on MugShop and on **MugShop (contract removed, contrast)**: without the plan's refund claim the same refund asked from the admin page and then from the support desk becomes two PayPal refunds (red), with it one (green); the same pair was run on real sandbox payments with the same result (V5b). Below that it reads `paypal-plan.md` at the app root (written to the APIMatic plugin's plan layout) and shows, row by row, what EchoBench proved. Press **Run C-UNK**: a confirmation card shows amount, capture id and who runs it. After Run, the proxy forwards the refund to PayPal (the local stand-in in the default run) and cuts the reply. The result card shows what the proxy saw without opening anything: the same `PayPal-Request-Id` on both sends, the SDK's different `Idempotency-Key`, and one refund at PayPal. **Run C-UNK-CAPTURE** does the same for `captureOrder` on the stand-in.
6. The **Recording** tab has **Start recording** and **Finish recording** buttons (the same API the scripts use). In the default run PayPal is the stand-in, so the built-in recording is the one to use; real recordings need VERIFY.md V1.
7. **Inbound events table** is EchoBench's own proposal for the webhooks the plugin's table does not cover; for MugShop it is filled in from MugShop's code (the tables and the handler lines that reject a second event). **A/B and EverShop** shows R2: two handlers generated on 2026-11-12 by Claude Code from one request text, once without and once with the APIMatic Context Plugin loaded, each run on its own recording of the same purchase (local stand-in). The model did not open a plugin skill in the plugin-on run, so the two columns compare two handlers, not the plugin. EverShop (R1) is not run.

## Sandbox demo mode

The default is the local stand-in (no keys). To run the real sandbox flow, for example on a deployed server:

1. Put sandbox `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env` (and `FORCE_MOCK=0`). The header chip then says "PayPal: sandbox"; the server refuses any `PAYPAL_BASE_URL` that is not a PayPal sandbox host.
2. Make sandbox contract payments: `ECHOBENCH_ALLOW_SANDBOX=1 BUYER_RUN=<a script that puts SANDBOX_BUYER_EMAIL and SANDBOX_BUYER_PASSWORD in the environment> npm run sandbox:contract -- mugshop-reference:C-UNK mugshop-contrast:C-DUP`. For each pair it buys one mug through MugShop, approves it as the sandbox buyer in headless Chromium (`scripts/approve-buyer.py`, Python Playwright), captures it on MugShop's return path, saves that capture as the contract payment of a new recording and runs the scenario once. Each run refunds 4.00 or 8.00 of fake sandbox money.
3. Start the app. In sandbox mode the recording picker opens on the newest sandbox recording; the Contract tab's Run C-UNK / Run C-DUP buttons (after the confirmation card) refund 4.00 from that recording's real capture and show the real refund ids.
4. Webhook scenarios (S0 to D1) need recorded real deliveries, which need a public URL (VERIFY V1). Until then they answer `na` on a sandbox recording, and a recording made on the stand-in answers `na` in sandbox mode instead of failing.

## Sandbox evidence

Measured on the PayPal sandbox on 2026-11-12 (VERIFY.md "Sandbox results"; the app shows the same list in the Contract tab as "Measured on the PayPal sandbox, not re-run now", from `builtin/sandbox-evidence.json`):

| Id | Result | What it showed |
|---|---|---|
| V4 | PASS | The SDK read equals the plain REST read of the same order; MugShop's SDK capture returns the captures. Found: `captureOrder` without a body gets 415 |
| V5 | PASS | The same `PayPal-Request-Id` returned the same refund id (201, then 200), one refund on the order |
| V5b | 5 runs | Contract tab promises on real sandbox payments through the reply-cutting proxy (`npm run sandbox:contract`). C-UNK: MugShop GREEN (cut reply, same `PayPal-Request-Id` re-sent, PayPal answered 200 with refund 8DH51725TN890892T, one refund), contrast RED (refund 98G44114MT935673U at PayPal, the shop reported failure). C-DUP: MugShop GREEN (one refund 3R834948FC525115M), contrast RED (two refunds 0YV80846AW8891156 and 2TE88129DT787735B for one request). Found: two refund requests that overlap at PayPal get 409 `PREVIOUS_REQUEST_IN_PROGRESS` from the sandbox, so C-DUP now sends them one after the other |
| V8 | PASS | A real contract payment recorded for Contract tab runs |
| V11 | PASS | SDK smoke reads work; a made-up order id decodes as a typed PayPal 404 |

Not run on the sandbox: V1 to V3, V6, V7, V9 (public URL). The webhook scenarios therefore still run on the local stand-in's recording. V10 (the AI step) passed in account mode, which is not a sandbox item.

## What each scenario does

Every scenario first stops the target, restores its database from a saved **start point**, starts it again and checks the state equals the start point. If it does not, nothing is run ("Reset failed"). This is what stops a handler from looking fine only because the order was already finished.

| Id | Starts at | Does | Judged by |
|---|---|---|---|
| S0 | SP0 order approved, nothing processed | the recorded purchase in order (control) | I1 |
| S1 | SP0 | capture event delivered twice | I1 |
| S2 | SP0 | capture event delivered twice at the same time | I1 |
| S3 | SP0 | capture event before the approval event | I1, I4 |
| S4 | SP0 | approval event races the buyer's return | I1, I4 |
| S5 | SP2 first refund booked | second refund event dropped | I5 |
| S5b | SP1 capture booked | refund 4.00 then 8.00 | I2 |
| S6 | SP3 final | body changed after signing; simulator-style event; event signed by a certificate that is not PayPal's | I3 |
| S7 | SP3 | original capture event delivered again | I6 |
| D1 | SP0 | dispute event before the capture event | I8 |
| C-DUP | SPC a captured, unrefunded payment | the same refund from the admin page, then from the support desk | I7 |
| C-UNK | SPC | refund sent, reply cut | I7 |
| C-DUP-CAPTURE | SP0 | two return paths at once (shop side only) | I7 |
| C-UNK-CAPTURE | SP0 | capture sent, reply cut, the app must read the order back (local stand-in only: the order is rewound for the run and put back; `na` on the sandbox) | I7 |

Rules: **I1** one shipment per captured payment and never before the capture. **I2** shop refunds equal PayPal's refunds (count and total). **I3** forged events change nothing. **I4** the final state does not depend on delivery order. **I5** after a missed event the books match PayPal within `SETTLE_WINDOW_MS`. **I6** an old re-delivery changes nothing (processed = fail, accepted but ignored = warning, rejected = pass). **I7** the contract promise holds. **I8** an order with an open dispute is held, not shipped.

Judging looks at state, never at HTTP status codes alone. PayPal's records cannot be rewound, so a handler that re-reads PayPal sees the final state; every result says so.

## MugShop's planted bugs

All three live in `targets/mugshop/src/webhook.ts` and are marked `PLANTED BUG`. Details and the scenarios that catch each are in `targets/mugshop/README.md`.

- **A** the capture handler ships unconditionally (no event-id check, no already-shipped check, no dispute hold)
- **B** the approval handler ships before the money is captured
- **C** the refund handler keeps one refund per order and overwrites it, and nothing reconciles with PayPal

MugShop's signature check, return path, refund claims and retry are written correctly, so S6, C-DUP and C-UNK come out green. A copy of the handler that downloads whatever `cert_url` says would be caught by S6; the test suite shows that.

## How APIMatic is used

- **Plugin output as input.** `server/contract/parser.js` reads `paypal-plan.md` tables by their header names (DUPLICATE CLAIMS, UNKNOWN OUTCOMES, CROSS-OPERATION INVARIANTS, names in `server/contract/headers.js`). Rows become tests. EchoBench never edits the plan: it writes a copy with its own column, "Proven by EchoBench". CROSS-OPERATION INVARIANTS are shown, not tested. A write with no way to find it again, or a `getRefund` re-read whose refund id was inside the lost reply, is shown as a Blocker, as the plugin's own rule says. `TBD` cells and names that do not exist in the code are listed.
- **SDK as judge and fault injector.** The judge reads PayPal's records through `server/truth.js`, which has no write call, with `client.orders.getOrder` and `client.payments.getCapturedPayment` of the APIMatic-generated SDK (package `paypal`, installed from git, see below). MugShop's own PayPal calls (`createOrder`, `captureOrder`, `getOrder`, `getCapturedPayment`, `refundCapturedPayment`) go through the same SDK in `targets/mugshop/src/paypalSdk.ts`. Cutting a reply works by pointing the SDK's `serverOptions.baseUrl` at EchoBench's proxy. The retry uses `payPalRequestId`. The SDK also adds its own `Idempotency-Key` to every non-GET call, minted per call, which is not the `PayPal-Request-Id` header PayPal uses to recognise a repeated request; C-UNK checks the app stores and re-sends the latter, and the proxy log shows both headers.
- **Both adapters, same scenario.** `PAYPAL_CLIENT_IMPL=rest` switches the judge and MugShop to plain `fetch` calls of the same endpoints. `test/adapters.test.js` runs C-DUP, C-UNK and S1 through both and requires the same verdicts. The header shows which client is active.
- **Honest status.** The tests run against a faked `fetch` and EchoBench's local PayPal stand-in. Measured on the PayPal sandbox on 2026-11-12: the SDK read equals the REST read of the same order (V4), MugShop's capture through the SDK returns the captures with `Prefer: return=representation` (V4), a repeated `PayPal-Request-Id` returns the same refund and creates no second one (V5, first half), and the SDK smoke reads work and a 404 decodes as a PayPal error (V11). The results are in `builtin/sandbox-evidence.json` and in the Contract tab. One finding from the sandbox: the SDK map lists the `captureOrder` body as optional, but without a body the SDK sends no Content-Type and the sandbox answers 415 UNSUPPORTED_MEDIA_TYPE; passing `body: {}` fixes it. The SDK has no Webhooks resource, so Webhooks v1 is called as REST (`server/webhooksRest.js`) and webhook signatures are verified in code. `paypal-plan.md` was written by Claude Code following the plugin's `typescript-integrate-paypal` skill (plugin 0.4.1 installed); the plugin-off / plugin-on comparison is VERIFY.md R2.

## Built with the APIMatic Context Plugin

- **Skills used**: `typescript-integrate-paypal`, `typescript-getting-started`, `typescript-error-handling`, `typescript-client-initialization`, `typescript-authentication`, `typescript-calling-endpoints`, `typescript-models`, `typescript-configuration-resilience`, `typescript-testing`.
- **SDK**: package `paypal` (APIMatic-generated, 2.29.0). It is not on npm: `npm install git+https://github.com/context-plugins/paypal-typescript-sdk#main` (already in `package.json`; the install builds it and `package-lock.json` pins the commit). Every call was written from the SDK map shipped inside `node_modules/paypal/`.
- **Through the SDK**: Orders `createOrder`, `captureOrder`, `getOrder`; Payments `getCapturedPayment`, `refundCapturedPayment`.
- **Kept on REST**: Webhooks v1 (register, list, resend, simulate-event: `server/webhooksRest.js`) and webhook signature verification (`targets/mugshop/src/signature.ts`). The SDK has no Webhooks resource.
- **Contract sheet**: [`paypal-plan.md`](paypal-plan.md) (DUPLICATE CLAIMS, UNKNOWN OUTCOMES, CROSS-OPERATION INVARIANTS, OPTIONAL FIELDS, WHEN THE API SAYS NO, host, retry and logging decisions, blockers). The SDK adapter tests are `test/sdk-adapter.test.js` and `test/sdk-truth.test.js`, with a faked `fetch` (duplicate claim and lost reply for each durable write).
- Sandbox results: VERIFY.md (V4, V5 first half, V8, V11 PASS; V1 to V3, V6, V7, V9 not run; V10 was run through a local Claude Code account, not the hosted API).

## The AI step

`server/agent/` is a tool loop (same shape as the Claude loop in the CartPilot entry). Tools: `get_timeline`, `get_failures`, `get_delivery`, `read_contract`, `read_handler_file` (only `src/*.ts` of the copy), `lookup_sdk`, `paypal_truth` (read-only), `run_scenario` (webhook scenarios only, on the patched copy), `check_invariants`, `propose_patch` (applied to a **copy**, `tsc` must pass, at most 3 attempts). There is no PayPal write tool and no way to run the money-moving contract scenarios. Amounts are constants in code. `verified` is computed by the server: after the model finishes, EchoBench re-runs the failing scenario and the whole webhook suite on the patched copy itself, and ignores what the model says about its fix. The screen shows the model's own text, labeled with the model name, in live mode. **Apply** needs a verified patch and `confirm: true`, and copies the files into the working copy, not into the repository.

Three backends, same prompt, same tools, same output shape:

- **mock** (default): a mocked agent follows the same tool sequence with canned explanation text, labeled as scripted, and the reference fix, so the type check and re-runs are real. Also used if a live call fails (the card says so).
- **account** (`LLM_BACKEND=account`): `server/agent/accountAgent.js` runs the loop through the Claude Agent SDK with the developer's Claude Code login. The Anthropic API key and token are removed from the environment of that process and the key is never read. The badge says "Claude Sonnet (local account)". Local use only.
- **api** (`ANTHROPIC_API_KEY`): the loop in `server/agent/claudeAgent.js` over the Anthropic API. Not run for this entry (VERIFY.md V10 was run in account mode).

**Recorded runs.** `npm run verify-model -- <scenario> --record` runs one real diagnosis (account mode) against the local stand-in and saves it as `builtin/recorded-runs/<scenario>.json`: the model's own text, its tool order with the time of each call, its edits and the model time. Two runs ship with the app, both Claude Sonnet through a local Claude Code account on 2026-11-12: S1 (`builtin/live-diagnosis.json`, 23 tool calls, saved before per-call times were kept) and S5b (`builtin/recorded-runs/S5b.json`, 25 tool calls, 39 s of model time). Without a key, "Explain and fix" on S1 or S5b replays the matching file and labels it "Recorded run: Claude Sonnet (local account), 2026-11-12"; the header says "AI: recorded run ... other scenarios mocked". The edits are applied to a copy and type-checked, and the scenario and the suite are re-run by this server each time, so `verified` is never taken from the recording. If the edits no longer fit the file, the scripted agent runs instead and says so. Results computed ahead of time are in `builtin/precomputed.json` and marked "precomputed".

## Safety

- Sandbox and local stand-in only. With credentials, the server refuses to start unless `PAYPAL_BASE_URL` is exactly `https://api-m.sandbox.paypal.com` or `https://api.sandbox.paypal.com` (a strict host check, not a substring match); in mock mode the URL is never used. `scripts/verify-sandbox.js` applies the same check and does nothing without `ECHOBENCH_ALLOW_SANDBOX=1`.
- Exposed through a tunnel, set `ECHOBENCH_ACCESS_TOKEN`: then only `POST /hooks/paypal` is open and every other route needs the token (see VERIFY.md).
- Money moves only in the two contract scenarios, only after a confirmation card (amount, capture id, who) that works once and expires in 5 minutes. The amount is a constant (4.00).
- The receiver always answers PayPal 2xx. What your handler answers is recorded separately.
- Forged events are made with EchoBench's own test keys (`fixtures/keys`, test material only, no secrets). They need the webhook id your handler verifies against, which you, the developer, know. They do not imitate PayPal's signing key.
- Targets run on `127.0.0.1` as child processes; a model patch can touch only the handler files (`webhook.ts`, `checkout.ts`, `refunds.ts`, `events.ts`, `money.ts`, `signature.ts`) of a copy, never the adapter the judge reads, the configuration or the PayPal client. The patched copy runs without the Anthropic key and without PayPal credentials in its environment (the proxy adds the credentials to the token request). It can still call PayPal through the proxy like any handler, in the sandbox; "the model never moves money" is about the tools it has. The lab does not fetch arbitrary URLs.

## Layout

```
server/            Express app, lab wiring, recorder, scenarios, judge (oracle.js), contract reader, agent, local PayPal stand-in
client/            React 19 + Vite UI
targets/mugshop/   the sample shop (TypeScript, runs with Node's type stripping) and its fix; its contract sheet is paypal-plan.md at the app root
targets/evershop/  R1 harness notes (EverShop itself is downloaded, not included)
targets/ab/        R2 notes (agent-built handlers go here)
builtin/           the built-in recording (raw bytes, start-point databases) and precomputed results
scripts/           seed, precompute, run-ab, verify-sandbox, sdk-smoke, install-evershop
test/              node:test suites
```

## Environment

See `.env.example`. All optional.

| Variable | Default | Meaning |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | empty | Sandbox credentials. Empty = local stand-in |
| `PAYPAL_WEBHOOK_ID` | `WH-MOCK-0001` | Id of the webhook registered for `/hooks/paypal` |
| `PAYPAL_CLIENT_IMPL` | `sdk` | `sdk` = the APIMatic SDK for the judge and MugShop. `rest` = plain fetch, to run a scenario through both |
| `LLM_BACKEND` | empty | `account` = run the AI step through the local Claude Code login (the API key is not read). Empty = `api` if `ANTHROPIC_API_KEY` is set, else mocked |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | empty, `claude-sonnet-5-5` | Live diagnosis over the API. Empty = mocked |
| `RESET_WORKSPACE_ON_START` | `0` | `1` = every start begins from the planted MugShop (for a hosted demo) |
| `FORCE_MOCK` | `0` | `1` = stand-in and mocked model even if keys are present |
| `SETTLE_WINDOW_MS` | 6000 | How long S5 waits for the books to catch up |
| `PORT`, `PUBLIC_URL`, `DATA_DIR` | 3101, local, `./data` | Server. `DATA_DIR` can be anywhere |
| `ECHOBENCH_ACCESS_TOKEN` | empty | When set, every route except `POST /hooks/paypal` needs the token |
| `ECHOBENCH_OPERATOR` | `you` | Name shown on confirmation cards and apply records |
| `EVERSHOP_*` | empty | R1, see `targets/evershop/README.md` |

## What is not done yet

Listed in `VERIFY.md` with how to run each. Not run yet: V1 to V3, V6, V7, V9 (they need a public URL), the hosted-API path of the AI step and R1 (EverShop). R2 was run once (see the A/B tab); the plugin-on model did not use the plugin's skills. Until they are run, the built-in results come from the local stand-in and say so. Next steps after this submission: R1, a resend mode (after V2 says how fast and how signed a resend is), and a CI check.

## License

MIT. Test keys in `fixtures/keys` are throwaway test material. EverShop (GPL-3.0) is never copied into this repository.
