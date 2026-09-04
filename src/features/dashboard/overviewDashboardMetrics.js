/**
 * Pure Overview dashboard metrics.
 * Derives presentation KPIs from live incidents, match history, detection,
 * and orchestration state — no second detector or fabricated scores.
 */

import {
  DETECTION_TYPE_LABELS,
  detectionTypeLabel,
  SEVERITY_LEVELS,
} from '../../../shared/incidents.js'
import { isActiveResponseIncident } from '../../../shared/incidentStatus.js'
import { ORCHESTRATION_STATUS, normalizeOrchestrationStatus } from '../../../shared/response/orchestration.js'
import { nodeById, nodeLabel, selectPrimaryIncident } from './overviewView.js'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MIN_MS = 60 * 1000

const SEVERITY_ORDER = Object.freeze([...SEVERITY_LEVELS].reverse())

const CLOSED = new Set(['cleared', 'closed', 'resolved'])

/** Activity chart range keys — filters history by wall-clock window. */
export const ACTIVITY_RANGES = Object.freeze({
  today: { id: 'today', label: 'Today', windowMs: DAY_MS },
  week: { id: 'week', label: 'This week', windowMs: 7 * DAY_MS },
  month: { id: 'month', label: 'This month', windowMs: 30 * DAY_MS },
})

function severityOf(row) {
  return String(row?.severity ?? 'low').toLowerCase()
}

function statusOf(row) {
  return String(row?.status ?? 'open').toLowerCase().trim() || 'open'
}

function typeOf(row) {
  return String(row?.detectionType ?? row?.incidentType ?? 'behavioural_anomaly')
}

function isResolvedStatus(status) {
  return CLOSED.has(String(status ?? '').toLowerCase())
}

function isCriticalSeverity(severity) {
  return severityOf({ severity }) === 'critical'
}

function sectorOf(row, nodes) {
  const direct = row?.sector
  if (direct) return String(direct)
  const id = row?.endpointId ?? row?.affectedNodeId
  const n = nodeById(nodes, id)
  return String(n?.data?.sector ?? n?.sector ?? 'Unknown')
}

function labelOf(row, nodes) {
  return (
    row?.endpointLabel ||
    row?.affectedNodeLabel ||
    nodeLabel(nodes, row?.endpointId ?? row?.affectedNodeId) ||
    row?.endpointId ||
    row?.affectedNodeId ||
    '—'
  )
}

function detectedMsOf(row) {
  const ms = Number(row?.detectedAtMs)
  if (Number.isFinite(ms) && ms > 0) return ms
  const ts = row?.timestamp
  if (typeof ts === 'string' && ts) {
    const t = Date.parse(ts)
    if (Number.isFinite(t) && t > 0) return t
  }
  if (Number.isFinite(Number(ts)) && Number(ts) > 0) return Number(ts)
  return 0
}

