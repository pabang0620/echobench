import { useState } from 'react'
import { useLab } from './useLab.js'
import { checkSummary, countChecks } from './rules.js'
import Header, { ModeTags } from './components/Header.jsx'
import ChecksView from './components/ChecksView.jsx'
import ScenarioTable from './components/ScenarioTable.jsx'
import ContractTab from './components/ContractTab.jsx'
import InboundTab from './components/InboundTab.jsx'
import MatrixTab from './components/MatrixTab.jsx'
import RecordingPanel from './components/RecordingPanel.jsx'
import { Spinner } from './components/common.jsx'

const TABS = [
  ['checks', 'Checks'],
  ['recording', 'Recording'],
  ['scenarios', 'All scenarios'],
  ['contract', 'Contract (paypal-plan.md)'],
  ['inbound', 'Inbound events table'],
  ['matrix', 'A/B and EverShop'],
]

function StateBall({ counts }) {
  const { tone, label } = checkSummary(counts)
  return <span className={`stateball stateball--${tone}`}>{label}</span>
}

export default function App() {
  const lab = useLab()
  const { overview, targetId, recordingId, busy, error, openRunId, setOpenRunId, progress, queued } = lab
  const [tab, setTab] = useState('checks')
  const [refreshKey, setRefreshKey] = useState(0)
  const target = lab.targets.find((t) => t.id === targetId)
  const changed = async () => {
    await lab.loadOverview()
    setRefreshKey((k) => k + 1)
  }
  // A run opened from any tab shows in the Checks detail pane.
  const openRun = (id) => {
    setOpenRunId(id)
    setTab('checks')
    requestAnimationFrame(() => {
      const el = document.getElementById('detail')
      if (el && el.getBoundingClientRect().top > window.innerHeight * 0.6) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  const hasRuns = Boolean(overview?.scenarios.some((s) => s.run))
  const counts = countChecks(overview?.scenarios)
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
  const countLine = [`${counts.failing} failing`, `${counts.passing} passing`, counts.warning ? `${counts.warning} warning` : '', counts.notRun ? `${counts.notRun} not run` : '', `${counts.total} scenarios`].filter(Boolean).join(', ')

  return (
    <div className="app">
      <Header lab={lab} step={step} onStep={goToStep} />
      <section className="head card--hero" aria-labelledby="hero-title">
        <div className="head__title">
          <StateBall counts={counts} />
          <h1 id="hero-title">Shake your webhook handler with {realDeliveries ? 'your own recorded PayPal sandbox deliveries' : 'recorded PayPal deliveries'}</h1>
          <div className="hero__actions">
            <button type="button" className="btn btn--primary" disabled={Boolean(busy) || !targetId} onClick={async () => { setOpenRunId(''); setTab('checks'); await lab.runAll(); setRefreshKey((k) => k + 1) }}>
              Shake all
            </button>
            {target?.editable && (
              <button type="button" className="btn" disabled={Boolean(busy)} onClick={async () => { await lab.resetPlanted(); setRefreshKey((k) => k + 1) }}>
                Reset to planted bugs
              </button>
            )}
          </div>
        </div>
        <div className="meta">
          {overview && <span>{countLine}</span>}
          <ModeTags status={lab.status} />
          {target?.note && <span className="note">{target.note}</span>}
        </div>
        <p className="head__lede">
          Each scenario resets the target to a saved start point, replays recorded events duplicated, reordered, dropped or forged, and compares the shop's books with PayPal's records.
          {!realDeliveries && ' This recording came from the local PayPal stand-in; recording real sandbox deliveries needs a public URL (VERIFY.md V1).'}
        </p>
        {busy && <Spinner label={`${busy}${progress ? `: ${progress.current} (${progress.done + 1}/${progress.total})` : ''}${queued > 1 ? `. ${queued - 1} other run(s) are using the lab right now; it does one scenario at a time.` : ''}`} />}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <nav className="subnav" aria-label="Details">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={`subnav__tab${tab === id ? ' subnav__tab--on' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            {label}{id === 'checks' && overview && <span className="subnav__n">{counts.total}</span>}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'checks' ? (
          <ChecksView
            lab={lab}
            target={target}
            openRunId={openRunId}
            onOpenRun={openRun}
            onSummary={() => setOpenRunId('')}
            onGoContract={() => setTab('contract')}
            onChanged={async () => { await lab.reloadTargets(); await changed() }}
            onRan={() => setRefreshKey((k) => k + 1)}
          />
        ) : (
          <section className="pane" aria-label={TABS.find((t) => t[0] === tab)[1]}>
            {tab === 'recording' && <RecordingPanel recordingId={recordingId} status={lab.status} targetId={targetId} onRecorded={lab.reloadRecordings} />}
            {tab === 'scenarios' && <ScenarioTable overview={overview} busy={busy} onRun={async (id) => { const run = await lab.runOne(id); if (run) { openRun(run.id); setRefreshKey((k) => k + 1) } }} onOpen={openRun} />}
            {tab === 'contract' && <ContractTab recordingId={recordingId} targetId={targetId} scenarios={overview?.scenarios} refreshKey={refreshKey} onOpenRun={openRun} onChanged={changed} />}
            {tab === 'inbound' && <InboundTab recordingId={recordingId} targetId={targetId} refreshKey={refreshKey} />}
            {tab === 'matrix' && <MatrixTab recordingId={recordingId} refreshKey={refreshKey} onOpenRun={openRun} />}
          </section>
        )}
      </main>
      <footer className="foot">
        Sandbox and local stand-in only. The model never moves money; refunds run only after you press Approve and run on a confirmation card.
      </footer>
    </div>
  )
}
