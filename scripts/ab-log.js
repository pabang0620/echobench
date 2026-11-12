import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Turns one R2 raw stream (generation.stream.jsonl) into a readable GENERATION_LOG.md next to it.
// Nothing is summarised away: every tool call and every tool result is copied (results cut at 4000 chars).
//   node scripts/ab-log.js <folder> "<title>" "<command line>" <started-iso>
const [folder, title, command, started] = process.argv.slice(2)
const lines = readFileSync(path.join(folder, 'generation.stream.jsonl'), 'utf8').split('\n').filter(Boolean)
const events = lines.map((l) => JSON.parse(l))
const init = events.find((e) => e.type === 'system' && e.subtype === 'init') || {}
const result = events.find((e) => e.type === 'result') || {}
const fence = (text) => `\n\`\`\`\n${String(text).replaceAll('```', "'''").slice(0, 4000)}\n\`\`\`\n`
const out = [
  `# Generation log: ${title}`,
  '',
  `Started ${started} (UTC). Claude Code ${init.claude_code_version}, model \`${init.model}\`, through the local Claude Code account (apiKeySource: ${init.apiKeySource}).`,
  `Command: \`${command}\``,
  'Run in an empty folder outside any project (no CLAUDE.md, no user settings, no MCP servers). The only difference between the two runs of this round is the `--plugin-dir` flag.',
  '',
  `Plugins loaded: ${(init.plugins || []).map((p) => `${p.name} ${p.version || ''}`.trim()).join(', ')}`,
  `Skills the session could use (${(init.skills || []).length}): ${(init.skills || []).join(', ')}`,
  '',
  `Result: ${result.subtype}, ${result.num_turns} turns, ${Math.round((result.duration_ms || 0) / 1000)} s.`,
  '',
  'The raw stream is `generation.stream.jsonl` in this folder. Nothing in this folder was edited by hand after generation.',
  '',
  '## Transcript',
  '',
]
for (const e of events) {
  const content = e.message?.content
  if (!Array.isArray(content)) continue
  for (const c of content) {
    if (e.type === 'assistant' && c.type === 'text' && c.text.trim()) out.push(`**Model**\n\n${c.text.trim()}\n`)
    if (e.type === 'assistant' && c.type === 'tool_use') {
      const body = c.name === 'Bash' ? c.input.command : c.name === 'Write' ? `${c.input.file_path}\n\n${c.input.content}` : JSON.stringify(c.input, null, 1)
      out.push(`**Tool call \`${c.name}\`**${fence(body)}`)
    }
    if (e.type === 'user' && c.type === 'tool_result') {
      const text = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('\n') : c.content
      out.push(`Tool result:${fence(text)}`)
    }
  }
}
if (result.result) out.push(`## Final answer\n\n${result.result}\n`)
writeFileSync(path.join(folder, 'GENERATION_LOG.md'), out.join('\n'))
