import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { workspaceDir } from '../server/targets/mugshop.js'
import { countChecks, checkSummary } from '../client/src/rules.js'
import { api, startLab } from './helpers.js'

// Apply re-runs the scenarios on the patched copy, and each visitor's Apply stays on their own copy.

const A = 'a1'.repeat(16)
const B = 'b2'.repeat(16)
let ctx
before(async () => {
  ctx = await startLab({ maxVisitorCopies: 2 })
})
after(() => ctx.stop())

const as = (visitor) => ({
  get: (route) => api(ctx.url, 'GET', route, undefined, visitor),
  post: (route, body) => api(ctx.url, 'POST', route, body, visitor),
})
const OVERVIEW = '/overview?recordingId=mugshop-demo&targetId=mugshop'

let applied
let diagnosis
let failedRun

test('after Apply the server re-runs the scenarios on the patched copy, and the badge and the card come from those runs', async () => {
  const a = as(A)
  failedRun = (await a.post('/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
  assert.equal(failedRun.status, 'red')
  const beforeCounts = countChecks((await a.get(OVERVIEW)).json.data.scenarios)
  assert.ok(beforeCounts.failing > 0)

  diagnosis = (await a.post('/agent/diagnose', { runId: failedRun.id })).json.data
  assert.equal(diagnosis.candidate.verified, true)
  const res = await a.post(`/agent/${diagnosis.id}/apply`, { confirm: true })
  assert.equal(res.status, 200)
  applied = res.json.data
  // the diagnosed scenario first, then every scenario that moves no money
  assert.equal(applied.reruns[0].scenarioId, 'S1')
  assert.equal(applied.rerun.status, 'green')
  assert.equal(applied.reruns.length, 12)
  assert.ok(applied.reruns.every((r) => r.status !== 'red' && r.status !== 'error'), JSON.stringify(applied.reruns))

  const overview = (await a.get(OVERVIEW)).json.data
  const counts = countChecks(overview.scenarios)
  assert.equal(counts.failing, 0)
  assert.equal(counts.notRun, 0, 'no scenario is left blank on the new copy')
  assert.doesNotMatch(checkSummary(counts).label, /failing/)
  // the S1 card the screen opens is the new run, on the patched copy
  assert.equal(overview.scenarios.find((s) => s.scenario.id === 'S1').run.id, applied.rerun.run_id)
  const card = (await a.get(`/runs/${applied.rerun.run_id}`)).json.data
  assert.equal(card.status, 'green')
  assert.notEqual(card.targetId, 'mugshop')
  // the two money-moving contract scenarios are shown as results from before the patch
  const cdup = overview.scenarios.find((s) => s.scenario.id === 'C-DUP').run
  if (cdup) assert.match(cdup.headline, /before your patch/)

  const target = (await a.get('/targets')).json.data.find((t) => t.id === 'mugshop')
  assert.equal(target.patched, true)
  assert.doesNotMatch(target.note, /bugs are fixed/)
  assert.match(target.note, /re-ran every scenario/)
})

test('a second visitor still sees and runs the planted MugShop, and cannot see or apply the first visitor\'s patch', async () => {
  const b = as(B)
  const target = (await b.get('/targets')).json.data.find((t) => t.id === 'mugshop')
  assert.equal(target.label, 'MugShop (planted bugs)')
  assert.equal(target.patched, false)
  const overview = (await b.get(OVERVIEW)).json.data
  assert.ok(countChecks(overview.scenarios).failing > 0)
  assert.equal((await b.post('/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data.status, 'red')
  const matrix = (await b.get('/matrix?recordingId=mugshop-demo')).json.data
  assert.equal(matrix.columns.find((c) => c.id === 'mugshop').label, 'MugShop (planted bugs)')
  assert.ok(!matrix.columns.some((c) => c.id.startsWith('mugshop-v-')))

  assert.deepEqual((await b.get(`/agent/for-run/${failedRun.id}`)).json.data, [])
  assert.equal((await b.get(`/agent/${diagnosis.id}`)).status, 404)
  assert.equal((await b.post(`/agent/${diagnosis.id}/apply`, { confirm: true })).status, 404)
  // the first visitor's copy is not reachable by its id either
  const copyId = (await as(A).get(`/runs/${applied.rerun.run_id}`)).json.data.targetId
  assert.equal((await b.post('/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: copyId })).status, 404)
  assert.equal((await b.get(`/overview?recordingId=mugshop-demo&targetId=${copyId}`)).status, 404)
  // and the shared working copy on disk is still the planted source
  assert.equal(ctx.lab.target('mugshop').meta.workspace, workspaceDir(ctx.lab.cfg.dataDir, 'mugshop'))
  assert.equal((await api(ctx.url, 'GET', '/targets')).json.data.find((t) => t.id === 'mugshop').patched, false)
})

test('Reset drops only that visitor\'s copy, and copies are capped (the oldest is removed with its folder and runs)', async () => {
  const copyA = ctx.lab.visitors.copyOf(A)
  const dirA = copyA.meta.workspace
  assert.ok(existsSync(dirA))
  const others = ['c3', 'd4'].map((p) => p.repeat(16))
  for (const sid of others) await ctx.lab.exclusive(() => ctx.lab.visitors.ensure(sid))
  assert.equal(ctx.lab.visitors.size, 2)
  assert.equal(ctx.lab.visitors.has(A), false, 'the least recently used copy went first')
  assert.equal(existsSync(dirA), false)
  assert.equal(ctx.lab.targets.has(copyA.id), false)
  assert.equal(ctx.lab.store.listRuns({ targetId: copyA.id }).length, 0)

  const c = as(others[0])
  assert.equal((await c.post('/targets/mugshop/reset-workspace')).status, 200)
  assert.equal(ctx.lab.visitors.has(others[0]), false)
  assert.equal(ctx.lab.visitors.has(others[1]), true)
})
