import { TRUST_CONFIG } from './trustConfig.js'
import {
  behavioralFromMetrics,
  computeDeviationMetrics,
  interactionFromIncidents,
  intrinsicFromTypeAndCriticality,
  localPosture,
  maxMetricDeviation,
  peerFromNeighborLocal,
  undirectedNeighbors,
} from './trustModel.js'
import { getTelemetryKeys } from './telemetryKeys.js'

export const BASE_CITY_FEATURE_KEYS = Object.freeze([
  'telemetryDeviation',
  'behavioralDeviation',
  'runtimeRisk',
  'intrinsicTrust',
  'peerTrust',
  'interactionTrust',
  'criticality',
  'inDegree',
  'outDegree',
  'neighborRisk',
  'upstreamStress',
  'downstreamStress',
  'activityDeviation',
  'contextLoad',
])

/** Frozen encoder input. YAML metric names must not resize the checkpoint. */
export const CITY_FEATURE_KEYS = BASE_CITY_FEATURE_KEYS

/** @deprecated Kept so overlays do not explode W_IN. Encoder stays at 14 channels. */
export function setCityYamlFeatureKeys(_names) {
  return CITY_FEATURE_KEYS
}

const CRITICALITY_NORM = Object.freeze({
  low: 0,
  medium: 1 / 3,
  high: 2 / 3,
  critical: 1,
})

