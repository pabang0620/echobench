// The INBOUND EVENTS table. The plugin's plan covers calls the app makes, not webhooks the app
// receives, so this table is EchoBench's own proposal and is titled as such. The key and the
// recovery call come from how PayPal delivers; the two target-specific cells are left as TBD for
// the developer (or the AI step) to fill from the handler's code.
const EVENTS = [
  { event: 'CHECKOUT.ORDER.APPROVED', key: 'event id', settle: 'getOrder', scenarios: ['S3', 'S4'] },
  { event: 'PAYMENT.CAPTURE.COMPLETED', key: 'event id (and capture id)', settle: 'getOrder (purchase_units[].payments.captures)', scenarios: ['S1', 'S2', 'S7'] },
  { event: 'PAYMENT.CAPTURE.REFUNDED', key: 'refund id (resource.id)', settle: 'getOrder (purchase_units[].payments.refunds)', scenarios: ['S5', 'S5b'] },
  { event: 'CUSTOMER.DISPUTE.CREATED', key: 'dispute id (resource.dispute_id)', settle: 'the Disputes API (not covered by the SDK map)', scenarios: ['D1'] },
]

const label = (run) => (run ? { green: 'GREEN', red: 'RED', amber: 'WARN', na: 'n/a', error: 'ERROR' }[run.status] : 'not run')

// cells: { [event type]: [whereStored, whatRejects] } for a target whose code EchoBench knows. Without it both stay TBD.
export function inboundTable(results, cells = null) {
  const rows = EVENTS.map((e) => ({
    event: e.event,
    dedupKey: e.key,
    whereStored: cells?.[e.event]?.[0] || 'TBD',
    whatRejects: cells?.[e.event]?.[1] || 'TBD',
    settleWith: e.settle,
    proof: e.scenarios.map((id) => `${id} ${label(results[id])}`).join(', '),
  }))
  const header = ['Event', 'Dedup key', 'Where stored', 'What rejects the second one', 'Settle missing event with', 'Proven by EchoBench']
  const markdown = [
    '## INBOUND EVENTS (proposed by EchoBench, not part of the plugin\'s plan)',
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.event} | ${r.dedupKey} | ${r.whereStored} | ${r.whatRejects} | ${r.settleWith} | ${r.proof} |`),
  ].join('\n')
  return { header, rows, markdown }
}
