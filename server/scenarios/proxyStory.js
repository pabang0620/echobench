// The proxy's record of a contract run, as three plain lines for the result card: what was sent with which
// headers, what came back, and how many refunds (or captures) PayPal ended up with. Built from the proxy log
// and PayPal's records, so nothing here is written by a model.
const WRITE = /\/(refund|capture)$/

export function buildProxyStory({ proxyLog, ledgerNew, ledger }) {
  const writes = proxyLog.filter((p) => p.method === 'POST' && WRITE.test(p.path.split('?')[0]))
  if (!writes.length) return null
  const op = writes[0].path.split('?')[0].match(WRITE)[1]
  const cut = writes.find((p) => p.cut)
  const total = op === 'refund' ? ledgerNew.length : ledger.captures.length
  const lines = writes.map((w, i) => {
    const sent = `${i + 1} POST /${op} PayPal-Request-Id=${w.requestId || '(none)'} Idempotency-Key=${w.sdkKey || '(none)'}`
    if (w.cut) return `${sent} -> forwarded to PayPal (${w.status}), reply cut`
    const sameAsCut = cut && w.requestId && w.requestId === cut.requestId
    return `${sent} -> ${w.status}${sameAsCut ? ` same PayPal-Request-Id as the cut call, PayPal answered with the stored ${op}` : ''}`
  })
  lines.push(`PayPal ${op === 'refund' ? 'refunds' : 'captures'} on this order: ${total}`)
  const keys = new Set(writes.map((w) => w.sdkKey).filter(Boolean))
  const ids = new Set(writes.map((w) => w.requestId).filter(Boolean))
  return {
    operation: op,
    lines,
    total,
    sameRequestId: Boolean(cut) && ids.size === 1,
    sdkKeysDiffer: keys.size > 1,
    note: keys.size > 1 && ids.size === 1 ? "The SDK's Idempotency-Key is different on each call. PayPal recognised the repeat by PayPal-Request-Id, which the app stored and sent again." : null,
  }
}
