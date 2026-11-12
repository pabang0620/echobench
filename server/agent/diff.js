// Minimal unified diff (line based, LCS). Enough to show a patch to a person.
export function unifiedDiff(oldText, newText, file, context = 3) {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push([' ', a[i]])
      i += 1
      j += 1
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      ops.push(['+', b[j]])
      j += 1
    } else {
      ops.push(['-', a[i]])
      i += 1
    }
  }
  const keep = new Array(ops.length).fill(false)
  ops.forEach(([tag], index) => {
    if (tag === ' ') return
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k += 1) keep[k] = true
  })
  if (!keep.some(Boolean)) return ''
  const out = [`--- a/${file}`, `+++ b/${file}`]
  let inHunk = false
  ops.forEach(([tag, line], index) => {
    if (!keep[index]) {
      inHunk = false
      return
    }
    if (!inHunk) out.push('@@')
    inHunk = true
    out.push(`${tag}${line}`)
  })
  return out.join('\n')
}
