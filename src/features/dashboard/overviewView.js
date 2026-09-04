/**
 * Pure view-model helpers for the SOC Overview panel.
 * Derives display state from existing detection / nodes / finance — no new risk engine.
 */

import {
  detectionTypeLabel,
  formatEvidenceItem,
} from '../../../shared/incidents.js'
import {
  hopDistanceOf,
  labelPath,
  primaryAttackPath,
  INCIDENT_STATUS,
} from '../../../shared/incidentIntel.js'
import {
  formatMomentumLine,
  formatScoreOver100,
  isPlateauAtCeiling,
  trajectoryLabel,
} from '../../../shared/riskMomentum.js'
import {
  computeFinancialExposure,
  RESIDUAL_BAND,
} from '../../../shared/financialExposure.js'
import { fmt } from './metrics.js'

const SEVERITY_RANK = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
})

const METRIC_LABELS = Object.freeze({
  packetsPerSecond: 'Packets / sec',
  httpRequestsPerMin: 'HTTP / min',
  filesDownloaded: 'Files downloaded',
  failedLoginsPerMin: 'Failed logins / min',
})

export function isNodeQuarantined(node) {
  if (!node || typeof node !== 'object') return false
  return (
    node.data?.runtimeState?.quarantined === true ||
    node.data?.quarantined === true ||
    node.quarantined === true
  )
}

export function nodeById(nodes = [], id) {
  if (id == null) return null
  const key = String(id)
  return (nodes ?? []).find((n) => String(n.id) === key) ?? null
}

export function nodeLabel(nodes = [], id) {
  const n = nodeById(nodes, id)
  return n?.data?.label ?? n?.label ?? (id != null ? String(id) : '')
}

function severityRank(severity) {
  return SEVERITY_RANK[String(severity ?? '').toLowerCase()] ?? 4
}

function isOpenIncident(inc) {
  const status = String(inc?.status ?? INCIDENT_STATUS.OPEN).toLowerCase()
  return status !== INCIDENT_STATUS.CLEARED
}

/** Highest-priority open incident (confirmed seeds only — promotion is TGNN-seed based). */
export function selectPrimaryIncident(incidents = [], anomalyNodeIds = []) {
  const list = Array.isArray(incidents) ? incidents : []
  const anomalySet = new Set((anomalyNodeIds ?? []).map(String))
  const open = list.filter(isOpenIncident)
  const preferred = open.filter((inc) => anomalySet.has(String(inc.endpointId)))
  const pool = preferred.length ? preferred : open
  if (!pool.length) return null
  return [...pool].sort((a, b) => {
    const d = severityRank(a.severity) - severityRank(b.severity)
    if (d !== 0) return d
    const sa = Number(a.anomalyScore)
    const sb = Number(b.anomalyScore)
    if (Number.isFinite(sa) && Number.isFinite(sb) && sb !== sa) return sb - sa
    return String(a.endpointLabel || a.endpointId || '').localeCompare(
      String(b.endpointLabel || b.endpointId || '')
    )
  })[0]
}

export function metricEvidenceHighlight(incident) {
  const evidence = Array.isArray(incident?.evidence) ? incident.evidence : []
  const metric = evidence.find(
    (ev) =>
      ev &&
      (ev.code === 'metric_deviation' || String(ev.code ?? '').startsWith('telemetry_spike')) &&
      Number.isFinite(Number(ev.observed)) &&
      Number.isFinite(Number(ev.expected))
  )
  if (!metric) return null
  const key = String(metric.metric ?? 'packetsPerSecond')
  return {
    metricKey: key,
    label: METRIC_LABELS[key] || key,
    observed: Number(metric.observed),
    expected: Number(metric.expected),
    deviationPct: Number.isFinite(Number(metric.deviationPct))
      ? Number(metric.deviationPct)
      : null,
  }
}

/** Operator-facing detection tags from evidence — not a second detector. */
export function detectionTags(incident) {
  const tags = []
  const evidence = Array.isArray(incident?.evidence) ? incident.evidence : []
  const codes = evidence.map((ev) => String(ev?.code ?? ''))

  const hasDrift = codes.some(
    (c) => c.startsWith('telemetry_drift') || c === 'behavioural_anomaly'
  )
  const hasSpike = codes.some(
    (c) =>
      c === 'metric_deviation' ||
      c.startsWith('telemetry_spike') ||
      c.startsWith('edge_pps')
  )
  const hasResidual = codes.some(
    (c) => c.startsWith('tgnn') || c === 'anomaly' || c.startsWith('structural')
  )

  if (hasDrift) tags.push('Behavioral drift')
  if (hasSpike) tags.push('Metric spike')
  if (hasResidual) tags.push('Graph residual anomaly')

  if (!tags.length && incident?.detectionType) {
    tags.push(detectionTypeLabel(incident.detectionType))
  }

  if (tags.length < 3) {
    const line = evidence.map(formatEvidenceItem).find((s) => s && !tags.includes(s))
    if (line && line.length < 48) tags.push(line)
  }

  return tags.slice(0, 3)
}

