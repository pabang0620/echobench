import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { APP_ROOT, assertSandboxUrl, loadConfig } from '../server/config.js'
import { diagnose } from '../server/agent/index.js'
import { PATCHABLE_FILES, applyEdits, createCandidate, discardCandidate } from '../server/agent/patch.js'
import { errorHandler, ConfigError } from '../server/http.js'
import { createProxy } from '../server/proxy.js'
import { api, startLab } from './helpers.js'

const FIXED = readFileSync(path.join(APP_ROOT, 'targets', 'mugshop', 'fixes', 'webhook.fixed.ts'), 'utf8')
const fixedPatch = [{ file: 'src/webhook.ts', content: FIXED }]
const runOf = async (ctx, scenarioId) => (await api(ctx.url, 'POST', '/runs', { scenarioId, recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data

// ---- D1 and D2: the live path is verified by the server, not by what the model says

let live
before(async () => {
  live = await startLab({ anthropicKey: 'test-key-not-used' })
})
after(() => live.stop())

test('D1: live path, a model that only claims success is not trusted; the server re-runs the failing scenario and the suite', async () => {
  const run = await runOf(live, 'S1')
  const record = await diagnose(live.lab, { runId: run.id }, {
    runModel: async ({ tools }) => {
      const current = (await tools.read_handler_file({ path: 'src/webhook.ts' })).text
      await tools.propose_patch({ edits: [{ file: 'src/webhook.ts', content: `${current}\n// harmless comment\n` }] })
      return 'I fixed it, everything is green.'
    },
  })
  assert.equal(record.mode, 'live')
  assert.equal(record.candidate.tscOk, true)
  assert.equal(record.candidate.rerun.status, 'red')
  assert.equal(record.candidate.verified, false)
})

test('D1: live path, a real fix is verified by the server and can be applied; D2: the model\'s own text is kept and labeled', async () => {
  const run = await runOf(live, 'S1')
  const record = await diagnose(live.lab, { runId: run.id }, {
    runModel: async ({ tools }) => {
      await tools.propose_patch({ edits: fixedPatch })
      return 'The capture handler ships without claiming the event id.'
    },
  })
  assert.equal(record.mode, 'live')
  assert.equal(record.candidate.rerun.status, 'green')
  assert.ok(record.candidate.suite.length >= 10)
  assert.equal(record.candidate.verified, true)
  assert.equal(record.explanation.model, 'The capture handler ships without claiming the event id.')
  assert.equal(record.explanation.modelName, live.lab.cfg.anthropicModel)
  assert.deepEqual(record.explanation.cause, [], 'no scripted text in a live diagnosis')
  assert.ok(record.steps.some((s) => s.summary.startsWith('(run by the server)')))
})

test('D1: live path, no patch means no candidate; a failing model falls back to the mocked agent and says so', async () => {
  const run = await runOf(live, 'S1')
  const none = await diagnose(live.lab, { runId: run.id }, { runModel: async () => 'Only an explanation.' })
  assert.equal(none.candidate, null)
  const failed = await diagnose(live.lab, { runId: run.id }, { runModel: async () => { throw new Error('API down') } })
  assert.equal(failed.mode, 'mock')
  assert.match(failed.fallbackReason, /API down/)
  assert.ok(failed.explanation.cause.length > 0)
})

// ---- D3: handler files only, and no secrets in the copy's environment

test('D3: patches reach handler files only, not the adapter, the configuration or the PayPal port', () => {
  assert.ok(!PATCHABLE_FILES.some((f) => /state|config|server|db|paypalPort/.test(f)))
  const dir = path.join(live.lab.cfg.dataDir, 'cand-test')
  const { dir: copy } = createCandidate(live.lab.cfg.dataDir, path.join(APP_ROOT, 'targets', 'mugshop'))
  try {
    for (const file of ['src/state.ts', 'src/config.ts', 'src/server.ts', 'src/db.ts', 'src/paypalPort.ts', 'package.json', '../x.ts']) {
      assert.throws(() => applyEdits(copy, [{ file, content: 'export {}' }]), /Handler files only/, file)
    }
    assert.deepEqual(applyEdits(copy, [{ file: 'src/webhook.ts', content: FIXED }]), ['src/webhook.ts'])
  } finally {
    discardCandidate(copy)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('D3: a patched copy runs without the Anthropic key and without PayPal credentials', { skip: !existsSync('/proc/self/environ') }, async () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, s: process.env.PAYPAL_CLIENT_SECRET, i: process.env.PAYPAL_CLIENT_ID }
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'sk-ant-secret-for-test', PAYPAL_CLIENT_SECRET: 'real-secret-for-test', PAYPAL_CLIENT_ID: 'real-id-for-test' })
  const target = live.lab.target('mugshop')
  try {
    await target.start({ fresh: true })
    const env = readFileSync(`/proc/${target.child.pid}/environ`, 'utf8')
    assert.ok(!env.includes('sk-ant-secret-for-test'))
    assert.ok(!env.includes('real-secret-for-test'))
    assert.ok(!env.includes('real-id-for-test'))
    assert.match(env, /PAYPAL_CLIENT_ID=echobench-proxied/)
  } finally {
    await target.stop()
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved.a], ['PAYPAL_CLIENT_SECRET', saved.s], ['PAYPAL_CLIENT_ID', saved.i]]) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})

