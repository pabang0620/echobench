import express from 'express'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { APP_ROOT } from '../config.js'
import { HttpError, idSchema, parse } from '../http.js'
import { checkCodeNames, parsePlan } from '../contract/parser.js'
import { annotatedPlan, contractRows } from '../contract/annotate.js'
import { inboundTable } from '../contract/inbound.js'
import { mugshopCells } from '../contract/inboundMugshop.js'
import { CONTRACT_REFUND_AMOUNT, SCENARIOS, scenarioById } from '../scenarios/definitions.js'
import { runScenario } from '../scenarios/engine.js'
import { targetView } from '../targets/view.js'

const COMPARE_TARGETS = ['mugshop', 'mugshop-contrast']
const COMPARE_SCENARIOS = [
  { id: 'C-DUP', title: 'Duplicate claim: the same refund from two code paths' },
  { id: 'C-UNK', title: 'Unknown outcome: refund reply cut' },
  { id: 'C-UNK-CAPTURE', title: 'Unknown outcome: capture reply cut (stand-in only)' },
]
const ok = (res, data) => res.json({ success: true, data })
const CARD_TTL_MS = 5 * 60 * 1000
// The contract sheet written for the APIMatic Context Plugin's skills. Code references in it are relative to targets/mugshop.
const PLAN_FILE = path.join(APP_ROOT, 'paypal-plan.md')
const PLAN_CODE_ROOT = path.join(APP_ROOT, 'targets', 'mugshop')

function latestByScenario(runs) {
  const latest = {}
  for (const run of runs) if (!latest[run.scenarioId]) latest[run.scenarioId] = run
  return latest
}

