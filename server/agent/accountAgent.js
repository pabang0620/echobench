import { z } from 'zod'
import { SYSTEM_PROMPT, userPrompt } from './claudeAgent.js'
import { TOOL_SPECS } from './tools.js'

// LLM_BACKEND=account: the same system prompt and the same ten tools, run through the Claude Agent SDK,
// which signs in with the developer's Claude Code login. The Anthropic API key is never passed on:
// it is removed from the environment of the Claude Code process, so nothing is billed to a key.
const SERVER_NAME = 'echobench'
const MAX_TURNS = 14

export const ACCOUNT_LABEL = 'Claude Sonnet (local account)'

export function withoutApiKey(env = process.env) {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, ...rest } = env
  return rest
}

async function loadSdk() {
  return import('@anthropic-ai/claude-agent-sdk')
}

// Maps the tool specs to SDK tools. Every call goes to the session's own tool functions and is noted in `calls`.
export function buildSdkTools(sdk, tools, calls, started = Date.now()) {
  return TOOL_SPECS.map((spec) =>
    sdk.tool(spec.name, spec.description, z.fromJSONSchema(spec.input_schema).shape, async (input) => {
      let output
      try {
        output = await tools[spec.name](input || {})
      } catch (err) {
        output = { error: err.message }
      }
      calls.push({ tool: spec.name, input, ok: !output?.error, atMs: Date.now() - started })
      return { content: [{ type: 'text', text: JSON.stringify(output).slice(0, 12000) }], isError: Boolean(output?.error) }
    }),
  )
}

export async function runAccountAgent({ session, tools, model, sdk = null }) {
  const agentSdk = sdk || (await loadSdk())
  const calls = []
  const server = agentSdk.createSdkMcpServer({ name: SERVER_NAME, version: '1.0.0', tools: buildSdkTools(agentSdk, tools, calls) })
  const stream = agentSdk.query({
    prompt: userPrompt(session),
    options: {
      model,
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      allowedTools: [`mcp__${SERVER_NAME}__*`],
      mcpServers: { [SERVER_NAME]: server },
      maxTurns: MAX_TURNS,
      effort: 'medium',
      settingSources: [],
      env: withoutApiKey(),
    },
  })
  let text = ''
  for await (const message of stream) {
    if (message.type !== 'result') continue
    if (message.subtype === 'success') text = message.result || ''
    else if (message.subtype !== 'error_max_turns') throw new Error(`Account agent failed: ${message.subtype}`)
  }
  session.modelCalls = calls
  return text.trim()
}
