import path from 'node:path'
import { evaluate, overallStatus } from '../oracle.js'
import { fingerprint, sameFingerprint } from '../targets/processSqlite.js'
import { newId } from '../store.js'
import { buildProxyStory } from './proxyStory.js'
import { buildTimeline } from './timeline.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cents = (v) => Math.round(Number(v) * 100)

function booksMatch(state, ledger) {
  const shop = state.refunds.reduce((sum, r) => sum + cents(r.amount), 0)
  const paypal = ledger.refunds.reduce((sum, r) => sum + cents(r.amount), 0)
  return shop === paypal && state.refunds.length === ledger.refunds.length
}

function skeleton(scenario, recording, target) {
  return {
    id: newId('run'),
    scenarioId: scenario.id,
    title: scenario.title,
    kind: scenario.kind,
    rules: scenario.rules,
    targetId: target.id,
    recordingId: recording.id,
    startPoint: scenario.startPoint,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: 'error',
    headline: '',
    verdicts: [],
    deliveries: [],
    resetOk: false,
    notes: [],
  }
}

// Runs one scenario: reset the target to the start point, check it really is there, act, then
// compare the target's books with PayPal's records.
export async function runScenario({ lab, scenario, recording, target }) {
  const run = skeleton(scenario, recording, target)
  const started = Date.now()
  const finish = (patch) => Object.assign(run, patch, { durationMs: Date.now() - started })

  if (scenario.requires?.dispute && !recording.extras?.dispute) {
    return finish({ status: 'na', headline: 'This recording has no dispute event' })
  }
  if (scenario.requires?.returnPath && !target.capabilities.returnPath) {
    return finish({ status: 'na', headline: 'This target has no buyer return path to race' })
  }
  if (scenario.requires?.refunds && !target.capabilities.refunds) {
    return finish({ status: 'na', headline: 'This target has no refund entry point EchoBench can call' })
  }
  if (scenario.requires?.freshCapture && !lab.mock) {
    return finish({ status: 'na', headline: 'This scenario needs an approved, uncaptured order. Only the local stand-in can rewind one; the sandbox cannot un-capture an order' })
  }
  if (scenario.kind === 'contract' && scenario.startPoint === 'SPC' && !recording.contract) {
    return finish({ status: 'na', headline: 'This recording has no contract fixture (a captured, unrefunded payment)' })
  }

  const isContract = scenario.startPoint === 'SPC'
  const start = isContract ? { ...recording.contract, fingerprint: recording.contract.fingerprint } : recording.startPoints[scenario.startPoint]
  const orderId = isContract ? recording.contract.orderId : recording.orderId
  if (!start) return finish({ status: 'error', headline: `The recording has no start point ${scenario.startPoint}` })

  // 1. reset
  await target.restore(path.join(recording.dir, start.file))
  const stateStart = await target.readState(orderId)
  const reachedStart = start.fingerprint ? sameFingerprint(fingerprint(stateStart), start.fingerprint) : true
  run.resetOk = reachedStart
  if (!reachedStart) {
    return finish({ status: 'error', headline: `Reset failed: the target is not at ${scenario.startPoint}, so nothing was run`, stateStart })
  }

  // 2. act
  const rewound = scenario.requires?.freshCapture ? await lab.rewindOrder(orderId) : null
  const putLedgerBack = async () => {
    if (rewound) await lab.restoreOrder(rewound)
  }
  const ledgerBefore = await lab.truth.order(orderId)
  lab.proxy.disarm()
  lab.proxy.clearLog()
  const sent = []
  const droppedLabels = []
  const windowMs = lab.settleWindowMs
  const byLabel = Object.fromEntries([...recording.deliveries, ...(recording.extras?.dispute ? [recording.extras.dispute] : [])].map((d) => [d.label, d]))

  const ctx = {
    contract: recording.contract,
    mockKeyPem: lab.mockKeyPem,
    webhookId: recording.webhookId,
    publicUrl: lab.localUrl || lab.publicUrl,
    delivery(label) {
      if (!byLabel[label]) throw new Error(`The recording has no "${label}" delivery`)
      return byLabel[label]
    },
    async send(label, { tag } = {}) {
      const d = ctx.delivery(label)
      const res = await target.postWebhook(d.headers, Buffer.from(d.bodyBase64, 'base64'))
      sent.push({ label: tag || label, status: res.status, body: res.body, ms: res.ms })
      return res
    },
    async sendForged(forged, skipReason) {
      if (!forged) {
        sent.push({ label: skipReason, status: 0, skipped: true })
        return
      }
      const res = await target.postWebhook(forged.headers, forged.body)
      sent.push({ label: forged.label, status: res.status, body: res.body, ms: res.ms })
    },
    async returnPath(tag = 'return path') {
      if (!target.capabilities.returnPath) {
        sent.push({ label: `${tag} (skipped: target has none)`, status: 0, skipped: true })
        return { status: 0 }
      }
      const res = await target.returnPath(orderId)
      sent.push({ label: tag, status: res.status, body: res.body })
      return res
    },
    async refund(pathName, body) {
      const res = await target.refund(pathName, body)
      sent.push({ label: `${pathName} refund`, status: res.status, body: res.body })
      return res
    },
    armCut(pattern = /\/refund$/) {
      lab.proxy.arm({ method: 'POST', pattern, times: 1 })
    },
    dropped(label) {
      droppedLabels.push(label)
      sent.push({ label: `${label} (dropped, never delivered)`, status: 0, dropped: true })
    },
    async waitForBooksToMatch() {
      const deadline = Date.now() + windowMs
      while (Date.now() < deadline) {
        const [state, ledger] = await Promise.all([target.readState(orderId), lab.truth.order(orderId)])
        if (booksMatch(state, ledger)) return
        await sleep(150)
      }
    },
  }

  try {
    await scenario.run(ctx)
    await sleep(150)
  } catch (err) {
    await putLedgerBack()
    return finish({ status: 'error', headline: `The scenario could not run: ${err.message}`, deliveries: sent })
  }

  // 3. judge
  const after = await target.readState(orderId)
  const ledger = await lab.truth.order(orderId)
  const knownBefore = new Set(ledgerBefore.refunds.map((r) => r.id))
  const ledgerNew = ledger.refunds.filter((r) => !knownBefore.has(r.id))
  const proxyLog = lab.proxy.log.map((p) => ({ method: p.method, path: p.path, requestId: p.requestId, sdkKey: p.sdkKey, status: p.status, cut: p.cut }))
  const effectiveLedger = isContract ? { ...ledger, refunds: ledgerNew } : ledger
  const verdicts = evaluate(scenario.rules, {
    scenario,
    expect: scenario.expect || {},
    before: stateStart,
    after,
    ledger: effectiveLedger,
    ledgerNew,
    ledgerBefore,
    sent,
    proxyLog,
    windowMs,
  })
  lab.proxy.disarm()
  await putLedgerBack()
  if (isContract && scenario.movesMoney) await lab.afterContractRun?.(recording.contract)

  const status = overallStatus(verdicts)
  const firstBad = verdicts.find((v) => v.status === 'fail') || verdicts.find((v) => v.status === 'warn') || verdicts[0]
  return finish({
    status,
    headline: firstBad?.message || '',
    verdicts,
    deliveries: sent,
    stateStart,
    stateAfter: after,
    ledger: effectiveLedger,
    ledgerFinalNote: 'PayPal records cannot be rewound. A handler that re-reads PayPal sees the final state, not the start point.',
    proxyLog,
    timeline: buildTimeline({ ledger: effectiveLedger, after, verdicts, rules: scenario.rules, proxyLog }),
    proxyStory: scenario.kind === 'contract' ? buildProxyStory({ proxyLog, ledgerNew, ledger }) : null,
  })
}
