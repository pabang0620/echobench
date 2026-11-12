import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createApp } from '../server/app.js'
import { createLab } from '../server/lab.js'
import { APP_ROOT } from '../server/config.js'
import { buildBuiltinRecording } from '../server/seed.js'
import { WEBHOOK_SCENARIO_IDS, scenarioById } from '../server/scenarios/definitions.js'
import { runScenario } from '../server/scenarios/engine.js'

// R2: run every webhook scenario on the agent-built handlers in targets/ab/* (plugin off / plugin on)
// and, if EVERSHOP_DIR is set, on EverShop. Always on the local PayPal stand-in.
// A handler keeps its own database layout, so each one gets its own recording of the same purchase
// (builtin/ab-<name>-demo, made by driving that handler, never by copying MugShop's files).
// Results go to builtin/ab-runs.json and show in the "A/B and EverShop" tab.
//   FORCE_MOCK=1 node scripts/run-ab.js [--record]
process.env.FORCE_MOCK = '1'
const scratch = path.join(APP_ROOT, '.scratch')
mkdirSync(scratch, { recursive: true })

async function recordFor(targetId) {
  const id = `${targetId}-demo`
  if (!process.argv.includes('--record') && existsSync(path.join(APP_ROOT, 'builtin', id, 'recording.json'))) return id
  const dataDir = mkdtempSync(path.join(scratch, 'ab-rec-'))
  try {
    await buildBuiltinRecording({ dataDir, targetId, id, name: `The built-in purchase, recorded against ${targetId} (local PayPal stand-in)` })
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
  return id
}

const probe = await createLab({ dataDir: mkdtempSync(path.join(scratch, 'ab-probe-')), mode: 'mock' })
const targetIds = [...probe.targets.values()].filter((t) => t.id.startsWith('ab-') || t.id === 'evershop').map((t) => t.id)
await probe.stop()
rmSync(probe.cfg.dataDir, { recursive: true, force: true })
if (!targetIds.length) process.stdout.write('No agent-built handlers found. See targets/ab/README.md.\n')

const recordings = {}
for (const id of targetIds) recordings[id] = await recordFor(id)

const dataDir = mkdtempSync(path.join(scratch, 'ab-run-'))
const lab = await createLab({ dataDir, mode: 'mock', settleWindowMs: 6000 })
const server = createApp(lab).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
lab.publicUrl = `http://127.0.0.1:${server.address().port}`
const runs = []
try {
  for (const targetId of targetIds) {
    const target = lab.target(targetId)
    const recording = lab.store.getRecording(recordings[targetId])
    if (!recording) throw new Error(`No recording ${recordings[targetId]}`)
    for (const id of WEBHOOK_SCENARIO_IDS) {
      const run = await runScenario({ lab, scenario: scenarioById(id), recording, target })
      run.precomputed = true
      runs.push(run)
      process.stdout.write(`${targetId} ${id} ${run.status} ${run.headline}\n`)
    }
    await target.stop()
  }
  writeFileSync(path.join(APP_ROOT, 'builtin', 'ab-runs.json'), JSON.stringify({ generatedAt: new Date().toISOString(), note: 'R2 plugin off / on: webhook scenarios on the two agent-built handlers, local PayPal stand-in. Generation logs in targets/ab/*/GENERATION_LOG.md.', recordings, runs }, null, 1))
} finally {
  server.close()
  await lab.stop()
  rmSync(dataDir, { recursive: true, force: true })
}