/**
 * Mesh posture label from existing counts — display taxonomy only.
 * Does not invent a parallel risk score.
 */
export function meshPosture({
  incidents = [],
  anomalyCount = 0,
  atRiskCount = 0,
  quarantinedCount = 0,
  tgnnCalibrating = false,
  riskScore = null,
} = {}) {
  const open = (incidents ?? []).filter(isOpenIncident)
  const high = open.filter(
    (i) => i.severity === 'critical' || i.severity === 'high'
  ).length

  const summaryParts = []
  if (anomalyCount > 0) {
    summaryParts.push(
      `${anomalyCount} confirmed anomal${anomalyCount === 1 ? 'y' : 'ies'}`
    )
  }
  if (atRiskCount > 0) {
    summaryParts.push(`${atRiskCount} node${atRiskCount === 1 ? '' : 's'} at risk`)
  }
  if (quarantinedCount > 0) {
    summaryParts.push(`${quarantinedCount} quarantined`)
  }
  const summary =
    summaryParts.length > 0
      ? summaryParts.join(' · ')
      : 'No confirmed anomalies on the mesh'

  if (tgnnCalibrating) {
    return {
      key: 'calibrating',
      label: 'CALIBRATING',
      tone: 'muted',
      summary: 'Idle-window calibrator collecting baseline samples',
      empty: true,
    }
  }

  const score = riskScore != null && Number.isFinite(Number(riskScore)) ? Number(riskScore) : null
  if (high > 0 || (anomalyCount > 0 && score != null && score >= 70)) {
    return { key: 'critical', label: 'CRITICAL', tone: 'crit', summary, empty: false }
  }
  if (anomalyCount > 0) {
    return { key: 'high', label: 'HIGH', tone: 'crit', summary, empty: false }
  }
  if (open.length > 0 || atRiskCount > 0) {
    return { key: 'elevated', label: 'ELEVATED', tone: 'warn', summary, empty: false }
  }
  return {
    key: 'healthy',
    label: 'HEALTHY',
    tone: 'ok',
    summary: 'No confirmed anomalies detected on the mesh',
    empty: true,
  }
}

/** Presentation kind for Overview Risk — copy only, not a second score. */
export const RISK_PRESENTATION = Object.freeze({
  WAITING: 'waiting',
  ACTIVE: 'active',
  RESIDUAL: 'residual',
  RECOVERING: 'recovering',
  STABLE: 'stable',
})

function hasConfirmedThreat({ anomalyCount = 0, openIncidentCount = 0 } = {}) {
  return Number(anomalyCount) > 0 || Number(openIncidentCount) > 0
}

