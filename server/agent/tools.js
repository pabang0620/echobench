import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from '../config.js'
import { parsePlan } from '../contract/parser.js'
import { contractRows } from '../contract/annotate.js'
import { createMugshopTarget } from '../targets/mugshop.js'
import { runScenario } from '../scenarios/engine.js'
import { scenarioById } from '../scenarios/definitions.js'
import { applyEdits, createCandidate, diffAgainst, discardCandidate, typecheck } from './patch.js'
import { lookupSdk } from './sdkMap.js'

export const MAX_PATCH_ATTEMPTS = 3
const SAFE_READ = /^(src\/[A-Za-z0-9_.-]+\.ts|paypal-plan\.md)$/

// The tools the agent may use. There is deliberately no PayPal write call, no contract scenario
// and no way to run anything outside the copy: the model proposes, code and people decide.
export function createAgentSession(lab, { run, recording, target }) {
  const session = { lab, run, recording, target, candidate: null, candidateEdits: null, modelCalls: [], attempts: 0, steps: [] }

  const baseWorkspace = target.meta?.workspace
  const activeTarget = () => session.candidate?.target || target
  const note = (tool, summary, result) => {
    session.steps.push({ tool, summary })
    return result
  }

  const tools = {
    async get_timeline() {
      return note('get_timeline', `timeline of ${run.scenarioId}`, { scenario: run.scenarioId, timeline: run.timeline, headline: run.headline })
    },
    async get_failures() {
      const runs = lab.store.listRuns({ recordingId: recording.id, targetId: target.id })
      const latest = new Map()
      for (const r of runs) if (!latest.has(r.scenarioId)) latest.set(r.scenarioId, r)
      const failures = [...latest.values()].filter((r) => r.status === 'red' || r.status === 'amber').map((r) => ({ run_id: r.id, scenario: r.scenarioId, status: r.status, headline: r.headline }))
      return note('get_failures', `${failures.length} failing scenario(s)`, { failures })
    },
    async get_delivery({ label }) {
      const d = [...recording.deliveries, ...(recording.extras?.dispute ? [recording.extras.dispute] : [])].find((x) => x.label === label)
      if (!d) return { error: `No delivery labelled ${label}` }
      const headers = { ...d.headers, 'paypal-transmission-sig': `${d.headers['paypal-transmission-sig']?.slice(0, 16)}...` }
      return note('get_delivery', `${label} (${d.eventType})`, { label, eventType: d.eventType, headers, body: JSON.parse(Buffer.from(d.bodyBase64, 'base64').toString('utf8')) })
    },
    async read_contract() {
      const file = path.join(APP_ROOT, 'paypal-plan.md')
      if (!existsSync(file) || target.meta?.group) return note('read_contract', 'no plan for this target', { error: 'This target has no paypal-plan.md' })
      const parsed = parsePlan(readFileSync(file, 'utf8'))
      return note('read_contract', `${parsed.tables.length} tables`, { rows: contractRows(parsed, {}), tbd: parsed.tbd, blockers: parsed.blockers })
    },
    async read_handler_file({ path: rel }) {
      if (!SAFE_READ.test(rel)) return { error: 'Only files under src/ of the target copy can be read' }
      const root = session.candidate?.dir || baseWorkspace
      const file = path.join(root || '', rel)
      if (!root || !existsSync(file)) return { error: `No such file: ${rel}` }
      return note('read_handler_file', rel, { path: rel, text: readFileSync(file, 'utf8') })
    },
    async lookup_sdk({ name }) {
      return note('lookup_sdk', String(name), lookupSdk(name))
    },
    async paypal_truth({ order_id }) {
      const ledger = await lab.truth.order(order_id)
      return note('paypal_truth', `PayPal records for ${order_id}`, ledger)
    },
    async run_scenario({ scenario_id }) {
      const scenario = scenarioById(scenario_id)
      if (!scenario) return { error: `Unknown scenario ${scenario_id}` }
      if (scenario.kind !== 'webhook') return { error: 'Contract scenarios move money and can only be run by a person after the confirmation card' }
      const result = await lab.exclusive(() => runScenario({ lab, scenario, recording, target: activeTarget() }))
      lab.store.saveRun(result)
      return note('run_scenario', `${scenario_id} on ${activeTarget().id}: ${result.status}`, { run_id: result.id, status: result.status, headline: result.headline })
    },
    async check_invariants({ run_id }) {
      const r = lab.store.getRun(run_id)
      if (!r) return { error: 'Unknown run' }
      return note('check_invariants', `${r.verdicts.length} verdict(s) for ${r.scenarioId}`, { status: r.status, verdicts: r.verdicts.map((v) => ({ rule: v.rule, status: v.status, message: v.message })) })
    },
    async propose_patch({ edits }) {
      if (!baseWorkspace) return { error: 'This target has no editable copy, so no patch can be tried' }
      if (session.attempts >= MAX_PATCH_ATTEMPTS) return { error: `At most ${MAX_PATCH_ATTEMPTS} patch attempts per diagnosis` }
      session.attempts += 1
      await tools.discard()
      const created = createCandidate(lab.cfg.dataDir, baseWorkspace)
      let files
      try {
        files = applyEdits(created.dir, edits)
      } catch (err) {
        discardCandidate(created.dir)
        return note('propose_patch', `attempt ${session.attempts} rejected`, { ok: false, error: err.message })
      }
      const tsc = await typecheck(created.dir)
      const candidateTarget = lab.addTarget(createMugshopTarget(lab, { id: `cand-${created.id}`, variant: 'candidate', workspace: created.dir }))
      session.candidate = { id: created.id, dir: created.dir, target: candidateTarget, files, tsc }
      session.candidateEdits = edits
      const diff = diffAgainst(baseWorkspace, created.dir)
      return note('propose_patch', `attempt ${session.attempts}: tsc ${tsc.ok ? 'passed' : 'FAILED'}`, { ok: tsc.ok, tsc, files, diff })
    },
    async discard() {
      if (!session.candidate) return
      await session.candidate.target.stop()
      lab.targets.delete(session.candidate.target.id)
      discardCandidate(session.candidate.dir)
      session.candidate = null
    },
  }
  return { session, tools }
}

