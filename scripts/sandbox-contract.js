import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../server/app.js'
import { createLab } from '../server/lab.js'
import { scenarioById } from '../server/scenarios/definitions.js'
import { runScenario } from '../server/scenarios/engine.js'

// Contract runs on the real PayPal SANDBOX (VERIFY V5 second half). Fake money only.
// For each (target, scenario) pair: buy one mug through that MugShop copy, the sandbox buyer approves it
// in headless Chromium (through the shared buyer lock), MugShop captures on its return path, the capture
// becomes the contract payment of a new recording, then the scenario runs through the reply-cutting proxy.
//   ECHOBENCH_ALLOW_SANDBOX=1 BUYER_RUN=<path to buyer-run.sh> node scripts/sandbox-contract.js
// Writes one JSON line per run to VERIFY_RESULTS.json (git-ignored) and the summary to .scratch/sandbox-contract.json.
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Pairs as <target>:<scenario> arguments; the default is the first set that was run.
const DEFAULT_PAIRS = ['mugshop-reference:C-UNK', 'mugshop-contrast:C-UNK', 'mugshop-contrast:C-DUP']
const PAIRS = (process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_PAIRS).map((p) => p.split(':'))

const lab = await createLab()
if (process.env.ECHOBENCH_ALLOW_SANDBOX !== '1' || lab.cfg.mode !== 'sandbox' || !process.env.BUYER_RUN) {
  await lab.stop()
  throw new Error('Refusing to run: needs ECHOBENCH_ALLOW_SANDBOX=1, sandbox credentials in .env and BUYER_RUN.')
}
const server = createApp(lab).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
lab.publicUrl = `http://127.0.0.1:${server.address().port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function approved(orderId) {
  for (let i = 0; i < 20; i += 1) {
    const order = await lab.truth.order(orderId)
    if (order.status === 'APPROVED') return true
    await sleep(1500)
  }
  return false
}

const summary = []
mkdirSync(path.join(APP, '.scratch'), { recursive: true })
try {
  for (const [targetId, scenarioId] of PAIRS) {
    const target = lab.target(targetId)
    await target.start({ fresh: true })
    lab.recorder.start({ name: `Sandbox contract payment for ${scenarioId} on ${targetId} (2026-11-12)`, targetId, source: 'live-sandbox', webhookId: lab.cfg.webhookId })
    const order = (await target.checkout({ sku: 'MUG-001', quantity: 1 })).body
    if (!order.approveUrl) throw new Error(`checkout gave no approve link: ${JSON.stringify(order)}`)
    const buyer = spawnSync(process.env.BUYER_RUN, ['python3', path.join(APP, 'scripts', 'approve-buyer.py'), order.approveUrl], { cwd: APP, encoding: 'utf8', timeout: 180000 })
    if (!(await approved(order.orderId))) throw new Error(`order ${order.orderId} not approved: ${buyer.stdout.trim()} ${buyer.stderr.trim().slice(-300)}`)
    const back = await target.returnPath(order.orderId)
    const state = await target.readState(order.orderId)
    if (!state.captures.length) throw new Error(`return path did not capture: ${JSON.stringify(back)}`)
    await lab.recorder.recordContractFixture({ orderId: order.orderId, captureId: state.captures[0].id, amount: order.amount })
    const rec = await lab.recorder.finish()
    const recording = lab.store.getRecording(rec.id)
    const run = await runScenario({ lab, scenario: scenarioById(scenarioId), recording, target })
    run.confirmedBy = 'scripts/sandbox-contract.js (sandbox runs approved by the user, SANDBOX_BRIEF)'
    run.card = { amount: '4.00', captureId: recording.contract.captureId, environment: 'PayPal sandbox (api-m.sandbox.paypal.com, fake money)' }
    lab.store.saveRun(run)
    const ledger = await lab.truth.order(order.orderId)
    const line = {
      step: 'V5b', at: new Date().toISOString(), targetId, scenarioId, recordingId: rec.id, runId: run.id, status: run.status, headline: run.headline,
      orderId: order.orderId, captureId: recording.contract.captureId, refundsOnPayPal: ledger.refunds.map((r) => ({ id: r.id, amount: r.amount })),
      shopRefunds: run.stateAfter?.refunds?.map((r) => r.id) || [],
      proxy: (run.proxyLog || []).filter((p) => /refund$/.test(p.path)).map((p) => ({ status: p.status, cut: Boolean(p.cut), requestId: p.requestId || null })),
    }
    writeFileSync(path.join(APP, 'VERIFY_RESULTS.json'), `${JSON.stringify(line)}\n`, { flag: 'a' })
    summary.push(line)
    process.stdout.write(`${targetId} ${scenarioId} ${run.status} ${run.headline}\n  order ${line.orderId} capture ${line.captureId} PayPal refunds ${line.refundsOnPayPal.map((r) => `${r.id} ${r.amount}`).join(', ')}\n`)
    await target.stop()
  }
} finally {
  writeFileSync(path.join(APP, '.scratch', 'sandbox-contract.json'), `${JSON.stringify(summary, null, 2)}\n`)
  server.close()
  await lab.stop()
}