export function riskTrajectoryCopy(
  riskMomentum = null,
  { anomalyCount = 0, openIncidentCount = 0 } = {}
) {
  const rm = riskMomentum ?? {}
  const available = rm.available === true && rm.score != null
  const traj = String(rm.trajectory ?? 'stable').toLowerCase()
  const score = available ? Number(rm.score) : null
  const plateau = isPlateauAtCeiling(rm)
  const confirmedThreat = hasConfirmedThreat({ anomalyCount, openIncidentCount })
  const delta = Number(rm.delta)
  const falling = Number.isFinite(delta) && delta < -3

  let headline = trajectoryLabel(rm.trajectory)
  let narrative = 'Waiting for residual score samples from the live detection pipeline.'
  let presentation = RISK_PRESENTATION.WAITING
  if (available) {
    if (traj === 'escalating' || traj === 'rising') {
      if (confirmedThreat) {
        narrative = 'Risk is accelerating as new anomalous activity is detected.'
        presentation = RISK_PRESENTATION.ACTIVE
      } else {
        headline = 'ELEVATED RESIDUAL'
        narrative =
          'Residual is rising, but no confirmed anomalous activity is present on this tick.'
        presentation = RISK_PRESENTATION.RESIDUAL
      }
    } else if (falling && !confirmedThreat) {
      narrative = 'Risk is recovering as confirmed anomalies decrease.'
      headline = 'RECOVERING'
      presentation = RISK_PRESENTATION.RECOVERING
    } else if (falling && confirmedThreat) {
      narrative = 'Risk is falling, but confirmed anomalous activity is still present.'
      presentation = RISK_PRESENTATION.ACTIVE
    } else if (confirmedThreat && (traj === 'critical' || (score != null && score >= 70))) {
      narrative = plateau
        ? 'Risk remains critical — active anomalous activity is still present at the residual ceiling.'
        : 'Risk remains critical because active anomalous activity is still present.'
      if (plateau) headline = 'PLATEAUED'
      presentation = RISK_PRESENTATION.ACTIVE
    } else if (!confirmedThreat && score != null && score >= 70) {
      headline = 'ELEVATED RESIDUAL'
      narrative =
        'Residual remains elevated after containment — no confirmed anomalous activity on this tick.'
      presentation = RISK_PRESENTATION.RESIDUAL
    } else {
      narrative = 'Risk is stable for the current observation window.'
      presentation = RISK_PRESENTATION.STABLE
    }
  }

  const series = Array.isArray(rm.series) ? rm.series : []
  const peak = series.length
    ? Math.max(...series.map((p) => Number(p.score ?? p.value)).filter(Number.isFinite))
    : score

  return {
    available,
    score,
    scoreLabel: available ? formatScoreOver100(score) : '— / 100',
    headline,
    narrative,
    presentation,
    confirmedThreat,
    delta: available ? rm.delta : null,
    deltaLabel: formatMomentumLine(available ? rm.delta : null, Number(rm.windowTicks) || 10),
    windowTicks: Number(rm.windowTicks) || 10,
    peak: peak != null && Number.isFinite(Number(peak)) ? Math.round(Number(peak)) : null,
    series,
    techHint:
      'Current score is peak graph residual × 100 among currently gated anomalous nodes. Contained or unflagged nodes keep explainability residuals but do not hold Current at the ceiling. Peak is the maximum in the recent residual series. Momentum is the change over the last residual window (~10 s). Assessment only — not a confirmed kill-chain.',
  }
}

export function attackPathView(incident, nodes = [], detection = null) {
  if (!incident) {
    return {
      active: false,
      labels: [],
      pathIds: [],
      hopDepth: 0,
      confirmedCount: Array.isArray(detection?.anomalyNodeIds)
        ? detection.anomalyNodeIds.length
        : 0,
      exposedCount: 0,
      affectedCount: 0,
    }
  }

  const pathIds = primaryAttackPath(incident)
  const labels = labelPath(pathIds, { nodes })
  const hopDepth = hopDistanceOf(pathIds)

  const confirmed = new Set((detection?.anomalyNodeIds ?? []).map(String))
  const exposed = new Set()
  for (const id of incident.propagatedNodeIds ?? []) exposed.add(String(id))
  for (const id of incident.peerExposedNodeIds ?? []) exposed.add(String(id))
  for (const id of detection?.propagatedNodeIds ?? []) exposed.add(String(id))
  for (const id of detection?.peerExposedNodeIds ?? []) exposed.add(String(id))
  for (const id of detection?.atRiskNodeIds ?? []) exposed.add(String(id))
  for (const id of confirmed) exposed.delete(id)

  const affected = new Set([...confirmed, ...exposed])
  for (const id of pathIds) if (id) affected.add(String(id))

  return {
    active: pathIds.length > 0 && (confirmed.size > 0 || hopDepth > 0 || exposed.size > 0),
    labels,
    pathIds,
    hopDepth,
    confirmedCount: confirmed.size,
    exposedCount: exposed.size,
    affectedCount: affected.size,
  }
}

/**
 * Response / containment lifecycle from quarantine + incident status.
 * Does not claim recovery from Execute HTTP success alone.
 */
