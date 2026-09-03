import { useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  DETECTION_TYPES,
  detectionTypeLabel,
  formatEvidenceItem,
} from '@shared/incidents.js'
import { playbookTitle, stageProgressLabel } from '@shared/campaigns.js'

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
      return 'var(--tn-crit)'
    case 'high':
      return 'var(--tn-crit)'
    case 'medium':
      return 'var(--tn-warn)'
    default:
      return 'var(--tn-muted)'
  }
}

function explanationPreview(inc) {
  if (inc.explanationStatus === 'pending') return 'Generating…'
  if (inc.explanationStatus === 'fallback') return 'Template facts — AI Commander unavailable'
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
}) {
  const [typeFilter, setTypeFilter] = useState(null)
  const [openId, setOpenId] = useState(null)
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
        title: meta?.title || playbookTitle(meta?.playbookId) || 'Campaign',
        status: meta?.status,
        progress: meta ? stageProgressLabel(meta) : `${list.length} endpoints`,
        incidents: list,
      }
    })
    return { campaignGroups, ungrouped }
  }, [rows, campaigns])

  return (
    <section className="tn-surface overflow-hidden">
      <div className="border-b border-[var(--tn-line)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="tn-label">{demoted ? 'Endpoint flags' : 'Incident stream'}</div>
            <p className="mt-0.5 text-sm text-[var(--tn-muted)]">
              {demoted
                ? 'Raw detections behind the attack story'
                : 'Grouped by campaign when correlated'}
            </p>
          </div>
          <span className="font-mono text-lg tabular-nums">{incidents.length}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
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
        </div>
      </div>
      <div className="min-h-[10rem]">
        {rows.length === 0 ? (
          <div className="flex h-full min-h-[10rem] flex-col items-center justify-center gap-1 px-4 text-center">
            <p className="text-sm">Channel clear</p>
            <p className="text-sm text-[var(--tn-muted)]">No detections have passed criteria.</p>
          </div>
        ) : (
          <div>
            {groups.campaignGroups.map((group) => (
              <div key={group.id} className="border-b border-[var(--tn-line)]">
                <div className="bg-[var(--tn-elevated)] px-3 py-1.5">
                  <div className="text-xs font-medium">{group.title}</div>
                  <p className="font-mono text-[11px] text-[var(--tn-muted)]">
                    {group.status ? `${group.status} · ` : ''}
                    {group.progress}
                  </p>
                </div>
                <ul>
                  {group.incidents.map((inc) => (
                    <IncidentCard
                      key={streamKey(inc)}
                      inc={inc}
                      expanded={openId === streamKey(inc)}
                      onToggle={() => setOpenId((id) => (id === streamKey(inc) ? null : streamKey(inc)))}
                      onSelectEndpoint={onSelectEndpoint}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {groups.ungrouped.length > 0 ? (
              <div>
                {groups.campaignGroups.length > 0 ? (
                  <div className="bg-[var(--tn-elevated)] px-3 py-1.5 text-xs text-[var(--tn-muted)]">
                    Ungrouped
                  </div>
                ) : null}
                <ul>
                  {groups.ungrouped.map((inc) => (
                    <IncidentCard
                      key={streamKey(inc)}
                      inc={inc}
                      expanded={openId === streamKey(inc)}
                      onToggle={() => setOpenId((id) => (id === streamKey(inc) ? null : streamKey(inc)))}
                      onSelectEndpoint={onSelectEndpoint}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {rows.length > 0 ? (
        <div className="border-t border-[var(--tn-line)] px-3 py-2 text-xs text-[var(--tn-muted)]">
          Click an endpoint name to chart it
        </div>
      ) : null}
    </section>
  )
}

function IncidentCard({ inc, expanded, onToggle, onSelectEndpoint }) {
  const evidence = Array.isArray(inc.evidence) ? inc.evidence : []
  const deps = Array.isArray(inc.affectedDependencies) ? inc.affectedDependencies : []
  return (
    <li className="border-b border-[var(--tn-line)]">
      <article className="flex">
        <div className="w-0.5 shrink-0" style={{ background: railColor(inc.severity) }} />
        <div className="min-w-0 flex-1 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              className="truncate text-sm font-medium hover:underline"
              onClick={() => onSelectEndpoint?.(inc.endpointId)}
            >
              {inc.endpointLabel || inc.endpointId}
            </button>
            <button
              type="button"
              className="shrink-0 p-0.5 text-[var(--tn-muted)]"
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse incident' : 'Expand incident'}
              onClick={onToggle}
            >
              <ChevronDown className={`h-3.5 w-3.5 ${expanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
          <button type="button" className="mt-1 w-full text-left" onClick={onToggle}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="tn-badge">{inc.severity || 'low'}</span>
              <span className="text-xs text-[var(--tn-muted)]">
                {detectionTypeLabel(inc.detectionType)}
              </span>
              <span className="font-mono text-xs tabular-nums text-[var(--tn-muted)]">
                conf {pct(inc.confidence)}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-[var(--tn-muted)]">
              {explanationPreview(inc)}
            </p>
          </button>
          {expanded ? (
            <div className="mt-2 border-t border-[var(--tn-line)] pt-2 text-xs">
              <div className="mb-2 grid grid-cols-3 gap-2 font-mono tabular-nums">
                <div>
                  <div className="tn-label">Anomaly</div>
                  {pct(inc.anomalyScore)}
                </div>
                <div>
                  <div className="tn-label">Trust</div>
                  {trustFmt(inc.trustScore)}
                </div>
                <div>
                  <div className="tn-label">Deps</div>
                  {deps.length}
                </div>
              </div>
              <div className="mb-2">
                <div className="mb-1 font-medium">Explanation</div>
                {inc.explanationStatus === 'pending' ? (
                  <p className="text-[var(--tn-muted)]">Generating explanation…</p>
                ) : inc.explanationStatus === 'fallback' ? (
                  <>
                    <p className="text-[var(--tn-muted)]">
                      AI Commander unavailable. Showing a short template; numeric facts are below.
                    </p>
                    {inc.explanation ? <p className="mt-1">{inc.explanation}</p> : null}
                  </>
                ) : inc.explanationStatus === 'error' ? (
                  <p className="text-[var(--tn-muted)]">
                    Commander could not explain this detection. Numeric facts are below.
                  </p>
                ) : inc.explanation ? (
                  <p>{inc.explanation}</p>
                ) : (
                  <p className="text-[var(--tn-muted)]">No explanation yet.</p>
                )}
              </div>
              <div className="mb-1 font-medium">Facts</div>
              {evidence.length === 0 ? (
                <p className="text-[var(--tn-muted)]">None</p>
              ) : (
                <ul className="space-y-1 text-[var(--tn-muted)]">
                  {evidence.map((ev, i) => (
                    <li key={`${ev.code}-${ev.detail ?? i}`}>{formatEvidenceItem(ev)}</li>
                  ))}
                </ul>
              )}
              <div className="mt-2 mb-1 font-medium">Affected dependencies</div>
              {deps.length === 0 ? (
                <p className="text-[var(--tn-muted)]">None on the spread path</p>
              ) : (
                <ul className="space-y-1 text-[var(--tn-muted)]">
                  {deps.map((d) => (
                    <li key={d.id}>
                      {d.source} → {d.target}
                      {d.role ? ` · ${d.role}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              {Array.isArray(inc.detectionTypes) && inc.detectionTypes.length > 1 ? (
                <p className="mt-2 text-xs text-[var(--tn-muted)]">
                  Also:{' '}
                  {inc.detectionTypes
                    .filter((t) => t !== inc.detectionType)
                    .map(detectionTypeLabel)
                    .join(', ')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>
    </li>
  )
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      className="rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide"
      style={
        active
          ? { background: 'var(--tn-ink)', color: 'var(--tn-ink-fg)' }
          : { background: 'var(--tn-elevated)', color: 'var(--tn-muted)' }
      }
      onClick={onClick}
    >
      {children}
    </button>
  )
}
