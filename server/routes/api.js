import express from 'express'
import { clientIp } from '../agent/liveLimit.js'
import { z } from 'zod'
import { llmBackendOf } from '../config.js'
import { ACCOUNT_LABEL } from '../agent/accountAgent.js'
import { recordedLabel } from '../agent/recorded.js'
import { HttpError, idSchema, parse } from '../http.js'
import { SCENARIOS, SHAKE_ALL_IDS, scenarioById } from '../scenarios/definitions.js'
import { runScenario } from '../scenarios/engine.js'
import { compositeTimeline } from '../scenarios/timeline.js'
import { applyDiagnosis, diagnose, getDiagnosis, listDiagnoses, resetWorkspace } from '../agent/index.js'
import { importPrecomputed } from '../precomputed.js'
import { targetView } from '../targets/view.js'
import { summarizeAb } from '../abSummary.js'
import { isVisitorCopyId, ownerTag } from '../visitors.js'
import { contractRouter } from './contract.js'
import { recordingsRouter } from './recordings.js'

const ok = (res, data) => res.json({ success: true, data })

function latestByScenario(runs) {
  const latest = {}
  for (const run of runs) if (!latest[run.scenarioId]) latest[run.scenarioId] = run
  return latest
}

function publicScenario(s) {
  const { run: _run, ...rest } = s
  return { ...rest, shakeAll: SHAKE_ALL_IDS.includes(s.id) }
}