test('D3: the proxy swaps in the real credentials on the token request, so the target holds only placeholders', async () => {
  let seen = ''
  const upstream = createServer((req, res) => {
    seen = req.headers.authorization || ''
    res.end('{}')
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const proxy = createProxy({ upstream: `http://127.0.0.1:${upstream.address().port}`, credentials: { clientId: 'REAL', clientSecret: 'SECRET' } })
  await proxy.listen(0)
  try {
    await fetch(`${proxy.baseUrl}/v1/oauth2/token`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from('echobench-proxied:echobench-proxied').toString('base64')}` }, body: 'grant_type=client_credentials' })
    assert.equal(seen, `Basic ${Buffer.from('REAL:SECRET').toString('base64')}`)
  } finally {
    await proxy.close()
    upstream.close()
  }
})

// ---- D4 and D7: DATA_DIR anywhere, and a readable configuration error

test('D4: with DATA_DIR outside the app, the copies still resolve zod and @types/node (a scenario runs and tsc passes)', async () => {
  const outside = mkdtempSync(path.join(os.tmpdir(), 'echobench-datadir-'))
  const far = await startLab({ dataDir: outside })
  try {
    const run = await runOf(far, 'S1')
    assert.equal(run.status, 'red', run.headline)
    const record = await diagnose(far.lab, { runId: run.id })
    assert.equal(record.candidate.tscOk, true, record.candidate.tsc)
    assert.equal(record.candidate.verified, true)
  } finally {
    await far.stop()
    rmSync(outside, { recursive: true, force: true })
  }
})

test('D7: a configuration problem shows its message; any other server error stays "Internal error"', () => {
  const capture = (err) => {
    let out
    const res = { status: () => ({ json: (body) => (out = body) }) }
    const write = process.stderr.write
    process.stderr.write = () => true
    try {
      errorHandler(err, {}, res, () => {})
    } finally {
      process.stderr.write = write
    }
    return out
  }
  assert.match(capture(new ConfigError('mugshop could not start. Cannot find package zod')).message, /Cannot find package zod/)
  assert.equal(capture(new Error('secret detail')).message, 'Internal error')
})

// ---- D5: sandbox host only

test('D5: a PayPal base URL that is not the sandbox is refused unless the lab is in mock mode', () => {
  const creds = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret' }
  for (const url of ['https://api-m.paypal.com', 'https://api.paypal.com', 'https://evil.example/sandbox', 'https://api-m.sandbox.paypal.com.evil.example', 'https://sandbox.paypal.com.example/?api-m.sandbox.paypal.com', 'http://api-m.sandbox.paypal.com', 'not a url', 'https://user:pw@api-m.sandbox.paypal.com']) {
    assert.throws(() => loadConfig({ ...creds, PAYPAL_BASE_URL: url }), /PAYPAL_BASE_URL|Refusing/, url)
  }
  assert.equal(loadConfig({ ...creds, PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com/' }).mode, 'sandbox')
  assert.equal(loadConfig({ ...creds }).mode, 'sandbox')
  assert.equal(assertSandboxUrl('https://api.sandbox.paypal.com'), 'https://api.sandbox.paypal.com')
  // mock mode never calls the base URL, so it does not matter there
  assert.equal(loadConfig({ PAYPAL_BASE_URL: 'https://api-m.paypal.com' }).mode, 'mock')
  assert.equal(loadConfig({ ...creds, FORCE_MOCK: '1', PAYPAL_BASE_URL: 'https://api-m.paypal.com' }).mode, 'mock')
})

// ---- D6: with a token, only the PayPal receiver is open

test('D6: with ECHOBENCH_ACCESS_TOKEN set, only POST /hooks/paypal is open without the token', async () => {
  const guarded = await startLab({ accessToken: 'tunnel-secret' })
  try {
    const hook = await fetch(`${guarded.url}/hooks/paypal`, { method: 'POST', body: '{}' })
    assert.equal(hook.status, 200)
    for (const [method, route] of [['GET', '/api/status'], ['POST', '/api/contract/cards'], ['POST', '/api/recordings/start'], ['GET', '/'], ['GET', '/forge/cert.pem'], ['GET', '/rec/return?token=x']]) {
      const res = await fetch(`${guarded.url}${route}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined })
      assert.equal(res.status, 401, `${method} ${route}`)
    }
    assert.equal((await fetch(`${guarded.url}/api/status`, { headers: { 'x-echobench-token': 'wrong' } })).status, 401)
    assert.equal((await fetch(`${guarded.url}/api/status`, { headers: { 'x-echobench-token': 'tunnel-secret' } })).status, 200)
    const first = await fetch(`${guarded.url}/api/status?token=tunnel-secret`)
    assert.equal(first.status, 200)
    const cookie = first.headers.get('set-cookie').split(';')[0]
    assert.equal((await fetch(`${guarded.url}/api/status`, { headers: { cookie } })).status, 200)
  } finally {
    await guarded.stop()
  }
})

