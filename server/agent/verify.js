import { runScenario } from '../scenarios/engine.js'
import { WEBHOOK_SCENARIO_IDS, scenarioById } from '../scenarios/definitions.js'

const PASSING = ['green', 'amber']

// EchoBench's own check of a patch, run by the server after the model (or the mocked model) is done.
// Whatever the model says about its fix is ignored: the failing scenario and the whole webhook suite are
// run on the patched copy by this code, and `verified` is computed from those runs and from tsc.
export async function verifyCandidate({ session }) {
  const { lab, run, recording, candidate } = session
  if (!candidate || !candidate.tsc.ok) return { rerun: null, suite: null }
  const runOn = async (scenarioId) => {
    const result = await lab.exclusive(() => runScenario({ lab, scenario: scenarioById(scenarioId), recording, target: candidate.target }))
    lab.store.saveRun(result)
    session.steps.push({ tool: 'run_scenario', summary: `(run by the server) ${scenarioId} on the patched copy: ${result.status}` })
    return result
  }
  const again = await runOn(run.scenarioId)
  const rerun = { run_id: again.id, status: again.status, headline: again.headline }
  const suite = []
  for (const id of WEBHOOK_SCENARIO_IDS) suite.push({ scenario: id, status: (await runOn(id)).status })
  return { rerun, suite }
}

export function isVerified(candidate, rerun, suite) {
  return Boolean(candidate?.tsc?.ok && PASSING.includes(rerun?.status) && Array.isArray(suite) && suite.length > 0 && suite.every((s) => PASSING.includes(s.status) || s.status === 'na'))
}
