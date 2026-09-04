import { useEffect, useMemo, useState } from 'react'
import {
  DETECTION_TYPES,
  detectionTypeLabel,
} from '@shared/incidents.js'
import IncidentCard from './IncidentCard'
import CampaignIntelligence from './CampaignIntelligence'
import LiveCorrelationPanel from './LiveCorrelationPanel'
import HistoryIncidentTimeline from './HistoryIncidentTimeline'
import Toolbar, { FilterChip } from '../../ui/Toolbar'
import StatusBadge from '../../ui/StatusBadge'
import EmptyState from '../../ui/EmptyState'
import {
  liveIncidentMatchesTimelineEvent,
  timelineSelectionKey,
} from './historyTimelineView.js'
import {
  correlationGroupId,
  formatPriorityScore,
  orderLiveIncidents,
  recoveryImpactBand,
  recoveryPriorityValue,
  relatedLiveCount,
  reliefCount,
} from './incidentStreamView.js'

function railColor(severity) {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'var(--tn-crit)'
    case 'medium':
      return 'var(--tn-warn)'
    default:
      return 'var(--tn-muted)'
  }
}

function severityTone(severity) {
  if (severity === 'critical' || severity === 'high') return 'crit'
  if (severity === 'medium') return 'warn'
  return 'muted'
}

function streamKey(inc) {
  return String(inc.endpointId || inc.id || '')
}

