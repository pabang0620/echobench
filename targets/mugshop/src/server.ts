import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { z } from 'zod'
import { config } from './config.ts'
import { openDb } from './db.ts'
import { createCheckout, returnPath, ShopInputError } from './checkout.ts'
import { describeFailure, NOT_SENT_ANSWER, UNKNOWN_OUTCOME_ANSWER } from './failure.ts'
import { getPort, NetworkError, NotSentError, PaypalError } from './paypalPort.ts'
import { requestRefund } from './refunds.ts'
import { readState } from './state.ts'
import { handleWebhook, startReconcile } from './webhook.ts'

const db = openDb()
const port = await getPort()

const checkoutSchema = z.object({ sku: z.string().min(1), quantity: z.number().int().min(1).max(10).default(1) })
const refundSchema = z.object({ orderId: z.string().min(1), amount: z.string().regex(/^\d+\.\d{2}$/), refundRef: z.string().min(1) })

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

// The adapter only answers on mock or sandbox, and only when switched on.
const adapterOpen = config.adapter && (config.paypalEnv === 'mock' || config.paypalEnv === 'sandbox')

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost')
  const key = `${req.method} ${url.pathname}`

  if (key === 'GET /health') return send(res, 200, { ok: true, paypalEnv: config.paypalEnv, paypalClient: config.clientImpl, claim: config.refundClaim })

  if (key === 'POST /checkout') {
    const input = checkoutSchema.parse(JSON.parse((await readBody(req)).toString('utf8') || '{}'))
    return send(res, 201, await createCheckout(db, port, input.sku, input.quantity))
  }
  if (key === 'GET /checkout/return') {
    const token = z.string().min(1).parse(url.searchParams.get('token'))
    return send(res, 200, await returnPath(db, port, token))
  }
  if (key === 'POST /webhooks/paypal') {
    const reply = await handleWebhook(db, port, req.headers, await readBody(req))
    return send(res, reply.status, reply.body)
  }
  if (key === 'POST /admin/refund' || key === 'POST /support/refund') {
    const input = refundSchema.parse(JSON.parse((await readBody(req)).toString('utf8') || '{}'))
    const outcome = await requestRefund(db, port, { ...input, path: key.includes('admin') ? 'admin' : 'support' })
    return send(res, outcome.status, outcome.body)
  }
  if (adapterOpen && key === 'GET /__echobench/state') {
    return send(res, 200, readState(db, z.string().min(1).parse(url.searchParams.get('paypal_order_id'))))
  }
  if (adapterOpen && key === 'POST /__echobench/snapshot') {
    // VACUUM INTO writes a consistent copy of the database; the file must sit inside SNAPSHOT_DIR.
    const { to } = z.object({ to: z.string().min(1) }).parse(JSON.parse((await readBody(req)).toString('utf8') || '{}'))
    if (!config.snapshotDir || !to.startsWith(`${config.snapshotDir}/`) || to.includes('..')) return send(res, 400, { error: 'snapshot path not allowed' })
    db.prepare('VACUUM INTO ?').run(to)
    return send(res, 200, { ok: true })
  }
  send(res, 404, { error: 'not found' })
}

const server = createServer((req, res) => {
  route(req, res).catch((err: Error) => {
    // Central error handler. PayPal failures follow paypal-plan.md, WHEN THE API SAYS NO.
    if (err instanceof ShopInputError) return send(res, err.status, { error: err.message })
    if (err instanceof PaypalError) {
      const answer = describeFailure(err)
      return send(res, answer.status, answer.body)
    }
    if (err instanceof NetworkError) return send(res, UNKNOWN_OUTCOME_ANSWER.status, UNKNOWN_OUTCOME_ANSWER.body)
    if (err instanceof NotSentError) return send(res, NOT_SENT_ANSWER.status, NOT_SENT_ANSWER.body)
    const bad = err instanceof z.ZodError || err instanceof SyntaxError
    send(res, bad ? 400 : 500, { error: err instanceof SyntaxError ? 'request body is not valid JSON' : bad ? err.message : 'internal error' })
  })
})

startReconcile(db, port)
server.listen(config.port, '127.0.0.1', () => {
  process.stdout.write(`mugshop listening on ${config.port}\n`)
})
