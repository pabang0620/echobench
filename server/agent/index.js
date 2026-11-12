import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runScenario } from '../scenarios/engine.js'
import { SCENARIOS, WEBHOOK_SCENARIO_IDS, scenarioById } from '../scenarios/definitions.js'
import { HttpError } from '../http.js'
import { newId } from '../store.js'
import { applyCandidate, changedFiles, diffAgainst } from './patch.js'
import { createAgentSession } from './tools.js'
import { llmBackendOf } from '../config.js'
import { ACCOUNT_LABEL, runAccountAgent } from './accountAgent.js'
import { runClaudeAgent } from './claudeAgent.js'
import { loadRecorded, runRecorded, summarizeCall } from './recorded.js'
import { runMockAgent } from './mockAgent.js'
import { isVerified, verifyCandidate } from './verify.js'
import { explainRun } from './explain.js'
import { ownerTag } from '../visitors.js'
import { createLiveLimiter } from './liveLimit.js'

const limiters = new WeakMap()
const limiterOf = (lab) => {
  if (!limiters.has(lab)) limiters.set(lab, createLiveLimiter({ perIpHour: lab.cfg.liveLimitPerIpHour, perDay: lab.cfg.liveLimitPerDay, now: lab.cfg.now }))
  return limiters.get(lab)
}

const agentDir = (lab) => path.join(lab.cfg.dataDir, 'agent')

export function save(lab, record) {
  mkdirSync(agentDir(lab), { recursive: true })
  writeFileSync(path.join(agentDir(lab), `${record.id}.json`), JSON.stringify(record, null, 2))
}

// A diagnosis belongs to the visitor who asked for it (owner = a hash of their session). Older or
// precomputed ones have no owner and are shown to everyone; their patches cannot be applied.
const visibleTo = (record, visitor) => !record?.owner || visitor === undefined || record.owner === ownerTag(visitor)

export function getDiagnosis(lab, id, visitor) {
  const file = path.join(agentDir(lab), `${id}.json`)
  const record = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  return visibleTo(record, visitor) ? record : null
}

