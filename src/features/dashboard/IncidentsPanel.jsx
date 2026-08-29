import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Radio } from 'lucide-react'
import {
  DETECTION_TYPES,
  detectionTypeLabel,
  formatEvidenceItem,
} from '@shared/incidents.js'

function pct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Math.round(Number(n) * 100)}%`
}

function trustFmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return String(Math.round(Number(n)))
}

function severityTone(severity) {
  switch (severity) {
    case 'critical':
      return 'bg-rose-500 text-white'
    case 'high':
      return 'bg-orange-500 text-white'
    case 'medium':
      return 'bg-amber-400 text-amber-950'
    default:
      return 'bg-slate-300 text-slate-800 dark:bg-slate-700 dark:text-slate-100'
  }
}

function railClass(severity) {
  switch (severity) {
    case 'critical':
      return 'bg-rose-500'
    case 'high':
      return 'bg-orange-500'
    case 'medium':
      return 'bg-amber-400'
    default:
      return 'bg-slate-400'
  }
}

function explanationPreview(inc) {
  const t = String(inc.explanation ?? '').trim()
  if (t) return t.length > 110 ? `${t.slice(0, 107)}…` : t
  if (inc.explanationStatus === 'pending') return 'Generating…'
  return 'No explanation yet'
}

export default function IncidentsPanel({ incidents = [], onSelectEndpoint }) {
  const [typeFilter, setTypeFilter] = useState(null)
  const [openId, setOpenId] = useState(null)

  const rows = useMemo(() => {
    const list = Array.isArray(incidents) ? incidents : []
    if (!typeFilter) return list
    return list.filter(
      (inc) =>
        inc.detectionType === typeFilter ||
        (inc.detectionTypes ?? []).includes(typeFilter)
    )
  }, [incidents, typeFilter])

  const presentTypes = useMemo(() => {
    const set = new Set()
    for (const inc of incidents ?? []) {
      if (inc.detectionType) set.add(inc.detectionType)
      for (const t of inc.detectionTypes ?? []) set.add(t)
    }
    return DETECTION_TYPES.filter((t) => set.has(t))
  }, [incidents])

  const chipTypes = presentTypes.length > 0 ? presentTypes : DETECTION_TYPES

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white/70 dark:border-white/10 dark:bg-slate-950/50 lg:sticky lg:top-3 lg:max-h-[calc(100svh-4.75rem)]">
      <div className="border-b border-slate-200/60 px-4 py-3 dark:border-white/10">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Incident stream
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Live — drops when the signal clears
            </p>
          </div>
          <span className="font-mono text-lg tabular-nums text-slate-900 dark:text-slate-100">
            {incidents.length}
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1">
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
      <div className="min-h-[12rem] flex-1 overflow-auto p-2">
        {rows.length === 0 ? (
          <div className="flex h-full min-h-[10rem] flex-col items-center justify-center gap-2 px-4 text-center">
            <Radio className="h-8 w-8 text-emerald-500/80" strokeWidth={1.5} />
            <p className="text-sm text-slate-600 dark:text-slate-300">Channel clear</p>
            <p className="text-xs text-slate-400">No detections have passed criteria.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((inc) => {
              const expanded = openId === inc.id
              const evidence = Array.isArray(inc.evidence) ? inc.evidence : []
              const deps = Array.isArray(inc.affectedDependencies)
                ? inc.affectedDependencies
                : []
              return (
                <li key={inc.id}>
                  <article
                    className={[
                      'overflow-hidden rounded-xl border bg-white/80 dark:bg-slate-900/40',
                      expanded
                        ? 'border-cyan-400/40'
                        : 'border-slate-200/70 dark:border-white/10',
                    ].join(' ')}
                  >
                    <div className="flex">
                      <div className={`w-1 shrink-0 ${railClass(inc.severity)}`} />
                      <div className="min-w-0 flex-1 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            className="truncate text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
                            onClick={() => onSelectEndpoint?.(inc.endpointId)}
                          >
                            {inc.endpointLabel || inc.endpointId}
                          </button>
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
                            aria-expanded={expanded}
                            aria-label={expanded ? 'Collapse incident' : 'Expand incident'}
                            onClick={() => setOpenId((id) => (id === inc.id ? null : inc.id))}
                          >
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition ${expanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                        </div>
                        <button
                          type="button"
                          className="mt-1.5 w-full text-left"
                          onClick={() => setOpenId((id) => (id === inc.id ? null : inc.id))}
                        >
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityTone(
                              inc.severity
                            )}`}
                          >
                            {inc.severity || 'low'}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {detectionTypeLabel(inc.detectionType)}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-slate-500">
                            conf {pct(inc.confidence)}
                          </span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-xs text-slate-600 dark:text-slate-400">
                          {explanationPreview(inc)}
                        </p>
                        </button>
                      </div>
                    </div>
                    {expanded ? (
                      <div className="border-t border-slate-200/60 px-3 py-3 text-xs dark:border-white/10">
                        <div className="mb-2 grid grid-cols-3 gap-2 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400">
                              Anomaly
                            </div>
                            {pct(inc.anomalyScore)}
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400">
                              Trust
                            </div>
                            {trustFmt(inc.trustScore)}
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400">
                              Deps
                            </div>
                            {deps.length}
                          </div>
                        </div>
                        <div className="mb-2">
                          <div className="mb-1 font-medium text-slate-700 dark:text-slate-200">
                            Explanation
                          </div>
                          {inc.explanationStatus === 'pending' && !inc.explanation ? (
                            <p className="text-slate-400">Generating explanation…</p>
                          ) : inc.explanation ? (
                            <p className="text-slate-600 dark:text-slate-300">{inc.explanation}</p>
                          ) : (
                            <p className="text-slate-400">
                              {inc.explanationStatus === 'error'
                                ? 'Commander could not explain this detection. Numeric facts are below.'
                                : 'No explanation yet.'}
                            </p>
                          )}
                        </div>
                        <div className="grid gap-3 md:grid-cols-1">
                          <div>
                            <div className="mb-1 font-medium text-slate-700 dark:text-slate-200">
                              Facts
                            </div>
                            {evidence.length === 0 ? (
                              <p className="text-slate-400">None</p>
                            ) : (
                              <ul className="space-y-1 text-slate-600 dark:text-slate-300">
                                {evidence.map((ev, i) => (
                                  <li key={`${ev.code}-${ev.detail ?? i}`}>
                                    {formatEvidenceItem(ev)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <div className="mb-1 font-medium text-slate-700 dark:text-slate-200">
                              Affected dependencies
                            </div>
                            {deps.length === 0 ? (
                              <p className="text-slate-400">None on the spread path</p>
                            ) : (
                              <ul className="space-y-1 text-slate-600 dark:text-slate-300">
                                {deps.map((d) => (
                                  <li key={d.id}>
                                    {d.source} → {d.target}
                                    {d.role ? ` · ${d.role}` : ''}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                        {Array.isArray(inc.detectionTypes) && inc.detectionTypes.length > 1 ? (
                          <p className="mt-2 text-[11px] text-slate-400">
                            Also:{' '}
                            {inc.detectionTypes
                              .filter((t) => t !== inc.detectionType)
                              .map(detectionTypeLabel)
                              .join(', ')}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {rows.length > 0 ? (
        <div className="flex items-center gap-1.5 border-t border-slate-200/60 px-3 py-2 text-[11px] text-slate-400 dark:border-white/10">
          <AlertTriangle className="h-3 w-3" />
          Click an endpoint name to chart it
        </div>
      ) : null}
    </section>
  )
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={[
        'rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        active
          ? 'bg-slate-900 text-white dark:bg-cyan-400 dark:text-slate-950'
          : 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300',
      ].join(' ')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