export function responseLifecycle({
  detection = null,
  nodes = [],
  incidents = [],
} = {}) {
  const anomalyIds = new Set((detection?.anomalyNodeIds ?? []).map(String))
  const list = Array.isArray(incidents) ? incidents : []
  const open = list.filter(isOpenIncident)
  const cleared = list.filter((i) => !isOpenIncident(i))

  const targetIds = new Set([
    ...anomalyIds,
    ...list.map((i) => String(i.endpointId ?? '')).filter(Boolean),
  ])

  let anyContained = false
  let containedClear = true
  let hasTargets = targetIds.size > 0

  for (const id of targetIds) {
    const n = nodeById(nodes, id)
    const q = isNodeQuarantined(n)
    if (q) anyContained = true
    if (q && anomalyIds.has(id)) containedClear = false
    if (!q && anomalyIds.has(id)) containedClear = false
  }

  const quarantinedCount = (nodes ?? []).filter(isNodeQuarantined).length
  if (!anyContained && quarantinedCount > 0 && (anomalyIds.size > 0 || open.length > 0)) {
    anyContained = true
  }

  const detectionConfirmed = anomalyIds.size > 0 || open.length > 0
  const investigationAvailable = open.length > 0 || cleared.length > 0 || detectionConfirmed
  const containmentExecuted = anyContained
  const telemetryRecovering =
    containmentExecuted && anomalyIds.size === 0 && (open.length > 0 || cleared.length > 0 || quarantinedCount > 0)
  const incidentCleared =
    containmentExecuted &&
    open.length === 0 &&
    anomalyIds.size === 0 &&
    (cleared.length > 0 || quarantinedCount > 0)

  const stages = [
    {
      id: 'detection',
      label: 'DETECTION',
      state: detectionConfirmed ? 'done' : 'idle',
      detail: detectionConfirmed ? 'Confirmed' : 'Clear',
    },
    {
      id: 'investigation',
      label: 'INVESTIGATION',
      state: investigationAvailable ? (detectionConfirmed ? 'active' : 'done') : 'idle',
      detail: investigationAvailable ? 'Available' : 'Not started',
    },
    {
      id: 'containment',
      label: 'CONTAINMENT',
      state: containmentExecuted ? 'done' : detectionConfirmed ? 'pending' : 'idle',
      detail: containmentExecuted ? 'Executed' : 'Not executed',
    },
    {
      id: 'recovery',
      label: incidentCleared
        ? 'INCIDENT CLEARED'
        : telemetryRecovering
          ? 'TELEMETRY RECOVERING'
          : 'RECOVERY',
      state: incidentCleared ? 'done' : telemetryRecovering ? 'active' : 'idle',
      detail: incidentCleared
        ? 'Cleared'
        : telemetryRecovering
          ? 'In progress'
          : 'Not started',
    },
  ]

  return {
    stages,
    detectionConfirmed,
    investigationAvailable,
    containmentExecuted,
    telemetryRecovering,
    incidentCleared,
    containedClear,
    hasTargets,
  }
}

export function telemetryHealthView({
  nodes = [],
  rows = [],
  feedStatus = null,
  phase = 'lobby',
  sampleTicks = 0,
  quarantinedCount = 0,
  tgnnCalibrating = false,
  fetchError = null,
  pps = null,
} = {}) {
  const totalDevices = Array.isArray(nodes) ? nodes.length : 0
  const reporting =
    Array.isArray(rows) && rows.length
      ? rows.filter((r) => r.catalogBaseline !== true).length
      : null

  let feed = 'UNKNOWN'
  let feedTone = 'muted'
  if (fetchError) {
    feed = 'ERROR'
    feedTone = 'crit'
  } else if (phase !== 'playing') {
    feed = 'STANDBY'
    feedTone = 'muted'
  } else if (feedStatus === 'ok') {
    feed = 'LIVE'
    feedTone = 'ok'
  } else if (feedStatus === 'empty') {
    feed = 'EMPTY'
    feedTone = 'warn'
  } else if (feedStatus === 'down') {
    feed = 'DOWN'
    feedTone = 'crit'
  }

  let pipeline = 'UNKNOWN'
  let pipelineTone = 'muted'
  if (tgnnCalibrating) {
    pipeline = 'CALIBRATING'
    pipelineTone = 'warn'
  } else if (feed === 'LIVE' && !fetchError) {
    pipeline = 'HEALTHY'
    pipelineTone = 'ok'
  } else if (feed === 'DOWN' || feed === 'ERROR') {
    pipeline = 'DEGRADED'
    pipelineTone = 'crit'
  } else if (feed === 'EMPTY' || feed === 'STANDBY') {
    pipeline = 'WAITING'
    pipelineTone = 'muted'
  }

  return {
    feed,
    feedTone,
    reporting,
    totalDevices,
    reportingLabel:
      reporting != null && totalDevices > 0
        ? `${reporting} / ${totalDevices}`
        : totalDevices > 0
          ? String(totalDevices)
          : null,
    updateIntervalSec: phase === 'playing' ? 1 : null,
    sampleTicks,
    pipeline,
    pipelineTone,
    quarantinedCount,
    ppsLabel: pps != null && Number.isFinite(Number(pps)) ? fmt(pps) : null,
  }
}