export function listDiagnoses(lab, runId, visitor) {
  const dir = agentDir(lab)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')))
    .filter((d) => d.runId === runId && visibleTo(d, visitor))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

// Diagnose one failing webhook run: explanation, a type-checked patch on a copy, and re-runs on that copy.
// `deps.runModel` replaces the Anthropic call (tests); it gets { session, tools } and returns the model's text.
export async function diagnose(lab, { runId, visitor, ip = 'local' }, deps = {}) {
  const run = lab.store.getRun(runId)
  if (!run) throw new HttpError(404, 'Unknown run')
  if (visitor !== undefined) lab.visitors.resolve(run.targetId, visitor)
  if (run.status !== 'red' && run.status !== 'amber') throw new HttpError(400, 'Only failing runs are diagnosed')
  if (run.kind !== 'webhook') throw new HttpError(403, 'Contract runs are explained by a person; the model has no access to them')
  const recording = lab.store.getRecording(run.recordingId)
  const target = lab.target(run.targetId)
  const { session, tools } = createAgentSession(lab, { run, recording, target })

  const backend = llmBackendOf(lab.cfg)
  const model = lab.cfg.anthropicModel
  let mode = backend === 'mock' ? 'mock' : 'live'
  let fallbackReason = null
  let result
  let modelMs = null
  if (mode === 'live') {
    const taken = limiterOf(lab).take(ip)
    if (!taken.ok) {
      fallbackReason = taken.reason
      mode = 'mock'
    }
  }
  if (mode === 'live') {
    const modelStarted = Date.now()
    try {
      const runModel = deps.runModel || (backend === 'account' ? (args) => runAccountAgent({ ...args, model }) : (args) => runClaudeAgent({ ...args, apiKey: lab.cfg.anthropicKey, model }))
      const text = await runModel({ session, tools })
      modelMs = Date.now() - modelStarted
      // Only the judge's verdicts come from EchoBench here. The words are the model's own (explanation.model).
      const source = backend === 'account' ? ACCOUNT_LABEL : `Claude (${model}, Anthropic API)`
      result = { explanation: { cause: [], fix: [], evidence: explainRun(run).evidence, model: text || '', modelName: model, source }, patch: session.candidate ? { ok: session.candidate.tsc.ok } : null }
    } catch (err) {
      fallbackReason = `Claude API unavailable: ${String(err.message).slice(0, 160)}`
      mode = 'mock'
      await tools.discard()
      session.steps.length = 0
    }
  }
  const recorded = mode === 'mock' ? loadRecorded(lab.cfg.recordedDir, run.scenarioId) : null
  if (recorded && target.meta?.editable) {
    result = await runRecorded({ session, tools, recorded })
    if (session.candidate) mode = 'recorded'
    else {
      session.steps.length = 0
      result = null
    }
  }
  if (!result) result = await runMockAgent({ session, tools })
  // The server runs the re-run and the suite itself, in both modes. Nothing the model claims counts.
  const checked = await verifyCandidate({ session })

  const candidate = session.candidate
  const record = {
    id: newId('diag'),
    runId,
    scenarioId: run.scenarioId,
    targetId: target.id,
    owner: ownerTag(visitor),
    mode,
    fallbackReason,
    createdAt: new Date().toISOString(),
    explanation: result.explanation,
    steps: session.steps,
    recorded: mode === 'recorded' ? { backend: recorded.backend, model: recorded.model, source: recorded.source, recordedAt: recorded.recordedAt, durationMs: recorded.durationMs ?? null, toolCalls: recorded.toolCalls } : null,
    modelMs: mode === 'live' ? modelMs : null,
    modelCalls: mode === 'live' ? session.modelCalls.map((c) => ({ tool: c.tool, ok: c.ok, summary: summarizeCall(c), ...(Number.isInteger(c.atMs) ? { atMs: c.atMs } : {}) })) : [],
    patchEdits: mode === 'live' && candidate ? session.candidateEdits : null,
    candidate: candidate && {
      id: candidate.id,
      dir: candidate.dir,
      tscOk: candidate.tsc.ok,
      tsc: candidate.tsc.output,
      files: candidate.files,
      diff: diffAgainst(target.meta.workspace, candidate.dir),
      rerun: checked.rerun,
      suite: checked.suite,
      verified: isVerified(candidate, checked.rerun, checked.suite),
      applied: false,
    },
  }
  save(lab, record)
  return record
}

// Apply = copy the candidate files over the visitor's own working copy of MugShop (made from the planted
// source on their first Apply, so nobody else sees the change). Needs an explicit confirmation and a
// verified candidate. The repository source and the shared planted copy are never touched.
// Then every scenario that moves no money is re-run on the patched copy, so the badge and the cards show the
// patch's real results, not the results from before it. The two that move money need a confirmation card.
export async function applyDiagnosis(lab, { diagnosisId, confirm, operator, visitor }) {
  if (confirm !== true) throw new HttpError(400, 'Apply needs confirm: true')
  const record = getDiagnosis(lab, diagnosisId, visitor)
  if (!record?.candidate) throw new HttpError(404, 'No patch to apply')
  if (!record.candidate.verified) throw new HttpError(409, 'Only a patch that passed tsc and turned the scenario green can be applied')
  if (record.candidate.applied) throw new HttpError(409, 'Already applied')
  const source = lab.visitors.resolve(record.targetId, visitor)
  if (!source.meta?.editable || !source.meta?.workspace) throw new HttpError(400, 'This target cannot be edited by EchoBench')
  if (!existsSync(record.candidate.dir)) throw new HttpError(409, 'The patched copy no longer exists; diagnose again')

  const { target, entry } = await lab.exclusive(async () => {
    const own = source.meta.visitor ? source : await lab.visitors.ensure(visitor)
    const base = own.meta.workspace
    const files = changedFiles(base, record.candidate.dir)
    const diff = diffAgainst(base, record.candidate.dir)
    applyCandidate(base, record.candidate.dir)
    await own.stop()
    return { target: own, entry: { id: newId('apply'), diagnosisId, targetId: own.id, owner: ownerTag(visitor), files, appliedBy: operator, appliedAt: new Date().toISOString(), diff } }
  })
  lab.store.addApply(entry)
  record.candidate.applied = true
  record.appliedAt = entry.appliedAt
  save(lab, record)

  // The diagnosed scenario first (the card opens on it), then the rest.
  const failed = lab.store.getRun(record.runId)
  const recording = lab.store.getRecording(failed.recordingId)
  const order = [failed.scenarioId, ...SCENARIOS.filter((s) => !s.movesMoney && s.id !== failed.scenarioId).map((s) => s.id)]
  const reruns = []
  for (const scenarioId of order) {
    const run = await lab.exclusive(() => runScenario({ lab, scenario: scenarioById(scenarioId), recording, target }))
    lab.store.saveRun(run)
    reruns.push({ scenarioId, run_id: run.id, status: run.status, headline: run.headline })
  }
  const first = reruns[0]
  return { apply: entry, rerun: { run_id: first.run_id, status: first.status, headline: first.headline }, reruns }
}

export async function resetWorkspace(lab, targetId) {
  const { prepareWorkspace } = await import('../targets/mugshop.js')
  const target = lab.target(targetId)
  if (!target.meta?.editable) throw new HttpError(400, 'Only the planted MugShop copy can be reset')
  await target.stop()
  prepareWorkspace(lab.cfg.dataDir, target.id, 'planted', { force: true })
}

export { WEBHOOK_SCENARIO_IDS }
