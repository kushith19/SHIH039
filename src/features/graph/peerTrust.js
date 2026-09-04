import { TRUST_CONFIG } from '@shared/trustConfig.js'
import {
  cityContextOfSim,
  expectedEdgePackets,
  expectedTelemetry,
} from '@shared/cityContext.js'
import {
  behavioralFromMetrics,
  blendTrust,
  computeBehavioralTrustComponent as modelBehavioralComponent,
  computeDeviationMetrics as modelDeviationMetrics,
  interactionFromIncidents,
  localPosture,
  maxMetricDeviation,
  peerFromNeighborLocal,
  undirectedNeighbors,
} from '@shared/trustModel.js'
import { getNodeIntrinsicTrust, runtimeStateOf } from './infrastructureNode'
import { getNodeTgnnResult, runTgnnAnomaly } from './tgnnAnomaly'
import { getTelemetryKeys, ingestedTelemetryPatch, mergeTelemetryBags } from '@shared/telemetryKeys.js'
import {
  getDefaultNodeMetrics,
  mergeMetrics,
  metricsEqual,
  normalizeMetricPatch,
  normalizeMetricSnapshot,
} from './nodeMetrics'

export function nodeIsAttackSeed(nodeId, nodes = [], sim = {}) {
  const ov = sim?.nodeOverrides?.[nodeId]
  if (ov && typeof ov === 'object' && Object.keys(ov).length > 0) return true
  const node = nodes.find((n) => n.id === nodeId)
  if (runtimeStateOf(node?.data).provenance === 'injected') return true
  const seeds = sim?.campaignSeedNodeIds
  return Array.isArray(seeds) && seeds.includes(nodeId)
}

/**
 * @typedef {{
 *   active?: boolean
 *   nodeOverrides?: Record<string, Partial<Record<import('./nodeMetrics').NodeMetricKey, number>>>
 *   edgeOverrides?: Record<string, number>
 *   nodeScenarioBaselines?: Record<string, Partial<Record<import('./nodeMetrics').NodeMetricKey, number>> | number>
 *   edgeScenarioBaselines?: Record<string, number>
 *   simulationTick?: number
 *   cityContext?: string
 *   liveTelemetryByNodeId?: Record<string, Partial<Record<import('./nodeMetrics').NodeMetricKey, number>>>
 * }} HackSim
 */

export const TRUST_SCORE_WEIGHT_INTRINSIC = TRUST_CONFIG.blend.intrinsic
export const TRUST_SCORE_WEIGHT_STRUCTURAL_PEER = TRUST_CONFIG.blend.peer
export const TRUST_SCORE_WEIGHT_BEHAVIORAL = TRUST_CONFIG.blend.behavioral
export const TRUST_SCORE_WEIGHT_INTERACTION = TRUST_CONFIG.blend.interaction
export const BEHAVIORAL_TRUST_FULL_PENALTY_RATIO = TRUST_CONFIG.behavioral.fullPenaltyRatio

export function computeDeviationMetrics({ baselinePps, effectivePps, metricKey }) {
  return modelDeviationMetrics({ baselinePps, effectivePps, metricKey })
}

/**
 * @param {import('@xyflow/react').Node} n
 * @param {HackSim | null | undefined} sim
 */
export function getNodeBaselineMetrics(n, sim) {
  const live = getDefaultNodeMetrics(n)
  if (sim?.active !== true) return live
  const locked = sim.nodeScenarioBaselines?.[n.id]
  if (locked !== undefined) {
    return normalizeMetricSnapshot(locked, n)
  }
  return live
}

export function getNodeExpectedMetrics(n, sim) {
  const baseline = getNodeBaselineMetrics(n, sim)
  if (sim?.active !== true) return baseline
  return expectedTelemetry(baseline, cityContextOfSim(sim), {
    sector: n?.data?.sector,
    type: n?.data?.type,
    id: n?.id,
    tick: sim?.simulationTick,
    cityEndpointId: n?.data?.cityEndpointId,
  })
}

