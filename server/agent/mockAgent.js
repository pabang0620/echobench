import { readFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from '../config.js'
import { explainRun } from './explain.js'

const FIXED = path.join(APP_ROOT, 'targets', 'mugshop', 'fixes', 'webhook.fixed.ts')

// Stand-in for the model when there is no API key. It follows the same tool sequence a real
// diagnosis would (read the failure, the delivery, the handler, then try a patch on a copy) and
// uses the real tools, so the type check and the re-runs are real. Only the thinking is canned:
// the explanation text and the patch come from the failing rule and the reference fix.
export async function runMockAgent({ session, tools }) {
  const { run, target } = session
  await tools.get_failures()
  await tools.get_timeline()
  const label = run.deliveries.find((d) => d.label && !d.skipped)?.label?.split(' ')[0]
  if (['approved', 'completed', 'refund1', 'refund2', 'dispute'].includes(label)) await tools.get_delivery({ label })
  await tools.read_handler_file({ path: 'src/webhook.ts' })

  const explanation = explainRun(run)
  if (!target.meta?.editable) {
    return { explanation: { ...explanation, fix: [...explanation.fix, 'No canned patch exists for this target. Set ANTHROPIC_API_KEY to have the model write one.'] }, patch: null }
  }
  const patch = await tools.propose_patch({ edits: [{ file: 'src/webhook.ts', content: readFileSync(FIXED, 'utf8') }] })
  return { explanation, patch }
}
