import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../server/app.js'
import { createLab } from '../server/lab.js'
import { diagnose } from '../server/agent/index.js'
import { buildRecorded, recordedFile } from '../server/agent/recorded.js'
import { scenarioById } from '../server/scenarios/definitions.js'
import { runScenario } from '../server/scenarios/engine.js'
import { APP_ROOT } from '../server/config.js'

// V10: one real diagnosis. PayPal stays the local stand-in. Needs LLM_BACKEND=account (a Claude Code login) or ANTHROPIC_API_KEY.
//   LLM_BACKEND=account node scripts/verify-model.js S1 [--record]
// --record also writes builtin/live-diagnosis.json so the app can replay the run without a key.
const scenarioId = process.argv[2] || 'S1'
const record = process.argv.includes('--record')
const scratch = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.scratch')
mkdirSync(scratch, { recursive: true })
const dataDir = mkdtempSync(path.join(scratch, 'v10-'))
const backend = process.env.LLM_BACKEND === 'account' ? 'account' : 'api'
const overrides = { dataDir, mode: 'mock', settleWindowMs: 6000, llmBackend: backend, ...(backend === 'account' ? { anthropicKey: '' } : {}) }
const lab = await createLab(overrides)
const server = createApp(lab).listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
lab.publicUrl = `http://127.0.0.1:${server.address().port}`
lab.mock?.registerWebhook(`${lab.publicUrl}/hooks/paypal`)
try {
  const recording = lab.store.getRecording('mugshop-demo')
  const run = await runScenario({ lab, scenario: scenarioById(scenarioId), recording, target: lab.target('mugshop') })
  lab.store.saveRun(run)
  process.stdout.write(`${scenarioId} before: ${run.status} ${run.headline}\n`)
  const started = Date.now()
  const diagnosis = await diagnose(lab, { runId: run.id })
  const summary = {
    step: 'V10',
    at: new Date().toISOString(),
    backend,
    mode: diagnosis.mode,
    fallbackReason: diagnosis.fallbackReason,
    model: diagnosis.explanation.modelName,
    seconds: Math.round((Date.now() - started) / 1000),
    modelToolOrder: diagnosis.modelCalls.map((c) => `${c.tool}${c.summary ? `(${c.summary})` : ''}${c.ok ? '' : ' [error]'}`),
    tscOk: diagnosis.candidate?.tscOk ?? null,
    rerun: diagnosis.candidate?.rerun?.status ?? null,
    suite: diagnosis.candidate?.suite?.map((s) => `${s.scenario}:${s.status}`).join(' ') ?? null,
    verified: diagnosis.candidate?.verified ?? null,
    diffLines: diagnosis.candidate?.diff ? diagnosis.candidate.diff.split('\n').length : 0,
  }
  appendFileSync(path.join(APP_ROOT, 'VERIFY_RESULTS.json'), `${JSON.stringify(summary)}\n`)
  writeFileSync(path.join(scratch, 'v10-last-diagnosis.json'), JSON.stringify(diagnosis, null, 2))
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n\nModel text:\n${diagnosis.explanation.model}\n\nDiff:\n${diagnosis.candidate?.diff || '(none)'}\n`)
  if (record) {
    writeFileSync(recordedFile(path.join(APP_ROOT, 'builtin')), `${JSON.stringify(buildRecorded(diagnosis), null, 2)}\n`)
    process.stdout.write('Wrote builtin/live-diagnosis.json\n')
  }
} finally {
  server.close()
  await lab.stop()
  rmSync(dataDir, { recursive: true, force: true })
}
