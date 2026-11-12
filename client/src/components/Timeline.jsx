// Two lines: what PayPal's records say, and what the shop's books say. Flagged cells break a rule.
export default function Timeline({ timeline, targetId, caption }) {
  if (!timeline) return <p className="panel__body muted">Run a scenario to see PayPal's records next to the shop's books.</p>
  const { paypal, shop } = timeline
  return (
    <div className="timeline" aria-label="PayPal records and shop books">
      <div className="timeline__lane">
        <span className="timeline__who">PayPal</span>
        <div className="timeline__cells">
          {paypal.map((c, i) => <span key={i} className="cell">{c.text}</span>)}
        </div>
      </div>
      <div className="timeline__lane">
        <span className="timeline__who">{targetId?.startsWith('mugshop') ? 'MugShop' : 'Target'}</span>
        <div className="timeline__cells">
          {shop.length === 0 && <span className="cell cell--none">nothing booked</span>}
          {shop.map((c, i) => <span key={i} className={`cell${c.flag ? ' cell--bad' : ''}`}>{c.text}{c.flag ? ' (!)' : ''}</span>)}
        </div>
      </div>
      <p className="timeline__note">{caption} PayPal's records are final; they cannot be rewound to the start point.</p>
    </div>
  )
}
