import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../server/app.js'
import { createLab } from '../server/lab.js'
import { CONTRACT_REFUND_AMOUNT, SCENARIOS } from '../server/scenarios/definitions.js'
import { runScenario } from '../server/scenarios/engine.js'
import { diagnose } from '../server/agent/index.js'
import { BUILTIN_ID } from '../server/seed.js'
import { APP_ROOT } from '../server/config.js'

// Runs every scenario on the planted MugShop and on the reference fix, then lets the (mocked) AI
// step diagnose each failing webhook run. Output: builtin/precomputed.json.
const scratch = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.scratch')
mkdirSync(scratch, { recursive: true })
const dataDir = mkdtempSync(path.join(scratch, 'pre-'))
const lab = await createLab({ dataDir, mode: 'mock', anthropicKey: '', settleWindowMs: 6000 })
const server = createApp(lab).listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
lab.publicUrl = `http://127.0.0.1:${server.address().port}`

try {
  const recording = lab.store.getRecording(BUILTIN_ID)
  const runs = []
  for (const targetId of ['mugshop', 'mugshop-reference', 'mugshop-contrast']) {
    for (const scenario of SCENARIOS) {
      const run = await runScenario({ lab, scenario, recording, target: lab.target(targetId) })
      run.precomputed = true
      if (scenario.movesMoney) {
        run.confirmedBy = 'precompute script (local PayPal stand-in, no real money)'
        run.card = { amount: CONTRACT_REFUND_AMOUNT, captureId: recording.contract.captureId, environment: 'Local PayPal stand-in (no real money, no sandbox)' }
      }
      lab.store.saveRun(run)
      runs.push(run)
      process.stdout.write(`${targetId} ${scenario.id} ${run.status}\n`)
    }
  }
  const diagnoses = []
  for (const run of runs.filter((r) => r.targetId === 'mugshop' && r.kind === 'webhook' && (r.status === 'red' || r.status === 'amber'))) {
    const diagnosis = await diagnose(lab, { runId: run.id })
    diagnosis.precomputed = true
    if (diagnosis.candidate) diagnosis.candidate.dir = null
    diagnoses.push(diagnosis)
    process.stdout.write(`diagnosed ${run.scenarioId} tsc=${diagnosis.candidate?.tscOk} verified=${diagnosis.candidate?.verified}\n`)
    await lab.target('mugshop').stop()
  }
  writeFileSync(path.join(APP_ROOT, 'builtin', 'precomputed.json'), JSON.stringify({ generatedAt: new Date().toISOString(), recordingId: BUILTIN_ID, note: 'Computed against the local PayPal stand-in with the mocked AI step.', runs, diagnoses }, null, 1))
} finally {
  server.close()
  await lab.stop()
  rmSync(dataDir, { recursive: true, force: true })
}
