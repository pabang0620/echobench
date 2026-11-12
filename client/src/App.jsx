import { useState } from 'react'
import { useLab } from './useLab.js'
import Header from './components/Header.jsx'
import Timeline from './components/Timeline.jsx'
import ResultRows from './components/ResultRows.jsx'
import ScenarioTable from './components/ScenarioTable.jsx'
import FailureCard from './components/FailureCard.jsx'
import ContractTab from './components/ContractTab.jsx'
import InboundTab from './components/InboundTab.jsx'
import MatrixTab from './components/MatrixTab.jsx'
import RecordingPanel from './components/RecordingPanel.jsx'
import { Spinner } from './components/common.jsx'

const TABS = [
  ['recording', 'Recording'],
  ['scenarios', 'All scenarios'],
  ['contract', 'Contract (paypal-plan.md)'],
  ['inbound', 'Inbound events table'],
  ['matrix', 'A/B and EverShop'],
]

export default function App() {
  const lab = useLab()
  const { overview, targetId, recordingId, busy, error, openRunId, setOpenRunId, progress, queued } = lab
  const [tab, setTab] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const target = lab.targets.find((t) => t.id === targetId)
  const changed = async () => {
    await lab.loadOverview()
    setRefreshKey((k) => k + 1)
  }
  const toggle = (id) => setTab((cur) => (cur === id ? '' : id))
  const openRun = (id) => setOpenRunId(id)
  const hasRuns = overview?.scenarios.some((s) => s.run)
  const recording = lab.recordings.find((r) => r.id === recordingId)
  const realDeliveries = recording?.source === 'live-sandbox'
  const firstRed = overview?.topRows.find((r) => r.status === 'red' || r.status === 'amber')
  // Where the visitor is: nothing recorded, nothing shaken yet, or failures to fix.
  const step = !recordingId ? 1 : !hasRuns ? 2 : 3
  const goToStep = (n) => {
    if (n === 1) setTab('recording')
    if (n === 2) document.getElementById('hero-title')?.scrollIntoView({ behavior: 'smooth' })
    if (n === 3 && firstRed) openRun(firstRed.runId)
    if (n === 3 && !firstRed) document.getElementById('hero-title')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="page">
      <Header lab={lab} step={step} onStep={goToStep} />
      <main>
        <section className="card card--hero" aria-labelledby="hero-title">
          <div className="hero__head">
            <div>
              <h1 id="hero-title">Shake your webhook handler with {realDeliveries ? 'your own recorded PayPal sandbox deliveries' : 'recorded PayPal deliveries'}</h1>
              <p className="muted">
                Each scenario resets the target to a saved start point, replays recorded events duplicated, reordered, dropped or forged, and compares the shop's books with PayPal's records.
                {!realDeliveries && ' This recording came from the local PayPal stand-in; recording real sandbox deliveries needs a public URL (VERIFY.md V1).'}
              </p>
            </div>
            <div className="hero__actions">
              <button type="button" className="btn btn--primary" disabled={Boolean(busy) || !targetId} onClick={async () => { await lab.runAll(); setRefreshKey((k) => k + 1) }}>
                Shake all
              </button>
              {target?.editable && (
                <button type="button" className="btn" disabled={Boolean(busy)} onClick={async () => { await lab.resetPlanted(); setRefreshKey((k) => k + 1) }}>
                  Reset to planted bugs
                </button>
              )}
            </div>
          </div>
          {target?.note && <p className="note">{target.note}</p>}
          {busy && <Spinner label={`${busy}${progress ? `: ${progress.current} (${progress.done + 1}/${progress.total})` : ''}${queued > 1 ? `. ${queued - 1} other run(s) are using the lab right now; it does one scenario at a time.` : ''}`} />}
          {error && <p className="error" role="alert">{error}</p>}
          {hasRuns ? (
            <>
              <Timeline timeline={overview.timeline} targetId={targetId} caption={overview.timelineCaption} />
              <ResultRows rows={overview.topRows} onOpen={openRun} />
            </>
          ) : !busy && <p className="muted">No results for this target yet. Press "Shake all" (about {Math.ceil((lab.status?.settleWindowMs || 6000) / 1000) + 8} seconds, 11 scenarios).</p>}
        </section>

        {openRunId && <FailureCard key={openRunId} runId={openRunId} editable={Boolean(target?.editable)} onChanged={async () => { await lab.reloadTargets(); await changed() }} onClose={() => setOpenRunId('')} />}

        <nav className="tabs" aria-label="Details">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" className={`tab${tab === id ? ' tab--on' : ''}`} aria-expanded={tab === id} onClick={() => toggle(id)}>{label}</button>
          ))}
        </nav>
        {tab && (
          <section className="card" aria-label={TABS.find((t) => t[0] === tab)[1]}>
            {tab === 'recording' && <RecordingPanel recordingId={recordingId} status={lab.status} targetId={targetId} onRecorded={lab.reloadRecordings} />}
            {tab === 'scenarios' && <ScenarioTable overview={overview} busy={busy} onRun={async (id) => { const run = await lab.runOne(id); if (run) { openRun(run.id); setRefreshKey((k) => k + 1) } }} onOpen={openRun} />}
            {tab === 'contract' && <ContractTab recordingId={recordingId} targetId={targetId} refreshKey={refreshKey} onOpenRun={openRun} onChanged={changed} />}
            {tab === 'inbound' && <InboundTab recordingId={recordingId} targetId={targetId} refreshKey={refreshKey} />}
            {tab === 'matrix' && <MatrixTab recordingId={recordingId} refreshKey={refreshKey} onOpenRun={openRun} />}
          </section>
        )}
      </main>
      <footer className="foot">
        Sandbox and local stand-in only. The model never moves money; refunds run only after you press Run on a confirmation card.
      </footer>
    </div>
  )
}