export function apiRouter(lab) {
  const router = express.Router()
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next)

  router.get('/status', (_req, res) =>
    ok(res, {
      mode: lab.cfg.mode,
      llm: llmBackendOf(lab.cfg),
      llmLabel: llmBackendOf(lab.cfg) === 'account' ? ACCOUNT_LABEL : llmBackendOf(lab.cfg) === 'api' ? `Claude (${lab.cfg.anthropicModel}, API)` : null,
      recordedModel: recordedLabel(lab),
      sdk: lab.cfg.clientImpl,
      operator: lab.cfg.operator,
      settleWindowMs: lab.settleWindowMs,
      // Runs in progress or waiting: the lab does one scenario at a time.
      queued: lab.pending,
      note: lab.cfg.mode === 'mock' ? 'PayPal is the local stand-in. Add sandbox credentials to use the real sandbox.' : 'PayPal sandbox',
    }),
  )

  // Targets as this visitor sees them: "mugshop" is their own patched copy once they applied a patch.
  const shown = (visitor) => [...lab.targets.values()].filter((t) => t.meta?.variant !== 'candidate' && !t.meta?.visitor)
  const viewFor = (t, visitor) => (t.id === 'mugshop' ? { ...targetView(lab.visitors.resolve('mugshop', visitor)), id: 'mugshop' } : targetView(t))
  // Runs are stored under the id of the target that really ran (a visitor's copy has its own id).
  const runTargetId = (id, visitor) => (id ? lab.visitors.resolve(id, visitor).id : id)
  // Runs of what the visitor calls targetId, newest first. On a patched copy, the two scenarios that move money
  // (re-run only through a confirmation card) fall back to the shared copy's result, marked as from before the patch.
  const runsFor = (recordingId, targetId, visitor) => {
    const id = runTargetId(targetId, visitor)
    const own = lab.store.listRuns({ recordingId, targetId: id })
    if (!isVisitorCopyId(id)) return own
    const money = new Set(SCENARIOS.filter((s) => s.movesMoney).map((s) => s.id))
    const before = lab.store.listRuns({ recordingId, targetId: 'mugshop' }).filter((r) => money.has(r.scenarioId))
    return [...own, ...before.map((r) => ({ ...r, beforePatch: true, headline: `${r.headline} (result from before your patch; run it again from the Contract tab)` }))]
  }

  router.get('/targets', (req, res) => ok(res, shown(req.visitor).map((t) => viewFor(t, req.visitor))))

  router.get('/scenarios', (_req, res) => ok(res, SCENARIOS.map(publicScenario)))

  router.use(recordingsRouter(lab))
  router.use(contractRouter(lab, { runTargetId, runsFor, viewFor }))

  const runSchema = z.object({ scenarioId: idSchema, recordingId: idSchema, targetId: idSchema })

  async function execute({ scenarioId, recordingId, targetId }, visitor) {
    const scenario = scenarioById(scenarioId)
    if (!scenario) throw new HttpError(404, 'Unknown scenario')
    const recording = lab.store.getRecording(recordingId)
    if (!recording) throw new HttpError(404, 'Unknown recording')
    const target = lab.visitors.resolve(targetId, visitor)
    const run = await lab.exclusive(() => runScenario({ lab, scenario, recording, target }))
    lab.store.saveRun(run)
    return run
  }

  // Webhook scenarios, and contract scenarios that move no money. The ones that do go through the confirmation card.
  router.post('/runs', wrap(async (req, res) => {
    const input = parse(runSchema, req.body)
    const scenario = scenarioById(input.scenarioId)
    if (scenario?.movesMoney) throw new HttpError(403, 'This scenario moves sandbox money. Open a confirmation card first.')
    ok(res, await execute(input, req.visitor))
  }))

  router.post('/runs/all', wrap(async (req, res) => {
    const { recordingId, targetId } = parse(z.object({ recordingId: idSchema, targetId: idSchema }), req.body)
    const runs = []
    for (const scenarioId of SHAKE_ALL_IDS) runs.push(await execute({ scenarioId, recordingId, targetId }, req.visitor))
    ok(res, runs)
  }))

  router.get('/runs', (req, res) => {
    const { recordingId, targetId } = parse(z.object({ recordingId: idSchema.optional(), targetId: idSchema.optional() }), req.query)
    const own = lab.visitors.copyOf(req.visitor)?.id
    ok(res, lab.store.listRuns({ recordingId, targetId: runTargetId(targetId, req.visitor) }).filter((r) => !isVisitorCopyId(r.targetId) || r.targetId === own).slice(0, 100))
  })

  router.get('/runs/:id', (req, res) => {
    const run = lab.store.getRun(parse(idSchema, req.params.id))
    if (!run) throw new HttpError(404, 'Unknown run')
    ok(res, run)
  })

  // First screen: latest result per scenario, the headline run for the timeline, and the three rows to show.
  router.get('/overview', (req, res) => {
    const { recordingId, targetId } = parse(z.object({ recordingId: idSchema, targetId: idSchema }), req.query)
    const latest = latestByScenario(runsFor(recordingId, targetId, req.visitor))
    const list = SCENARIOS.map((s) => ({ scenario: publicScenario(s), run: latest[s.id] || null }))
    const done = list.filter((x) => x.run && x.run.kind === 'webhook')
    // One row per kind of problem: shipping first, then refund books, then the rest.
    const order = ['S1', 'S5b', 'S5', 'S0', 'S2', 'S3', 'S4', 'S7', 'D1']
    const reds = done.filter((x) => x.run.status === 'red').sort((a, b) => order.indexOf(a.scenario.id) - order.indexOf(b.scenario.id))
    const headline = reds[0]?.run || latest.S0 || done[0]?.run || null
    const topRows = [...reds.slice(0, 2), ...done.filter((x) => x.run.status === 'green' && x.scenario.id === 'S6').slice(0, 1)]
    ok(res, { scenarios: list, headlineRun: headline, timeline: compositeTimeline(latest) || headline?.timeline || null, timelineCaption: compositeTimeline(latest)?.caption || (headline ? `Scenario ${headline.scenarioId}: ${headline.title}` : ''), topRows: topRows.map((x) => ({ id: x.scenario.id, title: x.scenario.title, status: x.run.status, headline: x.run.headline, runId: x.run.id, precomputed: Boolean(x.run.precomputed) })) })
  })

  // Targets x scenarios: latest status of every scenario on every target that has runs (A/B and R1 tables).
  router.get('/matrix', (req, res) => {
    const { recordingId } = parse(z.object({ recordingId: idSchema.optional() }), req.query)
    const targets = shown(req.visitor)
    // An agent-built handler and EverShop keep their own database layout, so each is run on its own
    // recording of a purchase made inside it (<target>-demo).
    const ownRecordingOf = (id) => (lab.store.getRecording(`${id}-demo`) ? `${id}-demo` : null)
    const column = (id, label, group, ownRecording) => {
      const latest = latestByScenario(id === 'evershop' && !lab.targets.has('evershop') ? lab.store.listRuns({ recordingId: ownRecording, targetId: id }) : runsFor(ownRecording || recordingId, id, req.visitor))
      return { id, label, group, recordingId: ownRecording || recordingId, results: Object.fromEntries(Object.entries(latest).map(([k, r]) => [k, { status: r.status, headline: r.headline, runId: r.id }])) }
    }
    const columns = targets.map((t) => column(t.id, viewFor(t, req.visitor).label, t.meta?.group || null, t.meta?.variant === 'agent-built' || t.id === 'evershop' ? ownRecordingOf(t.id) : null))
    // EverShop (R1) results recorded by scripts/run-ab.js stay visible where EverShop is not installed.
    if (!lab.targets.has('evershop') && ownRecordingOf('evershop')) columns.push(column('evershop', 'EverShop 2.4.0, unmodified (recorded results)', 'evershop', 'evershop-demo'))
    ok(res, { scenarios: SCENARIOS.map((s) => ({ id: s.id, title: s.title })), columns, abSummary: summarizeAb(columns, SCENARIOS.map((s) => s.id)) })
  })

  const diagnoseSchema = z.object({ runId: idSchema })
  router.post('/agent/diagnose', wrap(async (req, res) => {
    const { runId } = parse(diagnoseSchema, req.body)
    ok(res, await diagnose(lab, { runId, visitor: req.visitor, ip: clientIp(req) }))
  }))
  router.get('/agent/for-run/:runId', (req, res) => {
    const runId = parse(idSchema, req.params.runId)
    ok(res, listDiagnoses(lab, runId, req.visitor))
  })
  router.get('/agent/:id', (req, res) => {
    const record = getDiagnosis(lab, parse(idSchema, req.params.id), req.visitor)
    if (!record) throw new HttpError(404, 'Unknown diagnosis')
    ok(res, record)
  })
  router.post('/agent/:id/apply', wrap(async (req, res) => {
    const { confirm } = parse(z.object({ confirm: z.boolean() }), req.body)
    ok(res, await applyDiagnosis(lab, { diagnosisId: parse(idSchema, req.params.id), confirm, operator: lab.cfg.operator, visitor: req.visitor }))
  }))
  router.get('/applies', (req, res) => ok(res, lab.store.listApplies().filter((a) => !a.owner || a.owner === ownerTag(req.visitor))))
  // Back to the planted bugs. A visitor with their own patched copy loses it (and its runs) and sees the shared
  // planted MugShop again. Without one: a fresh shared working copy, and the precomputed red results again.
  router.post('/targets/:id/reset-workspace', wrap(async (req, res) => {
    const targetId = parse(idSchema, req.params.id)
    if (targetId === 'mugshop' && lab.visitors.has(req.visitor)) {
      await lab.exclusive(() => lab.visitors.drop(req.visitor))
      return ok(res, { reset: true })
    }
    lab.visitors.resolve(targetId, req.visitor)
    await lab.exclusive(async () => {
      await resetWorkspace(lab, targetId)
      lab.store.deleteRuns({ targetId })
      importPrecomputed(lab)
    })
    ok(res, { reset: true })
  }))

  return router
}
