import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import EmptyState from '../../ui/EmptyState'
import { dashboardPanelHref } from '../dashboard/dashboardPanels.js'
import ResponseConsole from './ResponseConsole.jsx'
import {
  getResponseAnalyzeUi,
  subscribeResponseAnalyzeUi,
} from './responseAnalyzeUi.js'
import {
  responseConsolePresentation,
  safeLlmDebugFields,
} from './responseConsoleView.js'

/**
 * Dashboard panel: loads commander-context and wires Response Console execute
 * to the existing backend. Refreshes context after successful execution.
 */
export default function ResponseConsolePanel({
  roomId,
  focusIncidentId = null,
  orchestrationState = null,
}) {
  const [searchParams] = useSearchParams()
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [analyzeUi, setAnalyzeUi] = useState(getResponseAnalyzeUi)
  const [debugLast, setDebugLast] = useState(null)

  useEffect(() => subscribeResponseAnalyzeUi(setAnalyzeUi), [])

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

  const presentation = responseConsolePresentation({
    context,
    socketPlan: orchestrationState?.plan ?? null,
    analyzeUi,
    workflowStatus: orchestrationState?.workflowStatus,
    continuationReason: orchestrationState?.continuationReason,
    pausedForApprovalReason: orchestrationState?.pausedForApprovalReason,
  })

  useEffect(() => {
    if (!presentation.visiblePlan) {
      setDebugLast(null)
      return undefined
    }
    let cancelled = false
    void fetch('/debug/llm-response')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || !json || json.ok === false) return
        const last = json.last
        if (!last || typeof last !== 'object') return
        const lastIncident = String(last.incidentId ?? '').trim()
        const focused = String(
          context?.incidentId || context?.liveIncidentId || ''
        ).trim()
        if (lastIncident && focused && lastIncident !== focused) return
        setDebugLast(safeLlmDebugFields(last))
      })
      .catch(() => {
        if (!cancelled) setDebugLast(null)
      })
    return () => {
      cancelled = true
    }
  }, [
    presentation.visiblePlan?.planId,
    context?.incidentId,
    context?.liveIncidentId,
  ])

  if (!focusIncidentId) {
    return (
      <EmptyState
        title="No incident selected"
        body="Select an incident to open the execution console."
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
    <div className="flex min-h-0 flex-1 flex-col">
      <ResponseConsole
        roomId={roomId}
        context={context}
        responsePlan={presentation.visiblePlan}
        loading={loading && !context && !presentation.waiting}
        error={error}
        analyzing={presentation.waiting}
        analyzeFailed={presentation.failed}
        analyzeError={analyzeUi.error || orchestrationState?.pausedForApprovalReason}
        analyzeAttempted={
          Number(analyzeUi.generation) > 0 ||
          orchestrationState?.continuationReason === 'planning_failed'
        }
        socketPlan={orchestrationState?.plan ?? null}
        debugLast={debugLast}
        onRefreshContext={loadContext}
      />
    </div>
  )
}
