/**
 * SOC Overview — hackathon command-center presentation.
 * Derives KPIs from live + match history; does not alter detection/orchestration.
 */

import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import StatusBadge from '../../ui/StatusBadge'
import { paddedDomainFromSeries } from './metrics'
import {
  ACTIVITY_RANGES,
  buildOverviewDashboardMetrics,
} from './overviewDashboardMetrics.js'
import {
  buildOverviewModel,
  RISK_PRESENTATION,
} from './overviewView.js'
import {
  dashboardCommanderIncidentHref,
  dashboardOrchestrateIncidentHref,
  dashboardPanelHref,
} from './dashboardPanels.js'
import useIncidentHistory from './useIncidentHistory.js'

const TYPE_COLORS = [
  'var(--tn-crit)',
  'var(--tn-warn)',
  'var(--tn-info)',
  '#a78bfa',
  '#34d399',
  '#94a3b8',
]

const SEVERITY_COLOR = {
  critical: 'var(--tn-crit)',
  high: 'var(--tn-crit)',
  medium: 'var(--tn-warn)',
  low: 'var(--tn-muted)',
}

function SectionLabel({ children }) {
  return <div className="soc-zone-title">{children}</div>
}

function postureToneColor(tone) {
  if (tone === 'crit') return 'var(--tn-crit)'
  if (tone === 'warn') return 'var(--tn-warn)'
  if (tone === 'ok') return 'var(--tn-ok)'
  return 'var(--tn-muted)'
}

function severityTone(severity) {
  const s = String(severity ?? '').toLowerCase()
  if (s === 'critical' || s === 'high') return 'crit'
  if (s === 'medium') return 'warn'
  return 'muted'
}

function KpiCell({ label, value, hint, hot = false, warn = false }) {
  return (
    <div className="soc-zone soc-overview-kpi">
      <div className="tn-label">{label}</div>
      <div
        className="mt-2 font-mono text-2xl font-medium tabular-nums tracking-tight sm:text-[1.75rem]"
        style={{
          color: hot
            ? warn
              ? 'var(--tn-warn)'
              : 'var(--tn-crit)'
            : 'var(--tn-text)',
        }}
      >
        {value}
      </div>
      {hint ? <p className="tn-meta mt-1.5 truncate text-[12px] leading-snug">{hint}</p> : null}
    </div>
  )
}

function MiniRiskSpark({ data = [], color = 'var(--tn-text)' }) {
  if (!data.length) {
    return <div className="h-12 w-full bg-[var(--tn-elevated)]" aria-hidden />
  }
  const series = data.map((p) => ({
    value: Number(p.score ?? p.value),
  }))
  const yDomain = paddedDomainFromSeries(series)
  return (
    <div className="h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <YAxis domain={yDomain} allowDataOverflow hide />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={0.12}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-[var(--tn-line)] bg-[var(--tn-surface)] px-2.5 py-1.5 text-xs shadow-sm">
      <div className="tn-meta">{label}</div>
      <div className="font-mono tabular-nums text-[var(--tn-text)]">
        {payload[0].value} detections
      </div>
    </div>
  )
}

/**
 * SOC / cyber-command-center Overview.
 * Navigation only — does not execute containment.
 */
