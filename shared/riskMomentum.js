/** City / node risk momentum overlay on graph residual scores. Not a second detector. */

export const RISK_WINDOW_TICKS = 10
export const RISK_HISTORY_CAP = 40
export const RISK_SERIES_POINTS = 20

export const TRAJECTORY = Object.freeze({
  STABLE: 'stable',
  RISING: 'rising',
  ESCALATING: 'escalating',
  CRITICAL: 'critical',
})

export function emptyRiskMomentum() {
  return {
    score: null,
    windowTicks: RISK_WINDOW_TICKS,
    delta: null,
    trajectory: TRAJECTORY.STABLE,
    exposedCount: 0,
    series: [],
    available: false,
  }
}

export function peakResidualScore(isolationScoresByNodeId) {
  const vals = Object.values(isolationScoresByNodeId ?? {})
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n))
  if (!vals.length) return 0
  return Math.max(0, Math.min(100, Math.round(Math.max(...vals) * 100)))
}

export function residualToScore(isolationScore) {
  const n = Number(isolationScore)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n * 100)))
}

export function exposedSetCount(detection) {
  const ids = new Set()
  for (const list of [
    detection?.anomalyNodeIds,
    detection?.compromisedNodeIds,
    detection?.atRiskNodeIds,
  ]) {
    for (const id of list ?? []) {
      if (id) ids.add(id)
    }
  }
  return ids.size
}

export function scoreFromDetection(detection) {
  if (detection?.tgnnCalibrating === true) return null
  return peakResidualScore(detection?.isolationScoresByNodeId)
}

export function classifyTrajectory({ score, delta, exposedDelta } = {}) {
  if (delta == null || !Number.isFinite(Number(delta)) || score == null || !Number.isFinite(Number(score))) {
    return TRAJECTORY.STABLE
  }
  const d = Number(delta)
  const s = Number(score)
  const grew = Number(exposedDelta) >= 2
  const escalating = d >= 12
  const rising = d >= 4
  if (s >= 70) {
    if (d <= -12) return TRAJECTORY.STABLE
    if (escalating || grew || d > -12) return TRAJECTORY.CRITICAL
  }
  if (escalating) return TRAJECTORY.ESCALATING
  if (rising) return TRAJECTORY.RISING
  return TRAJECTORY.STABLE
}

function sampleAtOrBefore(samples, tick) {
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const s = samples[i]
    if (Number(s?.tick) <= tick) return s
  }
  return null
}

export function appendRiskSample(history, sample, cap = RISK_HISTORY_CAP) {
  const next = Array.isArray(history) ? history.slice() : []
  next.push(sample)
  if (next.length > cap) return next.slice(next.length - cap)
  return next
}

export function momentumFromHistory(history, { windowTicks = RISK_WINDOW_TICKS, seriesPoints = RISK_SERIES_POINTS } = {}) {
  const samples = Array.isArray(history) ? history : []
  const last = samples[samples.length - 1]
  if (!last) return emptyRiskMomentum()

  const score = last.score == null || !Number.isFinite(Number(last.score)) ? null : Number(last.score)
  const available = score != null
  const exposedCount = Number.isFinite(Number(last.exposedCount)) ? Number(last.exposedCount) : 0
  const scored = samples.filter((s) => s?.score != null && Number.isFinite(Number(s.score)))

  let delta = null
  let exposedDelta = 0
  const tick = Number(last.tick)
  if (available && Number.isFinite(tick) && scored.length >= windowTicks) {
    const baseline = sampleAtOrBefore(samples, tick - windowTicks)
    if (baseline && baseline.score != null && Number.isFinite(Number(baseline.score))) {
      delta = score - Number(baseline.score)
      exposedDelta = exposedCount - (Number(baseline.exposedCount) || 0)
    }
  }

  const series = scored.slice(-seriesPoints).map((s) => ({
    tick: Number(s.tick) || 0,
    score: Number(s.score),
    value: Number(s.score),
  }))

  return {
    score,
    windowTicks,
    delta,
    trajectory: classifyTrajectory({ score, delta, exposedDelta }),
    exposedCount,
    series,
    available,
  }
}

export function formatScoreOver100(score) {
  if (score == null || !Number.isFinite(Number(score))) return '— / 100'
  return `${Math.round(Number(score))} / 100`
}

export function formatMomentumLine(delta, windowTicks = RISK_WINDOW_TICKS) {
  if (delta == null || !Number.isFinite(Number(delta))) return '—'
  const rounded = Math.round(Number(delta))
  const arrow = rounded > 0 ? '↑' : rounded < 0 ? '↓' : '→'
  const signed = rounded > 0 ? `+${rounded}` : String(rounded)
  return `${arrow} ${signed} in last ${windowTicks} sec`
}

export function trajectoryLabel(key) {
  const k = String(key ?? TRAJECTORY.STABLE).toLowerCase()
  if (k === TRAJECTORY.CRITICAL) return 'CRITICAL'
  if (k === TRAJECTORY.ESCALATING) return 'ESCALATING'
  if (k === TRAJECTORY.RISING) return 'RISING'
  return 'STABLE'
}

export function isPlateauAtCeiling(riskMomentum) {
  const rm = riskMomentum ?? {}
  if (rm.available !== true || rm.score == null) return false
  if (Number(rm.score) < 100) return false
  const delta = Number(rm.delta)
  return Number.isFinite(delta) && Math.abs(delta) < 4
}
