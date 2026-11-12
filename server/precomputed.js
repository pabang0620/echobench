import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from './config.js'
import { getDiagnosis, save } from './agent/index.js'

// Results computed ahead of time (npm run precompute) against the built-in recording and the local
// PayPal stand-in, so the first screen and the AI cards are full before anyone presses Run.
// They are marked precomputed: true, and every Run button still runs the real thing.
export function importPrecomputed(lab) {
  const file = path.join(APP_ROOT, 'builtin', 'precomputed.json')
  if (!existsSync(file)) return 0
  const data = JSON.parse(readFileSync(file, 'utf8'))
  // R2 plugin off / on runs (scripts/run-ab.js), shown in the A/B tab.
  const abFile = path.join(APP_ROOT, 'builtin', 'ab-runs.json')
  const abRuns = existsSync(abFile) ? JSON.parse(readFileSync(abFile, 'utf8')).runs : []
  let added = 0
  for (const run of [...data.runs, ...abRuns]) {
    if (!lab.store.getRun(run.id)) {
      lab.store.saveRun(run)
      added += 1
    }
  }
  for (const diagnosis of data.diagnoses) if (!getDiagnosis(lab, diagnosis.id)) save(lab, diagnosis)
  return added
}