/**
 * @param {import('@xyflow/react').Node} n
 * @param {HackSim | null | undefined} sim
 */
export function getNodeEffectiveMetrics(n, sim) {
  const expected = getNodeExpectedMetrics(n, sim)
  const ingested = ingestedTelemetryPatch(sim?.liveTelemetryByNodeId?.[n.id])
  const live = Object.keys(ingested).length ? mergeTelemetryBags(expected, ingested) : expected
  if (sim?.active !== true) return live
  const o = normalizeMetricPatch(sim.nodeOverrides?.[n.id])
  return mergeMetrics(live, o)
}

/** Scenario baseline PPS for a node. */
export function getNodeBaselinePps(n, sim) {
  return getNodeBaselineMetrics(n, sim).packetsPerSecond
}

/** Live effective PPS for a node (attack override when active). */
export function getNodeEffectivePps(n, sim) {
  return getNodeEffectiveMetrics(n, sim).packetsPerSecond
}

/**
 * @param {import('@xyflow/react').Edge} e
 * @param {HackSim | null | undefined} sim
 */
export function getEdgeBaselinePps(e, sim) {
  const live = Number.isFinite(Number(e.data?.packetsPerSecond))
    ? Number(e.data.packetsPerSecond)
    : 0
  if (sim?.active !== true) return live
  const locked = sim.edgeScenarioBaselines?.[e.id]
  if (locked !== undefined && Number.isFinite(locked)) return locked
  return live
}

export function getEdgeExpectedPps(e, sim) {
  const baseline = getEdgeBaselinePps(e, sim)
  if (sim?.active !== true) return baseline
  return expectedEdgePackets(baseline, cityContextOfSim(sim), undefined, {
    tick: sim?.simulationTick,
    edgeId: e?.id,
  })
}

/**
 * @param {import('@xyflow/react').Edge} e
 * @param {HackSim | null | undefined} sim
 */
export function getEdgeEffectivePps(e, sim) {
  const expected = getEdgeExpectedPps(e, sim)
  if (sim?.active !== true) return expected
  const o = sim.edgeOverrides?.[e.id]
  if (o !== undefined && Number.isFinite(o)) return o
  return expected
}

/**
 * @param {{ baselinePps: number, effectivePps: number }} args
 * @returns {number} 0–100; stable traffic → high, drift → low.
 */
export function computeBehavioralTrustComponent({ baselinePps, effectivePps }) {
  return modelBehavioralComponent({ baselinePps, effectivePps })
}

/**
 * @param {Record<string, number>} baseline
 * @param {Record<string, number>} effective
 */
export function computeBehavioralTrustFromMetrics(baseline, effective) {
  return behavioralFromMetrics(baseline, effective, getTelemetryKeys()).score
}

export function computeBehavioralTrustDetails(baseline, effective) {
  return behavioralFromMetrics(baseline, effective, getTelemetryKeys())
}

function incidentsForNode(nodeId, nodes, edges, sim) {
  const safeSim = sim ?? { active: false }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const nodeIds = new Set(byId.keys())
  const incidents = []
  for (const e of edges) {
    if (e.source !== nodeId && e.target !== nodeId) continue
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue
    const src = byId.get(e.source)
    const tgt = byId.get(e.target)
    if (!src || !tgt) continue
    incidents.push({
      role: e.target === nodeId ? 'upstream' : 'downstream',
      edgeEffective: getEdgeEffectivePps(e, safeSim),
      edgeBaseline: getEdgeExpectedPps(e, safeSim),
      srcPps: getNodeEffectivePps(src, safeSim),
      tgtPps: getNodeEffectivePps(tgt, safeSim),
    })
  }
  return incidents
}

/**
 * Dependency consistency: volume vs endpoints, and observed vs expected link contract.
 */
