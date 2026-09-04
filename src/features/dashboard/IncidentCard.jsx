import { Link, useSearchParams } from 'react-router-dom'
import {
  detectionTypeLabel,
  formatEvidenceItem,
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
import {
  dashboardCommanderIncidentHref,
  dashboardResponseIncidentHref,
} from './dashboardPanels.js'
import { fmt } from './metrics'
import { metricEvidenceHighlight } from './overviewView.js'

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

  const nextTargetId =
    primarySpreadNodeId ??
    inc.primarySpreadNodeId ??
    inc.graphContext?.primarySpreadNodeId ??
    null
  const nextTargetNode = nextTargetId
    ? nodes.find((n) => n.id === nextTargetId)
    : null
  const nextTargetLabel = nextTargetNode?.data?.label ?? nextTargetId
  const spreadAssessment =
    (inc.primarySpreadAssessment?.nodeId === nextTargetId
      ? inc.primarySpreadAssessment
      : null) ??
    (inc.graphContext?.primarySpreadAssessment?.nodeId === nextTargetId
      ? inc.graphContext.primarySpreadAssessment
      : null)
  const spreadComponents = spreadAssessment?.components
  const spreadPathLabels = Array.isArray(spreadAssessment?.path)
    ? labelPath(spreadAssessment.path, roomLike)
    : []
  const metric = metricEvidenceHighlight(inc)
  const evidenceLines = (Array.isArray(inc.evidence) ? inc.evidence : [])
    .map(formatEvidenceItem)
    .filter(Boolean)
    .slice(0, 4)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={severityTone(inc.severity)}>{inc.severity || 'low'}</StatusBadge>
        <StatusBadge tone={status === 'open' ? 'warn' : 'muted'}>{status}</StatusBadge>
      </div>
      <h2 className="mt-2 text-lg font-medium">
        <button
          type="button"
          className="text-left hover:underline"
          onClick={() => onSelectEndpoint?.(inc.endpointId)}
        >
          {inc.endpointLabel || inc.endpointId}
        </button>
      </h2>
      <p className="tn-meta mt-0.5">{detectionTypeLabel(inc.detectionType)}</p>

      <div className="mt-4 grid grid-cols-3 gap-3 border-y border-[var(--tn-line)] py-3 font-mono tabular-nums">
        <div>
          <div className="tn-label">Risk</div>
          <div className="mt-0.5 text-base">{risk == null ? '—' : risk}</div>
        </div>
        <div>
          <div className="tn-label">Trust</div>
          <div className="mt-0.5 text-base">{trustFmt(inc.trustScore)}</div>
        </div>
        <div>
          <div className="tn-label">Exposure</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-base">
            <span>{money || '—'}</span>
            {money ? <span className="soc-role-chip soc-role-simulated">Sim</span> : null}
          </div>
        </div>
      </div>
      {money ? (
        <p className="tn-meta mt-1.5 text-[11px]">Simulated exposure — not a loss forecast.</p>
      ) : null}

      <div className="mt-5">
        <h3 className="soc-zone-title">Why it matters</h3>
        <p className="mt-1.5 text-sm leading-relaxed">{whyItMatters(inc)}</p>
      </div>

      {metric || evidenceLines.length ? (
        <div className="mt-5">
          <h3 className="soc-zone-title">Level-1 evidence</h3>
          {metric ? (
            <div className="mt-2 grid grid-cols-3 gap-3 border border-[var(--tn-line)] bg-[var(--tn-elevated)] px-3 py-2.5">
              <div>
                <div className="tn-label">{metric.label}</div>
                <div className="mt-0.5 font-mono text-sm tabular-nums text-[var(--tn-crit)]">
                  {fmt(metric.observed)}
                </div>
              </div>
              <div>
                <div className="tn-label">Expected</div>
                <div className="mt-0.5 font-mono text-sm tabular-nums">
                  ~{fmt(metric.expected)}
                </div>
              </div>
              <div>
                <div className="tn-label">Deviation</div>
                <div className="mt-0.5 font-mono text-sm tabular-nums text-[var(--tn-crit)]">
                  {metric.deviationPct == null
                    ? '—'
                    : `${metric.deviationPct > 0 ? '+' : ''}${Math.round(metric.deviationPct)}%`}
                </div>
              </div>
            </div>
          ) : null}
          {evidenceLines.length ? (
            <ul className="tn-meta mt-2 space-y-1">
              {evidenceLines.map((line, i) => (
                <li key={`${i}-${line.slice(0, 24)}`}>• {line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5">
        <h3 className="soc-zone-title">Attack path</h3>
        {labels.length <= 1 ? (
          <p className="tn-meta mt-1.5">
            {labels[0] || inc.endpointLabel || inc.endpointId}
            {hops === 0 ? ' · no observed downstream path this tick' : ''}
          </p>
        ) : (
          <ol className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {labels.map((label, i) => (
              <li key={`${path[i]}-${i}`} className="flex items-center gap-1.5 text-sm">
                {i > 0 ? <span className="text-[var(--tn-muted)]">→</span> : null}
                <span className={i === 0 ? 'font-medium text-[var(--tn-crit)]' : 'text-[var(--tn-warn)]'}>
                  {label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {nextTargetId ? (
        <div className="mt-5">
          <h3 className="soc-zone-title">Highest-risk next target</h3>
          <div className="mt-1.5 flex items-center gap-2 rounded-md border border-[color-mix(in_srgb,#a855f7_35%,transparent)] bg-[color-mix(in_srgb,#a855f7_10%,transparent)] px-3 py-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#a855f7]" />
            <button
              type="button"
              className="text-left text-sm font-medium text-[#a855f7] hover:underline"
              onClick={() => onSelectEndpoint?.(nextTargetId)}
            >
              {nextTargetLabel}
            </button>
            {spreadAssessment?.score != null ? (
              <span className="font-mono text-[11px] tabular-nums text-[#a855f7]">
                {Math.round(spreadAssessment.score)}
              </span>
            ) : null}
            <span className="ml-auto text-[11px] text-[var(--tn-muted)]">assessment</span>
          </div>
          {spreadComponents ? (
            <ul className="tn-meta mt-2 space-y-0.5">
              <li>
                • Behavioral risk: {Math.round(spreadComponents.behavioralRisk)}
              </li>
              <li>
                • Peer exposure/trust risk: {Math.round(spreadComponents.peerRisk)}
              </li>
              <li>
                • TGNN residual: {Math.round(spreadComponents.residualRisk)}
              </li>
              <li>
                • Graph relationship: {Math.round(spreadComponents.graphRelationshipRisk)}
              </li>
              <li>
                • Hop proximity: {Math.round(spreadComponents.hopProximityRisk)}
              </li>
            </ul>
          ) : null}
          {spreadPathLabels.length > 1 ? (
            <p className="tn-meta mt-1.5">
              Path: {spreadPathLabels.join(' → ')}
            </p>
          ) : null}
          <p className="tn-meta mt-1.5 text-[11px]">
            Assessment only — not a confirmed compromise or automatic attack target.
          </p>
        </div>
      ) : null}

      <div className="mt-5">
        <h3 className="soc-zone-title">Key signals</h3>
        {signals.length === 0 ? (
          <p className="tn-meta mt-1.5">No compact signals beyond the residual flag.</p>
        ) : (
          <ul className="tn-meta mt-1.5 space-y-1">
            {signals.map((s) => (
              <li key={s}>• {s}</li>
            ))}
          </ul>
        )}
      </div>

      {related.length > 0 ? (
        <div className="mt-5">
          <h3 className="soc-zone-title">Related</h3>
          <ul className="tn-meta mt-1.5 space-y-1">
            {related.slice(0, 3).map((r) => (
              <li key={r.incidentId}>• {r.summary || r.incidentType || r.incidentId}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {inc.campaignId ? (
        <p className="tn-meta mt-3 text-[11px]">History campaign {inc.campaignId}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--tn-line)] pt-4">
        <Link
          to={dashboardCommanderIncidentHref(searchParams, commanderId)}
          replace
          className="tn-btn inline-flex"
        >
          Commander <span className="text-[var(--tn-muted)]">(advisory)</span>
        </Link>
        <Link
          to={dashboardResponseIncidentHref(searchParams, commanderId)}
          replace
          className="tn-btn-primary inline-flex"
        >
          Response <span className="opacity-80">(execute)</span>
        </Link>
      </div>
    </div>
  )
}
