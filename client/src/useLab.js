import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

// All screen state in one place: what is selected, what the last runs say, what is running.
export function useLab() {
  const [status, setStatus] = useState(null)
  const [targets, setTargets] = useState([])
  const [recordings, setRecordings] = useState([])
  const [targetId, setTargetId] = useState('')
  const [recordingId, setRecordingId] = useState('')
  const [overview, setOverview] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [openRunId, setOpenRunId] = useState('')
  const [progress, setProgress] = useState(null)
  const [queued, setQueued] = useState(0)

  const guard = useCallback(async (label, work) => {
    setBusy(label)
    setError('')
    try {
      return await work()
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setBusy('')
    }
  }, [])

  useEffect(() => {
    guard('Loading', async () => {
      const [s, t, r] = await Promise.all([api('GET', '/status'), api('GET', '/targets'), api('GET', '/recordings')])
      setStatus(s)
      setTargets(t)
      setRecordings(r)
      setTargetId((cur) => cur || (t.find((x) => x.id === 'mugshop') || t[0])?.id || '')
      setRecordingId((cur) => cur || r[0]?.id || '')
    })
  }, [guard])

  const loadOverview = useCallback(async () => {
    if (!targetId || !recordingId) return
    try {
      setOverview(await api('GET', `/overview?recordingId=${recordingId}&targetId=${targetId}`))
    } catch (err) {
      setError(err.message)
    }
  }, [targetId, recordingId])

  useEffect(() => {
    loadOverview()
  }, [loadOverview])

  const reloadRecordings = useCallback(async (selectId) => {
    const list = await api('GET', '/recordings')
    setRecordings(list)
    if (selectId) setRecordingId(selectId)
  }, [])

  const runOne = (scenarioId) =>
    guard(`Running ${scenarioId}`, async () => {
      const run = await api('POST', '/runs', { scenarioId, recordingId, targetId })
      await loadOverview()
      return run
    })

  // One request per scenario, so the screen can say "7/11" while each scenario restarts the target from its start point.
  const runAll = () =>
    guard('Running all scenarios', async () => {
      const ids = (await api('GET', '/scenarios')).filter((s) => s.shakeAll).map((s) => s.id)
      try {
        for (let i = 0; i < ids.length; i += 1) {
          setProgress({ done: i, total: ids.length, current: ids[i] })
          await api('POST', '/runs', { scenarioId: ids[i], recordingId, targetId })
        }
      } finally {
        setProgress(null)
      }
      await loadOverview()
    })

  const reloadTargets = useCallback(async () => {
    setTargets(await api('GET', '/targets'))
  }, [])

  // Back to the three planted bugs: fresh working copy, first screen starts red again.
  const resetPlanted = () =>
    guard('Resetting MugShop to the planted bugs', async () => {
      await api('POST', `/targets/${targetId}/reset-workspace`)
      setOpenRunId('')
      await reloadTargets()
      await loadOverview()
    })

  // While something runs, ask how many runs share the lab (it does one scenario at a time).
  useEffect(() => {
    if (!busy) {
      setQueued(0)
      return undefined
    }
    const timer = setInterval(() => {
      api('GET', '/status').then((s) => setQueued(s.queued || 0)).catch(() => {})
    }, 1500)
    return () => clearInterval(timer)
  }, [busy])

  return { status, targets, recordings, targetId, setTargetId, recordingId, setRecordingId, overview, loadOverview, reloadRecordings, busy, error, setError, guard, runOne, runAll, openRunId, setOpenRunId, progress, queued, reloadTargets, resetPlanted }
}
