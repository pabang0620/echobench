import { createServer } from 'node:http'

// Sits between the target's PayPal client and PayPal (or the local PayPal stand-in).
// It passes every call through and keeps a log. When armed, it forwards one matching
// request to PayPal and then cuts the connection before the reply reaches the target:
// the "PayPal did it, but the app never heard" case (UNKNOWN OUTCOMES).
// With `credentials`, the target only ever holds placeholder credentials: the proxy swaps in the real
// ones on the OAuth token request, so code running on the target side never sees them.
export function createProxy({ upstream, credentials = null }) {
  const log = []
  const rules = []
  let server = null
  let baseUrl = ''

  async function handle(req, res) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const entry = {
      at: new Date().toISOString(),
      method: req.method,
      path: req.url,
      requestId: req.headers['paypal-request-id'] || null,
      // The SDK mints its own Idempotency-Key per call. It is not PayPal-Request-Id; both are recorded so C-UNK can show the difference.
      sdkKey: req.headers['idempotency-key'] || null,
      cut: false,
      status: 0,
    }
    log.push(entry)

    const headers = {}
    for (const name of ['authorization', 'content-type', 'paypal-request-id', 'prefer', 'idempotency-key']) {
      if (req.headers[name]) headers[name] = String(req.headers[name])
    }
    if (credentials && req.url.split('?')[0] === '/v1/oauth2/token') {
      headers.authorization = `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`
    }
    let upstreamRes
    let payload
    try {
      upstreamRes = await fetch(`${upstream}${req.url}`, { method: req.method, headers, body: body.length ? body : undefined })
      payload = Buffer.from(await upstreamRes.arrayBuffer())
    } catch (err) {
      entry.status = 502
      res.writeHead(502, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ name: 'PROXY_UPSTREAM_ERROR', message: String(err.message) }))
    }
    entry.status = upstreamRes.status

    const ruleIndex = rules.findIndex((rule) => rule.method === req.method && rule.pattern.test(req.url) && rule.remaining > 0)
    if (ruleIndex >= 0) {
      rules[ruleIndex].remaining -= 1
      entry.cut = true
      req.socket.destroy()
      return
    }
    res.writeHead(upstreamRes.status, { 'content-type': upstreamRes.headers.get('content-type') || 'application/json', 'content-length': payload.length })
    res.end(payload)
  }

  return {
    log,
    arm({ method = 'POST', pattern, times = 1 }) {
      rules.push({ method, pattern, remaining: times })
    },
    disarm() {
      rules.length = 0
    },
    clearLog() {
      log.length = 0
    },
    async listen(port = 0) {
      server = createServer((req, res) => {
        handle(req, res).catch(() => res.destroy())
      })
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
      baseUrl = `http://127.0.0.1:${server.address().port}`
      return baseUrl
    },
    close: () => new Promise((resolve) => (server ? server.close(resolve) : resolve())),
    get baseUrl() {
      return baseUrl
    },
  }
}
