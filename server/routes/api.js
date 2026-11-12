import express from 'express'
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

  router.get('/targets', (_req, res) =>
    ok(res, [...lab.targets.values()]
      .filter((t) => t.meta?.variant !== 'candidate')
      .map(targetView)),
  )

  router.get('/scenarios', (_req, res) => ok(res, SCENARIOS.map(publicScenario)))

  router.use(recordingsRouter(lab))
  router.use(contractRouter(lab))

  const runSchema = z.object({ scenarioId: idSchema, recordingId: idSchema, targetId: idSchema })

  async function execute({ scenarioId, recordingId, targetId }) {
    const scenario = scenarioById(scenarioId)
    if (!scenario) throw new HttpError(404, 'Unknown scenario')
    const recording = lab.store.getRecording(recordingId)
    if (!recording) throw new HttpError(404, 'Unknown recording')
    const target = lab.target(targetId)
    const run = await lab.exclusive(() => runScenario({ lab, scenario, recording, target }))
    lab.store.saveRun(run)
    return run
  }

  // Webhook scenarios, and contract scenarios that move no money. The ones that do go through the confirmation card.
  router.post('/runs', wrap(async (req, res) => {
    const input = parse(runSchema, req.body)
    const scenario = scenarioById(input.scenarioId)
    if (scenario?.movesMoney) throw new HttpError(403, 'This scenario moves sandbox money. Open a confirmation card first.')
    ok(res, await execute(input))
  }))

  router.post('/runs/all', wrap(async (req, res) => {
    const { recordingId, targetId } = parse(z.object({ recordingId: idSchema, targetId: idSchema }), req.body)
    const runs = []
    for (const scenarioId of SHAKE_ALL_IDS) runs.push(await execute({ scenarioId, recordingId, targetId }))
    ok(res, runs)
  }))

  router.get('/runs', (req, res) => {
    const { recordingId, targetId } = parse(z.object({ recordingId: idSchema.optional(), targetId: idSchema.optional() }), req.query)
    ok(res, lab.store.listRuns({ recordingId, targetId }).slice(0, 100))
  })

  router.get('/runs/:id', (req, res) => {
    const run = lab.store.getRun(parse(idSchema, req.params.id))
    if (!run) throw new HttpError(404, 'Unknown run')
    ok(res, run)
  })

  // First screen: latest result per scenario, the headline run for the timeline, and the three rows to show.
  router.get('/overview', (req, res) => {
    const { recordingId, targetId } = parse(z.object({ recordingId: idSchema, targetId: idSchema }), req.query)
    const latest = latestByScenario(lab.store.listRuns({ recordingId, targetId }))
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
    const targets = [...lab.targets.values()].filter((t) => t.meta?.variant !== 'candidate')
    const columns = targets.map((t) => {
      const latest = latestByScenario(lab.store.listRuns({ recordingId, targetId: t.id }))
      return { id: t.id, label: targetView(t).label, group: t.meta?.group || null, results: Object.fromEntries(Object.entries(latest).map(([k, r]) => [k, { status: r.status, headline: r.headline, runId: r.id }])) }
    })
    ok(res, { scenarios: SCENARIOS.map((s) => ({ id: s.id, title: s.title })), columns })
  })

  const diagnoseSchema = z.object({ runId: idSchema })
  router.post('/agent/diagnose', wrap(async (req, res) => {
    const { runId } = parse(diagnoseSchema, req.body)
    ok(res, await diagnose(lab, { runId }))
  }))
  router.get('/agent/for-run/:runId', (req, res) => {
    const runId = parse(idSchema, req.params.runId)
    ok(res, listDiagnoses(lab, runId))
  })
  router.get('/agent/:id', (req, res) => {
    const record = getDiagnosis(lab, parse(idSchema, req.params.id))
    if (!record) throw new HttpError(404, 'Unknown diagnosis')
    ok(res, record)
  })
  router.post('/agent/:id/apply', wrap(async (req, res) => {
    const { confirm } = parse(z.object({ confirm: z.boolean() }), req.body)
    ok(res, await applyDiagnosis(lab, { diagnosisId: parse(idSchema, req.params.id), confirm, operator: lab.cfg.operator }))
  }))
  router.get('/applies', (_req, res) => ok(res, lab.store.listApplies()))
  // Back to the planted bugs: a fresh working copy, and the first screen starts from the precomputed red results again.
  router.post('/targets/:id/reset-workspace', wrap(async (req, res) => {
    const targetId = parse(idSchema, req.params.id)
    await lab.exclusive(async () => {
      await resetWorkspace(lab, targetId)
      lab.store.deleteRuns({ targetId })
      importPrecomputed(lab)
    })
    ok(res, { reset: true })
  }))

  return router
}