export function computeInteractionTrustComponent(nodeId, nodes, edges, sim) {
  return interactionFromIncidents(incidentsForNode(nodeId, nodes, edges, sim))
}

/**
 * User-facing reliability score from class reputation, peer topology, traffic stability, and links.
 * Anomaly detection uses TGNN via `evaluateTrustAnomaly`.
 * @param {object | undefined} row
 * @param {import('@xyflow/react').Node | undefined} node
 * @param {HackSim | null | undefined} sim
 */
export function trustModelFromGraphRow(row, node, sim) {
  const safeSim = sim ?? { active: false }
  const intrinsicTrust = row?.intrinsicTrust ?? getNodeIntrinsicTrust(node?.data)
  const peerTrustStructural = row?.peerTrust ?? intrinsicTrust
  const behavioralComponent = row?.behavioralComponent ?? 100
  const interactionComponent = row?.interactionComponent ?? 100
  const degree = row?.degree ?? 0
  const baselinePps = node ? getNodeBaselinePps(node, safeSim) : 0
  const effectivePps = node ? getNodeEffectivePps(node, safeSim) : 0
  const trustScore = blendTrust({
    intrinsic: intrinsicTrust,
    peer: peerTrustStructural,
    behavioral: behavioralComponent,
    interaction: interactionComponent,
  })

  return {
    trustScore,
    peerTrust: peerTrustStructural,
    peerTrustStructural,
    behavioralComponent,
    interactionComponent,
    intrinsicTrust,
    degree,
    baselinePps,
    effectivePps,
    expectedActivity: row?.expectedActivity ?? 'normal',
    observedActivity: row?.observedActivity ?? 'normal',
  }
}

/**
 * One full-graph trust pass for all nodes (use this instead of per-node `computeTrustScore`).
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @param {HackSim | null | undefined} sim
 * @returns {Record<string, ReturnType<typeof trustModelFromGraphRow>>}
 */
export function buildTrustByNodeId(nodes, edges, sim) {
  const safeSim = sim ?? { active: false }
  const graph = computeGraphTrustState(nodes, edges, safeSim)
  /** @type {Record<string, ReturnType<typeof trustModelFromGraphRow>>} */
  const byId = {}
  for (const n of nodes) {
    byId[n.id] = trustModelFromGraphRow(graph.byId.get(n.id), n, safeSim)
  }
  return byId
}

export function computeTrustScore(nodeId, nodes, edges, sim) {
  const byId = buildTrustByNodeId(nodes, edges, sim)
  const node = nodes.find((x) => x.id === nodeId)
  return byId[nodeId] ?? trustModelFromGraphRow(undefined, node, sim)
}

/**
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @returns {Map<string, { peerTrust: number, degree: number }>}
 */
/**
 * Two-pass graph trust: local posture (intrinsic + behavioural + interaction),
 * then peer = mean of neighbors' local posture.
 *
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @param {HackSim | null | undefined} sim
 */
