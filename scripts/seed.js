import { mkdtempSync, rmSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildBuiltinRecording } from '../server/seed.js'

// The scratch folder must sit inside the app so the workspace copy of MugShop can resolve node_modules.
const scratch = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.scratch')
mkdirSync(scratch, { recursive: true })
const dataDir = mkdtempSync(path.join(scratch, 'seed-'))
try {
  const result = await buildBuiltinRecording({ dataDir })
  process.stdout.write(`Built-in recording written to ${result.dir}\nDeliveries: ${result.deliveries.join(', ')}\nStart points: ${result.startPoints.join(', ')}\n`)
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
