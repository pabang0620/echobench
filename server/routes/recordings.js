import express from 'express'
import { z } from 'zod'
import { HttpError, idSchema, parse } from '../http.js'

const ok = (res, data) => res.json({ success: true, data })

// The first recording is the one the screen opens with: in sandbox mode the newest sandbox recording, else the built-in one.
function sortForMode(list, mode) {
  if (mode === 'mock') return list
  const fromSandbox = list.filter((r) => !String(r.source).endsWith('mock')).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return [...fromSandbox, ...list.filter((r) => String(r.source).endsWith('mock'))]
}

// Recordings: list, inspect, and (sandbox) record a new one. Bodies stay out of list/detail
// unless asked for, they are the exact bytes PayPal sent.
export function recordingsRouter(lab) {
  const router = express.Router()
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next)

  // Recordings made against an agent-built handler (R2) only feed the A/B tab: their start points are that handler's database.
  router.get('/recordings', (_req, res) => ok(res, sortForMode(lab.store.listRecordings().filter((r) => !String(r.targetId).startsWith('ab-')), lab.cfg.mode)))

  router.get('/recordings/:id', (req, res) => {
    const rec = lab.store.getRecording(parse(idSchema, req.params.id))
    if (!rec) throw new HttpError(404, 'Unknown recording')
    const full = req.query.full === '1'
    ok(res, {
      id: rec.id,
      name: rec.name,
      source: rec.source,
      createdAt: rec.createdAt,
      targetId: rec.targetId,
      orderId: rec.orderId,
      captureId: rec.captureId,
      builtin: rec.builtin,
      startPoints: Object.fromEntries(Object.entries(rec.startPoints).map(([k, v]) => [k, v.fingerprint])),
      contract: rec.contract ? { orderId: rec.contract.orderId, captureId: rec.contract.captureId, amount: rec.contract.amount } : null,
      deliveries: [...rec.deliveries, ...(rec.extras?.dispute ? [rec.extras.dispute] : [])].map((d) => ({
        seq: d.seq, label: d.label, eventType: d.eventType, eventId: d.eventId, receivedAt: d.receivedAt,
        headers: d.headers, targetResponse: d.targetResponse, ...(full ? { bodyBase64: d.bodyBase64 } : { body: JSON.parse(Buffer.from(d.bodyBase64, 'base64').toString('utf8')) }),
      })),
    })
  })

  // Read-only precheck: does the target know the recorded order? (EverShop: the DB match from the plan.)
  router.get('/recordings/:id/precheck', wrap(async (req, res) => {
    const rec = lab.store.getRecording(parse(idSchema, req.params.id))
    const { targetId } = parse(z.object({ targetId: idSchema }), req.query)
    if (!rec) throw new HttpError(404, 'Unknown recording')
    const target = lab.target(targetId)
    if (!target.precheck) return ok(res, { ok: true, reason: 'This target has no precheck' })
    const result = await lab.exclusive(async () => {
      if (!target.child && target.kind === 'process-sqlite') await target.restore(`${rec.dir}/${rec.startPoints.SP1.file}`)
      return target.precheck({ orderId: rec.orderId, captureId: rec.captureId })
    })
    ok(res, result)
  }))

  const startSchema = z.object({ name: z.string().min(1).max(80), targetId: idSchema })
  router.post('/recordings/start', (req, res) => {
    const { name, targetId } = parse(startSchema, req.body)
    lab.target(targetId)
    if (lab.recorder.session) throw new HttpError(409, 'A recording is already running')
    const session = lab.recorder.start({ name, targetId, source: lab.cfg.mode === 'mock' ? 'live-mock' : 'live-sandbox', webhookId: lab.cfg.webhookId })
    ok(res, { id: session.id, webhookUrl: `${lab.publicUrl}/hooks/paypal`, returnUrl: `${lab.publicUrl}/rec/return?token=ORDER_ID` })
  })

  router.get('/recordings-live', (_req, res) => {
    const s = lab.recorder.session
    ok(res, s ? { id: s.id, name: s.name, deliveries: s.deliveries.map((d) => d.label), startPoints: Object.keys(s.startPoints), orderId: s.orderId } : null)
  })

  router.post('/recordings/finish', wrap(async (_req, res) => {
    if (!lab.recorder.session) throw new HttpError(409, 'No recording is running')
    const rec = await lab.recorder.finish()
    ok(res, { id: rec.id, deliveries: rec.deliveries.length, startPoints: Object.keys(rec.startPoints) })
  }))

  const fixtureSchema = z.object({ orderId: z.string().min(1), captureId: z.string().min(1), amount: z.string().regex(/^\d+\.\d{2}$/) })
  router.post('/recordings/contract-fixture', wrap(async (req, res) => {
    await lab.recorder.recordContractFixture(parse(fixtureSchema, req.body))
    ok(res, { saved: true })
  }))

  return router
}
