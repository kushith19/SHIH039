import { useEffect, useMemo, useState } from 'react'
import {
  DETECTION_TYPES,
  detectionTypeLabel,
  formatEvidenceItem,
} from '@shared/incidents.js'
import IncidentCard from './IncidentCard'
import CampaignIntelligence from './CampaignIntelligence'
import HistoryIncidentTimeline from './HistoryIncidentTimeline'
import Toolbar, { FilterChip } from '../../ui/Toolbar'
import StatusBadge from '../../ui/StatusBadge'
import EmptyState from '../../ui/EmptyState'
import {
  liveIncidentMatchesTimelineEvent,
  timelineSelectionKey,
} from './historyTimelineView.js'

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

function explanationPreview(inc) {
  if (inc.explanationStatus === 'pending') return 'Generating…'
  if (inc.explanationStatus === 'fallback') return 'Deterministic template — Commander offline'
  if (inc.explanationStatus === 'error') return 'Commander could not explain this detection'
  const t = String(inc.explanation ?? '').trim()
  if (t) return t.length > 90 ? `${t.slice(0, 87)}…` : t
  return 'No explanation yet'
}

function queueEvidencePreview(inc) {
  const line = (Array.isArray(inc?.evidence) ? inc.evidence : [])
    .map(formatEvidenceItem)
    .find(Boolean)
  if (line) return line.length > 90 ? `${line.slice(0, 87)}…` : line
  return explanationPreview(inc)
}

function streamKey(inc) {
  return String(inc.endpointId || inc.id || '')
}

function severityRank(severity) {
  switch (String(severity ?? '').toLowerCase()) {
    case 'critical':
      return 0
    case 'high':
      return 1
    case 'medium':
      return 2
    default:
      return 3
  }
}

function compareBySeverity(a, b) {
  const d = severityRank(a.severity) - severityRank(b.severity)
  if (d !== 0) return d
  const la = String(a.endpointLabel || a.endpointId || '')
  const lb = String(b.endpointLabel || b.endpointId || '')
  return la.localeCompare(lb)
}

export default function IncidentsPanel({
  roomId = '',
  incidents = [],
  nodes = [],
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
  const [secondaryTab, setSecondaryTab] = useState('timeline')

  const nextTargetKey = primarySpreadNodeId ? String(primarySpreadNodeId) : null

  const orderedIncidents = useMemo(() => {
    const list = Array.isArray(incidents) ? incidents : []
    return [...list].sort(compareBySeverity)
  }, [incidents])

  const rows = useMemo(() => {
    if (!typeFilter) return orderedIncidents
    return orderedIncidents.filter(
      (inc) =>
        inc.detectionType === typeFilter ||
        (inc.detectionTypes ?? []).includes(typeFilter)
    )
  }, [orderedIncidents, typeFilter])

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
          <p className="tn-meta mt-2">Live promoted detections this tick · history below.</p>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <div className="soc-zone flex min-h-0 max-h-[40vh] flex-col overflow-hidden lg:max-h-none">
          <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-[var(--tn-line)] px-4 py-2.5">
            <div>
              <div className="text-sm font-medium">Live queue</div>
              <p className="tn-meta mt-0.5 text-[11px]">Promoted this tick</p>
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
              Level-1 evidence · hand off to Commander (advisory) or Response (execute)
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selected ? (
              <IncidentCard
                inc={selected}
                nodes={nodes}
                primarySpreadNodeId={primarySpreadNodeId}
                onSelectEndpoint={onSelectEndpoint}
              />
            ) : (
              <p className="tn-meta">Select an incident from the live queue to inspect evidence.</p>
            )}
          </div>
        </div>
      </div>

      <div className="soc-zone flex min-h-[12rem] max-h-[18rem] shrink-0 flex-col overflow-hidden lg:min-h-[14rem]">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--tn-line)] px-4 py-2">
          <span className="soc-zone-title mr-2">Secondary</span>
          <FilterChip
            active={secondaryTab === 'timeline'}
            onClick={() => setSecondaryTab('timeline')}
          >
            Timeline
          </FilterChip>
          <FilterChip
            active={secondaryTab === 'campaigns'}
            onClick={() => setSecondaryTab('campaigns')}
          >
            Campaigns
          </FilterChip>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {secondaryTab === 'timeline' ? (
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

function QueueRow({ inc, selected, onSelect, isNextTarget = false }) {
  return (
    <li>
      <button
        type="button"
        className="flex w-full text-left"
        style={selected ? { background: 'var(--tn-select-bg)' } : undefined}
        onClick={onSelect}
      >
        <div
          className="w-0.5 shrink-0"
          style={{ background: isNextTarget ? '#a855f7' : railColor(inc.severity) }}
        />
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {inc.endpointLabel || inc.endpointId}
            </span>
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
          </div>
          <p className="tn-meta mt-1 line-clamp-1 text-[12px]">{queueEvidencePreview(inc)}</p>
        </div>
      </button>
    </li>
  )
}
