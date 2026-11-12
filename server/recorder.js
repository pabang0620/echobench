import path from 'node:path'
import { pickPaypalHeaders } from './lib/signature.js'
import { newId } from './store.js'

// Receives PayPal deliveries. Every delivery is answered with 2xx right away (PayPal does not
// resend pending notifications, and the target's own answer must not decide that), stored as the
// exact bytes plus the PAYPAL-* headers, and then handed to the target. Start points (target
// snapshots) are taken around the hand-over so scenarios can later begin from the same state.

const EVENT_LABEL = {
  'CHECKOUT.ORDER.APPROVED': 'approved',
  'PAYMENT.CAPTURE.COMPLETED': 'completed',
  'CUSTOMER.DISPUTE.CREATED': 'dispute',
}

// Which order and capture a delivery is about, when the event says so. The sandbox webhook belongs to
// an app that other shops may use too, so while a session knows its order, events about another
// order are not recorded. An event that names neither is kept (the stand-in's minimal events).
export function eventRefs(event) {
  const r = event?.resource || {}
  const up = (r.links || []).find((l) => l.rel === 'up')?.href || ''
  const captureFromUp = /\/captures\/([^/?]+)/.exec(up)?.[1] || null
  const disputed = (r.disputed_transactions || [])[0] || {}
  return {
    orderId: event?.event_type === 'CHECKOUT.ORDER.APPROVED' ? r.id || null : r.supplementary_data?.related_ids?.order_id || null,
    captureId: event?.event_type === 'PAYMENT.CAPTURE.COMPLETED' ? r.id || null : captureFromUp || disputed.seller_transaction_id || null,
  }
}

export function belongsToSession(session, event) {
  const refs = eventRefs(event)
  if (session.orderId && refs.orderId && refs.orderId !== session.orderId) return false
  if (session.captureId && refs.captureId && refs.captureId !== session.captureId) return false
  if (session.orderId && !session.captureId && refs.captureId && !refs.orderId && event?.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return false
  return true
}

function parseSafe(body) {
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    return null
  }
}

export function createRecorder({ store, getTarget }) {
  let session = null

  function labelFor(eventType) {
    if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
      const seen = session.deliveries.filter((d) => d.eventType === eventType).length
      return `refund${seen + 1}`
    }
    return EVENT_LABEL[eventType] || 'other'
  }

  async function takeStartPoint(name) {
    if (!session || session.startPoints[name]) return
    const target = getTarget(session.targetId)
    const rel = `snapshots/${name}.sqlite`
    const file = path.join(store.recordingDir(session.id), rel)
    const fp = await target.snapshot(file, session.orderId)
    session.startPoints[name] = { file: rel, fingerprint: fp, takenAt: new Date().toISOString() }
  }

  async function forward(delivery) {
    const target = getTarget(session.targetId)
    if (delivery.label === 'approved') await takeStartPoint('SP0')
    delivery.targetResponse = await target.postWebhook(delivery.headers, Buffer.from(delivery.bodyBase64, 'base64'))
    if (delivery.label === 'completed') await takeStartPoint('SP1')
    if (delivery.label === 'refund1') await takeStartPoint('SP2')
    if (delivery.label === 'refund2') await takeStartPoint('SP3')
  }

  return {
    get session() {
      return session
    },

    start({ id, name, targetId, source = 'live-sandbox', webhookId }) {
      session = {
        id: id || newId('rec'),
        name,
        source,
        targetId,
        webhookId,
        createdAt: new Date().toISOString(),
        orderId: null,
        captureId: null,
        deliveries: [],
        extras: {},
        startPoints: {},
        contract: null,
        chain: Promise.resolve(),
      }
      return session
    },

    // Called by the HTTP route. Returns after the bytes are safely stored; forwarding continues in order.
    ingest(body, headers) {
      if (!session) return { stored: false }
      const event = parseSafe(body)
      if (!belongsToSession(session, event)) {
        session.ignored = (session.ignored || 0) + 1
        return { stored: false, reason: 'another order' }
      }
      const eventType = event?.event_type || 'UNKNOWN'
      if (eventType === 'CHECKOUT.ORDER.APPROVED' && !session.orderId) session.orderId = event.resource.id
      if (eventType === 'PAYMENT.CAPTURE.COMPLETED' && !session.captureId) session.captureId = event.resource.id
      const delivery = {
        seq: session.deliveries.length + 1,
        label: labelFor(eventType),
        receivedAt: new Date().toISOString(),
        eventType,
        eventId: event?.id || null,
        headers: pickPaypalHeaders(headers),
        bodyBase64: body.toString('base64'),
        targetResponse: null,
      }
      if (delivery.label === 'dispute') session.extras.dispute = delivery
      else session.deliveries.push(delivery)
      const current = session
      current.chain = current.chain.then(() => forward(delivery)).catch((err) => {
        delivery.targetResponse = { status: 0, body: String(err.message), ms: 0 }
      })
      return { stored: true, label: delivery.label }
    },

    // The buyer's return URL goes through here so SP0 is saved before the return path runs.
    async markReturn(orderId) {
      if (!session) throw new Error('No recording session is running')
      session.orderId = session.orderId || orderId
      await session.chain
      await takeStartPoint('SP0')
      return getTarget(session.targetId).returnPath(orderId)
    },

    async snapshotNow(name) {
      if (!session) throw new Error('No recording session is running')
      await session.chain
      await takeStartPoint(name)
    },

    async recordContractFixture({ orderId, captureId, amount }) {
      if (!session) throw new Error('No recording session is running')
      await session.chain
      const target = getTarget(session.targetId)
      const rel = 'snapshots/SPC.sqlite'
      const file = path.join(store.recordingDir(session.id), rel)
      const fp = await target.snapshot(file, orderId)
      session.contract = { orderId, captureId, amount, startPoint: 'SPC', file: rel, fingerprint: fp }
    },

    async waitForDeliveries(count, timeoutMs = 8000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (session.deliveries.length >= count) {
          await session.chain
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error(`Only ${session.deliveries.length} of ${count} deliveries arrived`)
    },

    async finish() {
      if (!session) throw new Error('No recording session is running')
      await session.chain
      const { chain: _chain, ignored: _ignored, ...plain } = session
      const rec = { ...plain, deliveries: plain.deliveries.map((d) => ({ ...d })) }
      const dir = store.saveRecording(rec)
      session = null
      return { ...rec, dir }
    },
  }
}
