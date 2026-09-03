import { detectionTypeLabel } from '@shared/incidents.js'
import StatusBadge from '../../ui/StatusBadge'
import EmptyState from '../../ui/EmptyState'
import {
  HISTORY_TIMELINE_CAPTION,
  annotateHistoryEventsWithCampaigns,
  historyEventsFromIncidents,
  timelineSelectionKey,
} from './historyTimelineView.js'

function severityTone(severity) {
  if (severity === 'critical' || severity === 'high') return 'crit'
  if (severity === 'medium') return 'warn'
  return 'muted'
}

function statusTone(status) {
  if (status === 'open' || status === 'suspected' || status === 'correlated') return 'warn'
  return 'muted'
}

function severityRail(severity) {
  if (severity === 'critical' || severity === 'high') return 'var(--tn-crit)'
  if (severity === 'medium') return 'var(--tn-warn)'
  return 'var(--tn-muted)'
}

/**
 * Chronology of persisted incidents. Renders backend history + campaign ids only.
 */
export default function HistoryIncidentTimeline({
  incidents = [],
  campaigns = [],
  order = 'newest-first',
  selectedKey = null,
  selectedIncidentId = null,
  onSelectEvent,
}) {
  const events = annotateHistoryEventsWithCampaigns(
    historyEventsFromIncidents(incidents, { order }),
    campaigns
  )

  return (
    <div className="tn-surface flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-[var(--tn-line)] px-4 py-3">
        <div>
          <div className="tn-label">Incident timeline</div>
          <p className="tn-meta mt-1">{HISTORY_TIMELINE_CAPTION}</p>
        </div>
        <span className="font-mono text-sm tabular-nums text-[var(--tn-muted)]">
          {events.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {events.length === 0 ? (
          <EmptyState
            title="No detections this match yet"
            body="Timeline events appear as this match promotes incidents. Clear attacks or a new match starts a fresh timeline."
          />
        ) : (
          <ol>
            {events.map((ev, i) => {
              const key = timelineSelectionKey(ev)
              const selected =
                (selectedIncidentId != null &&
                  String(ev.incidentId) === String(selectedIncidentId)) ||
                (selectedKey != null && key != null && selectedKey === key)
              const last = i === events.length - 1
              return (
                <li key={ev.incidentId}>
                  <button
                    type="button"
                    className="flex w-full text-left"
                    style={selected ? { background: 'var(--tn-select-bg)' } : undefined}
                    onClick={() => onSelectEvent?.(ev)}
                  >
                    <div className="flex w-4 shrink-0 flex-col items-center pt-2" aria-hidden>
                      <span
                        className="block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: severityRail(ev.severity) }}
                      />
                      {last ? null : (
                        <span className="mt-1 w-px min-h-[2.5rem] flex-1 bg-[var(--tn-line)]" />
                      )}
                    </div>
                    <div className={['min-w-0 flex-1 px-3', last ? 'pb-1' : 'pb-4'].join(' ')}>
                      <div className="font-mono text-sm tabular-nums text-[var(--tn-muted)]">
                        {ev.timeLabel}
                      </div>
                      <div className="mt-0.5 text-sm font-medium">
                        {ev.affectedNodeLabel || ev.affectedNodeId}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusBadge tone={severityTone(ev.severity)}>{ev.severity}</StatusBadge>
                        <StatusBadge tone={statusTone(ev.status)}>{ev.status}</StatusBadge>
                        <span className="text-sm text-[var(--tn-muted)]">
                          {detectionTypeLabel(ev.incidentType)}
                        </span>
                      </div>
                      {ev.summary ? (
                        <p className="tn-meta mt-1 line-clamp-1">{ev.summary}</p>
                      ) : null}
                      {ev.exposureLabel ? (
                        <p className="tn-meta mt-1">{ev.exposureLabel}</p>
                      ) : null}
                      {ev.campaignId ? (
                        <p className="tn-meta mt-1">
                          Campaign {ev.campaignStatus || 'linked'}
                          {ev.campaignIncidentCount
                            ? ` · ${ev.campaignIncidentCount} related`
                            : ''}
                        </p>
                      ) : null}
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
