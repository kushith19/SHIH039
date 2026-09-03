import { Link, useSearchParams } from 'react-router-dom'
import {
  detectionTypeLabel,
} from '@shared/incidents.js'
import {
  hopDistanceOf,
  keySignals,
  labelPath,
  primaryAttackPath,
  riskPercent,
  whyItMatters,
} from '@shared/incidentIntel.js'
import StatusBadge from '../../ui/StatusBadge'
import { dashboardCommanderIncidentHref } from './dashboardPanels.js'

function severityTone(severity) {
  if (severity === 'critical' || severity === 'high') return 'crit'
  if (severity === 'medium') return 'warn'
  return 'muted'
}

function trustFmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return String(Math.round(Number(n)))
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

export default function IncidentCard({ inc, nodes = [], primarySpreadNodeId = null, onSelectEndpoint }) {
  const [searchParams] = useSearchParams()
  const roomLike = { nodes }
  const path = primaryAttackPath(inc)
  const labels = labelPath(path, roomLike)
  const hops = hopDistanceOf(path)
  const risk = riskPercent(inc.anomalyScore)
  const fin = inc.financialContext
  const money =
    fin?.simulated && fin.exposureLabel && fin.exposureLabel !== '₹0' ? fin.exposureLabel : null
  const related = [...(Array.isArray(inc.relatedIncidents) ? inc.relatedIncidents : [])].sort(
    (a, b) => {
      const d = severityRank(a.severity) - severityRank(b.severity)
      if (d !== 0) return d
      return String(a.summary || a.incidentType || '').localeCompare(
        String(b.summary || b.incidentType || '')
      )
    }
  )
  const signals = keySignals(inc)
  const commanderId = inc.persistentId || inc.id
  const status = inc.status || 'open'

  // Highest-risk next target derived from peer trust + propagation scoring
  const nextTargetId =
    primarySpreadNodeId ??
    inc.primarySpreadNodeId ??
    inc.graphContext?.primarySpreadNodeId ??
    null
  const nextTargetNode = nextTargetId
    ? nodes.find((n) => n.id === nextTargetId)
    : null
  const nextTargetLabel = nextTargetNode?.data?.label ?? nextTargetId

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={severityTone(inc.severity)}>{inc.severity || 'low'}</StatusBadge>
        <StatusBadge tone={status === 'open' ? 'warn' : 'muted'}>{status}</StatusBadge>
      </div>
      <h2 className="mt-3 text-lg font-medium">
        <button
          type="button"
          className="text-left hover:underline"
          onClick={() => onSelectEndpoint?.(inc.endpointId)}
        >
          {inc.endpointLabel || inc.endpointId}
        </button>
      </h2>
      <p className="tn-meta mt-1">{detectionTypeLabel(inc.detectionType)}</p>

      <div className="mt-5 grid grid-cols-3 gap-4 font-mono tabular-nums">
        <div>
          <div className="tn-label">Risk</div>
          <div className="mt-1 text-base">{risk == null ? '—' : risk}</div>
        </div>
        <div>
          <div className="tn-label">Trust</div>
          <div className="mt-1 text-base">{trustFmt(inc.trustScore)}</div>
        </div>
        <div>
          <div className="tn-label">Exposure</div>
          <div className="mt-1 text-base">{money || '—'}</div>
        </div>
      </div>
      {money ? (
        <p className="tn-meta mt-2">Simulated exposure — demo mapping, not a loss forecast.</p>
      ) : null}

      <div className="mt-6">
        <h3 className="tn-section-title">Why it matters</h3>
        <p className="mt-2 text-sm leading-relaxed">{whyItMatters(inc)}</p>
      </div>

      <div className="mt-6">
        <h3 className="tn-section-title">Attack path</h3>
        {labels.length <= 1 ? (
          <p className="tn-meta mt-2">
            {labels[0] || inc.endpointLabel || inc.endpointId}
            {hops === 0 ? ' · no observed downstream path this tick' : ''}
          </p>
        ) : (
          <ol className="mt-2 space-y-1">
            {labels.map((label, i) => (
              <li key={`${path[i]}-${i}`} className="text-sm">
                <span className={i === 0 ? 'font-medium text-[var(--tn-crit)]' : 'text-[var(--tn-warn)]'}>
                  {label}
                </span>
                {i === 0 ? (
                  <span className="tn-meta"> confirmed anomaly</span>
                ) : (
                  <span className="tn-meta"> propagated</span>
                )}
                {i < labels.length - 1 ? <div className="pl-1 text-[var(--tn-muted)]">↓</div> : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      {nextTargetId ? (
        <div className="mt-6">
          <h3 className="tn-section-title">Highest-risk next target</h3>
          <div className="mt-2 flex items-center gap-2 rounded-md border border-[color-mix(in_srgb,#a855f7_35%,transparent)] bg-[color-mix(in_srgb,#a855f7_10%,transparent)] px-3 py-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#a855f7]" />
            <button
              type="button"
              className="text-left text-sm font-medium text-[#a855f7] hover:underline"
              onClick={() => onSelectEndpoint?.(nextTargetId)}
            >
              {nextTargetLabel}
            </button>
            <span className="ml-auto text-[11px] text-[var(--tn-muted)]">
              peer trust · propagation risk
            </span>
          </div>
          <p className="tn-meta mt-1.5">
            Predicted highest-risk spread target based on peer trust scores and graph propagation. Assessment only — not a confirmed attack path.
          </p>
        </div>
      ) : null}

      <div className="mt-6">
        <h3 className="tn-section-title">Key signals</h3>
        {signals.length === 0 ? (
          <p className="tn-meta mt-2">No compact signals beyond the residual flag.</p>
        ) : (
          <ul className="tn-meta mt-2 space-y-1.5">
            {signals.map((s) => (
              <li key={s}>• {s}</li>
            ))}
          </ul>
        )}
      </div>

      {related.length > 0 ? (
        <div className="mt-6">
          <h3 className="tn-section-title">Related</h3>
          <p className="tn-meta mt-2">{related.length} related</p>
          <ul className="tn-meta mt-1 space-y-1">
            {related.slice(0, 3).map((r) => (
              <li key={r.incidentId}>• {r.summary || r.incidentType || r.incidentId}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {inc.campaignId ? (
        <p className="tn-meta mt-4">History campaign {inc.campaignId}</p>
      ) : null}

      <Link
        to={dashboardCommanderIncidentHref(searchParams, commanderId)}
        replace
        className="tn-btn-primary mt-6 inline-flex"
      >
        Open in AI Commander →
      </Link>
    </div>
  )
}