export function computeGraphTrustState(nodes, edges, sim) {
  const safeSim = sim ?? { active: false }
  const nodeIds = new Set(nodes.map((n) => n.id))
  const neighbors = undirectedNeighbors(edges, nodeIds)
  /** @type {Map<string, number>} */
  const localById = new Map()
  /** @type {Map<string, object>} */
  const parts = new Map()

  for (const n of nodes) {
    const intrinsicTrust = getNodeIntrinsicTrust(n.data)
    const expected = getNodeExpectedMetrics(n, safeSim)
    const effective = getNodeEffectiveMetrics(n, safeSim)
    const cityContext = safeSim.active === true ? cityContextOfSim(safeSim) : undefined
    const behavioral = behavioralFromMetrics(
      expected,
      effective,
      getTelemetryKeys(),
      TRUST_CONFIG,
      cityContext
    )
    const interactionComponent = computeInteractionTrustComponent(
      n.id,
      nodes,
      edges,
      safeSim
    )
    const local = localPosture({
      intrinsic: intrinsicTrust,
      behavioral: behavioral.score,
      interaction: interactionComponent,
    })
    localById.set(n.id, local)
    parts.set(n.id, {
      intrinsicTrust,
      behavioralComponent: behavioral.score,
      interactionComponent,
      local,
      expectedActivity: behavioral.expectedBand,
      observedActivity: behavioral.observedBand,
      maxDeviation: behavioral.maxDeviation,
    })
  }

  /** @type {Map<string, { peerTrust: number, degree: number }>} */
  const metrics = new Map()
  /** @type {Map<string, object>} */
  const byId = new Map()

  for (const n of nodes) {
    const peerSet = neighbors.get(n.id)
    const neighborIds = peerSet ? [...peerSet] : []
    const degree = neighborIds.length
    const part = parts.get(n.id)
    const peerTrust = peerFromNeighborLocal(localById, neighborIds, n.id)
    metrics.set(n.id, {
      peerTrust,
      degree,
      local: part.local,
      behavioralComponent: part.behavioralComponent,
      interactionComponent: part.interactionComponent,
      intrinsicTrust: part.intrinsicTrust,
    })
    byId.set(n.id, { ...part, peerTrust, degree })
  }

  return { metrics, byId, localById }
}

export function computePeerTrustMetrics(nodes, edges, sim) {
  return computeGraphTrustState(nodes, edges, sim).metrics
}

/**
 * Anomaly detection via TGNN (compromise scenario only).
 * @param {{
 *   nodeId: string
 *   nodes: import('@xyflow/react').Node[]
 *   edges: import('@xyflow/react').Edge[]
 *   sim?: HackSim | null
 *   baselinePps: number
 *   effectivePps: number
 *   isolationScoresByNodeId?: Record<string, number>
 * }} args
 */
export function evaluateTrustAnomaly({
  nodeId,
  nodes,
  edges,
  sim,
  baselinePps,
  effectivePps,
  isolationScoresByNodeId,
}) {
  const node = nodes.find((n) => n.id === nodeId)
  const expectedMetrics = node
    ? getNodeExpectedMetrics(node, sim ?? { active: false })
    : { packetsPerSecond: baselinePps }
  const effectiveMetrics = node
    ? getNodeEffectiveMetrics(node, sim ?? { active: false })
    : { packetsPerSecond: effectivePps }
  const maxDeviation = maxMetricDeviation(expectedMetrics, effectiveMetrics, getTelemetryKeys())
  const deviationRatio = maxDeviation
  const deviationPercent = deviationRatio * 100

  const { isolationScore, isAnomaly } =
    sim?.active === true
      ? getNodeTgnnResult(nodeId, nodes, edges, sim, isolationScoresByNodeId)
      : { isolationScore: 0.5, isAnomaly: false }

  return {
    deviationRatio,
    deviationPercent,
    isolationScore,
    isAnomaly,
    trustAnomaly: isAnomaly,
  }
}

/** Critical UI (red): TGNN anomaly. */
export function isScenarioCritical({ isAnomaly, trustAnomaly }) {
  return isAnomaly === true || trustAnomaly === true
}

/** User-facing "anomaly" = TGNN flagged. */
export function isAnomalyDetected(anomaly) {
  return anomaly?.isAnomaly === true || anomaly?.trustAnomaly === true
}

/**
 * Nodes / edges currently in an anomaly state under the compromise scenario.
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 * @param {{ active: boolean, nodeOverrides?: Record<string, number>, edgeOverrides?: Record<string, number>, nodeScenarioBaselines?: Record<string, number>, edgeScenarioBaselines?: Record<string, number> }} sim
 */
