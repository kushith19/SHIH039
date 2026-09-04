import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import HistoryIncidentTimeline from './HistoryIncidentTimeline'
import useIncidentHistory from './useIncidentHistory.js'
import EmptyState from '../../ui/EmptyState'
import {
  liveIncidentMatchesTimelineEvent,
  timelineSelectionKey,
} from './historyTimelineView.js'
import { dashboardPanelHref } from './dashboardPanels.js'

/**
 * Match chronology for Monitor. Selecting a live event opens Incidents.
 * Includes response/orchestration lifecycle rows from room.responseOrchestration.
 */
export default function MonitorTimelinePanel({
  roomId = '',
  incidents = [],
  responseOrchestration = null,
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { campaigns, incidents: historyIncidents, order, status } =
    useIncidentHistory(roomId)
  const [timelineFocusId, setTimelineFocusId] = useState(null)

  const selectedKey = useMemo(() => {
    if (timelineFocusId == null) return null
    const row = historyIncidents.find(
      (item) => String(item.incidentId) === String(timelineFocusId)
    )
    return timelineSelectionKey(row)
  }, [timelineFocusId, historyIncidents])

  function selectFromTimeline(event) {
    setTimelineFocusId(event?.incidentId ?? null)
    const match = (incidents ?? []).find((inc) =>
      liveIncidentMatchesTimelineEvent(inc, event)
    )
    if (!match) return
    navigate(dashboardPanelHref(searchParams, 'incidents'), {
      replace: true,
      state: { selectIncidentId: match.persistentId || match.id || match.endpointId },
    })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="soc-zone flex min-h-0 flex-1 flex-col overflow-hidden">
        {status === 'loading' ? (
          <EmptyState title="Loading timeline" body="Fetching this match's detection chronology." />
        ) : status === 'error' ? (
          <EmptyState
            title="Timeline unavailable"
            body="Could not load persisted detections for this match."
          />
        ) : (
          <HistoryIncidentTimeline
            incidents={historyIncidents}
            campaigns={campaigns}
            orchestration={responseOrchestration}
            order={order}
            selectedKey={selectedKey}
            selectedIncidentId={timelineFocusId}
            onSelectEvent={selectFromTimeline}
          />
        )}
      </div>
    </section>
  )
}
