import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runScenario } from '../scenarios/engine.js'
import { WEBHOOK_SCENARIO_IDS, scenarioById } from '../scenarios/definitions.js'
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

const agentDir = (lab) => path.join(lab.cfg.dataDir, 'agent')

export function save(lab, record) {
  mkdirSync(agentDir(lab), { recursive: true })
  writeFileSync(path.join(agentDir(lab), `${record.id}.json`), JSON.stringify(record, null, 2))
}

export function getDiagnosis(lab, id) {
  const file = path.join(agentDir(lab), `${id}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

export function listDiagnoses(lab, runId) {
  const dir = agentDir(lab)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')))
    .filter((d) => d.runId === runId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

// Diagnose one failing webhook run: explanation, a type-checked patch on a copy, and re-runs on that copy.
// `deps.runModel` replaces the Anthropic call (tests); it gets { session, tools } and returns the model's text.
export async function diagnose(lab, { runId }, deps = {}) {
  const run = lab.store.getRun(runId)
  if (!run) throw new HttpError(404, 'Unknown run')
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
  if (mode === 'live') {
    try {
      const runModel = deps.runModel || (backend === 'account' ? (args) => runAccountAgent({ ...args, model }) : (args) => runClaudeAgent({ ...args, apiKey: lab.cfg.anthropicKey, model }))
      const text = await runModel({ session, tools })
      // Only the judge's verdicts come from EchoBench here. The words are the model's own (explanation.model).
      const source = backend === 'account' ? ACCOUNT_LABEL : `Claude (${model}, Anthropic API)`
      result = { explanation: { cause: [], fix: [], evidence: explainRun(run).evidence, model: text || '', modelName: model, source }, patch: session.candidate ? { ok: session.candidate.tsc.ok } : null }
    } catch (err) {
      fallbackReason = String(err.message).slice(0, 200)
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
    mode,
    fallbackReason,
    createdAt: new Date().toISOString(),
    explanation: result.explanation,
    steps: session.steps,
    recorded: mode === 'recorded' ? { backend: recorded.backend, model: recorded.model, source: recorded.source, recordedAt: recorded.recordedAt, toolCalls: recorded.toolCalls } : null,
    modelCalls: mode === 'live' ? session.modelCalls.map((c) => ({ tool: c.tool, ok: c.ok, summary: summarizeCall(c) })) : [],
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

// Apply = copy the candidate files over the editable workspace. Needs an explicit confirmation
// and a verified candidate. The repository source is never touched.
export async function applyDiagnosis(lab, { diagnosisId, confirm, operator }) {
  if (confirm !== true) throw new HttpError(400, 'Apply needs confirm: true')
  const record = getDiagnosis(lab, diagnosisId)
  if (!record?.candidate) throw new HttpError(404, 'No patch to apply')
  if (!record.candidate.verified) throw new HttpError(409, 'Only a patch that passed tsc and turned the scenario green can be applied')
  if (record.candidate.applied) throw new HttpError(409, 'Already applied')
  const target = lab.target(record.targetId)
  const base = target.meta?.workspace
  if (!target.meta?.editable || !base) throw new HttpError(400, 'This target cannot be edited by EchoBench')
  if (!existsSync(record.candidate.dir)) throw new HttpError(409, 'The patched copy no longer exists; diagnose again')

  const files = changedFiles(base, record.candidate.dir)
  const diff = diffAgainst(base, record.candidate.dir)
  applyCandidate(base, record.candidate.dir)
  const entry = { id: newId('apply'), diagnosisId, targetId: target.id, files, appliedBy: operator, appliedAt: new Date().toISOString(), diff }
  lab.store.addApply(entry)
  record.candidate.applied = true
  record.appliedAt = entry.appliedAt
  save(lab, record)

  // Re-run the failing scenario on the real workspace to show the change took.
  const run = lab.store.getRun(record.runId)
  const scenario = scenarioById(run.scenarioId)
  const recording = lab.store.getRecording(run.recordingId)
  const confirmRun = await lab.exclusive(() => runScenario({ lab, scenario, recording, target }))
  lab.store.saveRun(confirmRun)
  return { apply: entry, rerun: { run_id: confirmRun.id, status: confirmRun.status, headline: confirmRun.headline } }
}

export async function resetWorkspace(lab, targetId) {
  const { prepareWorkspace } = await import('../targets/mugshop.js')
  const target = lab.target(targetId)
  if (!target.meta?.editable) throw new HttpError(400, 'Only the planted MugShop copy can be reset')
  await target.stop()
  prepareWorkspace(lab.cfg.dataDir, target.id, 'planted', { force: true })
}

export { WEBHOOK_SCENARIO_IDS }
