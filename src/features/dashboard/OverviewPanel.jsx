import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'
import StatusBadge from '../../ui/StatusBadge'
import { paddedDomainFromSeries, fmt } from './metrics'
import {
  buildOverviewModel,
  nodeLabel,
} from './overviewView.js'
import {
  dashboardCommanderIncidentHref,
  dashboardPanelHref,
  dashboardResponseIncidentHref,
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
  return (
    <div className="tn-label tracking-[0.08em] uppercase">{children}</div>
  )
}

function RiskBar({ score, tone = 'muted' }) {
  const pct = score != null && Number.isFinite(Number(score))
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
      className="mt-3 h-2 w-full overflow-hidden bg-[var(--tn-elevated)]"
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Risk score"
    >
      <div
        className="h-full transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

function StageDot({ state }) {
  if (state === 'done') {
    return (
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
        style={{ background: 'color-mix(in srgb, var(--tn-ok) 18%, transparent)', color: 'var(--tn-ok)' }}
        aria-hidden
      >
        ✓
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span
        className="tn-pip mt-0.5"
        style={{ background: 'var(--tn-warn)' }}
        aria-hidden
      />
    )
  }
  if (state === 'pending') {
    return (
      <span
        className="mt-0.5 h-2 w-2 shrink-0 rounded-full border border-[var(--tn-muted)]"
        aria-hidden
      />
    )
  }
  return (
    <span
      className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--tn-line)]"
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
  const responseHref = dashboardResponseIncidentHref(searchParams, incidentId)

  const riskTone =
    risk.available && risk.score != null && risk.score >= 70
      ? 'crit'
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
    <div className="space-y-5">
      {/* 1. Mesh Posture — Hero */}
      <section
        className="tn-surface overflow-hidden"
        aria-labelledby="mesh-posture-heading"
      >
        <div
          className="border-b border-[var(--tn-line)] px-5 py-5 sm:px-6"
          style={{
            borderLeft: `3px solid ${postureToneColor(posture.tone)}`,
          }}
        >
          <SectionLabel>Mesh posture</SectionLabel>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h2
                id="mesh-posture-heading"
                className="font-mono text-3xl font-medium tracking-tight sm:text-4xl"
                style={{ color: postureToneColor(posture.tone) }}
              >
                {posture.label}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--tn-text)]">
                {posture.summary}
              </p>
            </div>
            <StatusBadge tone={posture.tone === 'ok' ? 'ok' : posture.tone === 'crit' ? 'crit' : posture.tone === 'warn' ? 'warn' : 'muted'}>
              {posture.empty ? 'SYSTEM CLEAR' : 'ACTIVE THREAT'}
            </StatusBadge>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {[
            { label: 'Active Incidents', value: stats.activeIncidents, hot: stats.activeIncidents > 0 },
            { label: 'Confirmed Anomalies', value: stats.confirmedAnomalies, hot: stats.confirmedAnomalies > 0 },
            { label: 'At-Risk Nodes', value: stats.atRiskNodes, hot: stats.atRiskNodes > 0, warn: true },
            { label: 'Quarantined', value: stats.quarantined, hot: false },
          ].map((s, i) => (
            <div
              key={s.label}
              className={`min-w-0 px-5 py-4 ${i > 0 ? 'border-l border-[var(--tn-line)]' : ''} ${i >= 2 ? 'border-t border-[var(--tn-line)] sm:border-t-0' : ''}`}
            >
              <div className="tn-label">{s.label}</div>
              <div
                className="mt-1 font-mono text-2xl font-medium tabular-nums"
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
      </section>

      {/* 2 + 3: Active Threat + Risk Trajectory */}
      <div className="grid gap-5 lg:grid-cols-5">
        <section
          className="tn-surface overflow-hidden lg:col-span-3"
          aria-labelledby="active-threat-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--tn-line)] px-5 py-4">
            <SectionLabel>Active threat</SectionLabel>
            {primaryIncident ? (
              <div className="flex flex-wrap gap-2">
                <Link
                  to={incidentsHref}
                  replace
                  className="tn-btn"
                  onClick={() => openThreat()}
                >
                  View Incident →
                </Link>
                <Link to={commanderHref} replace className="tn-btn-primary">
                  Open Commander →
                </Link>
              </div>
            ) : (
              <Link to={incidentsHref} replace className="tn-btn">
                Incident Stream →
              </Link>
            )}
          </div>

          {primaryIncident ? (
            <button
              type="button"
              className="block w-full px-5 py-5 text-left transition-colors hover:bg-[var(--tn-elevated)] focus-visible:bg-[var(--tn-elevated)] focus-visible:outline-none"
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
                <StatusBadge tone={primaryIncident.severity === 'critical' || primaryIncident.severity === 'high' ? 'crit' : 'warn'}>
                  {primaryIncident.severity || 'low'}
                </StatusBadge>
              </div>
              <h3
                id="active-threat-heading"
                className="mt-3 text-xl font-medium tracking-tight"
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
                <div className="mt-5 grid grid-cols-3 gap-4 border-t border-[var(--tn-line)] pt-4">
                  <div>
                    <div className="tn-label">{metric.label}</div>
                    <div className="mt-1 font-mono text-lg font-medium tabular-nums text-[var(--tn-crit)]">
                      {fmt(metric.observed)}
                    </div>
                  </div>
                  <div>
                    <div className="tn-label">Expected</div>
                    <div className="mt-1 font-mono text-lg font-medium tabular-nums">
                      ~{fmt(metric.expected)}
                    </div>
                  </div>
                  <div>
                    <div className="tn-label">Deviation</div>
                    <div className="mt-1 font-mono text-lg font-medium tabular-nums text-[var(--tn-crit)]">
                      {metric.deviationPct == null
                        ? '—'
                        : `${metric.deviationPct > 0 ? '+' : ''}${Math.round(metric.deviationPct)}%`}
                    </div>
                  </div>
                </div>
              ) : null}

              {detectionTags.length > 0 ? (
                <div className="mt-4">
                  <div className="tn-label">Detection</div>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {detectionTags.map((t) => (
                      <li key={t}>
                        <StatusBadge tone="warn">{t}</StatusBadge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </button>
          ) : (
            <div className="px-5 py-8">
              <h3 id="active-threat-heading" className="text-lg font-medium text-[var(--tn-ok)]">
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
          className="tn-surface overflow-hidden px-5 py-5 lg:col-span-2"
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
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <div
                id="risk-trajectory-heading"
                className="font-mono text-3xl font-medium tabular-nums"
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
            </div>
            <div className="w-24 shrink-0">
              <MiniSpark data={risk.series} color={postureToneColor(riskTone)} />
            </div>
          </div>
          <RiskBar score={risk.score} tone={riskTone} />
          <p className="mt-3 text-sm leading-relaxed text-[var(--tn-text)]">
            {risk.narrative}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--tn-line)] pt-4">
            <div>
              <dt className="tn-label">{risk.windowTicks}s change</dt>
              <dd className="mt-1 font-mono text-sm tabular-nums">
                {risk.delta == null || !Number.isFinite(Number(risk.delta))
                  ? '—'
                  : Math.round(Number(risk.delta))}
              </dd>
            </div>
            <div>
              <dt className="tn-label">Peak</dt>
              <dd className="mt-1 font-mono text-sm tabular-nums">
                {risk.peak != null ? risk.peak : '—'}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {/* 4 + 5: Attack Path + Business Impact */}
      <div className="grid gap-5 lg:grid-cols-5">
        <section
          className="tn-surface overflow-hidden lg:col-span-3"
          aria-labelledby="attack-path-heading"
        >
          <div className="border-b border-[var(--tn-line)] px-5 py-4">
            <SectionLabel>Attack path</SectionLabel>
          </div>
          <div className="px-5 py-5">
            <h3 id="attack-path-heading" className="sr-only">
              Observed propagation path
            </h3>
            {path.active && path.labels.length > 0 ? (
              <>
                <ol className="space-y-0">
                  {path.labels.map((label, i) => {
                    const id = path.pathIds[i]
                    const confirmed = i === 0
                    const isNext =
                      primarySpreadNodeId &&
                      String(id) === String(primarySpreadNodeId)
                    return (
                      <li key={`${id}-${i}`}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 rounded-sm px-1 py-1 text-left hover:bg-[var(--tn-elevated)] focus-visible:bg-[var(--tn-elevated)] focus-visible:outline-none"
                          onClick={() => onSelectEndpoint?.(id)}
                        >
                          <span
                            className="tn-pip"
                            style={{
                              background: confirmed
                                ? 'var(--tn-crit)'
                                : isNext
                                  ? '#a855f7'
                                  : 'var(--tn-warn)',
                            }}
                            aria-hidden
                          />
                          <span
                            className={`text-sm ${
                              confirmed
                                ? 'font-medium text-[var(--tn-crit)]'
                                : isNext
                                  ? 'font-medium text-[#a855f7]'
                                  : 'text-[var(--tn-warn)]'
                            }`}
                          >
                            {label}
                          </span>
                          <span className="tn-meta ml-auto text-[11px]">
                            {confirmed
                              ? 'Confirmed anomaly'
                              : isNext
                                ? 'Highest-risk next'
                                : 'Exposed / propagated'}
                          </span>
                        </button>
                        {i < path.labels.length - 1 ? (
                          <div className="pl-[0.85rem] text-[var(--tn-muted)]" aria-hidden>
                            ↓
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
                <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--tn-line)] pt-4 sm:grid-cols-4">
                  <div>
                    <dt className="tn-label">Confirmed</dt>
                    <dd className="mt-1 font-mono text-base font-medium tabular-nums text-[var(--tn-crit)]">
                      {path.confirmedCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="tn-label">Exposed</dt>
                    <dd className="mt-1 font-mono text-base font-medium tabular-nums text-[var(--tn-warn)]">
                      {path.exposedCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="tn-label">Hop depth</dt>
                    <dd className="mt-1 font-mono text-base font-medium tabular-nums">
                      {path.hopDepth}
                    </dd>
                  </div>
                  <div>
                    <dt className="tn-label">Nodes affected</dt>
                    <dd className="mt-1 font-mono text-base font-medium tabular-nums">
                      {path.affectedCount}
                    </dd>
                  </div>
                </dl>
                <p className="tn-meta mt-3">
                  Exposed nodes are peer / propagation context — not independently
                  confirmed anomalies.
                </p>
              </>
            ) : (
              <p className="text-sm text-[var(--tn-muted)]">
                No active propagation detected.
              </p>
            )}
          </div>
        </section>

        <section
          className="tn-surface overflow-hidden px-5 py-5 lg:col-span-2"
          aria-labelledby="business-impact-heading"
        >
          <SectionLabel>Business impact</SectionLabel>
          <div className="mt-3">
            <div
              id="business-impact-heading"
              className="font-mono text-3xl font-medium tabular-nums"
            >
              {finance.exposureLabel}
            </div>
            <StatusBadge tone={finance.lakhs > 0 ? bandTone(finance.residualBand) : 'muted'}>
              {finance.lakhs > 0 ? 'Simulated exposure' : 'No current economic exposure'}
            </StatusBadge>
          </div>
          <p className="tn-meta mt-3 leading-relaxed">
            {finance.lakhs > 0
              ? 'Simulated potential economic impact across affected Smart City infrastructure. This is not a predicted financial loss.'
              : 'No currently flagged node maps to economically consequential infrastructure.'}
          </p>
          <dl className="mt-5 space-y-3 border-t border-[var(--tn-line)] pt-4">
            <div className="flex justify-between gap-3">
              <dt className="tn-label">Economic services</dt>
              <dd className="font-mono text-sm tabular-nums">{finance.affectedServices}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="tn-label">Critical dependencies</dt>
              <dd className="font-mono text-sm tabular-nums">{finance.criticalDependencies}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="tn-label">Blast radius</dt>
              <dd className="font-mono text-sm tabular-nums">
                {finance.blastRadius} {finance.blastRadius === 1 ? 'node' : 'nodes'}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {/* 6 + 7: Response Status + Telemetry Health */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section
          className="tn-surface overflow-hidden"
          aria-labelledby="response-status-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--tn-line)] px-5 py-4">
            <SectionLabel>Response status</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {incidentId ? (
                <>
                  <Link to={commanderHref} replace className="tn-btn">
                    Open Commander →
                  </Link>
                  <Link to={responseHref} replace className="tn-btn-primary">
                    View Response →
                  </Link>
                </>
              ) : (
                <Link
                  to={dashboardPanelHref(searchParams, 'response')}
                  replace
                  className="tn-btn"
                >
                  Response Console →
                </Link>
              )}
            </div>
          </div>
          <ol className="space-y-0 px-5 py-4" id="response-status-heading">
            {lifecycle.stages.map((stage, i) => (
              <li key={stage.id} className="flex gap-3 py-2.5">
                <div className="flex flex-col items-center">
                  <StageDot state={stage.state} />
                  {i < lifecycle.stages.length - 1 ? (
                    <span className="mt-1 w-px flex-1 bg-[var(--tn-line)]" aria-hidden />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span
                      className={`font-mono text-xs font-medium tracking-wide ${
                        stage.state === 'done' || stage.state === 'active'
                          ? 'text-[var(--tn-text)]'
                          : 'text-[var(--tn-muted)]'
                      }`}
                    >
                      {stage.label}
                    </span>
                    <span className="tn-meta text-[11px]">{stage.detail}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className="tn-meta border-t border-[var(--tn-line)] px-5 py-3">
            Containment is executed in Response Console. Recovery reflects live
            quarantine and detection state — not Execute HTTP success alone.
          </p>
        </section>

        <section
          className="tn-surface overflow-hidden px-5 py-5"
          aria-labelledby="telemetry-health-heading"
        >
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Telemetry health</SectionLabel>
            <StatusBadge tone={telemetry.feedTone === 'ok' ? 'ok' : telemetry.feedTone === 'crit' ? 'crit' : telemetry.feedTone === 'warn' ? 'warn' : 'muted'}>
              ● {telemetry.feed}
            </StatusBadge>
          </div>
          <h3 id="telemetry-health-heading" className="sr-only">
            Telemetry pipeline health
          </h3>
          <div className="mt-5 grid grid-cols-2 gap-4">
            {telemetry.reportingLabel ? (
              <div>
                <div className="tn-label">Devices reporting</div>
                <div className="mt-1 font-mono text-xl font-medium tabular-nums">
                  {telemetry.reportingLabel}
                </div>
              </div>
            ) : null}
            {telemetry.updateIntervalSec != null ? (
              <div>
                <div className="tn-label">Update interval</div>
                <div className="mt-1 font-mono text-xl font-medium tabular-nums">
                  {telemetry.updateIntervalSec}s
                </div>
              </div>
            ) : null}
            <div>
              <div className="tn-label">Stored ticks</div>
              <div className="mt-1 font-mono text-xl font-medium tabular-nums">
                {telemetry.sampleTicks}
              </div>
            </div>
            <div>
              <div className="tn-label">Detection pipeline</div>
              <div
                className="mt-1 font-mono text-sm font-medium"
                style={{ color: postureToneColor(telemetry.pipelineTone) }}
              >
                {telemetry.pipeline}
              </div>
            </div>
            <div>
              <div className="tn-label">Quarantined</div>
              <div className="mt-1 font-mono text-xl font-medium tabular-nums">
                {telemetry.quarantinedCount}
              </div>
            </div>
            {telemetry.ppsLabel ? (
              <div>
                <div className="tn-label">Packets / s</div>
                <div className="mt-1 font-mono text-sm font-medium tabular-nums text-[var(--tn-muted)]">
                  {telemetry.ppsLabel}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {/* 8. Quick signals */}
      <section
        className="tn-surface overflow-hidden"
        aria-label="Active conditions"
      >
        <div className="border-b border-[var(--tn-line)] px-5 py-3">
          <SectionLabel>Active conditions</SectionLabel>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {signals.map((sig, i) => (
            <div
              key={sig.id}
              className={`min-w-0 px-5 py-4 ${i > 0 ? 'border-l border-[var(--tn-line)]' : ''} ${i >= 2 ? 'max-sm:border-t max-sm:border-l-0 border-[var(--tn-line)]' : ''} ${i >= 3 ? 'max-lg:border-t border-[var(--tn-line)]' : ''}`}
            >
              <div className="tn-label">{sig.label}</div>
              <div
                className="mt-1 font-mono text-sm font-medium"
                style={{ color: postureToneColor(sig.tone) }}
              >
                {sig.value}
              </div>
            </div>
          ))}
        </div>
        {primarySpreadNodeId ? (
          <div className="flex items-center gap-2 border-t border-[var(--tn-line)] px-5 py-3">
            <span className="tn-pip" style={{ background: '#a855f7' }} aria-hidden />
            <span className="tn-meta">
              Highest-risk next target:{' '}
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
      </section>
    </div>
  )
}