export function quickSignalsView({
  incident = null,
  detection = null,
  finance = null,
  telemetry = null,
} = {}) {
  const tags = detectionTags(incident)
  const propActive =
    (detection?.propagatedNodeIds ?? []).length > 0 ||
    hopDistanceOf(primaryAttackPath(incident)) > 0

  const exposureLabel =
    finance?.simulated === true && finance.exposureLabel && finance.exposureLabel !== '₹0'
      ? finance.exposureLabel
      : null

  return [
    {
      id: 'drift',
      label: 'Behavioral Drift',
      value: tags.includes('Behavioral drift') ? 'DETECTED' : 'CLEAR',
      tone: tags.includes('Behavioral drift') ? 'warn' : 'muted',
    },
    {
      id: 'spike',
      label: 'Metric Spike',
      value: tags.includes('Metric spike') ? 'DETECTED' : 'CLEAR',
      tone: tags.includes('Metric spike') ? 'warn' : 'muted',
    },
    {
      id: 'propagation',
      label: 'Propagation',
      value: propActive ? 'ACTIVE' : 'NONE',
      tone: propActive ? 'warn' : 'muted',
    },
    {
      id: 'finance',
      label: 'Financial Exposure',
      value: exposureLabel || '₹0',
      tone: exposureLabel ? 'crit' : 'muted',
    },
    {
      id: 'telemetry',
      label: 'Telemetry',
      value: telemetry?.pipeline ?? '—',
      tone: telemetry?.pipelineTone ?? 'muted',
    },
  ]
}

/**
 * Full Overview view model from existing DashboardPage props.
 */
export function buildOverviewModel({
  detection = null,
  nodes = [],
  edges = [],
  incidents = null,
  rows = [],
  feedStatus = null,
  phase = 'lobby',
  sampleTicks = 0,
  fetchError = null,
  pps = null,
} = {}) {
  const incidentList = Array.isArray(incidents)
    ? incidents
    : Array.isArray(detection?.incidents)
      ? detection.incidents
      : []

  const anomalyNodeIds = detection?.anomalyNodeIds ?? []
  const anomalyCount = anomalyNodeIds.length
  const atRiskCount = Array.isArray(detection?.atRiskNodeIds)
    ? detection.atRiskNodeIds.length
    : 0
  const quarantinedCount = (nodes ?? []).filter(isNodeQuarantined).length
  const openIncidentCount = incidentList.filter(isOpenIncident).length

  const primary = selectPrimaryIncident(incidentList, anomalyNodeIds)
  const finance = computeFinancialExposure({ detection, nodes, edges })
  const rm = detection?.riskMomentum ?? null
  const risk = riskTrajectoryCopy(rm, { anomalyCount, openIncidentCount })
  const posture = meshPosture({
    incidents: incidentList,
    anomalyCount,
    atRiskCount,
    quarantinedCount,
    tgnnCalibrating: detection?.tgnnCalibrating === true,
    riskScore: risk.available ? risk.score : null,
  })
  const path = attackPathView(primary, nodes, detection)
  const lifecycle = responseLifecycle({ detection, nodes, incidents: incidentList })
  const telemetry = telemetryHealthView({
    nodes,
    rows,
    feedStatus,
    phase,
    sampleTicks,
    quarantinedCount,
    tgnnCalibrating: detection?.tgnnCalibrating === true,
    fetchError,
    pps,
  })
  const signals = quickSignalsView({
    incident: primary,
    detection,
    finance,
    telemetry,
  })

  const metric = metricEvidenceHighlight(primary)
  const tags = detectionTags(primary)

  return {
    posture,
    stats: {
      activeIncidents: openIncidentCount,
      confirmedAnomalies: anomalyCount,
      atRiskNodes: atRiskCount,
      quarantined: quarantinedCount,
    },
    primaryIncident: primary,
    metric,
    detectionTags: tags,
    risk,
    path,
    finance,
    residualBand: finance.residualBand ?? RESIDUAL_BAND.NOMINAL,
    lifecycle,
    telemetry,
    signals,
    calibrating: detection?.tgnnCalibrating === true,
    primarySpreadNodeId: detection?.primarySpreadNodeId ?? primary?.primarySpreadNodeId ?? null,
  }
}