export default function OverviewPanel({
  roomId = '',
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
  responseOrchestration = null,
  onSelectEndpoint = null,
}) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [activityRange, setActivityRange] = useState('today')

  const { incidents: history, status: historyStatus } = useIncidentHistory(roomId, {
    order: 'newest-first',
    pollMs: 2500,
  })

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

  const dash = useMemo(
    () =>
      buildOverviewDashboardMetrics({
        live: incidents,
        history,
        nodes,
        detection,
        orchestration: responseOrchestration,
        activityRangeId: activityRange,
      }),
    [incidents, history, nodes, detection, responseOrchestration, activityRange]
  )

  const { posture, risk, primaryIncident, telemetry } = model
  const { kpis, activity, typeDistribution, severity, sectorImpact, liveThreat, responseOps, performance, recent } =
    dash

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

  const riskDir =
    risk.presentation === RISK_PRESENTATION.RECOVERING ||
    (Number.isFinite(Number(risk.delta)) && Number(risk.delta) < -3)
      ? '↓ Decreasing'
      : risk.presentation === RISK_PRESENTATION.ACTIVE ||
          (Number.isFinite(Number(risk.delta)) && Number(risk.delta) > 3)
        ? '↑ Increasing'
        : risk.available
          ? '→ Stable'
          : '— Waiting'

  const pieData = typeDistribution.rows.map((r, i) => ({
    ...r,
    color: TYPE_COLORS[i % TYPE_COLORS.length],
  }))

  function openIncidentRow(row) {
    if (row?.endpointId) onSelectEndpoint?.(row.endpointId)
    navigate(incidentsHref, {
      replace: true,
      state: { selectIncidentId: row?.liveIncidentId || row?.incidentId || row?.endpointId },
    })
  }

  const livePip =
    telemetry.feedTone === 'ok'
      ? 'var(--tn-ok)'
      : telemetry.feedTone === 'crit'
        ? 'var(--tn-crit)'
        : telemetry.feedTone === 'warn'
          ? 'var(--tn-warn)'
          : 'var(--tn-muted)'

  return (
    <div className="soc-overview">
      {/* Header */}
      <div className="soc-overview-header">
        <div className="min-w-0">
          <h2 className="font-mono text-xl font-medium tracking-tight sm:text-2xl">
            TrustNet Overview
          </h2>
          <p className="tn-meta mt-1.5 text-[13px] leading-relaxed">
            Detect → Understand → Correlate → Prioritize → Respond → Recover
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge
            tone={
              liveThreat.active
                ? 'crit'
                : posture.key === 'healthy'
                  ? 'ok'
                  : 'warn'
            }
          >
            {liveThreat.active ? 'THREAT ACTIVE' : posture.label}
          </StatusBadge>
          <span className="inline-flex items-center gap-2 font-mono text-[12px] font-medium tracking-wide text-[var(--tn-muted)]">
            <span className="tn-pip" style={{ background: livePip }} aria-hidden />
            {telemetry.feed}
          </span>
        </div>
      </div>

      {/* KPI row — independent cards */}
      <section className="soc-overview-kpis" aria-label="Key metrics">
        <KpiCell
          label="Total attacks"
          value={kpis.totalAttacks}
          hint={
            historyStatus === 'ready'
              ? 'All-time persisted history'
              : 'Live detections'
          }
          hot={kpis.totalAttacks > 0}
        />
        <KpiCell
          label="Active incidents"
          value={pad2(kpis.activeIncidents)}
          hint={
            kpis.criticalActive > 0
              ? `${kpis.criticalActive} critical`
              : 'None critical'
          }
          hot={kpis.activeIncidents > 0}
        />
        <KpiCell
          label="Critical events"
          value={pad2(kpis.criticalIncidents)}
          hint="Severity = critical"
          hot={kpis.criticalIncidents > 0}
        />
        <KpiCell
          label="Resolved"
          value={kpis.resolved}
          hint={
            performance.recoveryRateLabel
              ? `${performance.recoveryRateLabel} recovery rate`
              : 'Cleared / closed'
          }
        />
        <KpiCell
          label="Devices at risk"
          value={kpis.devicesAtRisk}
          hint={kpis.devicesHint}
          hot={kpis.devicesAtRisk > 0}
          warn
        />
        <KpiCell
          label="Response success"
          value={kpis.responseSuccessLabel ?? '—'}
          hint="Resolved ÷ detected (persisted)"
        />
      </section>

      {/* Attack activity — centerpiece */}
      <section className="soc-zone" aria-labelledby="attack-activity-heading">
        <div className="soc-overview-card-head">
          <div className="min-w-0">
            <SectionLabel>Attack activity</SectionLabel>
            <h3 id="attack-activity-heading" className="mt-1 text-base font-medium">
              {activity.contextLabel}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {Object.values(ACTIVITY_RANGES).map((r) => (
              <button
                key={r.id}
                type="button"
                className={
                  activityRange === r.id
                    ? 'tn-btn-primary px-3 py-1.5 text-[12px]'
                    : 'tn-btn px-3 py-1.5 text-[12px]'
                }
                onClick={() => setActivityRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="soc-overview-activity-grid">
          <div className="soc-overview-card-body min-w-0">
            <div className="soc-overview-activity-chart">
              {activity.points.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={activity.points}
                    margin={{ top: 12, right: 12, left: 4, bottom: 4 }}
                  >
                    <defs>
                      <linearGradient id="attackFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--tn-crit)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--tn-crit)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: 'var(--tn-muted)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      height={28}
                    />
                    <YAxis
                      allowDecimals={false}
                      width={32}
                      tick={{ fill: 'var(--tn-muted)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="var(--tn-crit)"
                      fill="url(#attackFill)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-[var(--tn-muted)]">
                  No detections in this window yet
                </div>
              )}
            </div>
          </div>
          <div className="soc-overview-activity-side">
            <div>
              <div className="tn-label">In window</div>
              <div className="mt-1.5 font-mono text-3xl font-medium tabular-nums">
                {activity.total}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-[var(--tn-text)]">
              {activity.peakLabel ||
                activity.volumeHint ||
                (activity.total === 0
                  ? 'Waiting for promoted detections.'
                  : 'Volume derived from persisted incident history.')}
            </p>
          </div>
        </div>
      </section>

      {/* Type + Severity */}
      <div className="soc-overview-pair">
        <section className="soc-zone" aria-labelledby="attack-dist-heading">
          <div className="soc-overview-card-head">
            <div>
              <SectionLabel>Attack distribution</SectionLabel>
              <h3 id="attack-dist-heading" className="mt-1 text-base font-medium">
                Detection type taxonomy
              </h3>
            </div>
          </div>
          <div className="soc-overview-card-body grid grid-cols-[132px_1fr] items-center gap-5 sm:grid-cols-[160px_1fr] sm:gap-6">
            <div className="h-[140px] sm:h-[152px]">
              {pieData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="count"
                      nameKey="label"
                      innerRadius={38}
                      outerRadius={58}
                      paddingAngle={2}
                      stroke="var(--tn-surface)"
                      isAnimationActive={false}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.id} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-[var(--tn-muted)]">
                  —
                </div>
              )}
            </div>
            <ul className="min-w-0 space-y-2.5">
              {pieData.length ? (
                pieData.map((row) => (
                  <li key={row.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: row.color }}
                        aria-hidden
                      />
                      <span className="truncate uppercase tracking-wide text-[var(--tn-muted)]">
                        {row.label}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {row.pct}% · {row.count}
                    </span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-[var(--tn-muted)]">No typed detections yet</li>
              )}
            </ul>
          </div>
        </section>

        <section className="soc-zone" aria-labelledby="severity-heading">
          <div className="soc-overview-card-head">
            <div>
              <SectionLabel>Threat severity</SectionLabel>
              <h3 id="severity-heading" className="mt-1 text-base font-medium">
                Landscape by severity band
              </h3>
            </div>
          </div>
          <div className="soc-overview-card-body space-y-4">
            {severity.rows.map((row) => (
              <div key={row.id} className="grid grid-cols-[80px_1fr_32px] items-center gap-3">
                <span className="tn-label truncate">{row.label}</span>
                <div className="h-2.5 overflow-hidden bg-[var(--tn-elevated)]">
                  <div
                    className="h-full transition-[width] duration-200"
                    style={{
                      width: `${row.barPct}%`,
                      background: SEVERITY_COLOR[row.id] || 'var(--tn-muted)',
                    }}
                  />
                </div>
                <span className="text-right font-mono text-sm tabular-nums">{row.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Infrastructure + Response ops */}
      <div className="soc-overview-pair">
        <section className="soc-zone" aria-labelledby="infra-heading">
          <div className="soc-overview-card-head">
            <div>
              <SectionLabel>Most affected infrastructure</SectionLabel>
              <h3 id="infra-heading" className="mt-1 text-base font-medium">
                Smart-city sectors by incident count
              </h3>
            </div>
          </div>
          <ul className="divide-y divide-[var(--tn-line)]">
            {sectorImpact.rows.length ? (
              sectorImpact.rows.map((row) => (
                <li
                  key={row.sector}
                  className="flex items-center gap-4 px-6 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium uppercase tracking-wide">
                      {row.sector}
                    </div>
                    <div className="tn-meta mt-1 text-[12px]">
                      {row.incidents} incident{row.incidents === 1 ? '' : 's'}
                      {row.critical > 0 ? ` · ${row.critical} critical` : ''}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden bg-[var(--tn-elevated)]">
                      <div
                        className="h-full"
                        style={{
                          width: `${row.barPct}%`,
                          background:
                            row.risk === 'crit'
                              ? 'var(--tn-crit)'
                              : row.risk === 'warn'
                                ? 'var(--tn-warn)'
                                : 'var(--tn-info)',
                        }}
                      />
                    </div>
                  </div>
                  <StatusBadge
                    tone={
                      row.risk === 'crit' ? 'crit' : row.risk === 'warn' ? 'warn' : 'muted'
                    }
                  >
                    {row.risk === 'crit' ? 'Crit' : row.risk === 'warn' ? 'Elevated' : 'Watch'}
                  </StatusBadge>
                </li>
              ))
            ) : (
              <li className="px-6 py-8 text-sm text-[var(--tn-muted)]">
                No sector impact yet — detections will group by infrastructure domain.
              </li>
            )}
          </ul>
        </section>

        <section className="soc-zone" aria-labelledby="response-ops-heading">
          <div className="soc-overview-card-head">
            <div>
              <SectionLabel>Response operations</SectionLabel>
              <h3 id="response-ops-heading" className="mt-1 text-base font-medium">
                Planner → approval → response → recover
              </h3>
            </div>
          </div>
          <ol className="space-y-0 px-6 py-5">
            {responseOps.stages.map((stage, i) => (
              <li key={stage.id} className="flex items-stretch gap-3">
                <div className="flex w-4 flex-col items-center">
                  <span
                    className="mt-1.5 h-2.5 w-2.5 rounded-full"
                    style={{
                      background:
                        stage.count > 0
                          ? i === responseOps.stages.length - 1
                            ? 'var(--tn-ok)'
                            : 'var(--tn-info)'
                          : 'var(--tn-line)',
                    }}
                    aria-hidden
                  />
                  {i < responseOps.stages.length - 1 ? (
                    <span className="w-px flex-1 bg-[var(--tn-line)]" aria-hidden />
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3 pb-3.5">
                  <span className="tn-label truncate">{stage.label}</span>
                  <span className="font-mono text-base font-medium tabular-nums">
                    {stage.count}
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <p className="tn-meta border-t border-[var(--tn-line)] px-6 py-3 text-[12px] leading-relaxed">
            Stage counts from orchestration workflow trace + resolved incidents — not a second
            pipeline.
          </p>
        </section>
      </div>

      {/* Live threat + Risk + Performance */}
      <div className="soc-overview-trio">
        <section
          className={`soc-zone ${
            liveThreat.active ? 'soc-zone-accent soc-zone-accent-crit' : ''
          }`}
          aria-labelledby="live-threat-heading"
        >
          <div className="soc-overview-card-body">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>Live threat status</SectionLabel>
              <span className="inline-flex items-center gap-2 font-mono text-[12px] font-medium">
                <span
                  className="tn-pip"
                  style={{
                    background: liveThreat.active ? 'var(--tn-crit)' : 'var(--tn-ok)',
                  }}
                  aria-hidden
                />
                {liveThreat.active ? 'ACTIVE' : 'CLEAR'}
              </span>
            </div>
            {liveThreat.focus ? (
              <dl className="mt-5 space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="tn-meta">Latest detection</dt>
                  <dd className="truncate font-medium">{liveThreat.focus.type}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="tn-meta">Affected asset</dt>
                  <dd className="truncate font-medium">{liveThreat.focus.asset}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="tn-meta">Severity</dt>
                  <dd>
                    <StatusBadge tone={severityTone(liveThreat.focus.severity)}>
                      {String(liveThreat.focus.severity).toUpperCase()}
                    </StatusBadge>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="tn-meta">Detected</dt>
                  <dd className="font-mono text-sm tabular-nums">{liveThreat.relativeTime}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-5 text-sm text-[var(--tn-muted)]">No live detections on the mesh.</p>
            )}
            <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--tn-line)] pt-4">
              <Link to={incidentsHref} replace className="tn-btn text-[12px]">
                Incidents →
              </Link>
              {primaryIncident ? (
                <>
                  <Link to={commanderHref} replace className="tn-btn text-[12px]">
                    Commander →
                  </Link>
                  <Link to={responseHref} replace className="tn-btn-primary text-[12px]">
                    Orchestrate →
                  </Link>
                </>
              ) : null}
            </div>
          </div>
        </section>

        <section className="soc-zone" aria-labelledby="risk-trend-heading">
          <div className="soc-overview-card-body">
            <SectionLabel>Risk trend</SectionLabel>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div>
                <div
                  id="risk-trend-heading"
                  className="font-mono text-3xl font-medium tabular-nums"
                  style={{ color: postureToneColor(riskTone) }}
                >
                  {risk.scoreLabel}
                </div>
                <div
                  className="mt-1.5 font-mono text-sm font-medium"
                  style={{ color: postureToneColor(riskTone) }}
                >
                  {riskDir}
                </div>
              </div>
              <div className="w-32 shrink-0">
                <MiniRiskSpark data={risk.series} color={postureToneColor(riskTone)} />
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-[var(--tn-text)]">{risk.narrative}</p>
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--tn-line)] pt-4">
              <div>
                <dt className="tn-label">{risk.windowTicks}s Δ</dt>
                <dd className="mt-1 font-mono text-base tabular-nums">
                  {risk.delta == null || !Number.isFinite(Number(risk.delta))
                    ? '—'
                    : Math.round(Number(risk.delta))}
                </dd>
              </div>
              <div>
                <dt className="tn-label">Peak</dt>
                <dd className="mt-1 font-mono text-base tabular-nums">
                  {risk.peak != null ? risk.peak : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="soc-zone" aria-labelledby="perf-heading">
          <div className="soc-overview-card-body">
            <SectionLabel>Response performance</SectionLabel>
            <h3 id="perf-heading" className="sr-only">
              Operational timings from persisted history
            </h3>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5">
              <div>
                <div className="tn-label">Avg recovery</div>
                <div className="mt-1.5 font-mono text-2xl font-medium tabular-nums">
                  {performance.avgRecoveryLabel ?? '—'}
                </div>
                <p className="tn-meta mt-1 text-[11px]">
                  {performance.mttrAvailable
                    ? 'Cleared − detected'
                    : 'Needs cleared timestamps'}
                </p>
              </div>
              <div>
                <div className="tn-label">Recovery rate</div>
                <div className="mt-1.5 font-mono text-2xl font-medium tabular-nums">
                  {performance.recoveryRateLabel ?? '—'}
                </div>
              </div>
              <div>
                <div className="tn-label">Resolved</div>
                <div className="mt-1.5 font-mono text-xl font-medium tabular-nums">
                  {performance.resolved}
                </div>
              </div>
              <div>
                <div className="tn-label">Still active</div>
                <div
                  className="mt-1.5 font-mono text-xl font-medium tabular-nums"
                  style={{
                    color: performance.active > 0 ? 'var(--tn-crit)' : 'var(--tn-text)',
                  }}
                >
                  {performance.active}
                </div>
              </div>
            </div>
            <p className="tn-meta mt-5 border-t border-[var(--tn-line)] pt-4 text-[12px] leading-relaxed">
              MTTD omitted — attack-injection start is not stored on incidents.
            </p>
          </div>
        </section>
      </div>

      {/* Recent threat activity */}
      <section className="soc-zone" aria-labelledby="recent-heading">
        <div className="soc-overview-card-head">
          <div>
            <SectionLabel>Recent threat activity</SectionLabel>
            <h3 id="recent-heading" className="mt-1 text-base font-medium">
              Latest detections
            </h3>
          </div>
          <Link to={incidentsHref} replace className="tn-btn text-[12px]">
            Full stream →
          </Link>
        </div>
        {recent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--tn-line)] text-[var(--tn-muted)]">
                  <th className="px-6 py-3 font-medium">Severity</th>
                  <th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 font-medium">Asset</th>
                  <th className="px-3 py-3 font-medium">Infrastructure</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr
                    key={row.key}
                    className="cursor-pointer border-b border-[var(--tn-line)] last:border-b-0 hover:bg-[var(--tn-elevated)]"
                    onClick={() => openIncidentRow(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openIncidentRow(row)
                      }
                    }}
                    tabIndex={0}
                    role="link"
                  >
                    <td className="px-6 py-3">
                      <StatusBadge tone={severityTone(row.severity)}>
                        {String(row.severity).toUpperCase()}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-3">{row.typeLabel}</td>
                    <td className="max-w-[12rem] truncate px-3 py-3 font-medium">
                      {row.asset}
                    </td>
                    <td className="px-3 py-3 text-[var(--tn-muted)]">{row.sector}</td>
                    <td className="px-3 py-3">{row.status}</td>
                    <td className="px-6 py-3 font-mono tabular-nums text-[var(--tn-muted)]">
                      {row.relativeTime}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-6 py-8 text-sm text-[var(--tn-muted)]">
            No threat activity recorded yet.
          </p>
        )}
      </section>
    </div>
  )
}

function pad2(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return String(Math.max(0, Math.round(v))).padStart(2, '0')
}
