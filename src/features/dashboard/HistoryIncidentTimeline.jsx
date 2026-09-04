import { detectionTypeLabel } from '@shared/incidents.js'
import StatusBadge from '../../ui/StatusBadge'
import EmptyState from '../../ui/EmptyState'
import { timelineSelectionKey } from './historyTimelineView.js'
import { mergeMonitorTimelineEvents } from './orchestrationTimelineView.js'

export const MONITOR_TIMELINE_CAPTION =
  'This match — detections plus response lifecycle when orchestration runs. Clears with the match.'

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

function eventRailColor(ev) {
  if (ev.eventKind === 'orchestration') return 'var(--tn-select)'
  if (ev.eventKind === 'evidence') return 'var(--tn-muted)'
  return severityRail(ev.severity)
}

function eventRowKey(ev, index) {
  if (ev.eventKind === 'detection') return `det-${ev.incidentId}`
  return `${ev.eventKind}-${ev.lifecycleKey}-${ev.incidentId}-${ev.planId ?? ''}-${ev.atMs}-${index}`
}

/**
 * Chronology of persisted detections + per-incident orchestration lifecycle.
 * Detection rows keep their existing presentation; orchestration rows are additive.
 */
export default function HistoryIncidentTimeline({
  incidents = [],
  campaigns = [],
  orchestration = null,
  order = 'newest-first',
  selectedKey = null,
  selectedIncidentId = null,
  onSelectEvent,
  compact = false,
}) {
  const events = mergeMonitorTimelineEvents({
    incidents,
    campaigns,
    orchestration,
    order,
  })

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {!compact ? (
        <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-[var(--tn-line)] px-4 py-3">
          <div>
            <div className="tn-label">Incident timeline</div>
            <p className="tn-meta mt-1">{MONITOR_TIMELINE_CAPTION}</p>
          </div>
          <span className="font-mono text-sm tabular-nums text-[var(--tn-muted)]">
            {events.length}
          </span>
        </div>
      ) : (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--tn-line)] px-4 py-2">
          <p className="tn-meta text-[11px]">{MONITOR_TIMELINE_CAPTION}</p>
          <span className="font-mono text-xs tabular-nums text-[var(--tn-muted)]">
            {events.length}
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {events.length === 0 ? (
          <EmptyState
            title="No detections this match yet"
            body="Timeline events appear as this match promotes incidents."
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
              const isDetection = ev.eventKind === 'detection' || !ev.eventKind
              return (
                <li key={eventRowKey(ev, i)}>
                  <button
                    type="button"
                    className="flex w-full text-left"
                    style={selected ? { background: 'var(--tn-select-bg)' } : undefined}
                    onClick={() => onSelectEvent?.(ev)}
                  >
                    <div className="flex w-3 shrink-0 flex-col items-center pt-2" aria-hidden>
                      <span
                        className="block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: eventRailColor(ev) }}
                      />
                      {last ? null : (
                        <span className="mt-1 w-px min-h-[1.75rem] flex-1 bg-[var(--tn-line)]" />
                      )}
                    </div>
                    <div className={['min-w-0 flex-1 px-2', last ? 'pb-1' : 'pb-3'].join(' ')}>
                      {isDetection ? (
                        <>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-mono text-[11px] tabular-nums text-[var(--tn-muted)]">
                              {ev.timeLabel}
                            </span>
                            <span className="text-sm font-medium">
                              {ev.affectedNodeLabel || ev.affectedNodeId}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <StatusBadge tone={severityTone(ev.severity)}>
                              {ev.severity}
                            </StatusBadge>
                            <StatusBadge tone={statusTone(ev.status)}>{ev.status}</StatusBadge>
                            <span className="text-xs text-[var(--tn-muted)]">
                              {detectionTypeLabel(ev.incidentType)}
                            </span>
                          </div>
                          {ev.campaignId ? (
                            <p className="tn-meta mt-0.5 text-[11px]">
                              Campaign {ev.campaignStatus || 'linked'}
                              {ev.campaignIncidentCount
                                ? ` · ${ev.campaignIncidentCount} related`
                                : ''}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-mono text-[11px] tabular-nums text-[var(--tn-muted)]">
                              {ev.timeLabel}
                            </span>
                            <span className="text-sm font-medium">{ev.label}</span>
                          </div>
                          {ev.affectedNodeLabel || ev.affectedNodeId ? (
                            <p className="tn-meta mt-0.5 text-[11px]">
                              {ev.affectedNodeLabel || ev.affectedNodeId}
                              {ev.detail ? ` · ${ev.detail}` : ''}
                            </p>
                          ) : ev.detail ? (
                            <p className="tn-meta mt-0.5 text-[11px]">{ev.detail}</p>
                          ) : null}
                        </>
                      )}
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
