// A fake `fetch` for the SDK's ClientOptions.fetch seam (typescript-testing). The SDK calls it with one
// Request and no init. Every request is recorded, the OAuth token request included.
export function stubFetch(responder) {
  const calls = []
  const fetchFake = async (input, init) => {
    const request = new Request(input, init)
    const body = request.body === null ? undefined : await request.clone().text()
    const url = new URL(request.url)
    const call = { url, request, body, path: url.pathname, method: request.method, headers: Object.fromEntries(request.headers) }
    calls.push(call)
    return responder(call)
  }
  return { fetch: fetchFake, calls, writes: (suffix) => calls.filter((c) => c.method === 'POST' && c.path.endsWith(suffix)) }
}

export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
export const tokenReply = () => json(200, { access_token: 'T', token_type: 'Bearer', expires_in: 3600 })
export const isToken = (call) => call.path === '/v1/oauth2/token'

// Wire-shaped bodies (snake_case), as PayPal sends them.
export const wireOrder = (extra = {}) => ({
  id: 'ORD1',
  status: 'COMPLETED',
  purchase_units: [{ amount: { currency_code: 'USD', value: '12.00' }, payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '12.00' } }], refunds: [] } }],
  ...extra,
})
export const wireError = (name, issue, message = 'rejected') => ({ name, message, debug_id: 'dbg-1', details: [{ issue }] })
