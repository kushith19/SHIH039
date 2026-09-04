import { TRUST_CONFIG } from './trustConfig.js'
import { activityBandsForContext, normalizeCityContext } from './cityContext.js'
import { GAME_METRIC_KEYS, getTelemetryKeys } from './telemetryKeys.js'

export const DEFAULT_METRIC_KEYS = GAME_METRIC_KEYS

function cfg(config) {
  return config ?? TRUST_CONFIG
}

function epsOf(config) {
  const n = Number(cfg(config).eps)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function clampTrust(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

export function criticalityFromTrust(trust, config = TRUST_CONFIG) {
  const t = Number(trust)
  const bands = config.intrinsic?.fromTrust ?? TRUST_CONFIG.intrinsic.fromTrust
  if (!Number.isFinite(t)) return 'medium'
  for (const band of bands) {
    if (t >= band.min) return band.level
  }
  return 'low'
}

export function applyIntrinsicCaps(base, runtime, config = TRUST_CONFIG) {
  let t = clampTrust(typeof base === 'number' && Number.isFinite(base) ? base : config.intrinsic.fallbackTypeTrust)
  if (runtime?.provenance === 'injected') t = Math.min(t, config.intrinsic.caps.injected)
  if (runtime?.quarantined === true) t = Math.min(t, config.intrinsic.caps.quarantined)
  return t
}

export function intrinsicFromTypeAndCriticality(
  { typeTrust, criticality, runtime },
  config = TRUST_CONFIG
) {
  const w = config.intrinsic.criticalityMix
  const fallback = config.intrinsic.fallbackTypeTrust
  const type =
    typeof typeTrust === 'number' && Number.isFinite(typeTrust) ? typeTrust : fallback
  const key = String(criticality ?? '').toLowerCase()
  const critBaseline =
    config.intrinsic.criticalityBaseline[key] ?? config.intrinsic.criticalityBaseline.medium
  const mixed = (1 - w) * type + w * critBaseline
  return applyIntrinsicCaps(mixed, runtime, config)
}

function countReferenceFor(metricKey, config) {
  const key = metricKey != null ? String(metricKey) : ''
  if (!key) return null
  const md = cfg(config).metricDeviation ?? TRUST_CONFIG.metricDeviation
  const ref = md?.countReference?.[key]
  if (Number.isFinite(Number(ref)) && Number(ref) > 0) return Number(ref)
  return null
}

/**
 * Relative deviation with metric-aware soft floors for low-count channels.
 * @param {{ baselinePps: number, effectivePps: number, metricKey?: string }} args
 */
export function computeDeviationMetrics(
  { baselinePps, effectivePps, metricKey },
  config = TRUST_CONFIG
) {
  const expected = Number(baselinePps) || 0
  const observed = Number(effectivePps) || 0
  const abs = Math.abs(observed - expected)
  if (abs === 0) return { deviationRatio: 0, deviationPercent: 0 }

  const key = metricKey != null ? String(metricKey) : ''
  const md = cfg(config).metricDeviation ?? TRUST_CONFIG.metricDeviation
  const countRef = countReferenceFor(key, config)
  if (countRef != null) {
    const deviationRatio = abs / Math.max(expected, countRef)
    return { deviationRatio, deviationPercent: deviationRatio * 100 }
  }
  if (
    key === 'httpRequestsPerMin' &&
    expected < (Number(md?.httpSmallExpectedMax) || 20)
  ) {
    const ref = Number(md?.httpSmallReference) || 40
    const deviationRatio = abs / Math.max(expected, ref)
    return { deviationRatio, deviationPercent: deviationRatio * 100 }
  }

  const eps = epsOf(config)
  const baseline = Math.max(expected, eps)
  const deviationRatio = abs / baseline
  return { deviationRatio, deviationPercent: deviationRatio * 100 }
}

/**
 * Debug/test helper: per-metric deviation breakdown for one endpoint bag pair.
 */
export function explainTelemetryDeviation(
  expected,
  observed,
  metricKeys = getTelemetryKeys(),
  config = TRUST_CONFIG
) {
  const keys = metricKeys ?? getTelemetryKeys()
  const rows = []
  let maxDeviation = 0
  let dominantMetric = null
  for (const key of keys) {
    const b = expected?.[key]
    const e = observed?.[key]
    if (b == null || e == null) continue
    const { deviationRatio, deviationPercent } = computeDeviationMetrics(
      { baselinePps: b, effectivePps: e, metricKey: key },
      config
    )
    rows.push({
      metric: key,
      expected: Number(b) || 0,
      observed: Number(e) || 0,
      deviationRatio,
      deviationPercent,
    })
    if (deviationRatio >= maxDeviation) {
      maxDeviation = deviationRatio
      dominantMetric = key
    }
  }
  return { maxDeviation, dominantMetric, metrics: rows }
}

export function behavioralScoreFromDeviation(deviationRatio, config = TRUST_CONFIG) {
  const ratio = config.behavioral.fullPenaltyRatio
  const t = Math.min(1, (Number(deviationRatio) || 0) / ratio)
  return clampTrust(100 * (1 - t))
}

export function computeBehavioralTrustComponent({ baselinePps, effectivePps }, config = TRUST_CONFIG) {
  const { deviationRatio } = computeDeviationMetrics({ baselinePps, effectivePps }, config)
  return behavioralScoreFromDeviation(deviationRatio, config)
}

export function activityBand(deviationRatio, config = TRUST_CONFIG, cityContext) {
  const r = Number(deviationRatio) || 0
  const { normalMax, elevatedMax } = cityContext
    ? activityBandsForContext(cityContext, config)
    : config.behavioral.activityBands
  if (r < normalMax) return 'normal'
  if (r < elevatedMax) return 'elevated'
  return 'extreme'
}

export function maxMetricDeviation(baseline, effective, metricKeys = getTelemetryKeys(), config = TRUST_CONFIG) {
  let max = 0
  const keys = metricKeys ?? getTelemetryKeys()
  for (const key of keys) {
    const b = baseline?.[key]
    const e = effective?.[key]
    if (b == null || e == null) continue
    const { deviationRatio } = computeDeviationMetrics(
      { baselinePps: b, effectivePps: e, metricKey: key },
      config
    )
    max = Math.max(max, deviationRatio)
  }
  return max
}

export function behavioralFromMetrics(
  baseline,
  effective,
  metricKeys = getTelemetryKeys(),
  config = TRUST_CONFIG,
  cityContext
) {
  let worst = 100
  let maxDeviation = 0
  const keys = metricKeys ?? getTelemetryKeys()
  for (const key of keys) {
    const b = baseline?.[key]
    const e = effective?.[key]
    if (b == null || e == null) continue
    const { deviationRatio } = computeDeviationMetrics(
      { baselinePps: b, effectivePps: e, metricKey: key },
      config
    )
    maxDeviation = Math.max(maxDeviation, deviationRatio)
    worst = Math.min(worst, behavioralScoreFromDeviation(deviationRatio, config))
  }
  const expectedBand = cityContext ? normalizeCityContext(cityContext, config) : 'normal'
  return {
    score: worst,
    maxDeviation,
    expectedBand,
    observedBand: activityBand(maxDeviation, config, cityContext),
  }
}

/**
 * @param {{
 *   role: 'upstream' | 'downstream'
 *   edgeEffective: number
 *   edgeBaseline: number
 *   srcPps: number
 *   tgtPps: number
 * }[]} incidents
 */
export function interactionFromIncidents(incidents, config = TRUST_CONFIG) {
  if (!Array.isArray(incidents) || incidents.length === 0) return 100
  const eps = epsOf(config)
  const upW = config.interaction.upstreamWeight
  const downW = config.interaction.downstreamWeight
  const contractRatio = config.interaction.contractPenaltyRatio

  let weighted = 0
  let weightSum = 0
  for (const inc of incidents) {
    const cap = Math.max(eps, Math.min(Number(inc.srcPps) || 0, Number(inc.tgtPps) || 0))
    const a = (Number(inc.edgeEffective) || 0) + eps
    const b = cap + eps
    const volume = (Math.min(a, b) / Math.max(a, b)) * 100
    const { deviationRatio } = computeDeviationMetrics(
      { baselinePps: inc.edgeBaseline, effectivePps: inc.edgeEffective },
      config
    )
    const contract = behavioralScoreFromDeviation(deviationRatio, {
      ...config,
      behavioral: { ...config.behavioral, fullPenaltyRatio: contractRatio },
    })
    const score = Math.min(volume, contract)
    const w = inc.role === 'upstream' ? upW : downW
    weighted += w * score
    weightSum += w
  }
  if (weightSum <= 0) return 100
  return clampTrust(weighted / weightSum)
}

export function localPosture({ intrinsic, behavioral, interaction }, config = TRUST_CONFIG) {
  const { intrinsic: wi, behavioral: wb, interaction: wx } = config.blend
  const sum = wi + wb + wx
  if (sum <= 0) return clampTrust((intrinsic + behavioral + interaction) / 3)
  return clampTrust((wi * intrinsic + wb * behavioral + wx * interaction) / sum)
}

export function peerFromNeighborLocal(localById, neighborIds, selfId, config = TRUST_CONFIG) {
  const selfLocal = Number(localById.get?.(selfId) ?? localById[selfId]) || 0
  const isolatedUses = cfg(config).peer?.isolatedUses ?? 'local'
  if (!neighborIds || neighborIds.length === 0) {
    return isolatedUses === 'local' ? selfLocal : 0
  }
  const values = []
  for (const id of neighborIds) {
    const v = Number(localById.get?.(id) ?? localById[id])
    if (!Number.isFinite(v)) continue
    values.push(v)
  }
  if (values.length === 0) return isolatedUses === 'local' ? selfLocal : 0
  const aggregate = String(cfg(config).peer?.aggregate ?? 'min').toLowerCase()
  if (aggregate === 'mean') {
    return values.reduce((a, b) => a + b, 0) / values.length
  }
  return Math.min(...values)
}

/**
 * 1-hop peer exposure from real edges. Seeds stay flagged; neighbors are at-risk only.
 * Does not invent topology or residual flags.
 *
 * @param {Array<{ id?: string, source?: string, target?: string }>} edges
 * @param {string[]} anomalyNodeIds
 * @param {Set<string> | string[]} [knownIds]
 * @returns {{ atRiskNodeIds: string[], atRiskEdgeIds: string[] }}
 */
export function peerExposureFromFlags(edges, anomalyNodeIds, knownIds) {
  const seeds = new Set((anomalyNodeIds ?? []).filter(Boolean).map(String))
  const nodeIds = knownIds instanceof Set ? knownIds : new Set((knownIds ?? []).map(String))
  const restrict = nodeIds.size > 0
  const atRiskNodes = new Set()
  const atRiskEdges = []
  const seenEdge = new Set()

  for (const e of edges ?? []) {
    const source = String(e?.source ?? '')
    const target = String(e?.target ?? '')
    if (!source || !target || source === target) continue
    if (restrict && (!nodeIds.has(source) || !nodeIds.has(target))) continue
    const srcSeed = seeds.has(source)
    const tgtSeed = seeds.has(target)
    if (!srcSeed && !tgtSeed) continue
    const edgeId = String(e.id ?? `${source}|${target}`)
    if (!seenEdge.has(edgeId)) {
      seenEdge.add(edgeId)
      atRiskEdges.push(edgeId)
    }
    if (srcSeed && !seeds.has(target)) atRiskNodes.add(target)
    if (tgtSeed && !seeds.has(source)) atRiskNodes.add(source)
  }

  return {
    atRiskNodeIds: [...atRiskNodes].sort(),
    atRiskEdgeIds: atRiskEdges,
  }
}

export function blendTrust(
  { intrinsic, peer, behavioral, interaction },
  config = TRUST_CONFIG
) {
  const w = config.blend
  const raw =
    w.intrinsic * intrinsic +
    w.peer * peer +
    w.behavioral * behavioral +
    w.interaction * interaction
  return Math.round(clampTrust(raw))
}

export function undirectedNeighbors(edges, nodeIds) {
  /** @type {Map<string, Set<string>>} */
  const neighbors = new Map()
  for (const e of edges) {
    const source = e.source
    const target = e.target
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue
    if (!neighbors.has(source)) neighbors.set(source, new Set())
    if (!neighbors.has(target)) neighbors.set(target, new Set())
    neighbors.get(source).add(target)
    neighbors.get(target).add(source)
  }
  return neighbors
}