export function contractRouter(lab, { runTargetId = (id) => id, runsFor = (recordingId, targetId) => lab.store.listRuns({ recordingId, targetId }), viewFor = (t) => targetView(t) } = {}) {
  const router = express.Router()
  const cards = new Map()
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next)

  const query = z.object({ recordingId: idSchema, targetId: idSchema })

  router.get('/contract', (req, res) => {
    const { recordingId, targetId } = parse(query, req.query)
    const planFile = targetId.startsWith('mugshop') ? PLAN_FILE : path.join(APP_ROOT, 'targets', 'ab', targetId.replace(/^ab-/, ''), 'paypal-plan.md')
    if (!existsSync(planFile)) return ok(res, { available: false, reason: 'This target has no paypal-plan.md, so only the webhook scenarios apply.' })
    const markdown = readFileSync(planFile, 'utf8')
    const parsed = parsePlan(markdown)
    const results = latestByScenario(runsFor(recordingId, targetId, req.visitor))
    const missing = checkCodeNames(parsed, planFile === PLAN_FILE ? PLAN_CODE_ROOT : path.dirname(planFile))
    ok(res, {
      available: true,
      file: path.relative(APP_ROOT, planFile),
      rows: contractRows(parsed, results, missing),
      tbd: parsed.tbd,
      blockers: parsed.blockers,
      annotated: annotatedPlan(markdown, parsed, results),
      note: 'Read-only. EchoBench adds its own "Proven by EchoBench" column to a copy. CROSS-OPERATION INVARIANTS are shown, not tested.',
    })
  })

  // Recorded sandbox results (builtin/sandbox-evidence.json). Shown with its date, never as a live check.
  router.get('/sandbox-evidence', (_req, res) => {
    const file = path.join(lab.cfg.builtinDir, 'sandbox-evidence.json')
    ok(res, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)
  })

  // The same contract promises on MugShop (the plan's claim kept) and on the contrast copy (claim and retry off).
  router.get('/contract/compare', (req, res) => {
    const { recordingId } = parse(z.object({ recordingId: idSchema }), req.query)
    const ids = COMPARE_SCENARIOS.map((s) => s.id)
    const columns = COMPARE_TARGETS.filter((id) => lab.targets.has(id)).map((id) => {
      const latest = latestByScenario(runsFor(recordingId, id, req.visitor))
      return {
        id,
        label: viewFor(lab.target(id), req.visitor).label,
        results: Object.fromEntries(ids.filter((s) => latest[s]).map((s) => [s, { status: latest[s].status, headline: latest[s].headline, runId: latest[s].id, precomputed: Boolean(latest[s].precomputed) }])),
      }
    })
    ok(res, { scenarios: COMPARE_SCENARIOS, columns, note: "The contrast copy is MugShop's reference fix with the plan's refund claim and retry switched off. It is not a planted bug; it shows what the Contract tab turns red." })
  })

  router.get('/inbound', (req, res) => {
    const { recordingId, targetId } = parse(query, req.query)
    const view = targetId.startsWith('mugshop') ? targetView(lab.visitors.resolve(targetId, req.visitor)) : null
    const handler = !view ? null : view.patched ? 'patched' : view.variant === 'planted' ? 'planted' : 'fixed'
    ok(res, inboundTable(latestByScenario(runsFor(recordingId, targetId, req.visitor)), mugshopCells(handler)))
  })

  // Step 1 of a contract run that moves sandbox money: build the card a person must confirm.
  const cardSchema = z.object({ scenarioId: z.enum(['C-DUP', 'C-UNK']), recordingId: idSchema, targetId: idSchema })
  router.post('/contract/cards', wrap(async (req, res) => {
    const { scenarioId, recordingId, targetId } = parse(cardSchema, req.body)
    const scenario = scenarioById(scenarioId)
    const recording = lab.store.getRecording(recordingId)
    if (!recording?.contract) throw new HttpError(409, 'This recording has no captured, unrefunded payment for contract runs')
    const ownTargetId = runTargetId(targetId, req.visitor)
    const ledger = await lab.truth.order(recording.contract.orderId)
    const capture = ledger.captures[0]
    const refunded = ledger.refunds.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0)
    const attempts = scenarioId === 'C-DUP' ? 2 : 1
    const remaining = Math.round(Number(capture.amount) * 100) - refunded
    if (remaining < Math.round(Number(CONTRACT_REFUND_AMOUNT) * 100) * attempts) {
      throw new HttpError(409, 'The contract payment has too little left to refund. Record a new contract payment first.')
    }
    const card = {
      token: randomUUID(),
      scenarioId,
      title: scenario.title,
      recordingId,
      targetId: ownTargetId,
      amount: CONTRACT_REFUND_AMOUNT,
      currency: 'USD',
      attempts,
      captureId: capture.id,
      orderId: recording.contract.orderId,
      operator: lab.cfg.operator,
      environment: lab.cfg.mode === 'mock' ? 'Local PayPal stand-in (no real money, no sandbox)' : 'PayPal sandbox (fake money)',
      text: `${lab.cfg.mode === 'mock' ? 'Mock refund (local PayPal stand-in)' : 'Sandbox refund'} of ${CONTRACT_REFUND_AMOUNT} USD ${scenarioId === 'C-DUP' ? 'is requested from the admin page and then again from the support desk.' : 'is sent; the reply is cut on the way back.'} Capture ${capture.id}.`,
      expiresAt: new Date(Date.now() + CARD_TTL_MS).toISOString(),
    }
    cards.set(card.token, card)
    ok(res, card)
  }))

  // Step 2: only a person pressing Run on an unexpired card gets here. A card works once.
  router.post('/contract/cards/:token/run', wrap(async (req, res) => {
    const token = parse(z.string().uuid(), req.params.token)
    const card = cards.get(token)
    if (!card) throw new HttpError(404, 'This confirmation card does not exist or was already used')
    cards.delete(token)
    if (Date.parse(card.expiresAt) < Date.now()) throw new HttpError(410, 'This confirmation card expired')
    const scenario = SCENARIOS.find((s) => s.id === card.scenarioId)
    const recording = lab.store.getRecording(card.recordingId)
    const target = lab.visitors.resolve(card.targetId, req.visitor)
    const run = await lab.exclusive(() => runScenario({ lab, scenario, recording, target }))
    run.confirmedBy = card.operator
    run.card = { amount: card.amount, captureId: card.captureId, environment: card.environment }
    lab.store.saveRun(run)
    ok(res, run)
  }))

  router.delete('/contract/cards/:token', (req, res) => {
    cards.delete(req.params.token)
    ok(res, { cancelled: true })
  })

  return router
}
