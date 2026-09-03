import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import EmptyState from '../../ui/EmptyState'
import { dashboardPanelHref } from '../dashboard/dashboardPanels.js'
import ResponseConsole from './ResponseConsole.jsx'

/**
 * Dashboard panel: loads commander-context and wires Response Console execute
 * to the existing backend. Refreshes context after successful execution.
 */
export default function ResponseConsolePanel({
  roomId,
  focusIncidentId = null,
}) {
  const [searchParams] = useSearchParams()
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadContext = useCallback(async () => {
    if (!roomId || !focusIncidentId) {
      setContext(null)
      setError(null)
      setLoading(false)
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/rooms/${encodeURIComponent(roomId)}/incidents/${encodeURIComponent(focusIncidentId)}/commander-context`
      )
      const json = await res.json()
      if (!res.ok || json.ok === false || !json.context) {
        setContext(null)
        setError(json.message ?? 'Incident context unavailable')
        setLoading(false)
        return null
      }
      setContext(json.context)
      setError(null)
      setLoading(false)
      return json.context
    } catch (err) {
      setContext(null)
      setError(err?.message ?? 'Failed to load response context')
      setLoading(false)
      return null
    }
  }, [roomId, focusIncidentId])

  useEffect(() => {
    if (!roomId || !focusIncidentId) {
      setContext(null)
      setError(null)
      setLoading(false)
      return undefined
    }
    let cancelled = false
    void loadContext().then(() => {
      if (cancelled) return
    })
    return () => {
      cancelled = true
    }
  }, [roomId, focusIncidentId, loadContext])

  if (!focusIncidentId) {
    return (
      <EmptyState
        title="No incident selected"
        body="Open an incident from the Incidents panel, then use Response Console to review registered containment actions."
        action={
          <Link
            to={dashboardPanelHref(searchParams, 'incidents')}
            replace
            className="tn-btn-primary inline-flex"
          >
            Open Incidents
          </Link>
        }
      />
    )
  }

  return (
    <ResponseConsole
      roomId={roomId}
      context={context}
      loading={loading && !context}
      error={error}
      onRefreshContext={loadContext}
    />
  )
}
