import { RULE_NAMES, groupByRule } from '../rules.js'
import { StatusIcon } from './common.jsx'
import FailureCard from './FailureCard.jsx'
import ResultRows from './ResultRows.jsx'
import Timeline from './Timeline.jsx'

// The first screen after a shake: PayPal's records next to the shop's books, and the three result rows.
function Summary({ overview, targetId, busy, settleSeconds, onOpenRun }) {
  const hasRuns = overview?.scenarios.some((s) => s.run)
  return (
    <div aria-label="Summary">
      <div className="dhead">
        <h2>Summary</h2>
        {overview?.timelineCaption && <span className="dhead__sub">{overview.timelineCaption}</span>}
      </div>
      {hasRuns ? (
        <>
          <div className="panel">
            <h3 className="panel__head">Books vs PayPal's records</h3>
            <Timeline timeline={overview.timeline} targetId={targetId} caption={overview.timelineCaption} />
          </div>
          <div className="panel">
            <h3 className="panel__head">Results <small>Open one to see the verdict, the deliveries and the fix.</small></h3>
            <ResultRows rows={overview.topRows} onOpen={onOpenRun} />
          </div>
        </>
      ) : !busy && <div className="panel"><p className="panel__body muted">No results for this target yet. Press "Shake all" (about {settleSeconds} seconds, 11 scenarios).</p></div>}
    </div>
  )
}

// A check that has no run yet: what it does, and how to run it.
function NotRun({ item, busy, onRun, onGoContract }) {
  const { scenario } = item
  return (
    <div>
      <div className="dhead">
        <StatusIcon status="notrun" />
        <h2>{scenario.id} {scenario.title}</h2>
        <span className="dhead__sub">{scenario.startPoint} · {scenario.rules.join(', ')} · not run</span>
      </div>
      <div className="panel">
        <p className="panel__body">{scenario.summary}</p>
        <ol className="panel__body steps-list">{scenario.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <div className="panel__body">
          {scenario.movesMoney
            ? <button type="button" className="btn" onClick={onGoContract}>Open the Contract tab (confirmation card)</button>
            : <button type="button" className="btn btn--primary" disabled={Boolean(busy)} onClick={() => onRun(scenario.id)}>Run {scenario.id}</button>}
        </div>
      </div>
    </div>
  )
}

export default function ChecksView({ lab, target, openRunId, onOpenRun, onSummary, onGoContract, onChanged, onRan }) {
  const { overview, busy } = lab
  const settleSeconds = Math.ceil((lab.status?.settleWindowMs || 6000) / 1000) + 8
  const scenarios = overview?.scenarios || []
  const pickedId = openRunId.startsWith('scenario:') ? openRunId.slice(9) : ''
  const picked = scenarios.find((s) => s.scenario.id === pickedId)
  const select = (item) => (item.run ? onOpenRun(item.run.id) : onOpenRun(`scenario:${item.scenario.id}`))
  const runOne = async (id) => {
    const run = await lab.runOne(id)
    if (run) {
      onOpenRun(run.id)
      onRan()
    }
  }
  return (
    <div className="checks-view">
      <nav className="checks" aria-label="Checks">
        <button type="button" className={`ck ck--summary${!openRunId ? ' ck--on' : ''}`} aria-current={!openRunId ? 'true' : undefined} onClick={onSummary}>
          <span className="ic ic--summary" aria-hidden="true">{'≡'}</span><span className="ck__nm">Summary</span><span />
        </button>
        {groupByRule(scenarios).map(([rule, items]) => (
          <div key={rule} className="grp">
            <div className="grp__name">{rule} {RULE_NAMES[rule] || ''}</div>
            {items.map((item) => {
              const on = (item.run && item.run.id === openRunId) || pickedId === item.scenario.id
              return (
                <button key={item.scenario.id} type="button" className={`ck${on ? ' ck--on' : ''}`} aria-current={on ? 'true' : undefined} onClick={() => select(item)} title={`${item.scenario.id} ${item.scenario.title}`}>
                  <StatusIcon status={item.run?.status} />
                  <span className="ck__nm"><b>{item.scenario.id}</b>{item.scenario.title}</span>
                  <span className="ck__t">{item.scenario.startPoint}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <section id="detail" className="detail">
        {!openRunId && <Summary overview={overview} targetId={lab.targetId} busy={busy} settleSeconds={settleSeconds} onOpenRun={onOpenRun} />}
        {picked && <NotRun item={picked} busy={busy} onRun={runOne} onGoContract={onGoContract} />}
        {openRunId && !pickedId && (
          <FailureCard key={openRunId} runId={openRunId} scenarios={scenarios} editable={Boolean(target?.editable)} onChanged={onChanged} />
        )}
      </section>
    </div>
  )
}
