import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ACCOUNT_LABEL } from '../server/agent/accountAgent.js'
import { buildRecorded, loadRecorded, recordedFile, recordedLabel, recordedRunFile } from '../server/agent/recorded.js'
import { APP_ROOT } from '../server/config.js'
import { api, startLab } from './helpers.js'

// Recorded real model runs (one per scenario). No test here calls a model: the files are read, never written by a model.
const BUILTIN = path.join(APP_ROOT, 'builtin')

function fixture(scenarioId, over = {}) {
  return {
    scenarioId,
    backend: 'account',
    model: 'claude-sonnet-5-5',
    source: ACCOUNT_LABEL,
    recordedAt: '2026-11-12',
    text: `Recorded explanation for ${scenarioId}.`,
    toolCalls: [{ tool: 'get_failures', summary: '', atMs: 1200 }],
    edits: [{ file: 'src/webhook.ts', old_str: 'a', new_str: 'b' }],
    ...over,
  }
}

test('each scenario reads its own recorded run; the first run file still serves S1', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'echobench-runs-'))
  try {
    writeFileSync(recordedFile(dir), JSON.stringify(fixture('S1')))
    mkdirSync(path.join(dir, 'recorded-runs'))
    writeFileSync(recordedRunFile(dir, 'S5b'), JSON.stringify(fixture('S5b', { durationMs: 38781 })))
    // a file whose content names another scenario is never used for this one
    writeFileSync(recordedRunFile(dir, 'S5'), JSON.stringify(fixture('S1')))
    assert.equal(loadRecorded(dir, 'S1').text, 'Recorded explanation for S1.')
    assert.equal(loadRecorded(dir, 'S5b').durationMs, 38781)
    assert.equal(loadRecorded(dir, 'S5b').toolCalls[0].atMs, 1200)
    assert.equal(loadRecorded(dir, 'S5'), null)
    assert.deepEqual(recordedLabel({ cfg: { recordedDir: dir } }).scenarioIds.sort(), ['S1', 'S5b'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildRecorded keeps the model time and the time of each tool call', () => {
  const record = buildRecorded({
    mode: 'live',
    scenarioId: 'S5b',
    createdAt: '2026-11-12T05:25:30.000Z',
    modelMs: 38781,
    explanation: { source: ACCOUNT_LABEL, modelName: 'claude-sonnet-5-5', model: 'text' },
    modelCalls: [{ tool: 'get_failures', summary: '', atMs: 3346 }, { tool: 'propose_patch', summary: '6 edit(s) in src/webhook.ts', atMs: 20725 }],
    patchEdits: [{ file: 'src/webhook.ts', content: 'x' }],
    candidate: { verified: true },
  })
  assert.equal(record.durationMs, 38781)
  assert.deepEqual(record.toolCalls.map((c) => c.atMs), [3346, 20725])
})

test('the recorded runs shipped with the app are real account-mode runs that parse and keep no secret', () => {
  for (const id of ['S1', 'S5b']) {
    const run = loadRecorded(BUILTIN, id)
    assert.ok(run, `${id} has a recorded run`)
    assert.equal(run.backend, 'account')
    assert.equal(run.source, ACCOUNT_LABEL)
    assert.ok(run.toolCalls.length >= 10, `${id}: the model chose many tools`)
    assert.ok(run.toolCalls.some((c) => c.tool === 'propose_patch'))
    assert.doesNotMatch(JSON.stringify(run), /sk-ant|oauth|secret|client_secret/i)
  }
  const s5b = loadRecorded(BUILTIN, 'S5b')
  assert.ok(s5b.durationMs > 0)
  assert.ok(s5b.toolCalls.every((c) => Number.isInteger(c.atMs)))
})

test('the shipped S5b run replays as "Recorded run" and the server re-run verifies it', async () => {
  const lab = await startLab({ recordedDir: BUILTIN })
  try {
    const run = (await api(lab.url, 'POST', '/runs', { scenarioId: 'S5b', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
    assert.equal(run.status, 'red')
    const record = (await api(lab.url, 'POST', '/agent/diagnose', { runId: run.id })).json.data
    assert.equal(record.mode, 'recorded')
    assert.equal(record.recorded.durationMs, loadRecorded(BUILTIN, 'S5b').durationMs)
    assert.equal(record.candidate.tscOk, true)
    assert.equal(record.candidate.verified, true, 'verified comes from this server re-running the suite')
  } finally {
    await lab.stop()
  }
})
