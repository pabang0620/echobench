// PayPal Webhooks v1 over plain REST (the SDK has no Webhooks resource). Used by scripts/verify-sandbox.js
// and the live recording setup. Every call here needs real sandbox credentials; nothing in the test suite or
// the default (local stand-in) mode calls it.
export function createWebhooksRest({ baseUrl, clientId, clientSecret }) {
  let token = null
  async function accessToken() {
    if (token && token.until > Date.now()) return token.value
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetch(`${baseUrl}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
    if (!res.ok) throw new Error(`OAuth failed: ${res.status}`)
    const body = await res.json()
    token = { value: body.access_token, until: Date.now() + (body.expires_in - 30) * 1000 }
    return token.value
  }
  async function call(method, path, body, raw = false) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  return {
    register: (url, eventTypes) => call('POST', '/v1/notifications/webhooks', { url, event_types: eventTypes.map((name) => ({ name })) }),
    list: () => call('GET', '/v1/notifications/webhooks'),
    remove: (id) => call('DELETE', `/v1/notifications/webhooks/${id}`),
    listEvents: (query = '') => call('GET', `/v1/notifications/webhooks-events${query}`),
    getEvent: (id) => call('GET', `/v1/notifications/webhooks-events/${id}`),
    resend: (eventId, webhookIds) => call('POST', `/v1/notifications/webhooks-events/${eventId}/resend`, { webhook_ids: webhookIds }),
    simulate: (webhookId, url, eventType) => call('POST', '/v1/notifications/simulate-event', { webhook_id: webhookId, url, event_type: eventType }),
    // The event body is spliced in as the exact received text so no re-serialisation can change a byte.
    verifyPostback: ({ headers, webhookId, rawBody }) =>
      call('POST', '/v1/notifications/verify-webhook-signature', `{"auth_algo":${JSON.stringify(headers['paypal-auth-algo'])},"cert_url":${JSON.stringify(headers['paypal-cert-url'])},"transmission_id":${JSON.stringify(headers['paypal-transmission-id'])},"transmission_sig":${JSON.stringify(headers['paypal-transmission-sig'])},"transmission_time":${JSON.stringify(headers['paypal-transmission-time'])},"webhook_id":${JSON.stringify(webhookId)},"webhook_event":${rawBody}}`, true),
  }
}
