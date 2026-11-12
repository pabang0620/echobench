import { createApp } from '../server/app.js'
import { createLab } from '../server/lab.js'
import { WEBHOOK_SCENARIO_IDS, scenarioById } from '../server/scenarios/definitions.js'
import { runScenario } from '../server/scenarios/engine.js'

// R2: run every webhook scenario on the agent-built handlers in targets/ab/* (plugin off / plugin on)
// and, if EVERSHOP_DIR is set, on EverShop. Results land in the store and show in the "A/B and EverShop" tab.
//   node scripts/run-ab.js <recording-id>
const recordingId = process.argv[2] || 'mugshop-demo'
const lab = await createLab()
const server = createApp(lab).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
lab.publicUrl = `http://127.0.0.1:${server.address().port}`
try {
  const recording = lab.store.getRecording(recordingId)
  if (!recording) throw new Error(`No recording ${recordingId}`)
  const targets = [...lab.targets.values()].filter((t) => t.id.startsWith('ab-') || t.id === 'evershop')
  if (!targets.length) process.stdout.write('No agent-built handlers found. See targets/ab/README.md.\n')
  for (const target of targets) {
    if (target.precheck) {
      const check = await target.precheck({ orderId: recording.orderId, captureId: recording.captureId })
      process.stdout.write(`${target.id} precheck: ${check.reason}\n`)
      if (!check.ok) continue
    }
    for (const id of WEBHOOK_SCENARIO_IDS) {
      const run = await runScenario({ lab, scenario: scenarioById(id), recording, target })
      lab.store.saveRun(run)
      process.stdout.write(`${target.id} ${id} ${run.status} ${run.headline}\n`)
    }
  }
} finally {
  server.close()
  await lab.stop()
}
