import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { api, startLab } from './helpers.js'

// The docs quote results the app computes. These tests tie each quote to its source, so a changed
// result fails here instead of leaving the app and the docs saying opposite things (REVIEW_4 defect 1:
// the A/B tab said "plugin on did not score better" while the table and the docs said 10 vs 9).

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const AB_DOCS = ['README.md', 'DEVPOST.md', 'VERIFY.md', 'targets/ab/README.md']
const STATUS_DOCS = ['README.md', 'DEVPOST.md', 'docs/VIDEO_SCRIPT.md']
const SCENARIO_ID = /\b(?:S\d+b?|D1|C-(?:UNK|DUP)(?:-CAPTURE)?)\b/g
const idsIn = (text) => new Set(text.match(SCENARIO_ID) || [])

let ab
before(async () => {
  const ctx = await startLab()
  try {
    const matrix = (await api(ctx.url, 'GET', '/matrix?recordingId=mugshop-demo')).json.data
    ab = matrix.abSummary.find((s) => s.id === 'sdk')
  } finally {
    await ctx.stop()
  }
})

test('the A/B tab computes its sentence from the table and never hard-codes a result', () => {
  assert.ok(ab, 'round 2 has results')
  const tab = read('client/src/components/MatrixTab.jsx')
  assert.doesNotMatch(tab, /did not score|scored better|\b\d+ green\b/)
  assert.match(tab, /abSummary/)
})

test('every "plugin on N green, plugin off M" in the docs is the round 2 table', () => {
  for (const file of AB_DOCS) {
    const text = read(file)
    assert.doesNotMatch(text, /plugin on did not score better/i, file)
    for (const m of text.matchAll(/plugin on (\d+) green, plugin off (\d+)/gi)) {
      assert.deepEqual([Number(m[1]), Number(m[2])], [ab.onGreen, ab.offGreen], `${file}: "${m[0]}"`)
    }
  }
  for (const file of ['README.md', 'DEVPOST.md']) assert.match(read(file), /plugin on \d+ green, plugin off \d+/i, `${file} states the A/B result`)
  const count = /\| Green count \| (\d+) \| (\d+) \|/.exec(read('targets/ab/README.md'))
  assert.deepEqual([Number(count[1]), Number(count[2])], [ab.offGreen, ab.onGreen])
})

test('the rows the docs say only one side passes, or both fail, are the ones the table shows', () => {
  const claims = [
    [/(?:only plugin on passes|plugin on alone passes|Only on:)([^.;|]*)/gi, ab.onlyOn],
    [/(?:only plugin off passes|plugin off alone passes|Only off:)([^.;|]*)/gi, ab.onlyOff],
    [/Both red(?: on)?:?([^.;|]*)/g, ab.bothRed],
  ]
  let seen = 0
  for (const file of AB_DOCS) {
    const text = read(file)
    for (const [pattern, expected] of claims) {
      for (const m of text.matchAll(pattern)) {
        const ids = idsIn(m[1])
        if (!ids.size) continue
        seen += 1
        assert.deepEqual([...ids].sort(), [...expected].sort(), `${file}: "${m[0].trim()}"`)
      }
    }
  }
  assert.ok(seen >= 4, 'the docs state the differing rows')
})

// VERIFY.md "Sandbox results" is the status source: one row per item, its first word is the status.
function verifyStatus() {
  const status = {}
  const section = read('VERIFY.md').split('## Sandbox results')[1].split('\n## ')[0]
  for (const m of section.matchAll(/^\| (V\d+b?) \| ([A-Z]+)/gm)) status[m[1]] = m[2]
  return status
}

test('the VERIFY count line matches its own rows', () => {
  const status = verifyStatus()
  const line = /^Count: PASS (\d+) \(([^)]*)\)/m.exec(read('VERIFY.md'))
  const listed = line[2].split(',').map((x) => x.trim().split(' ')[0])
  const pass = Object.keys(status).filter((id) => status[id] === 'PASS')
  assert.deepEqual([...listed].sort(), [...pass].sort())
  assert.equal(Number(line[1]), pass.length)
  const skipped = /SKIPPED (\d+) \(([^)]*)\)/.exec(line.input.split('\n').find((l) => l.startsWith('Count:')))
  assert.deepEqual(skipped[2].split(',').map((x) => x.trim()).sort(), Object.keys(status).filter((id) => status[id] === 'SKIPPED').sort())
})

