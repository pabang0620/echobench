import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig, llmBackendOf } from '../server/config.js'
import { ACCOUNT_LABEL, buildSdkTools, runAccountAgent, withoutApiKey } from '../server/agent/accountAgent.js'
import { diagnose } from '../server/agent/index.js'
import { buildRecorded, loadRecorded, recordedFile, summarizeCall } from '../server/agent/recorded.js'
import { TOOL_SPECS } from '../server/agent/tools.js'
import { api, startLab } from './helpers.js'

// None of these tests start the Claude Agent SDK or call Anthropic: the SDK is a fake with the same shape.
function fakeSdk(script) {
  const seen = { options: null, prompt: null, tools: [] }
  return {
    seen,
    tool: (name, description, shape, handler) => {
      const def = { name, description, shape, handler }
      seen.tools.push(def)
      return def
    },
    createSdkMcpServer: ({ name, tools }) => ({ name, tools }),
    query({ prompt, options }) {
      seen.prompt = prompt
      seen.options = options
      return (async function* run() {
        for (const message of await script(seen)) yield message
      })()
    },
  }
}

test('the account backend removes the Anthropic key and token from the environment it hands to Claude Code', async () => {
  const before = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN }
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real'
  process.env.ANTHROPIC_AUTH_TOKEN = 'token-not-real'
  try {
    const env = withoutApiKey()
    assert.equal('ANTHROPIC_API_KEY' in env, false)
    assert.equal('ANTHROPIC_AUTH_TOKEN' in env, false)
    assert.ok(env.PATH, 'the rest of the environment stays')
    const sdk = fakeSdk(() => [{ type: 'result', subtype: 'success', result: 'Done.' }])
    const text = await runAccountAgent({ session: { run: { scenarioId: 'S1', id: 'run_1', headline: 'h' } }, tools: {}, model: 'claude-sonnet-5-5', sdk })
    assert.equal(text, 'Done.')
    assert.equal('ANTHROPIC_API_KEY' in sdk.seen.options.env, false)
    assert.equal('ANTHROPIC_AUTH_TOKEN' in sdk.seen.options.env, false)
    assert.equal(sdk.seen.options.model, 'claude-sonnet-5-5')
    assert.deepEqual(sdk.seen.options.settingSources, [])
    assert.deepEqual(sdk.seen.options.tools, [], 'no built-in Claude Code tools (no shell, no file access)')
    assert.deepEqual(sdk.seen.options.allowedTools, ['mcp__echobench__*'])
    assert.match(sdk.seen.options.systemPrompt, /you never choose amounts/)
    assert.match(sdk.seen.prompt, /Diagnose scenario S1/)
  } finally {
    for (const [name, value] of [['ANTHROPIC_API_KEY', before.key], ['ANTHROPIC_AUTH_TOKEN', before.token]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('the ten tool specs become SDK tools that call the session\'s own tool functions, and errors map to isError', async () => {
  const calls = []
  const tools = Object.fromEntries(TOOL_SPECS.map((s) => [s.name, async (input) => (s.name === 'read_handler_file' ? { error: 'No such file' } : { ok: true, input })]))
  const sdk = fakeSdk(() => [])
  const mapped = buildSdkTools(sdk, tools, calls)
  assert.equal(mapped.length, 10)
  assert.deepEqual(mapped.map((t) => t.name), TOOL_SPECS.map((s) => s.name))
  assert.ok(!mapped.some((t) => /run_contract|refund|capture_order/i.test(t.name)), 'no money tool is exposed')
  const delivery = await mapped.find((t) => t.name === 'get_delivery').handler({ label: 'completed' })
  assert.equal(delivery.isError, false)
  assert.deepEqual(JSON.parse(delivery.content[0].text), { ok: true, input: { label: 'completed' } })
  const missing = await mapped.find((t) => t.name === 'read_handler_file').handler({ path: 'src/none.ts' })
  assert.equal(missing.isError, true)
  assert.deepEqual(calls.map((c) => [c.tool, c.ok]), [['get_delivery', true], ['read_handler_file', false]])
  assert.equal(summarizeCall(calls[0]), 'completed')
  assert.equal(summarizeCall({ tool: 'get_delivery', input: { label: 'completed' } }), 'completed')
})

test('a failed account run is an error (the app then falls back to the mocked agent and says so); hitting the turn limit is not', async () => {
  const session = { run: { scenarioId: 'S1', id: 'r', headline: 'h' } }
  const failing = fakeSdk(() => [{ type: 'result', subtype: 'error_during_execution' }])
  await assert.rejects(runAccountAgent({ session, tools: {}, model: 'm', sdk: failing }), /Account agent failed/)
  const limit = fakeSdk(() => [{ type: 'result', subtype: 'error_max_turns' }])
  assert.equal(await runAccountAgent({ session, tools: {}, model: 'm', sdk: limit }), '')
})

test('LLM_BACKEND=account selects the account backend and never reads the API key; the default stays mocked', () => {
  const withKey = { ANTHROPIC_API_KEY: 'sk-ant-test-not-real' }
  const account = loadConfig({ ...withKey, LLM_BACKEND: 'account' })
  assert.equal(account.llmBackend, 'account')
  assert.equal(account.anthropicKey, '')
  assert.equal(llmBackendOf(account), 'account')
  assert.equal(loadConfig({}).llmBackend, 'mock')
  assert.equal(loadConfig(withKey).llmBackend, 'api')
  assert.equal(loadConfig({ ...withKey, LLM_BACKEND: 'account', FORCE_MOCK: '1' }).llmBackend, 'mock')
})

let ctx
before(async () => {
  ctx = await startLab({ llmBackend: 'account' })
})
after(() => ctx.stop())

test('account mode diagnosis is labeled with its real source and is still verified by the server', async () => {
  assert.equal((await api(ctx.url, 'GET', '/status')).json.data.llmLabel, ACCOUNT_LABEL)
  assert.equal((await api(ctx.url, 'GET', '/status')).json.data.llm, 'account')
  const run = (await api(ctx.url, 'POST', '/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
  const fixed = (await import('node:fs')).readFileSync(path.join(ctx.lab.cfg.builtinDir, '..', 'targets', 'mugshop', 'fixes', 'webhook.fixed.ts'), 'utf8')
  const record = await diagnose(ctx.lab, { runId: run.id }, {
    runModel: async ({ session, tools }) => {
      await tools.propose_patch({ edits: [{ file: 'src/webhook.ts', content: fixed }] })
      session.modelCalls.push({ tool: 'propose_patch', ok: true, input: { edits: [{ file: 'src/webhook.ts' }] } })
      return 'Explained by the account model.'
    },
  })
  assert.equal(record.mode, 'live')
  assert.equal(record.explanation.source, ACCOUNT_LABEL)
  assert.equal(record.explanation.model, 'Explained by the account model.')
  assert.equal(record.candidate.verified, true)
  assert.deepEqual(record.modelCalls.map((c) => c.tool), ['propose_patch'])
  assert.ok(record.patchEdits.length === 1, 'the edits are kept so the run can be recorded')
})

// ---- item 6: a recorded live run replays without a key

function recordedFixture(over = {}) {
  return {
    scenarioId: 'S1',
    backend: 'account',
    model: 'claude-sonnet-5-5',
    source: ACCOUNT_LABEL,
    recordedAt: '2026-11-12',
    text: 'Recorded explanation.',
    toolCalls: [{ tool: 'get_failures', summary: '' }, { tool: 'propose_patch', summary: '1 edit(s) in src/webhook.ts' }],
    edits: [{ file: 'src/webhook.ts', old_str: "shipOrder(db, approvedOrderId(event), event.event_type) // PLANTED BUG B", new_str: '// approval does not ship' }],
    ...over,
  }
}

test('without a recorded file nothing changes; a broken or other-scenario file is ignored', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'echobench-rec-'))
  try {
    assert.equal(loadRecorded(dir, 'S1'), null)
    assert.equal(loadRecorded('', 'S1'), null)
    writeFileSync(recordedFile(dir), JSON.stringify({ scenarioId: 'S1' }))
    assert.equal(loadRecorded(dir, 'S1'), null, 'fails the schema')
    writeFileSync(recordedFile(dir), JSON.stringify(recordedFixture()))
    assert.equal(loadRecorded(dir, 'S1').source, ACCOUNT_LABEL)
    assert.equal(loadRecorded(dir, 'S5b'), null, 'another scenario never borrows this explanation')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a recorded run replays as "Recorded run" with its text and tool order; tsc and the re-runs are real and decide verified', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'echobench-rec-'))
  const lab = await startLab({ recordedDir: dir })
  try {
    // a deliberately incomplete patch: it passes tsc but cannot turn the whole suite green, so it must not be "verified"
    writeFileSync(recordedFile(dir), JSON.stringify(recordedFixture()))
    assert.equal((await api(lab.url, 'GET', '/status')).json.data.recordedModel.source, ACCOUNT_LABEL)
    const run = (await api(lab.url, 'POST', '/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
    const record = (await api(lab.url, 'POST', '/agent/diagnose', { runId: run.id })).json.data
    assert.equal(record.mode, 'recorded')
    assert.equal(record.recorded.source, ACCOUNT_LABEL)
    assert.equal(record.explanation.model, 'Recorded explanation.')
    assert.deepEqual(record.recorded.toolCalls.map((c) => c.tool), ['get_failures', 'propose_patch'])
    assert.equal(record.candidate.tscOk, true)
    assert.equal(record.candidate.verified, false, 'the server re-ran it: S1 is still red')
    assert.deepEqual(record.modelCalls, [])
    // another scenario falls back to the scripted agent
    const other = (await api(lab.url, 'POST', '/runs', { scenarioId: 'S5b', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
    assert.equal((await api(lab.url, 'POST', '/agent/diagnose', { runId: other.id })).json.data.mode, 'mock')
  } finally {
    await lab.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('edits that no longer fit fall back to the scripted agent instead of failing', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'echobench-rec-'))
  const lab = await startLab({ recordedDir: dir })
  try {
    writeFileSync(recordedFile(dir), JSON.stringify(recordedFixture({ edits: [{ file: 'src/webhook.ts', old_str: 'this text is not in the file', new_str: 'x' }] })))
    const run = (await api(lab.url, 'POST', '/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
    const record = (await api(lab.url, 'POST', '/agent/diagnose', { runId: run.id })).json.data
    assert.equal(record.mode, 'mock')
    assert.equal(record.candidate.verified, true)
  } finally {
    await lab.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildRecorded only accepts a live, verified diagnosis and keeps no secret', () => {
  assert.throws(() => buildRecorded({ mode: 'mock' }), /live/)
  assert.throws(() => buildRecorded({ mode: 'live', candidate: { verified: false } }), /verified patch/)
  const record = buildRecorded({
    mode: 'live',
    scenarioId: 'S1',
    createdAt: '2026-11-12T02:10:11.000Z',
    explanation: { source: ACCOUNT_LABEL, modelName: 'claude-sonnet-5-5', model: 'text' },
    modelCalls: [{ tool: 'get_failures', summary: '' }],
    patchEdits: [{ file: 'src/webhook.ts', content: 'x' }],
    candidate: { verified: true },
  })
  assert.equal(record.backend, 'account')
  assert.equal(record.recordedAt, '2026-11-12')
  assert.doesNotMatch(JSON.stringify(record), /sk-ant|token|secret/i)
})
