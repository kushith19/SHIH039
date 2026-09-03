import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DETECTION_TYPES,
  detectionTypeLabel,
  formatEvidenceItem,
} from '@shared/incidents.js'
import { campaignTitle } from '@shared/campaigns.js'
import { TIMELINE_CAPTION, timelineEventsFromIncident } from '@shared/incidentTimeline.js'
import IncidentTimeline from './IncidentTimeline'
import Toolbar, { FilterChip } from '../../ui/Toolbar'
import StatusBadge from '../../ui/StatusBadge'
import EmptyState from '../../ui/EmptyState'

function pct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Math.round(Number(n) * 100)}%`
}

function trustFmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return String(Math.round(Number(n)))
}

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
  if (t) return t.length > 110 ? `${t.slice(0, 107)}…` : t
  return 'No explanation yet'
}

function streamKey(inc) {
  return String(inc.endpointId || inc.id || '')
}

export default function IncidentsPanel({
  incidents = [],
  campaigns = [],
  onSelectEndpoint,
  demoted = false,
  hideHeader = false,
}) {
  const [typeFilter, setTypeFilter] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  const orderRef = useRef({ seq: 0, byKey: new Map() })

  const orderedIncidents = useMemo(() => {
    const list = Array.isArray(incidents) ? incidents : []
    const { byKey } = orderRef.current
    const live = new Set()
    const newcomers = []
    for (const inc of list) {
      const key = streamKey(inc)
      if (!key) continue
      live.add(key)
      if (!byKey.has(key)) newcomers.push(key)
    }
    for (let i = newcomers.length - 1; i >= 0; i -= 1) {
      orderRef.current.seq += 1
      byKey.set(newcomers[i], orderRef.current.seq)
    }
    for (const key of [...byKey.keys()]) {
      if (!live.has(key)) byKey.delete(key)
    }
    return [...list].sort((a, b) => {
      const ka = byKey.get(streamKey(a)) ?? 0
      const kb = byKey.get(streamKey(b)) ?? 0
      if (kb !== ka) return kb - ka
      return streamKey(a).localeCompare(streamKey(b))
    })
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

  const groups = useMemo(() => {
    const byId = new Map((campaigns ?? []).map((c) => [c.id, c]))
    const grouped = new Map()
    const ungrouped = []
    for (const inc of rows) {
      const cid = inc.campaignId
      if (!cid) {
        ungrouped.push(inc)
        continue
      }
      if (!grouped.has(cid)) grouped.set(cid, [])
      grouped.get(cid).push(inc)
    }
    const campaignGroups = [...grouped.entries()].map(([id, list]) => {
      const meta = byId.get(id)
      return {
        id,
        title: meta?.title || campaignTitle(meta) || 'Pattern match',
        status: meta?.status,
        progress: `${list.length} endpoints`,
        incidents: list,
      }
    })
    return { campaignGroups, ungrouped }
  }, [rows, campaigns])

  const selected = rows.find((inc) => streamKey(inc) === selectedKey) ?? null

  return (
    <section className="overflow-hidden">
      <div className="mb-5">
        <Toolbar
          trailing={
            <span className="font-mono text-lg tabular-nums">{incidents.length}</span>
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
          <p className="tn-meta mt-3">
            {demoted
              ? 'Raw detections behind the story. Live flags this tick, not a ticket queue.'
              : 'Grouped by recognized pattern when correlated. Live flags this tick.'}
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="tn-surface">
          <EmptyState
            title="No promoted detections this tick"
            body="No detections have passed criteria."
          />
        </div>
      ) : (
        <div className="grid min-h-[22rem] gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="tn-surface overflow-hidden">
            {groups.campaignGroups.map((group) => (
              <div key={group.id}>
                <div className="px-4 py-2.5">
                  <div className="text-sm font-medium">{group.title}</div>
                  <p className="tn-meta mt-0.5">
                    {group.status ? `${group.status} · ` : ''}
                    {group.progress}
                  </p>
                </div>
                <ul>
                  {group.incidents.map((inc) => (
                    <QueueRow
                      key={streamKey(inc)}
                      inc={inc}
                      selected={selectedKey === streamKey(inc)}
                      onSelect={() => setSelectedKey(streamKey(inc))}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {groups.ungrouped.length > 0 ? (
              <div>
                {groups.campaignGroups.length > 0 ? (
                  <div className="px-4 py-2.5 text-sm text-[var(--tn-muted)]">Ungrouped</div>
                ) : null}
                <ul>
                  {groups.ungrouped.map((inc) => (
                    <QueueRow
                      key={streamKey(inc)}
                      inc={inc}
                      selected={selectedKey === streamKey(inc)}
                      onSelect={() => setSelectedKey(streamKey(inc))}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="tn-surface min-w-0 p-5">
            {selected ? (
              <IncidentDetail inc={selected} onSelectEndpoint={onSelectEndpoint} />
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

function QueueRow({ inc, selected, onSelect }) {
  return (
    <li>
      <button
        type="button"
        className="flex w-full text-left"
        style={selected ? { background: 'var(--tn-select-bg)' } : undefined}
        onClick={onSelect}
      >
        <div className="w-0.5 shrink-0" style={{ background: railColor(inc.severity) }} />
        <div className="min-w-0 flex-1 px-4 py-3">
          <div className="truncate text-sm font-medium">
            {inc.endpointLabel || inc.endpointId}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge tone={severityTone(inc.severity)}>{inc.severity || 'low'}</StatusBadge>
            <span className="text-sm text-[var(--tn-muted)]">
              {detectionTypeLabel(inc.detectionType)}
            </span>
          </div>
          <p className="tn-meta mt-1 line-clamp-2">{explanationPreview(inc)}</p>
        </div>
      </button>
    </li>
  )
}

function IncidentDetail({ inc, onSelectEndpoint }) {
  const evidence = Array.isArray(inc.evidence) ? inc.evidence : []
  const deps = Array.isArray(inc.affectedDependencies) ? inc.affectedDependencies : []
  return (
    <div>
      <button
        type="button"
        className="text-left text-lg font-medium hover:underline"
        onClick={() => onSelectEndpoint?.(inc.endpointId)}
      >
        {inc.endpointLabel || inc.endpointId}
      </button>
      <p className="tn-meta mt-1">
        Click the name to chart this endpoint · conf {pct(inc.confidence)}
      </p>
      <div className="mt-5 grid grid-cols-3 gap-4 font-mono tabular-nums">
        <div>
          <div className="tn-label">Anomaly</div>
          <div className="mt-1 text-base">{pct(inc.anomalyScore)}</div>
        </div>
        <div>
          <div className="tn-label">Trust</div>
          <div className="mt-1 text-base">{trustFmt(inc.trustScore)}</div>
        </div>
        <div>
          <div className="tn-label">Deps</div>
          <div className="mt-1 text-base">{deps.length}</div>
        </div>
      </div>
      <div className="mt-6">
        <IncidentTimeline
          events={timelineEventsFromIncident(inc)}
          caption={TIMELINE_CAPTION}
          pulseCurrent={inc.explanationStatus === 'pending'}
        />
      </div>
      <div className="mt-6">
        <h3 className="tn-section-title">Explanation</h3>
        {inc.explanationStatus === 'pending' ? (
          <p className="tn-meta mt-2">Generating explanation…</p>
        ) : inc.explanationStatus === 'fallback' ? (
          <>
            <p className="tn-meta mt-2">Template · no RAG. Deterministic template — Commander offline.</p>
            {inc.explanation ? <p className="mt-2 text-sm leading-relaxed">{inc.explanation}</p> : null}
          </>
        ) : inc.explanationStatus === 'error' ? (
          <p className="tn-meta mt-2">
            Commander could not explain this detection. Numeric facts are below.
          </p>
        ) : inc.explanation ? (
          <>
            <p className="tn-meta mt-2">
              {inc.explanationSource === 'llm-explain'
                ? 'Ungrounded LLM restatement · no RAG'
                : 'Template · no RAG'}
            </p>
            <p className="mt-2 text-sm leading-relaxed">{inc.explanation}</p>
          </>
        ) : (
          <p className="tn-meta mt-2">No explanation yet.</p>
        )}
      </div>
      {inc.illustrativeImpact?.kind === 'illustrative' ? (
        <p className="tn-meta mt-4">
          {inc.illustrativeImpact.label}: {inc.illustrativeImpact.value}
        </p>
      ) : null}
      <div className="mt-6">
        <h3 className="tn-section-title">Facts</h3>
        {evidence.length === 0 ? (
          <p className="tn-meta mt-2">None</p>
        ) : (
          <ul className="tn-meta mt-2 space-y-1.5">
            {evidence.map((ev, i) => (
              <li key={`${ev.code}-${ev.detail ?? i}`}>{formatEvidenceItem(ev)}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-6">
        <h3 className="tn-section-title">Affected dependencies</h3>
        {deps.length === 0 ? (
          <p className="tn-meta mt-2">None on the spread path</p>
        ) : (
          <ul className="tn-meta mt-2 space-y-1.5">
            {deps.map((d) => (
              <li key={d.id}>
                {d.source} → {d.target}
                {d.role ? ` · ${d.role}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
      {Array.isArray(inc.detectionTypes) && inc.detectionTypes.length > 1 ? (
        <p className="tn-meta mt-4">
          Also:{' '}
          {inc.detectionTypes
            .filter((t) => t !== inc.detectionType)
            .map(detectionTypeLabel)
            .join(', ')}
        </p>
      ) : null}
    </div>
  )
}