export default function IncidentsPanel({
  roomId = '',
  incidents = [],
  nodes = [],
  edges = [],
  liveCorrelation = null,
  primarySpreadNodeId = null,
  onSelectEndpoint,
  hideHeader = false,
}) {
  const [typeFilter, setTypeFilter] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  const [historyCampaigns, setHistoryCampaigns] = useState([])
  const [historyIncidents, setHistoryIncidents] = useState([])
  const [historyOrder, setHistoryOrder] = useState('newest-first')
  const [timelineFocusId, setTimelineFocusId] = useState(null)
  const [secondaryTab, setSecondaryTab] = useState('correlation')

  const nextTargetKey = primarySpreadNodeId ? String(primarySpreadNodeId) : null
  const liveGroups = Array.isArray(liveCorrelation?.groups) ? liveCorrelation.groups : []

  const orderedIncidents = useMemo(() => orderLiveIncidents(incidents), [incidents])

  const rows = useMemo(() => {
    if (!typeFilter) return orderedIncidents
    return orderedIncidents.filter(
      (inc) =>
        inc.detectionType === typeFilter ||
        (inc.detectionTypes ?? []).includes(typeFilter)
    )
  }, [orderedIncidents, typeFilter])

  const rankByKey = useMemo(() => {
    const map = new Map()
    orderedIncidents.forEach((inc, i) => {
      map.set(streamKey(inc), i + 1)
    })
    return map
  }, [orderedIncidents])

  useEffect(() => {
    if (!roomId) {
      setHistoryCampaigns([])
      setHistoryIncidents([])
      return undefined
    }
    let cancelled = false
    const load = async () => {
      try {
        const [campRes, histRes] = await Promise.all([
          fetch(`/rooms/${encodeURIComponent(roomId)}/incidents/campaigns`),
          fetch(
            `/rooms/${encodeURIComponent(roomId)}/incidents/history?order=${encodeURIComponent(historyOrder)}`
          ),
        ])
        const campJson = await campRes.json()
        const histJson = await histRes.json()
        if (cancelled) return
        setHistoryCampaigns(
          campRes.ok && campJson.ok !== false && Array.isArray(campJson.campaigns)
            ? campJson.campaigns
            : []
        )
        if (histRes.ok && histJson.ok !== false) {
          setHistoryIncidents(Array.isArray(histJson.incidents) ? histJson.incidents : [])
          if (histJson.order) setHistoryOrder(histJson.order)
        } else {
          setHistoryIncidents([])
        }
      } catch {
        if (!cancelled) {
          setHistoryCampaigns([])
          setHistoryIncidents([])
        }
      }
    }
    void load()
    const id = window.setInterval(() => void load(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [roomId, incidents.length, historyOrder])

  useEffect(() => {
    if (!rows.length) {
      setSelectedKey(null)
      return
    }
    if (!selectedKey || !rows.some((inc) => streamKey(inc) === selectedKey)) {
      setSelectedKey(streamKey(rows[0]))
    }
  }, [rows, selectedKey])

  const presentTypes = useMemo(() => {
    const set = new Set()
    for (const inc of incidents ?? []) {
      if (inc.detectionType) set.add(inc.detectionType)
      for (const t of inc.detectionTypes ?? []) set.add(t)
    }
    return DETECTION_TYPES.filter((t) => set.has(t))
  }, [incidents])

  const chipTypes = presentTypes.length > 0 ? presentTypes : DETECTION_TYPES

  const selected = rows.find((inc) => streamKey(inc) === selectedKey) ?? null

  function selectFromTimeline(event) {
    setTimelineFocusId(event?.incidentId ?? null)
    const match = (incidents ?? []).find((inc) => liveIncidentMatchesTimelineEvent(inc, event))
    if (match) setSelectedKey(streamKey(match))
  }

  const timelineSelectedKey =
    timelineFocusId != null
      ? timelineSelectionKey(
          historyIncidents.find((row) => String(row.incidentId) === String(timelineFocusId))
        ) || selectedKey
      : selectedKey

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="shrink-0">
        <Toolbar
          trailing={
            <span className="font-mono text-sm tabular-nums text-[var(--tn-muted)]">
              {incidents.length} live
            </span>
          }
        >
          <FilterChip active={typeFilter == null} onClick={() => setTypeFilter(null)}>
            All
          </FilterChip>
          {chipTypes.map((type) => (
            <FilterChip
              key={type}
              active={typeFilter === type}
              onClick={() => setTypeFilter((cur) => (cur === type ? null : type))}
            >
              {detectionTypeLabel(type)}
            </FilterChip>
          ))}
        </Toolbar>
        {hideHeader ? (
          <p className="tn-meta mt-2">
            Ranked by recovery impact — resolve the incident that recovers the most
            infrastructure, not only the loudest severity.
          </p>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <div className="soc-zone flex min-h-0 max-h-[40vh] flex-col overflow-hidden lg:max-h-none">
          <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-[var(--tn-line)] px-4 py-2.5">
            <div>
              <div className="text-sm font-medium">Incident stream</div>
              <p className="tn-meta mt-0.5 text-[11px]">
                Recovery priority · then severity
              </p>
            </div>
            <span className="font-mono text-xs tabular-nums text-[var(--tn-muted)]">
              {rows.length}
            </span>
          </div>
          {rows.length === 0 ? (
            <EmptyState
              title="No promoted detections this tick"
              body="No detections have passed criteria."
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ul>
                {rows.map((inc) => (
                  <QueueRow
                    key={streamKey(inc)}
                    inc={inc}
                    rank={rankByKey.get(streamKey(inc)) ?? null}
                    selected={selectedKey === streamKey(inc)}
                    onSelect={() => setSelectedKey(streamKey(inc))}
                    isNextTarget={nextTargetKey != null && streamKey(inc) === nextTargetKey}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="soc-zone flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-[var(--tn-line)] px-4 py-2.5">
            <div className="text-sm font-medium">Investigation</div>
            <p className="tn-meta mt-0.5 text-[11px]">
              Why resolve first · evidence · Commander / Response
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selected ? (
              <IncidentCard
                inc={selected}
                rank={rankByKey.get(streamKey(selected)) ?? null}
                nodes={nodes}
                primarySpreadNodeId={primarySpreadNodeId}
                onSelectEndpoint={onSelectEndpoint}
                roomId={roomId}
              />
            ) : (
              <p className="tn-meta">Select an incident from the stream to inspect recovery impact.</p>
            )}
          </div>
        </div>
      </div>

      <div className="soc-zone flex min-h-[12rem] max-h-[18rem] shrink-0 flex-col overflow-hidden lg:min-h-[14rem]">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--tn-line)] px-4 py-2">
          <span className="soc-zone-title mr-2">Secondary</span>
          <FilterChip
            active={secondaryTab === 'correlation'}
            onClick={() => setSecondaryTab('correlation')}
          >
            Live correlation
          </FilterChip>
          <FilterChip
            active={secondaryTab === 'timeline'}
            onClick={() => setSecondaryTab('timeline')}
          >
            Timeline
          </FilterChip>
          <FilterChip
            active={secondaryTab === 'history'}
            onClick={() => setSecondaryTab('history')}
          >
            History
          </FilterChip>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {secondaryTab === 'correlation' ? (
            <LiveCorrelationPanel
              groups={liveGroups}
              incidents={incidents}
              nodes={nodes}
              edges={edges}
              compact
              onSelectIncident={(inc) => setSelectedKey(streamKey(inc))}
            />
          ) : secondaryTab === 'timeline' ? (
            <HistoryIncidentTimeline
              incidents={historyIncidents}
              campaigns={historyCampaigns}
              order={historyOrder}
              selectedKey={timelineSelectedKey}
              selectedIncidentId={timelineFocusId}
              onSelectEvent={selectFromTimeline}
              compact
            />
          ) : (
            <CampaignIntelligence campaigns={historyCampaigns} compact />
          )}
        </div>
      </div>
    </section>
  )
}

function QueueRow({ inc, rank, selected, onSelect, isNextTarget = false }) {
  const priority = recoveryPriorityValue(inc)
  const band = recoveryImpactBand(priority)
  const relief = reliefCount(inc)
  const related = relatedLiveCount(inc)
  const groupId = correlationGroupId(inc)

  return (
    <li>
      <button
        type="button"
        className="flex w-full text-left transition-colors duration-150"
        style={selected ? { background: 'var(--tn-select-bg)' } : undefined}
        onClick={onSelect}
      >
        <div
          className="w-0.5 shrink-0"
          style={{ background: isNextTarget ? '#a855f7' : railColor(inc.severity) }}
        />
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <div className="flex items-center gap-2">
            {rank != null ? (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--tn-muted)]">
                #{rank}
              </span>
            ) : null}
            <span className="truncate text-sm font-medium">
              {inc.endpointLabel || inc.endpointId}
            </span>
            {rank === 1 ? (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--tn-warn)]">
                Resolve first
              </span>
            ) : null}
            {isNextTarget ? (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight"
                style={{
                  background: 'color-mix(in srgb,#a855f7 18%,transparent)',
                  color: '#a855f7',
                }}
              >
                Next
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={severityTone(inc.severity)}>{inc.severity || 'low'}</StatusBadge>
            <span className="text-xs text-[var(--tn-muted)]">
              {detectionTypeLabel(inc.detectionType)}
            </span>
            {groupId ? (
              <StatusBadge tone="warn">
                Related · {related || '—'}
              </StatusBadge>
            ) : null}
          </div>
          <div className="tn-meta mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            {priority != null ? (
              <span>
                Recovery {formatPriorityScore(priority)}
                {band ? ` · ${band}` : ''}
              </span>
            ) : null}
            {relief > 0 ? <span>Relief {relief}</span> : null}
            {related > 0 && !groupId ? <span>Related {related}</span> : null}
          </div>
        </div>
      </button>
    </li>
  )
}