function updatedMsOf(row) {
  const ms = Number(row?.updatedAtMs)
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/**
 * Merge match history + live detection incidents without double-counting.
 * History is authoritative for timestamps/status; live fills gaps and sector labels.
 */
export function mergeIncidentCorpus({ live = [], history = [], nodes = [] } = {}) {
  const byLiveId = new Map()
  const rows = []

  for (const h of history ?? []) {
    if (!h) continue
    const liveId = h.liveIncidentId ? String(h.liveIncidentId) : null
    const id = String(h.incidentId ?? h.id ?? '')
    if (!id && !liveId) continue
    const row = {
      key: id || liveId,
      incidentId: id || null,
      liveIncidentId: liveId,
      detectedAtMs: detectedMsOf(h),
      updatedAtMs: updatedMsOf(h),
      detectionType: typeOf(h),
      severity: severityOf(h),
      status: statusOf(h),
      endpointId: String(h.affectedNodeId ?? h.endpointId ?? ''),
      endpointLabel: labelOf(h, nodes),
      sector: sectorOf(h, nodes),
      source: 'history',
    }
    rows.push(row)
    if (liveId) byLiveId.set(liveId, row)
  }

  for (const inc of live ?? []) {
    if (!inc) continue
    const liveId = String(inc.persistentId || inc.id || '')
    if (!liveId) continue
    const existing = byLiveId.get(liveId)
    if (existing) {
      const liveLabel = String(inc.endpointLabel ?? '').trim()
      if (liveLabel) existing.endpointLabel = liveLabel
      else if (!existing.endpointLabel || existing.endpointLabel === existing.endpointId) {
        existing.endpointLabel = labelOf(inc, nodes)
      }
      const liveSector = String(inc.sector ?? '').trim()
      if (liveSector) existing.sector = liveSector
      else if (!existing.sector || existing.sector === 'Unknown') {
        existing.sector = sectorOf(inc, nodes)
      }
      if (inc.detectionType) existing.detectionType = String(inc.detectionType)
      if (inc.severity) existing.severity = severityOf(inc)
      // Live status wins for open/cleared when present
      if (inc.status) existing.status = statusOf(inc)
      existing.live = inc
      continue
    }
    const row = {
      key: liveId,
      incidentId: null,
      liveIncidentId: liveId,
      detectedAtMs: detectedMsOf(inc),
      updatedAtMs: updatedMsOf(inc),
      detectionType: typeOf(inc),
      severity: severityOf(inc),
      status: statusOf(inc),
      endpointId: String(inc.endpointId ?? ''),
      endpointLabel: labelOf(inc, nodes),
      sector: sectorOf(inc, nodes),
      source: 'live',
      live: inc,
    }
    rows.push(row)
    byLiveId.set(liveId, row)
  }

  return rows
}

export function formatCompactDuration(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return null
  if (n < 1000) return `${Math.round(n)}ms`
  const sec = Math.round(n / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`
  const hr = Math.floor(min / 60)
  const m = min % 60
  return m ? `${hr}h ${m}m` : `${hr}h`
}

export function formatRelativeTime(ms, nowMs = Date.now()) {
  const t = Number(ms)
  if (!Number.isFinite(t) || t <= 0) return '—'
  const delta = Math.max(0, Number(nowMs) - t)
  if (delta < 2000) return 'just now'
  if (delta < MIN_MS) return `${Math.floor(delta / 1000)}s ago`
  if (delta < HOUR_MS) return `${Math.floor(delta / MIN_MS)}m ago`
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h ago`
  return `${Math.floor(delta / DAY_MS)}d ago`
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function startOfLocalDay(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function bucketKeyFor(ms, mode) {
  const d = new Date(ms)
  if (mode === 'day') {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  }
  if (mode === 'hour') {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00`
  }
  // minute
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function bucketLabelFor(ms, mode) {
  const d = new Date(ms)
  if (mode === 'day') {
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  }
  if (mode === 'hour') {
    return `${pad2(d.getHours())}:00`
  }
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * Adaptive activity series from detection timestamps.
 * Match demos are usually minutes long — bucket by minute/hour when span is short.
 */
export function buildAttackActivitySeries(corpus = [], { rangeId = 'today', nowMs = Date.now() } = {}) {
  const range = ACTIVITY_RANGES[rangeId] || ACTIVITY_RANGES.today
  const cutoff = Number(nowMs) - range.windowMs
  const inRange = (corpus ?? []).filter((r) => {
    const t = Number(r.detectedAtMs)
    return Number.isFinite(t) && t > 0 && t >= cutoff && t <= nowMs
  })

  const times = inRange.map((r) => r.detectedAtMs).filter((t) => t > 0)
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0

  let mode = 'day'
  let slots = 7
  let stepMs = DAY_MS
  let anchor = startOfLocalDay(nowMs) - 6 * DAY_MS

  if (times.length === 0) {
    // Empty match — still show a readable skeleton for the selected window.
    if (rangeId === 'today') {
      mode = 'hour'
      slots = 8
      stepMs = HOUR_MS
      anchor = nowMs - 7 * HOUR_MS
    } else if (rangeId === 'week') {
      mode = 'day'
      slots = 7
      stepMs = DAY_MS
      anchor = startOfLocalDay(nowMs) - 6 * DAY_MS
    } else {
      mode = 'day'
      slots = 10
      stepMs = 3 * DAY_MS
      anchor = startOfLocalDay(nowMs) - 27 * DAY_MS
    }
  } else if (span <= 2 * HOUR_MS || rangeId === 'today') {
    mode = span <= 45 * MIN_MS ? 'minute' : 'hour'
    if (mode === 'minute') {
      slots = 12
      stepMs = Math.max(MIN_MS, Math.ceil(span / 11) || MIN_MS)
      // Snap to whole minutes
      stepMs = Math.max(MIN_MS, Math.round(stepMs / MIN_MS) * MIN_MS)
      anchor = Math.min(...times)
      anchor = Math.floor(anchor / MIN_MS) * MIN_MS
      const end = Math.max(...times, nowMs)
      slots = Math.min(24, Math.max(6, Math.ceil((end - anchor) / stepMs) + 1))
    } else {
      slots = Math.min(24, Math.max(6, Math.ceil(span / HOUR_MS) + 1))
      stepMs = HOUR_MS
      anchor = Math.floor(Math.min(...times) / HOUR_MS) * HOUR_MS
    }
  } else if (span <= 3 * DAY_MS) {
    mode = 'hour'
    slots = Math.min(24, Math.max(8, Math.ceil(span / HOUR_MS) + 1))
    stepMs = HOUR_MS
    anchor = Math.floor(Math.min(...times) / HOUR_MS) * HOUR_MS
  } else {
    mode = 'day'
    slots = rangeId === 'month' ? 10 : 7
    stepMs = rangeId === 'month' ? 3 * DAY_MS : DAY_MS
    anchor = startOfLocalDay(nowMs) - (slots - 1) * stepMs
  }

  const counts = new Map()
  for (const r of inRange) {
    const key = bucketKeyFor(r.detectedAtMs, mode)
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const points = []
  for (let i = 0; i < slots; i++) {
    const t = anchor + i * stepMs
    const key = bucketKeyFor(t, mode)
    points.push({
      key,
      label: bucketLabelFor(t, mode),
      atMs: t,
      count: counts.get(key) || 0,
      value: counts.get(key) || 0,
    })
  }

  // Merge any leftover keys that fell outside generated slots (sparse history).
  for (const [key, count] of counts) {
    if (points.some((p) => p.key === key)) continue
    const sample = inRange.find((r) => bucketKeyFor(r.detectedAtMs, mode) === key)
    points.push({
      key,
      label: sample ? bucketLabelFor(sample.detectedAtMs, mode) : key,
      atMs: sample?.detectedAtMs ?? 0,
      count,
      value: count,
    })
  }
  points.sort((a, b) => a.atMs - b.atMs)

  const total = inRange.length
  const peak = points.reduce((m, p) => Math.max(m, p.count), 0)
  const peakPoint = points.find((p) => p.count === peak && peak > 0) || null

  let volumeHint = null
  if (points.length >= 4 && total > 0) {
    const mid = Math.floor(points.length / 2)
    const first = points.slice(0, mid).reduce((s, p) => s + p.count, 0)
    const second = points.slice(mid).reduce((s, p) => s + p.count, 0)
    if (first > 0) {
      const pct = Math.round(((second - first) / first) * 100)
      if (Math.abs(pct) >= 8) {
        volumeHint =
          pct > 0
            ? `Attack volume increased ${pct}% in the later window`
            : `Attack volume decreased ${Math.abs(pct)}% in the later window`
      }
    }
  }

  return {
    rangeId: range.id,
    mode,
    points,
    total,
    peak,
    peakLabel: peakPoint ? `Peak activity: ${peak} detections` : null,
    volumeHint,
    contextLabel:
      mode === 'minute'
        ? 'Detections this match (minute buckets)'
        : mode === 'hour'
          ? 'Detections by hour'
          : 'Detections by day',
  }
}

export function buildTypeDistribution(corpus = []) {
  const counts = new Map()
  for (const row of corpus ?? []) {
    const t = typeOf(row)
    counts.set(t, (counts.get(t) || 0) + 1)
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0)
  const rows = [...counts.entries()]
    .map(([id, count]) => ({
      id,
      label: DETECTION_TYPE_LABELS[id] || detectionTypeLabel(id),
      count,
      pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return { total, rows }
}

export function buildSeverityDistribution(corpus = []) {
  const counts = Object.fromEntries(SEVERITY_LEVELS.map((s) => [s, 0]))
  for (const row of corpus ?? []) {
    const s = severityOf(row)
    if (counts[s] != null) counts[s] += 1
    else counts.low += 1
  }
  const total = Object.values(counts).reduce((s, n) => s + n, 0)
  const max = Math.max(1, ...Object.values(counts))
  return {
    total,
    rows: SEVERITY_ORDER.map((id) => ({
      id,
      label: id.toUpperCase(),
      count: counts[id] || 0,
      pct: total > 0 ? Math.round(((counts[id] || 0) / total) * 100) : 0,
      barPct: Math.round(((counts[id] || 0) / max) * 100),
    })),
  }
}

export function buildSectorImpact(corpus = [], { limit = 6 } = {}) {
  const bySector = new Map()
  for (const row of corpus ?? []) {
    const sector = sectorOf(row, []) || 'Unknown'
    const cur = bySector.get(sector) || { sector, incidents: 0, critical: 0 }
    cur.incidents += 1
    if (isCriticalSeverity(row.severity)) cur.critical += 1
    bySector.set(sector, cur)
  }
  const rows = [...bySector.values()]
    .sort((a, b) => b.incidents - a.incidents || b.critical - a.critical || a.sector.localeCompare(b.sector))
    .slice(0, limit)
  const max = Math.max(1, ...rows.map((r) => r.incidents), 1)
  return {
    rows: rows.map((r) => ({
      ...r,
      barPct: Math.round((r.incidents / max) * 100),
      risk:
        r.critical > 0 ? 'crit' : r.incidents >= 3 ? 'warn' : r.incidents > 0 ? 'elevated' : 'muted',
    })),
    zoneCount: bySector.size,
  }
}

function uniqueIdsFromTrace(trace, predicate) {
  const ids = new Set()
  for (const row of trace ?? []) {
    if (!predicate(row)) continue
    const id = row?.primaryIncidentId
    if (id != null && String(id).trim()) ids.add(String(id))
  }
  return ids
}

/**
 * Funnel counts from workflowTrace + current orchestration status.
 * Cumulative: an incident that recovered also counts in earlier stages it reached.
 */
export function buildResponseOpsFunnel({ corpus = [], orchestration = null } = {}) {
  const detected = (corpus ?? []).length
  const trace = Array.isArray(orchestration?.workflowTrace)
    ? orchestration.workflowTrace
    : []

  const planned = uniqueIdsFromTrace(
    trace,
    (r) =>
      (r?.kind === 'agent_loop' &&
        (r.phase === 'COMMANDER_PLAN' || r.phase === 'PLANNER_STARTED')) ||
      (r?.kind === 'status_transition' &&
        ['PLAN_READY', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'RECOVERED'].includes(
          String(r.newStatus)
        ))
  )
  const awaiting = uniqueIdsFromTrace(
    trace,
    (r) =>
      (r?.kind === 'status_transition' && r.newStatus === 'AWAITING_APPROVAL') ||
      (r?.kind === 'agent_loop' && r.phase === 'AWAITING_APPROVAL')
  )
  const approved = uniqueIdsFromTrace(
    trace,
    (r) =>
      (r?.kind === 'agent_loop' && r.phase === 'HUMAN_APPROVED') ||
      (r?.kind === 'status_transition' &&
        ['APPROVED', 'EXECUTING', 'VERIFYING', 'RECOVERED'].includes(String(r.newStatus)))
  )
  const responded = uniqueIdsFromTrace(
    trace,
    (r) =>
      (r?.kind === 'agent_loop' &&
        (r.phase === 'RESPONSE_EXECUTING' ||
          r.phase === 'RESPONSE_COMPLETED' ||
          r.phase === 'VERIFICATION_EVIDENCE' ||
          r.phase === 'EPISODE_RECOVERED')) ||
      (r?.kind === 'status_transition' &&
        ['EXECUTING', 'VERIFYING', 'RECOVERED'].includes(String(r.newStatus)))
  )
  const recoveredFromTrace = uniqueIdsFromTrace(
    trace,
    (r) =>
      (r?.kind === 'agent_loop' && r.phase === 'EPISODE_RECOVERED') ||
      (r?.kind === 'status_transition' && r.newStatus === 'RECOVERED')
  )
  for (const id of orchestration?.completedIncidentIds ?? []) {
    if (id != null) recoveredFromTrace.add(String(id))
  }

  // Current workflow bumps the active incident into the matching stage.
  const status = normalizeOrchestrationStatus(
    orchestration?.workflowStatus ?? orchestration?.status
  )
  const currentId =
    orchestration?.currentIncidentId ||
    orchestration?.plan?.primaryIncidentId ||
    null
  if (currentId) {
    const id = String(currentId)
    if (
      status === ORCHESTRATION_STATUS.ANALYZING ||
      status === ORCHESTRATION_STATUS.PLAN_READY ||
      status === ORCHESTRATION_STATUS.AWAITING_APPROVAL ||
      status === ORCHESTRATION_STATUS.APPROVED ||
      status === ORCHESTRATION_STATUS.EXECUTING ||
      status === ORCHESTRATION_STATUS.CONTINUING ||
      status === ORCHESTRATION_STATUS.VERIFYING ||
      status === ORCHESTRATION_STATUS.RECOVERED
    ) {
      planned.add(id)
    }
    if (
      status === ORCHESTRATION_STATUS.AWAITING_APPROVAL ||
      status === ORCHESTRATION_STATUS.APPROVED ||
      status === ORCHESTRATION_STATUS.EXECUTING ||
      status === ORCHESTRATION_STATUS.VERIFYING ||
      status === ORCHESTRATION_STATUS.RECOVERED
    ) {
      awaiting.add(id)
    }
    if (
      status === ORCHESTRATION_STATUS.APPROVED ||
      status === ORCHESTRATION_STATUS.EXECUTING ||
      status === ORCHESTRATION_STATUS.CONTINUING ||
      status === ORCHESTRATION_STATUS.VERIFYING ||
      status === ORCHESTRATION_STATUS.RECOVERED
    ) {
      approved.add(id)
    }
    if (
      status === ORCHESTRATION_STATUS.EXECUTING ||
      status === ORCHESTRATION_STATUS.CONTINUING ||
      status === ORCHESTRATION_STATUS.VERIFYING ||
      status === ORCHESTRATION_STATUS.RECOVERED
    ) {
      responded.add(id)
    }
    if (status === ORCHESTRATION_STATUS.RECOVERED) {
      recoveredFromTrace.add(id)
    }
  }

  const resolvedCorpus = (corpus ?? []).filter((r) => isResolvedStatus(r.status)).length

  return {
    stages: [
      { id: 'detected', label: 'Detected', count: detected },
      { id: 'planned', label: 'Planned', count: planned.size },
      { id: 'awaiting', label: 'Awaiting approval', count: awaiting.size },
      { id: 'approved', label: 'Approved', count: approved.size },
      { id: 'responded', label: 'Responded', count: responded.size },
      {
        id: 'recovered',
        label: 'Recovered',
        count: Math.max(recoveredFromTrace.size, resolvedCorpus),
      },
    ],
    workflowStatus: status,
  }
}

export function buildLiveThreatStatus({
  live = [],
  detection = null,
  corpus = [],
  nowMs = Date.now(),
} = {}) {
  const open = (live ?? []).filter(isActiveResponseIncident)
  const primary = selectPrimaryIncident(live, detection?.anomalyNodeIds ?? [])
  const latest =
    [...(corpus ?? [])]
      .filter((r) => Number(r.detectedAtMs) > 0)
      .sort((a, b) => b.detectedAtMs - a.detectedAtMs)[0] || null

  const focus = primary
    ? {
        type: detectionTypeLabel(primary.detectionType),
        asset: primary.endpointLabel || primary.endpointId || '—',
        sector: primary.sector || '—',
        severity: severityOf(primary),
        detectedAtMs: detectedMsOf(primary) || latest?.detectedAtMs || 0,
        status: statusOf(primary),
      }
    : latest
      ? {
          type: detectionTypeLabel(latest.detectionType),
          asset: latest.endpointLabel || latest.endpointId || '—',
          sector: latest.sector || '—',
          severity: latest.severity,
          detectedAtMs: latest.detectedAtMs,
          status: latest.status,
        }
      : null

  const severities = open.map((i) => severityOf(i))
  let highest = null
  for (const s of SEVERITY_ORDER) {
    if (severities.includes(s)) {
      highest = s
      break
    }
  }

  const active = open.length > 0 || (detection?.anomalyNodeIds ?? []).length > 0

  return {
    active,
    activeCount: open.length,
    highestSeverity: highest,
    focus,
    relativeTime: focus?.detectedAtMs
      ? formatRelativeTime(focus.detectedAtMs, nowMs)
      : '—',
  }
}

export function buildResponsePerformance(corpus = []) {
  const list = corpus ?? []
  const resolved = list.filter((r) => isResolvedStatus(r.status))
  const active = list.filter((r) => !isResolvedStatus(r.status)).length
  const total = list.length
  const recoveryRate =
    total > 0 ? Math.round((resolved.length / total) * 1000) / 10 : null

  const durations = []
  for (const r of resolved) {
    const start = Number(r.detectedAtMs)
    const end = Number(r.updatedAtMs)
    if (Number.isFinite(start) && start > 0 && Number.isFinite(end) && end > start) {
      durations.push(end - start)
    }
  }
  const avgRecoveryMs =
    durations.length > 0
      ? Math.round(durations.reduce((s, n) => s + n, 0) / durations.length)
      : null

  return {
    resolved: resolved.length,
    active,
    total,
    recoveryRate,
    recoveryRateLabel: recoveryRate != null ? `${recoveryRate}%` : null,
    avgRecoveryMs,
    avgRecoveryLabel: formatCompactDuration(avgRecoveryMs),
    // MTTD / time-to-response require attack-injection start stamps — not on incidents.
    mttdAvailable: false,
    mttrAvailable: avgRecoveryMs != null,
  }
}

export function buildOverviewKpis({
  corpus = [],
  live = [],
  detection = null,
  performance = null,
  sectorImpact = null,
} = {}) {
  const list = corpus ?? []
  const totalAttacks = list.length
  const activeIncidents = (live ?? []).filter(isActiveResponseIncident).length
  const criticalIncidents = list.filter((r) => isCriticalSeverity(r.severity)).length
  const criticalActive = (live ?? []).filter(
    (i) => isActiveResponseIncident(i) && isCriticalSeverity(i.severity)
  ).length
  const resolved = list.filter((r) => isResolvedStatus(r.status)).length
  const atRisk = Array.isArray(detection?.atRiskNodeIds)
    ? detection.atRiskNodeIds.length
    : 0
  const anomalies = Array.isArray(detection?.anomalyNodeIds)
    ? detection.anomalyNodeIds.length
    : 0
  const devicesAtRisk = atRisk + anomalies

  const recoveryRate = performance?.recoveryRate ?? null
  const responseSuccess =
    recoveryRate != null
      ? recoveryRate
      : totalAttacks > 0
        ? Math.round((resolved / totalAttacks) * 1000) / 10
        : null

  return {
    totalAttacks,
    activeIncidents,
    criticalIncidents,
    criticalActive,
    resolved,
    devicesAtRisk,
    devicesHint:
      sectorImpact?.zoneCount > 0
        ? `Across ${sectorImpact.zoneCount} infrastructure zone${sectorImpact.zoneCount === 1 ? '' : 's'}`
        : anomalies > 0
          ? `${anomalies} confirmed anomal${anomalies === 1 ? 'y' : 'ies'}`
          : 'No elevated exposure',
    responseSuccess,
    responseSuccessLabel:
      responseSuccess != null ? `${Math.round(responseSuccess)}%` : null,
  }
}

export function buildRecentThreatRows(corpus = [], { limit = 8, nowMs = Date.now() } = {}) {
  return [...(corpus ?? [])]
    .sort((a, b) => (b.detectedAtMs || 0) - (a.detectedAtMs || 0))
    .slice(0, limit)
    .map((row) => ({
      key: row.key,
      incidentId: row.incidentId || row.liveIncidentId,
      liveIncidentId: row.liveIncidentId,
      endpointId: row.endpointId,
      severity: row.severity,
      typeLabel: detectionTypeLabel(row.detectionType),
      asset: row.endpointLabel || row.endpointId || '—',
      sector: row.sector || '—',
      status: isResolvedStatus(row.status)
        ? 'Recovered'
        : isActiveResponseIncident({ status: row.status })
          ? 'Active'
          : row.status,
      statusRaw: row.status,
      relativeTime: formatRelativeTime(row.detectedAtMs, nowMs),
      detectedAtMs: row.detectedAtMs,
    }))
}

/**
 * Full presentation model for the redesigned Overview dashboard.
 */
export function buildOverviewDashboardMetrics({
  live = [],
  history = [],
  nodes = [],
  detection = null,
  orchestration = null,
  activityRangeId = 'today',
  nowMs = Date.now(),
} = {}) {
  const corpus = mergeIncidentCorpus({ live, history, nodes })
  const activity = buildAttackActivitySeries(corpus, {
    rangeId: activityRangeId,
    nowMs,
  })
  const typeDistribution = buildTypeDistribution(corpus)
  const severity = buildSeverityDistribution(corpus)
  const sectorImpact = buildSectorImpact(corpus)
  const performance = buildResponsePerformance(corpus)
  const kpis = buildOverviewKpis({
    corpus,
    live,
    detection,
    performance,
    sectorImpact,
  })
  const responseOps = buildResponseOpsFunnel({ corpus, orchestration })
  const liveThreat = buildLiveThreatStatus({ live, detection, corpus, nowMs })
  const recent = buildRecentThreatRows(corpus, { nowMs })

  return {
    corpusCount: corpus.length,
    historyCount: (history ?? []).length,
    kpis,
    activity,
    typeDistribution,
    severity,
    sectorImpact,
    liveThreat,
    responseOps,
    performance,
    recent,
  }
}
