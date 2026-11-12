import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { explainRun } from './explain.js'

// A real model run (account or API backend), saved once with `npm run record-live` and replayed without a key.
// Replay is honest about it: the text, the tool order and the edits are the model's from that day, labeled
// "Recorded live run". The patch is still applied to a copy, type-checked and re-run by this server.
const recordedSchema = z.object({
  scenarioId: z.string(),
  backend: z.enum(['account', 'api']),
  model: z.string(),
  source: z.string(),
  recordedAt: z.string(),
  text: z.string(),
  toolCalls: z.array(z.object({ tool: z.string(), summary: z.string() })),
  edits: z.array(z.object({ file: z.string(), old_str: z.string().optional(), new_str: z.string().optional(), content: z.string().optional() })).min(1),
})

export const recordedFile = (builtinDir) => path.join(builtinDir, 'live-diagnosis.json')

export function loadRecorded(dir, scenarioId) {
  if (!dir) return null
  const file = recordedFile(dir)
  if (!existsSync(file)) return null
  const parsed = recordedSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  return parsed.success && parsed.data.scenarioId === scenarioId ? parsed.data : null
}

// Replays the recorded edits through the real propose_patch tool, so tsc and the re-runs stay real.
export async function runRecorded({ session, tools, recorded }) {
  const patch = await tools.propose_patch({ edits: recorded.edits })
  return {
    explanation: { cause: [], fix: [], evidence: explainRun(session.run).evidence, model: recorded.text, modelName: recorded.model, source: recorded.source, recordedAt: recorded.recordedAt },
    patch: session.candidate ? { ok: session.candidate.tsc.ok } : patch,
  }
}

// What a diagnosis record keeps of a live run, to build the recorded file from it.
export function summarizeCall(call) {
  const input = call.input || {}
  if (call.tool === 'propose_patch') return `${(input.edits || []).length} edit(s) in ${[...new Set((input.edits || []).map((e) => e.file))].join(', ')}`
  return String(input.path || input.label || input.scenario_id || input.run_id || input.order_id || input.name || '')
}

// For the status badge: "Claude Sonnet (local account), 2026-11-12" when a recorded run ships with the app.
export function recordedLabel(lab) {
  if (!lab.cfg.recordedDir) return null
  const file = recordedFile(lab.cfg.recordedDir)
  if (!existsSync(file)) return null
  const parsed = recordedSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  return parsed.success ? { source: parsed.data.source, model: parsed.data.model, recordedAt: parsed.data.recordedAt, scenarioId: parsed.data.scenarioId } : null
}

// Builds the file `builtin/live-diagnosis.json` from a live diagnosis record. Only a verified patch is worth replaying.
export function buildRecorded(record) {
  if (record.mode !== 'live') throw new Error('Only a live diagnosis can be recorded (mode: live)')
  if (!record.candidate?.verified || !record.patchEdits?.length) throw new Error('The diagnosis has no verified patch to record')
  const backend = record.explanation.source?.includes('account') ? 'account' : 'api'
  return recordedSchema.parse({
    scenarioId: record.scenarioId,
    backend,
    model: record.explanation.modelName,
    source: record.explanation.source,
    recordedAt: record.createdAt.slice(0, 10),
    text: record.explanation.model,
    toolCalls: record.modelCalls.map((c) => ({ tool: c.tool, summary: c.summary })),
    edits: record.patchEdits,
  })
}
