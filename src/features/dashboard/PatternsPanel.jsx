import { useEffect, useState } from 'react'
import { campaignHeadline, campaignTitle } from '@shared/campaigns.js'
import { formatStoryClock } from '@shared/cityContext.js'
import EmptyState from '../../ui/EmptyState'
import StatusBadge from '../../ui/StatusBadge'

function pct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Math.round(Number(n) * 100)}%`
}

function riskLabel(exposure) {
  const x = Number(exposure)
  if (!Number.isFinite(x) || x <= 0) return 'No finance exposure in set'
  if (x >= 0.7) return 'High qualitative finance exposure'
  if (x >= 0.35) return 'Moderate qualitative finance exposure'
  return 'Low qualitative finance exposure'
}

export default function PatternsPanel({ campaigns = [], hideHeader = false }) {
  const live = (campaigns ?? []).filter((c) => c.status && c.status !== 'expired')
  const rows = live.length ? live : campaigns ?? []
  const [selectedId, setSelectedId] = useState(rows[0]?.id ?? null)

  useEffect(() => {
    if (!rows.length) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !rows.some((c) => c.id === selectedId)) {
      setSelectedId(rows[0].id)
    }
  }, [rows, selectedId])

  const selected = rows.find((c) => c.id === selectedId) ?? null

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-3">
        {hideHeader ? (
          <p className="tn-meta">
            Catalog correlation after incidents exist — not a confirmed attacker campaign
          </p>
        ) : null}
        <span className="ml-auto font-mono text-lg tabular-nums">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="tn-surface">
          <EmptyState
            title="No pattern match yet"
            body="Two connected endpoints flagged inside the catalog window can form one."
          />
        </div>
      ) : (
        <div className="grid min-h-[22rem] gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ul className="tn-surface overflow-hidden">
            {rows.map((c) => {
              const active = c.id === selectedId
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full px-4 py-3 text-left"
                    style={active ? { background: 'var(--tn-select-bg)' } : undefined}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <div className="text-sm font-medium">{campaignTitle(c)}</div>
                    <p className="tn-meta mt-1 line-clamp-2">{campaignHeadline(c)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusBadge>{c.status}</StatusBadge>
                      <span className="font-mono text-sm tabular-nums text-[var(--tn-muted)]">
                        {pct(c.campaignMatchScore)}
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="tn-surface min-w-0 p-5">
            {selected ? <PatternDetail c={selected} /> : null}
          </div>
        </div>
      )}
    </section>
  )
}

function PatternDetail({ c }) {
  const assessment = c.commanderAssessment
  const rag = assessment?.rag === true
  return (
    <div>
      <h2 className="text-lg font-medium">{campaignTitle(c)}</h2>
      <p className="mt-2 text-sm leading-relaxed">{campaignHeadline(c)}</p>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="tn-label">Confidence</dt>
          <dd className="mt-1 font-mono tabular-nums">{pct(c.campaignMatchScore)}</dd>
        </div>
        <div>
          <dt className="tn-label">Endpoints</dt>
          <dd className="mt-1 font-mono tabular-nums">{(c.endpointIds ?? []).length}</dd>
        </div>
        <div>
          <dt className="tn-label">Incidents</dt>
          <dd className="mt-1 font-mono tabular-nums">{(c.incidentIds ?? []).length}</dd>
        </div>
        <div>
          <dt className="tn-label">Window</dt>
          <dd className="mt-1 font-mono text-sm">
            {formatStoryClock(c.startedTick)} → {formatStoryClock(c.lastSeenTick ?? c.startedTick)}
          </dd>
        </div>
      </dl>
      <p className="tn-meta mt-4">{riskLabel(c.financialExposure)}</p>
      {(c.sectors ?? []).length > 0 ? (
        <p className="tn-meta mt-2">Sectors: {c.sectors.join(', ')}</p>
      ) : null}
      {Array.isArray(c.signals) && c.signals.length > 0 ? (
        <ul className="mt-4 space-y-1.5 text-sm text-[var(--tn-muted)]">
          {c.signals.map((s) => (
            <li key={s.id}>
              {s.ok ? '●' : '○'} {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      {assessment?.summary ? (
        <div className="mt-6">
          <h3 className="tn-section-title">Commander note</h3>
          <p className="tn-meta mt-2">
            {assessment.status === 'ready'
              ? rag
                ? 'Commander · RAG'
                : 'Commander · no RAG claimed'
              : 'Deterministic template — Commander offline'}
          </p>
          <p className="mt-2 text-sm leading-relaxed">{assessment.summary}</p>
        </div>
      ) : null}
    </div>
  )
}