export function collectActiveAnomalies(nodes, edges, sim) {
  if (!sim?.active) {
    return {
      nodes: [],
      edges: [],
      anomalyNodeIds: [],
      spreadEdgeIds: [],
      compromisedNodeIds: [],
      atRiskNodeIds: [],
      atRiskEdgeIds: [],
      primarySpreadNodeId: null,
      primarySpreadEdgeId: null,
      isolationScoresByNodeId: {},
    }
  }

  const tgnnResult = runTgnnAnomaly(nodes, edges, sim)
  const nodeHits = tgnnResult.nodeResults
    .filter((r) => r.isAnomaly)
    .map((r) => ({
      id: r.id,
      label: r.label,
      isolationScore: r.isolationScore,
      isAnomaly: true,
    }))

  return {
    nodes: nodeHits,
    edges: [],
    anomalyNodeIds: tgnnResult.anomalyNodeIds,
    spreadEdgeIds: [],
    compromisedNodeIds: [...tgnnResult.anomalyNodeIds],
    atRiskNodeIds: [],
    atRiskEdgeIds: [],
    primarySpreadNodeId: null,
    primarySpreadEdgeId: null,
    isolationScoresByNodeId: tgnnResult.isolationScoresByNodeId,
  }
}

/** Any attack-layer value different from match-start baseline (for drift / amber tier). */
export function hasScenarioDrift({ baselinePps, effectivePps, baselineMetrics, effectiveMetrics }) {
  if (baselineMetrics && effectiveMetrics) {
    return !metricsEqual(baselineMetrics, effectiveMetrics)
  }
  return effectivePps !== baselinePps
}

/**
 * @param {{
 *   nodeId: string
 *   nodes: import('@xyflow/react').Node[]
 *   edges: import('@xyflow/react').Edge[]
 *   baselinePps: number
 *   effectivePps: number
 *   sim?: HackSim | null
 * }} args
 */
export function getNodeTrustInsights({
  nodeId,
  nodes,
  edges,
  baselinePps,
  effectivePps,
  sim,
}) {
  const node = nodes.find((n) => n.id === nodeId)
  const nodeData = node?.data
  const metrics = computePeerTrustMetrics(nodes, edges, sim)
  const row = metrics.get(nodeId)
  const peerTrust = row?.peerTrust ?? getNodeIntrinsicTrust(nodeData)
  const degree = row?.degree ?? 0
  const intrinsicTrust = getNodeIntrinsicTrust(nodeData)
  const hasServerScan =
    sim?.active === true &&
    sim?.isolationScoresByNodeId != null &&
    typeof sim.isolationScoresByNodeId === 'object' &&
    Array.isArray(sim.anomalyNodeIds)

  const tgnnResult = hasServerScan
    ? {
        isolationScoresByNodeId: sim.isolationScoresByNodeId,
        anomalyNodeIds: sim.anomalyNodeIds,
      }
    : sim?.active === true
      ? runTgnnAnomaly(nodes, edges, sim)
      : null
  const anomaly = evaluateTrustAnomaly({
    nodeId,
    nodes,
    edges,
    sim,
    baselinePps,
    effectivePps,
    isolationScoresByNodeId: tgnnResult?.isolationScoresByNodeId,
  })

  if (sim?.active === true && Array.isArray(sim.anomalyNodeIds)) {
    const flagged = sim.anomalyNodeIds.includes(nodeId)
    anomaly.isAnomaly = flagged
    anomaly.trustAnomaly = flagged
  }

  const trustModel = computeTrustScore(nodeId, nodes, edges, sim ?? { active: false })

  return {
    intrinsicTrust,
    peerTrust,
    degree,
    trustScore: trustModel.trustScore,
    behavioralComponent: trustModel.behavioralComponent,
    interactionComponent: trustModel.interactionComponent,
    expectedActivity: trustModel.expectedActivity,
    observedActivity: trustModel.observedActivity,
    ...anomaly,
    attackOrigin: nodeIsAttackSeed(nodeId, nodes, sim),
    spreadReached: false,
    atRisk: false,
    onSpreadPath: false,
  }
}
