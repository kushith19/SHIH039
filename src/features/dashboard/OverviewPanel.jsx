import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'
import StatusBadge from '../../ui/StatusBadge'
import { paddedDomainFromSeries, fmt } from './metrics'
import {
  buildOverviewModel,
  nodeLabel,
  RISK_PRESENTATION,
} from './overviewView.js'
import {
  dashboardCommanderIncidentHref,
  dashboardOrchestrateIncidentHref,
  dashboardPanelHref,
} from './dashboardPanels.js'
import { RESIDUAL_BAND } from '../../../shared/financialExposure.js'

function MiniSpark({ data = [], color = 'var(--tn-text)' }) {
  if (!data.length) {
    return <div className="h-9 w-full bg-[var(--tn-elevated)]" aria-hidden />
  }
  const yDomain = paddedDomainFromSeries(data)
  return (
    <div className="h-9 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <YAxis domain={yDomain} allowDataOverflow hide />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function SectionLabel({ children }) {
  return <div className="soc-zone-title">{children}</div>
}

function RiskBar({ score, tone = 'muted' }) {
  const pct =
    score != null && Number.isFinite(Number(score))
      ? Math.max(0, Math.min(100, Number(score)))
      : 0
  const color =
    tone === 'crit'
      ? 'var(--tn-crit)'
      : tone === 'warn'
        ? 'var(--tn-warn)'
        : tone === 'ok'
          ? 'var(--tn-ok)'
          : 'var(--tn-muted)'
  return (
    <div
      className="mt-3 h-1.5 w-full overflow-hidden bg-[var(--tn-elevated)]"
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Risk score"
    >
      <div
        className="h-full transition-[width] duration-200 ease-out"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

function StageDot({ state }) {
  if (state === 'done') {
    return (
      <span
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium"
        style={{
          background: 'color-mix(in srgb, var(--tn-ok) 18%, transparent)',
          color: 'var(--tn-ok)',
        }}
        aria-hidden
      >
        ✓
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span
        className="tn-pip"
        style={{ background: 'var(--tn-warn)' }}
        aria-hidden
      />
    )
  }
  if (state === 'pending') {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full border border-[var(--tn-muted)]"
        aria-hidden
      />
    )
  }
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full bg-[var(--tn-line)]"
      aria-hidden
    />
  )
}

function postureToneColor(tone) {
  if (tone === 'crit') return 'var(--tn-crit)'
  if (tone === 'warn') return 'var(--tn-warn)'
  if (tone === 'ok') return 'var(--tn-ok)'
  return 'var(--tn-muted)'
}

function bandTone(band) {
  if (band === RESIDUAL_BAND.HIGH) return 'crit'
  if (band === RESIDUAL_BAND.ELEVATED) return 'warn'
  return 'muted'
}

function accentClass(tone) {
  if (tone === 'crit') return 'soc-zone-accent soc-zone-accent-crit'
  if (tone === 'warn') return 'soc-zone-accent soc-zone-accent-warn'
  if (tone === 'ok') return 'soc-zone-accent soc-zone-accent-ok'
  return 'soc-zone-accent'
}

/**
 * SOC / cyber-command-center Overview.
 * Navigation only — does not execute containment.
 */
export default function OverviewPanel({
  detection = null,
  nodes = [],
  edges = [],
  incidents = [],
  rows = [],
  feedStatus = null,
  phase = 'lobby',
  sampleTicks = 0,
  fetchError = null,
  pps = null,
  onSelectEndpoint = null,
}) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const model = buildOverviewModel({
    detection,
    nodes,
    edges,
    incidents,
    rows,
    feedStatus,
    phase,
    sampleTicks,
    fetchError,
    pps,
  })

  const {
    posture,
    stats,
    primaryIncident,
    metric,
    detectionTags,
    risk,
    path,
    finance,
    lifecycle,
    telemetry,
    signals,
    primarySpreadNodeId,
  } = model

  const incidentId = primaryIncident?.persistentId || primaryIncident?.id || null
  const incidentsHref = dashboardPanelHref(searchParams, 'incidents')
  const commanderHref = dashboardCommanderIncidentHref(searchParams, incidentId)
  const responseHref = dashboardOrchestrateIncidentHref(searchParams, incidentId)

  const riskTone =
    risk.presentation === RISK_PRESENTATION.ACTIVE
      ? 'crit'
      : risk.presentation === RISK_PRESENTATION.RESIDUAL ||
          risk.presentation === RISK_PRESENTATION.RECOVERING
        ? 'warn'
        : risk.available && risk.score != null && risk.score >= 45
          ? 'warn'
          : posture.key === 'healthy'
            ? 'ok'
            : 'muted'

  function openThreat({ navigateToIncidents = false } = {}) {
    if (primaryIncident?.endpointId) {
      onSelectEndpoint?.(primaryIncident.endpointId)
    }
    if (navigateToIncidents) {
      navigate(incidentsHref, { replace: true })
    }
  }

  return (
    <div className="space-y-4">
      {/* ZONE A — Situation bar */}
      <section
        className={`soc-zone ${accentClass(posture.tone)}`}
        aria-labelledby="mesh-posture-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--tn-line)] px-5 py-4">
          <div className="min-w-0">
            <SectionLabel>Mesh posture</SectionLabel>
            <h2
              id="mesh-posture-heading"
              className="mt-2 font-mono text-3xl font-medium tracking-tight sm:text-4xl"
              style={{ color: postureToneColor(posture.tone) }}
            >
              {posture.label}
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm text-[var(--tn-text)]">
              {posture.summary}
            </p>
          </div>
          <StatusBadge
            tone={
              posture.tone === 'ok'
                ? 'ok'
                : posture.tone === 'crit'
                  ? 'crit'
                  : posture.tone === 'warn'
                    ? 'warn'
                    : 'muted'
            }
          >
            {posture.empty ? 'SYSTEM CLEAR' : 'ACTIVE THREAT'}
          </StatusBadge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4">
          {[
            {
              label: 'Active Incidents',
              value: stats.activeIncidents,
              hot: stats.activeIncidents > 0,
            },
            {
              label: 'Confirmed Anomalies',
              value: stats.confirmedAnomalies,
              hot: stats.confirmedAnomalies > 0,
            },
            {
              label: 'At-Risk Nodes',
              value: stats.atRiskNodes,
              hot: stats.atRiskNodes > 0,
              warn: true,
            },
            { label: 'Quarantined', value: stats.quarantined, hot: false },
          ].map((s, i) => (
            <div
              key={s.label}
              className={`min-w-0 px-5 py-3 ${i > 0 ? 'border-l border-[var(--tn-line)]' : ''} ${i >= 2 ? 'border-t border-[var(--tn-line)] sm:border-t-0' : ''}`}
            >
              <div className="tn-label">{s.label}</div>
              <div
                className="mt-0.5 font-mono text-xl font-medium tabular-nums"
                style={{
                  color: s.hot
                    ? s.warn
                      ? 'var(--tn-warn)'
                      : 'var(--tn-crit)'
                    : 'var(--tn-text)',
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>

        <ol className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--tn-line)] px-5 py-3">
          {lifecycle.stages.map((stage) => (
            <li key={stage.id} className="flex items-center gap-2">
              <StageDot state={stage.state} />
              <span
                className={`font-mono text-[11px] font-medium tracking-wide ${
                  stage.state === 'done' || stage.state === 'active'
                    ? 'text-[var(--tn-text)]'
                    : 'text-[var(--tn-muted)]'
                }`}
              >
                {stage.label}
              </span>
              <span className="tn-meta text-[11px]">{stage.detail}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* ZONE B + C — Primary incident + Risk */}
      <div className="grid gap-4 lg:grid-cols-5">
        <section
          className="soc-zone lg:col-span-3"
          aria-labelledby="active-threat-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--tn-line)] px-5 py-3">
            <SectionLabel>Primary incident</SectionLabel>
            {primaryIncident ? (
              <div className="flex flex-wrap gap-2">
                <Link
                  to={incidentsHref}
                  replace
                  className="tn-btn"
                  onClick={() => openThreat()}
                >
                  Incidents →
                </Link>
                <Link to={commanderHref} replace className="tn-btn">
                  Commander →
                </Link>
                <Link to={responseHref} replace className="tn-btn-primary">
                  Response →
                </Link>
              </div>
            ) : (
              <Link to={incidentsHref} replace className="tn-btn">
                Incident stream →
              </Link>
            )}
          </div>

          {primaryIncident ? (
            <button
              type="button"
              className="block w-full px-5 py-4 text-left transition-colors hover:bg-[var(--tn-elevated)] focus-visible:bg-[var(--tn-elevated)] focus-visible:outline-none"
              onClick={() => openThreat({ navigateToIncidents: true })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openThreat({ navigateToIncidents: true })
                }
              }}
              aria-label={`Open incident for ${primaryIncident.endpointLabel || primaryIncident.endpointId}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="crit">Confirmed anomaly</StatusBadge>
                <StatusBadge
                  tone={
                    primaryIncident.severity === 'critical' ||
                    primaryIncident.severity === 'high'
                      ? 'crit'
                      : 'warn'
                  }
                >
                  {primaryIncident.severity || 'low'}
                </StatusBadge>
                {detectionTags.slice(0, 2).map((t) => (
                  <StatusBadge key={t} tone="warn">
                    {t}
                  </StatusBadge>
                ))}
              </div>
              <h3
                id="active-threat-heading"
                className="mt-2.5 text-xl font-medium tracking-tight"
              >
                {primaryIncident.endpointLabel || primaryIncident.endpointId}
              </h3>
              <p className="tn-meta mt-1">
                {primaryIncident.sector
                  ? String(primaryIncident.sector).replaceAll('_', ' ')
                  : 'Infrastructure'}
                {primaryIncident.detectionType
                  ? ` · ${String(primaryIncident.detectionType).replaceAll('_', ' ')}`
                  : ''}
              </p>

              {metric ? (
                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--tn-line)] pt-3">
                  <div>
                    <div className="tn-label">{metric.label}</div>
                    <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-[var(--tn-crit)]">
                      {fmt(metric.observed)}
                    </div>
                  </div>
                  <div>
                    <div className="tn-label">Expected</div>
                    <div className="mt-0.5 font-mono text-base font-medium tabular-nums">
                      ~{fmt(metric.expected)}
                    </div>
                  </div>
                  <div>
                    <div className="tn-label">Deviation</div>
                    <div className="mt-0.5 font-mono text-base font-medium tabular-nums text-[var(--tn-crit)]">
                      {metric.deviationPct == null
                        ? '—'
                        : `${metric.deviationPct > 0 ? '+' : ''}${Math.round(metric.deviationPct)}%`}
                    </div>
                  </div>
                </div>
              ) : null}

              {path.active && path.labels.length > 0 ? (
                <div className="mt-4 border-t border-[var(--tn-line)] pt-3">
                  <div className="tn-label">Propagation path</div>
                  <ol className="mt-2 flex flex-wrap items-center gap-1.5">
                    {path.labels.map((label, i) => {
                      const id = path.pathIds[i]
                      const confirmed = i === 0
                      const isNext =
                        primarySpreadNodeId &&
                        String(id) === String(primarySpreadNodeId)
                      return (
                        <li key={`${id}-${i}`} className="flex items-center gap-1.5">
                          {i > 0 ? (
                            <span className="text-[var(--tn-muted)]" aria-hidden>
                              →
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className={`rounded-sm px-1.5 py-0.5 text-sm hover:bg-[var(--tn-elevated)] ${
                              confirmed
                                ? 'font-medium text-[var(--tn-crit)]'
                                : isNext
                                  ? 'font-medium text-[#a855f7]'
                                  : 'text-[var(--tn-warn)]'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation()
                              onSelectEndpoint?.(id)
                            }}
                          >
                            {label}
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                  <p className="tn-meta mt-2 text-[11px]">
                    Exposed nodes are peer / propagation context — not independently
                    confirmed anomalies.
                  </p>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--tn-line)] pt-3">
                <div>
                  <div className="tn-label">Simulated exposure</div>
                  <div className="mt-0.5 font-mono text-lg font-medium tabular-nums">
                    {finance.exposureLabel}
                  </div>
                </div>
                <span className="soc-role-chip soc-role-simulated">Simulated</span>
              </div>
            </button>
          ) : (
            <div className="px-5 py-8">
              <h3
                id="active-threat-heading"
                className="text-lg font-medium text-[var(--tn-ok)]"
              >
                System clear
              </h3>
              <p className="tn-meta mt-2 max-w-md">
                No confirmed anomalies detected on the mesh. At-risk and propagated
                nodes are not shown as confirmed threats.
              </p>
            </div>
          )}
        </section>

        <section
          className={`soc-zone px-5 py-4 lg:col-span-2 ${
            risk.presentation === RISK_PRESENTATION.ACTIVE
              ? accentClass('crit')
              : risk.presentation === RISK_PRESENTATION.RESIDUAL
                ? accentClass('warn')
                : ''
          }`}
          aria-labelledby="risk-trajectory-heading"
        >
          <div className="flex items-start justify-between gap-2">
            <SectionLabel>Risk trajectory</SectionLabel>
            <span
              className="tn-meta cursor-help text-[11px] underline decoration-dotted"
              title={risk.techHint}
            >
              Details
            </span>
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <div className="tn-label">Current residual</div>
              <div
                id="risk-trajectory-heading"
                className="mt-0.5 font-mono text-3xl font-medium tabular-nums"
                style={{ color: postureToneColor(riskTone) }}
              >
                {risk.scoreLabel}
              </div>
              <div
                className="mt-1 font-mono text-sm font-medium"
                style={{ color: postureToneColor(riskTone) }}
              >
                {risk.available ? risk.headline : 'WAITING'}
              </div>
              {risk.presentation === RISK_PRESENTATION.RESIDUAL ? (
                <div className="mt-1.5">
                  <StatusBadge tone="warn">No confirmed anomaly</StatusBadge>
                </div>
              ) : null}
              {risk.presentation === RISK_PRESENTATION.ACTIVE ? (
                <div className="mt-1.5">
                  <StatusBadge tone="crit">Confirmed activity</StatusBadge>
                </div>
              ) : null}
            </div>
            <div className="w-24 shrink-0">
              <MiniSpark data={risk.series} color={postureToneColor(riskTone)} />
            </div>
          </div>
          <RiskBar score={risk.score} tone={riskTone} />
          <p className="mt-2 text-sm leading-snug text-[var(--tn-text)]">
            {risk.narrative}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--tn-line)] pt-3">
            <div>
              <dt className="tn-label">{risk.windowTicks}s change</dt>
              <dd className="mt-0.5 font-mono text-sm tabular-nums">
                {risk.delta == null || !Number.isFinite(Number(risk.delta))
                  ? '—'
                  : Math.round(Number(risk.delta))}
              </dd>
            </div>
            <div>
              <dt className="tn-label">Peak (recent series)</dt>
              <dd className="mt-0.5 font-mono text-sm tabular-nums">
                {risk.peak != null ? risk.peak : '—'}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {/* ZONE D — Impact & conditions */}
      <section className="soc-zone" aria-label="Impact and conditions">
        <div className="grid gap-0 lg:grid-cols-12">
          <div className="border-b border-[var(--tn-line)] px-5 py-4 lg:col-span-4 lg:border-r lg:border-b-0">
            <SectionLabel>Business impact</SectionLabel>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="font-mono text-2xl font-medium tabular-nums">
                {finance.exposureLabel}
              </div>
              <StatusBadge
                tone={finance.lakhs > 0 ? bandTone(finance.residualBand) : 'muted'}
              >
                {finance.lakhs > 0 ? 'Simulated' : 'None'}
              </StatusBadge>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <div>
                <dt className="tn-label">Services</dt>
                <dd className="font-mono text-sm tabular-nums">
                  {finance.affectedServices}
                </dd>
              </div>
              <div>
                <dt className="tn-label">Critical deps</dt>
                <dd className="font-mono text-sm tabular-nums">
                  {finance.criticalDependencies}
                </dd>
              </div>
              <div>
                <dt className="tn-label">Blast</dt>
                <dd className="font-mono text-sm tabular-nums">
                  {finance.blastRadius}
                </dd>
              </div>
            </dl>
            {path.active ? (
              <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--tn-line)] pt-3 text-sm">
                <div>
                  <span className="tn-label">Confirmed </span>
                  <span className="font-mono tabular-nums text-[var(--tn-crit)]">
                    {path.confirmedCount}
                  </span>
                </div>
                <div>
                  <span className="tn-label">Exposed </span>
                  <span className="font-mono tabular-nums text-[var(--tn-warn)]">
                    {path.exposedCount}
                  </span>
                </div>
                <div>
                  <span className="tn-label">Hops </span>
                  <span className="font-mono tabular-nums">{path.hopDepth}</span>
                </div>
              </dl>
            ) : null}
          </div>

          <div className="border-b border-[var(--tn-line)] px-5 py-4 lg:col-span-5 lg:border-r lg:border-b-0">
            <SectionLabel>Active conditions</SectionLabel>
            <div className="mt-3 flex flex-wrap gap-2">
              {signals.map((sig) => (
                <div
                  key={sig.id}
                  className="rounded-md border border-[var(--tn-line)] px-3 py-2"
                >
                  <div className="tn-label">{sig.label}</div>
                  <div
                    className="mt-0.5 font-mono text-xs font-medium"
                    style={{ color: postureToneColor(sig.tone) }}
                  >
                    {sig.value}
                  </div>
                </div>
              ))}
            </div>
            {primarySpreadNodeId ? (
              <div className="mt-3 flex items-center gap-2 border-t border-[var(--tn-line)] pt-3">
                <span
                  className="tn-pip"
                  style={{ background: '#a855f7' }}
                  aria-hidden
                />
                <span className="tn-meta text-[12px]">
                  Highest-risk next:{' '}
                  <button
                    type="button"
                    className="font-medium text-[#a855f7] hover:underline"
                    onClick={() => onSelectEndpoint?.(primarySpreadNodeId)}
                  >
                    {nodeLabel(nodes, primarySpreadNodeId) || primarySpreadNodeId}
                  </button>
                  <span className="text-[var(--tn-muted)]"> · assessment only</span>
                </span>
              </div>
            ) : null}
          </div>

          <div className="px-5 py-4 lg:col-span-3">
            <SectionLabel>Telemetry</SectionLabel>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="tn-meta">Feed</span>
                <StatusBadge
                  tone={
                    telemetry.feedTone === 'ok'
                      ? 'ok'
                      : telemetry.feedTone === 'crit'
                        ? 'crit'
                        : telemetry.feedTone === 'warn'
                          ? 'warn'
                          : 'muted'
                  }
                >
                  {telemetry.feed}
                </StatusBadge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="tn-meta">Pipeline</span>
                <span
                  className="font-mono text-xs font-medium"
                  style={{ color: postureToneColor(telemetry.pipelineTone) }}
                >
                  {telemetry.pipeline}
                </span>
              </div>
              {telemetry.reportingLabel ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="tn-meta">Reporting</span>
                  <span className="font-mono text-xs tabular-nums">
                    {telemetry.reportingLabel}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <span className="tn-meta">Stored ticks</span>
                <span className="font-mono text-xs tabular-nums">
                  {telemetry.sampleTicks}
                </span>
              </div>
            </div>
          </div>
        </div>
        <p className="tn-meta border-t border-[var(--tn-line)] px-5 py-2.5 text-[11px]">
          Containment is executed in Response. Recovery reflects live quarantine and
          detection state — not Execute HTTP success alone. Exposure is simulated, not a
          loss forecast.
        </p>
      </section>
    </div>
  )
}
