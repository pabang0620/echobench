import { TOOL_SPECS } from './tools.js'

const MAX_STEPS = 12

export const SYSTEM_PROMPT = `You are the diagnosis step of EchoBench, a lab that replays recorded PayPal webhook deliveries against a developer's handler and judges the result against PayPal's own records.

You are given one failing scenario. Work like this:
- Read the failure (get_failures, get_timeline, check_invariants) and the recorded delivery involved (get_delivery).
- Read the handler (read_handler_file). Find the line that causes the failure and explain it in plain words a developer who has not read the code can follow: what happened, which rule broke, which line of the handler is responsible.
- Use lookup_sdk and read_contract for the exact PayPal operation and the plan's promises. Use paypal_truth to confirm what PayPal recorded.
- Propose a minimal patch with propose_patch. Prefer {file, old_str, new_str} edits that change only the lines involved over replacing a whole file, and keep comments and imports you do not need to change. It runs on a copy and is type-checked with tsc; if tsc fails, fix the error and try again (at most 3 attempts).
- get_failures lists every failing scenario of this handler. They can have different causes (shipping, refund books, missed events). One patch has to fix all of them: EchoBench accepts a patch only if every webhook scenario (S0, S1, S2, S3, S4, S5, S5b, S6, S7, D1) is green or a warning on the patched copy.
- When tsc passes, re-run the failing scenario and then every other scenario that failed before with run_scenario, and read the verdicts with check_invariants. Only report a fix as working if all of those re-runs are green. If one is still red, read its verdicts, patch again (at most 3 attempts) and say so honestly if it is still red.

Rules you cannot change: you never choose amounts, you cannot call PayPal to write, you cannot run contract scenarios (they move sandbox money and need a person's confirmation), and nothing is applied to the real handler until a person presses Apply. Keep the patch small and do not touch unrelated code. Answer in English, in short plain sentences.`

let sdkClient = null

async function client(apiKey) {
  if (!sdkClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    sdkClient = new Anthropic({ apiKey })
  }
  return sdkClient
}

// Live model loop over the Anthropic API (ANTHROPIC_API_KEY). Never run in this repository's tests; the mocked agent follows the same tool sequence.
// The account backend (accountAgent.js) runs the same prompt and tools through a Claude Code login instead.
export const userPrompt = (session) => `Diagnose scenario ${session.run.scenarioId} (run ${session.run.id}). Headline: ${session.run.headline}`

export async function runClaudeAgent({ session, tools, apiKey, model }) {
  const anthropic = await client(apiKey)
  const messages = [{ role: 'user', content: userPrompt(session) }]
  let text = ''
  const started = Date.now()
  const calls = []
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const response = await anthropic.messages.create({ model, max_tokens: 8000, system: SYSTEM_PROMPT, tools: TOOL_SPECS, messages })
    messages.push({ role: 'assistant', content: response.content })
    text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || text
    if (response.stop_reason !== 'tool_use') break
    const results = []
    for (const use of response.content.filter((b) => b.type === 'tool_use')) {
      const handler = tools[use.name]
      let output
      try {
        output = handler ? await handler(use.input || {}) : { error: `Unknown tool ${use.name}` }
      } catch (err) {
        output = { error: err.message }
      }
      calls.push({ tool: use.name, input: use.input || {}, ok: !output?.error, atMs: Date.now() - started })
      results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(output).slice(0, 12000), is_error: Boolean(output?.error) })
    }
    messages.push({ role: 'user', content: results })
  }
  session.modelCalls = calls
  return text
}