test('D6: without a token nothing changes', async () => {
  assert.equal((await api(live.url, 'GET', '/status')).status, 200)
})

// ---- D10, D12: card text matches the mode; MugShop answers bad JSON with 400

test('D10: in mock mode the confirmation card says mock, matching its Environment line', async () => {
  const card = (await api(live.url, 'POST', '/contract/cards', { scenarioId: 'C-UNK', recordingId: 'mugshop-demo', targetId: 'mugshop-reference' })).json.data
  assert.match(card.text, /^Mock refund \(local PayPal stand-in\) of 4\.00 USD/)
  assert.doesNotMatch(card.text, /Sandbox/)
  assert.match(card.environment, /no sandbox/)
})

test('D12: MugShop returns 400, not 500, for a request body that is not JSON', async () => {
  const target = live.lab.target('mugshop')
  await target.start({ fresh: true })
  try {
    const res = await fetch(`${target.baseUrl}/admin/refund`, { method: 'POST', body: '{' })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /not valid JSON/)
  } finally {
    await target.stop()
  }
})

test('D11: the first-screen rows carry the precomputed flag', async () => {
  const run = await runOf(live, 'S0')
  assert.ok(run)
  const overview = (await api(live.url, 'GET', '/overview?recordingId=mugshop-demo&targetId=mugshop')).json.data
  assert.ok(overview.topRows.every((r) => typeof r.precomputed === 'boolean'))
  assert.match(overview.timelineCaption, /two partial refunds\)\.$/)
})

// ---- live caps: per IP per hour and per host per day, then the labelled fallback

import { createLiveLimiter } from '../server/agent/liveLimit.js'

test('live limiter: hourly window per IP on a fake clock, daily cap per host', () => {
  let t = 0
  const lim = createLiveLimiter({ perIpHour: 2, perDay: 3, now: () => t })
  assert.equal(lim.take('a').ok, true)
  assert.equal(lim.take('a').ok, true)
  const blocked = lim.take('a')
  assert.equal(blocked.ok, false)
  assert.match(blocked.reason, /hourly/)
  assert.equal(lim.take('b').ok, true)
  assert.match(lim.take('c').reason, /daily/)
  t = 61 * 60 * 1000
  assert.match(lim.take('a').reason, /daily/, 'the hour window slid, only the daily cap is left')
  t = 25 * 60 * 60 * 1000
  assert.equal(lim.take('c').ok, true, 'the day window slid')
  assert.equal(lim.take('a').ok, true)
})

test('diagnose: a reached cap never calls the model and falls back with a label', async () => {
  const capped = await startLab({ anthropicKey: 'test-key-not-used', liveLimitPerIpHour: 1, liveLimitPerDay: 5 })
  try {
    const run = (await api(capped.url, 'POST', '/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
    let calls = 0
    const runModel = async () => { calls += 1; throw new Error('API down') }
    await diagnose(capped.lab, { runId: run.id, ip: '1.2.3.4' }, { runModel })
    const second = await diagnose(capped.lab, { runId: run.id, ip: '1.2.3.4' }, { runModel })
    assert.equal(calls, 1)
    assert.notEqual(second.mode, 'live')
    assert.match(second.fallbackReason, /live limit reached/)
  } finally {
    await capped.stop()
  }
})
