import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT, loadConfig } from '../server/config.js'
import { buildRecorded, recordedFile } from '../server/agent/recorded.js'

// Turns one live diagnosis (data/agent/<id>.json, written by "Explain and fix" with LLM_BACKEND=account or
// ANTHROPIC_API_KEY, or by scripts/verify-model.js) into builtin/live-diagnosis.json. Keys and tokens are never in it.
//   node scripts/record-live.js <diagnosis-id>
const id = process.argv[2]
if (!id || !/^[\w-]+$/.test(id)) throw new Error('Usage: node scripts/record-live.js <diagnosis-id>')
const cfg = loadConfig()
const file = path.join(cfg.dataDir, 'agent', `${id}.json`)
if (!existsSync(file)) throw new Error(`No diagnosis at ${file}`)
const recorded = buildRecorded(JSON.parse(readFileSync(file, 'utf8')))
writeFileSync(recordedFile(path.join(APP_ROOT, 'builtin')), `${JSON.stringify(recorded, null, 2)}\n`)
process.stdout.write(`Wrote builtin/live-diagnosis.json (${recorded.source}, ${recorded.recordedAt}, ${recorded.toolCalls.length} tool calls)\n`)