function clamp01(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function logNorm(ratio) {
  return clamp01(Math.log10(1 + Math.max(0, Number(ratio) || 0)) / 2)
}

function mean(values) {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function telemetryBag(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const key of getTelemetryKeys()) {
    const n = Number(src[key])
    out[key] = Number.isFinite(n) && n > 0 ? n : src[key] == null ? undefined : 0
  }
  return out
}

function directedDegrees(endpoints, dependencies) {
  const ids = new Set(endpoints.map((ep) => ep.id))
  const inDegree = new Map()
  const outDegree = new Map()
  for (const ep of endpoints) {
    inDegree.set(ep.id, 0)
    outDegree.set(ep.id, 0)
  }
  for (const d of dependencies) {
    if (!ids.has(d.source) || !ids.has(d.target) || d.source === d.target) continue
    outDegree.set(d.source, (outDegree.get(d.source) ?? 0) + 1)
    inDegree.set(d.target, (inDegree.get(d.target) ?? 0) + 1)
  }
  return { inDegree, outDegree }
}

function incidentsFor(endpointId, state, ppsById) {
  const ids = new Set(state.endpoints.map((e) => e.id))
  const incidents = []
  for (const d of state.dependencies) {
    if (d.source !== endpointId && d.target !== endpointId) continue
    if (!ids.has(d.source) || !ids.has(d.target)) continue
    incidents.push({
      role: d.target === endpointId ? 'upstream' : 'downstream',
      edgeEffective: Number(d.packetsPerSecond) || 0,
      edgeBaseline: Number(d.expectedPacketsPerSecond) || 0,
      srcPps: ppsById.get(d.source) ?? 0,
      tgtPps: ppsById.get(d.target) ?? 0,
    })
  }
  return incidents
}

/** Metric/graph only. Game flags (quarantine, injected, override) must not enter the encoder. */
function runtimeRiskOf() {
  return 0
}

function contextLoadOf(expected, baseline) {
  const base = Math.max(1, Number(baseline?.packetsPerSecond) || 0)
  const exp = Math.max(0, Number(expected?.packetsPerSecond) || 0)
  return clamp01(exp / base / 3)
}

function stressOf(incidents, role) {
  const subset = incidents.filter((inc) => inc.role === role)
  if (!subset.length) return 0
  return mean(
    subset.map((inc) =>
      logNorm(
        computeDeviationMetrics({
          baselinePps: inc.edgeBaseline,
          effectivePps: inc.edgeEffective,
        }).deviationRatio
      )
    )
  )
}

/**
 * Index-list adjacency: provider → dependent is source → target.
 * adjIn[i] = providers of i; adjOut[i] = dependents of i.
 *
 * @param {string[]} nodeIds
 * @param {{ source: string, target: string }[]} dependencies
 */
export function directedAdjacency(nodeIds, dependencies) {
  const indexById = new Map(nodeIds.map((id, i) => [id, i]))
  const n = nodeIds.length
  const adjIn = Array.from({ length: n }, () => [])
  const adjOut = Array.from({ length: n }, () => [])
  for (const d of dependencies ?? []) {
    const s = indexById.get(d.source)
    const t = indexById.get(d.target)
    if (s == null || t == null || s === t) continue
    adjOut[s].push(t)
    adjIn[t].push(s)
  }
  return { adjIn, adjOut }
}

/**
 * @param {Record<string, number>} features
 * @returns {number[]}
 */
export function featureObjectToVector(features) {
  return CITY_FEATURE_KEYS.map((k) => clamp01(features?.[k]))
}

/**
 * Extract one city-graph feature frame. Relational channels use a second pass
 * over per-node locals so neighbour risk sees telemetry deviation.
 *
 * @param {{
 *   endpoints: Array<{
 *     id: string
 *     telemetry?: object
 *     expectedTelemetry?: object
 *     baselineTelemetry?: object
 *     criticality?: string
 *     typeTrust?: number
 *     runtimeState?: { provenance?: string, quarantined?: boolean }
 *     attackOverrideActive?: boolean
 *     cityContext?: string
 *   }>
 *   dependencies: Array<{
 *     source: string
 *     target: string
 *     packetsPerSecond?: number
 *     expectedPacketsPerSecond?: number
 *   }>
 * }} graphState
 * @returns {{ nodeIds: string[], X: number[][], rows: Array<{ nodeId: string, features: Record<string, number> }> }}
 */
export function extractCityFeatureFrame(graphState) {
  const endpoints = Array.isArray(graphState?.endpoints) ? graphState.endpoints : []
  const dependencies = Array.isArray(graphState?.dependencies) ? graphState.dependencies : []
  const nodeIds = endpoints.map((ep) => String(ep.id))
  const ids = new Set(nodeIds)
  const neighbors = undirectedNeighbors(dependencies, ids)
  const { inDegree, outDegree } = directedDegrees(endpoints, dependencies)
  const maxIn = Math.max(1, ...inDegree.values())
  const maxOut = Math.max(1, ...outDegree.values())

  const ppsById = new Map(
    endpoints.map((ep) => [ep.id, telemetryBag(ep.telemetry).packetsPerSecond])
  )

  /** @type {Map<string, Record<string, number>>} */
  const locals = new Map()
  const localPostureById = new Map()

  for (const ep of endpoints) {
    const telemetry = telemetryBag(ep.telemetry)
    const expected = telemetryBag(ep.expectedTelemetry ?? ep.telemetry)
    const baseline = telemetryBag(ep.baselineTelemetry ?? expected)
    const cityContext = ep.cityContext
    const behavioral = behavioralFromMetrics(
      expected,
      telemetry,
      getTelemetryKeys(),
      TRUST_CONFIG,
      cityContext
    )
    const incidents = incidentsFor(ep.id, { endpoints, dependencies }, ppsById)
    const interaction = interactionFromIncidents(incidents)
    const intrinsic = intrinsicFromTypeAndCriticality({
      typeTrust: ep.typeTrust,
      criticality: ep.criticality,
      runtime: {},
    })
    const local = localPosture({
      intrinsic,
      behavioral: behavioral.score,
      interaction,
    })
    const telemetryDeviation = logNorm(
      maxMetricDeviation(expected, telemetry, getTelemetryKeys())
    )
    const nodePpsDev = computeDeviationMetrics({
      baselinePps: expected.packetsPerSecond,
      effectivePps: telemetry.packetsPerSecond,
    }).deviationRatio
    const edgeDevs = incidents.map(
      (inc) =>
        computeDeviationMetrics({
          baselinePps: inc.edgeBaseline,
          effectivePps: inc.edgeEffective,
        }).deviationRatio
    )
    locals.set(ep.id, {
      telemetryDeviation,
      behavioralDeviation: clamp01(1 - behavioral.score / 100),
      runtimeRisk: runtimeRiskOf(),
      intrinsicTrust: clamp01(intrinsic / 100),
      interactionTrust: clamp01(interaction / 100),
      criticality: CRITICALITY_NORM[String(ep.criticality ?? '').toLowerCase()] ?? CRITICALITY_NORM.medium,
      inDegree: (inDegree.get(ep.id) ?? 0) / maxIn,
      outDegree: (outDegree.get(ep.id) ?? 0) / maxOut,
      upstreamStress: stressOf(incidents, 'upstream'),
      downstreamStress: stressOf(incidents, 'downstream'),
      activityDeviation: logNorm(Math.max(nodePpsDev, mean(edgeDevs))),
      contextLoad: contextLoadOf(expected, baseline),
    })
    localPostureById.set(ep.id, local)
  }

  const rows = []
  const X = []
  for (const ep of endpoints) {
    const neighborIds = [...(neighbors.get(ep.id) ?? [])]
    const peerTrust = peerFromNeighborLocal(localPostureById, neighborIds, ep.id)
    const neighborDevs = neighborIds
      .map((id) => locals.get(id)?.telemetryDeviation)
      .filter((v) => Number.isFinite(v))
    const features = {
      ...locals.get(ep.id),
      peerTrust: clamp01(peerTrust / 100),
      neighborRisk: neighborDevs.length ? mean(neighborDevs) : locals.get(ep.id)?.telemetryDeviation ?? 0,
    }
    rows.push({ nodeId: ep.id, features })
    X.push(featureObjectToVector(features))
  }

  return { nodeIds, X, rows }
}
