// Renders the model's plain markdown (headings, lists, bold, code, small tables) as elements. No HTML is ever injected.
function Inline({ text }) {
  return String(text).split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return <code key={i} className="mono">{part.slice(1, -1)}</code>
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return <strong key={i}><Inline text={part.slice(2, -2)} /></strong>
    return part
  })
}

const isRow = (line) => /^\s*\|.*\|\s*$/.test(line)
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

function parseBlocks(text) {
  const lines = String(text ?? '').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i += 1; continue }
    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (heading) { blocks.push({ type: 'h', text: heading[1] }); i += 1; continue }
    if (isRow(line)) {
      const rows = []
      while (i < lines.length && isRow(lines[i])) { rows.push(lines[i]); i += 1 }
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map(cells)
      blocks.push({ type: 'table', head: body[0] || [], rows: body.slice(1) })
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i += 1 }
      blocks.push({ type: ordered ? 'ol' : 'ul', items })
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !isRow(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) { para.push(lines[i]); i += 1 }
    blocks.push({ type: 'p', text: para.join(' ') })
  }
  return blocks
}

export default function ModelText({ text }) {
  return (
    <div className="model-text">
      {parseBlocks(text).map((b, k) => {
        if (b.type === 'h') return <h5 key={k}><Inline text={b.text} /></h5>
        if (b.type === 'p') return <p key={k}><Inline text={b.text} /></p>
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type
          return <List key={k}>{b.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</List>
        }
        return (
          <table key={k} className="model-table">
            <thead><tr>{b.head.map((c, j) => <th key={j}><Inline text={c} /></th>)}</tr></thead>
            <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n}><Inline text={c} /></td>)}</tr>)}</tbody>
          </table>
        )
      })}
    </div>
  )
}