export const TOOL_SPECS = [
  { name: 'get_timeline', description: 'The two-line timeline (PayPal records vs shop books) and headline of the failing run.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_failures', description: 'Latest failing scenarios for this target and recording.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_delivery', description: 'A recorded PayPal delivery by label: approved, completed, refund1, refund2, dispute.', input_schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } },
  { name: 'read_contract', description: "The target's paypal-plan.md rows (DUPLICATE CLAIMS, UNKNOWN OUTCOMES, INVARIANTS).", input_schema: { type: 'object', properties: {} } },
  { name: 'read_handler_file', description: 'Read a source file of the target copy, for example src/webhook.ts.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'lookup_sdk', description: 'Look up an APIMatic PayPal SDK operation, for example payments.refundCapturedPayment.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'paypal_truth', description: "Read-only: PayPal's own records of an order (captures and refunds).", input_schema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'] } },
  { name: 'run_scenario', description: 'Re-run a webhook scenario (S0..S7, D1) on the patched copy if one exists, otherwise on the original. Contract scenarios are not available.', input_schema: { type: 'object', properties: { scenario_id: { type: 'string' } }, required: ['scenario_id'] } },
  { name: 'check_invariants', description: 'The rule verdicts of a run.', input_schema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'] } },
  { name: 'propose_patch', description: 'Apply edits to a COPY of the handler, type-check it with tsc, return the diff. Edits are {file, old_str, new_str} (old_str must occur once) or {file, content}. At most 3 attempts.', input_schema: { type: 'object', properties: { edits: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' }, content: { type: 'string' } }, required: ['file'] } } }, required: ['edits'] } },
]