// Every "Not run" list in the write-ups is derived from VERIFY: it names each SKIPPED item, and the hosted
// Anthropic API path of the AI step (V10 passed in account mode only). REVIEW_5: DEVPOST listed V2 and V9 only.
test('each "Not run" list in README and DEVPOST names every SKIPPED VERIFY item and the hosted API path', () => {
  const skipped = Object.entries(verifyStatus()).filter(([, word]) => word === 'SKIPPED').map(([id]) => id)
  assert.ok(skipped.length >= 1)
  for (const file of ['README.md', 'DEVPOST.md']) {
    const lists = [...read(file).matchAll(/Not run(?: yet)?:([^\n]*)/g)].map((m) => m[1])
    assert.ok(lists.length >= 1, `${file} has a "Not run" list`)
    for (const list of lists) {
      const named = new Set(list.match(/\bV\d+b?\b/g) || [])
      for (const id of skipped) assert.ok(named.has(id), `${file}: "Not run:${list.slice(0, 80)}..." leaves out ${id}`)
      assert.match(list, /hosted[- ](?:Anthropic )?API/i, `${file}: "Not run" list leaves out the hosted API path`)
    }
  }
})

test('the README sandbox evidence table gives each item the status VERIFY gives it', () => {
  const status = verifyStatus()
  const table = read('README.md').split('## Sandbox evidence')[1].split('\n## ')[0]
  const rows = [...table.matchAll(/^\| (V\d+b?) \| ([A-Z]+)/gm)]
  assert.ok(rows.length >= 6)
  for (const [, id, word] of rows) assert.equal(word, status[id], `README row ${id}`)
})

test('docs never call a passed item not run, and never call an unpassed item measured', () => {
  const status = verifyStatus()
  const negative = /not run|not been run|SKIPPED|PARTIAL|half done|needs? a public URL|not claimed/i
  const positive = /measured on the (?:real )?(?:PayPal )?sandbox|\bPASS\b|Real PayPal sandbox/i
  for (const file of STATUS_DOCS) {
    for (const fragment of read(file).split(/\.\s|;|\n/)) {
      const ids = (fragment.match(/\bV\d+b?\b/g) || []).filter((id) => id in status)
      if (!ids.length) continue
      if (negative.test(fragment)) {
        for (const id of ids) assert.notEqual(status[id], 'PASS', `${file}: "${fragment.trim()}" calls ${id} not run, VERIFY says PASS`)
      } else if (positive.test(fragment)) {
        for (const id of ids) assert.equal(status[id], 'PASS', `${file}: "${fragment.trim()}" claims ${id}, VERIFY says ${status[id]}`)
      }
    }
  }
})

test('the shipped sandbox evidence lists V1 only if VERIFY passed it', () => {
  const status = verifyStatus()
  const evidence = JSON.parse(read('builtin/sandbox-evidence.json'))
  for (const item of evidence.items.filter((i) => i.result === 'PASS')) assert.equal(status[item.id], 'PASS', item.id)
  assert.doesNotMatch(JSON.stringify(evidence), /secret|password|bearer|access_token|@/i)
})

// README "Recorded runs" table: one row per recorded real model run shipped in builtin/, with its tool
// count and model time read from the file itself.
test('the README recorded-runs table lists exactly the shipped recordings with their own numbers', () => {
  const dir = new URL('../builtin/', import.meta.url)
  const files = [['S1', 'builtin/live-diagnosis.json'], ...readdirSync(new URL('recorded-runs/', dir)).filter((f) => f.endsWith('.json')).map((f) => [f.replace('.json', ''), `builtin/recorded-runs/${f}`])]
  const rows = [...read('README.md').matchAll(/^\| (S\d+b?|D1) \| `([^`]+)` \| (\d+) \| ([^|]+) \|/gm)]
  assert.deepEqual(rows.map((r) => r[1]).sort(), files.map(([id]) => id).sort())
  for (const [id, file] of files) {
    const rec = JSON.parse(read(file))
    const row = rows.find((r) => r[1] === id)
    assert.equal(row[2], file, id)
    assert.equal(Number(row[3]), rec.toolCalls.length, `${id} tool calls`)
    assert.equal(row[4].trim(), rec.durationMs ? `${Math.round(rec.durationMs / 1000)} s` : 'not kept', `${id} model time`)
    assert.equal(rec.backend, 'account', `${id} was recorded in account mode`)
  }
})
