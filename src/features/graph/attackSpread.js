import { TRUST_CONFIG } from '@shared/trustConfig.js'
import { getNodeIntrinsicTrust, runtimeStateOf } from './infrastructureNode'
import { computePeerTrustMetrics } from './peerTrust'

/** Structural / class trust below this → deeper multi-hop spread is allowed. */
export const SPREAD_TRUST_CUTOFF = TRUST_CONFIG.spread.trustCutoff

function nodeResistance(nodeId, nodes, metrics) {
  const node = nodes.find((n) => n.id === nodeId)
  if (runtimeStateOf(node?.data).quarantined) return 100
  const intrinsic = getNodeIntrinsicTrust(node?.data)
  const peerTrust = metrics.get(nodeId)?.peerTrust ?? intrinsic
  return Math.max(intrinsic, peerTrust)
}

/**
 * Simulate spread when the attack moves to a single first-hop neighbor, then BFS
 * into lower-resistance assets.
 *
 * @returns {{ score: number, atRiskNodeIds: string[], atRiskEdgeIds: string[] }}
 */
function simulateSpreadReach(seeds, firstHopId, adj, nodes, metrics) {
  const seedSet = new Set(seeds)
  const compromised = new Set(seeds)
  compromised.add(firstHopId)
  const atRiskEdgeIds = []

  const queue = [firstHopId]

  while (queue.length > 0) {
    const u = queue.shift()
    for (const { neighborId: v, edgeId } of adj.get(u) ?? []) {
      if (compromised.has(v)) continue
      if (nodeResistance(v, nodes, metrics) >= SPREAD_TRUST_CUTOFF) continue
      compromised.add(v)
      atRiskEdgeIds.push(edgeId)
      queue.push(v)
    }
  }

  const atRiskNodeIds = [...compromised].filter(
    (id) => !seedSet.has(id) && id !== firstHopId
  )

  return {
    score: compromised.size - seedSet.size,
    atRiskNodeIds,
    atRiskEdgeIds,
  }
}

/**
 * Among direct neighbors of anomaly seeds, pick the one where spread reaches
 * the most downstream nodes (tie-break: lowest trust resistance, then higher degree).
 */
function pickPrimarySpreadTarget(seeds, adj, nodes, metrics) {
  const seedSet = new Set(seeds)
  /** @type {{ nodeId: string, edgeId: string, score: number, resistance: number, degree: number } | null} */
  let best = null

  for (const seed of seeds) {
    for (const { neighborId: v, edgeId } of adj.get(seed) ?? []) {
      if (seedSet.has(v)) continue

      const reach = simulateSpreadReach(seeds, v, adj, nodes, metrics)
      const resistance = nodeResistance(v, nodes, metrics)
      const degree = metrics.get(v)?.degree ?? 0

      if (
        best === null ||
        reach.score > best.score ||
        (reach.score === best.score && resistance < best.resistance) ||
        (reach.score === best.score &&
          resistance === best.resistance &&
          degree > best.degree)
      ) {
        best = {
          nodeId: v,
          edgeId,
          score: reach.score,
          resistance,
          degree,
          atRiskNodeIds: reach.atRiskNodeIds,
          atRiskEdgeIds: reach.atRiskEdgeIds,
        }
      }
    }
  }

  return best
}

/**
 * Direct neighbors of anomaly seeds that are not the chosen primary spread target.
 * These are the other first-hop nodes that could still be attacked.
 */
function collectAlternateSpreadTargets(seeds, primary, adj) {
  const seedSet = new Set(seeds)
  const primaryNodeId = primary?.nodeId ?? null
  const primaryEdgeId = primary?.edgeId ?? null
  /** @type {string[]} */
  const atRiskNodeIds = []
  /** @type {string[]} */
  const atRiskEdgeIds = []

  for (const seed of seeds) {
    for (const { neighborId: v, edgeId } of adj.get(seed) ?? []) {
      if (seedSet.has(v)) continue
      if (v === primaryNodeId) continue
      if (edgeId === primaryEdgeId) continue
      if (!atRiskNodeIds.includes(v)) atRiskNodeIds.push(v)
      if (!atRiskEdgeIds.includes(edgeId)) atRiskEdgeIds.push(edgeId)
    }
  }

  return { atRiskNodeIds, atRiskEdgeIds }
}

function mergeAtRiskLists(...lists) {
  const nodeIds = []
  const edgeIds = []
  for (const list of lists) {
    for (const id of list.atRiskNodeIds ?? []) {
      if (!nodeIds.includes(id)) nodeIds.push(id)
    }
    for (const id of list.atRiskEdgeIds ?? []) {
      if (!edgeIds.includes(id)) edgeIds.push(id)
    }
  }
  return { atRiskNodeIds: nodeIds, atRiskEdgeIds: edgeIds }
}

/**
 * Spread from TGNN anomaly seeds: surfaces only the single neighbor
 * where the attack can propagate the farthest (by simulated downstream reach).
 *
 * @param {{
 *   nodes: import('@xyflow/react').Node[]
 *   edges: import('@xyflow/react').Edge[]
 *   anomalyNodeIds: string[]
 *   peerMetrics?: Map<string, { peerTrust: number, degree: number }>
 *   sim?: import('./peerTrust').HackSim | null
 * }} args
 */
export function computeAttackSpread({ nodes, edges, anomalyNodeIds, peerMetrics, sim }) {
  const metrics = peerMetrics ?? computePeerTrustMetrics(nodes, edges, sim)
  const nodeIds = new Set(nodes.map((n) => n.id))
  const seeds = anomalyNodeIds.filter((id) => nodeIds.has(id))

  if (seeds.length === 0) {
    return {
      compromisedNodeIds: [],
      spreadEdgeIds: [],
      atRiskNodeIds: [],
      atRiskEdgeIds: [],
      primarySpreadNodeId: null,
      primarySpreadEdgeId: null,
    }
  }

  /** @type {Map<string, Array<{ neighborId: string, edgeId: string }>>} */
  const adj = new Map()
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue
    if (!adj.has(e.source)) adj.set(e.source, [])
    if (!adj.has(e.target)) adj.set(e.target, [])
    adj.get(e.source).push({ neighborId: e.target, edgeId: e.id })
    adj.get(e.target).push({ neighborId: e.source, edgeId: e.id })
  }

  const primary = pickPrimarySpreadTarget(seeds, adj, nodes, metrics)

  if (!primary) {
    return {
      compromisedNodeIds: [...seeds],
      spreadEdgeIds: [],
      atRiskNodeIds: [],
      atRiskEdgeIds: [],
      primarySpreadNodeId: null,
      primarySpreadEdgeId: null,
    }
  }

  const alternates = collectAlternateSpreadTargets(seeds, primary, adj)
  const merged = mergeAtRiskLists(
    { atRiskNodeIds: primary.atRiskNodeIds ?? [], atRiskEdgeIds: primary.atRiskEdgeIds ?? [] },
    alternates
  )
  const excludeNodes = new Set([...seeds, primary.nodeId])
  const atRiskNodeIds = merged.atRiskNodeIds.filter((id) => !excludeNodes.has(id))
  const atRiskEdgeIds = merged.atRiskEdgeIds.filter((id) => id !== primary.edgeId)

  return {
    compromisedNodeIds: [...seeds, primary.nodeId],
    spreadEdgeIds: [primary.edgeId],
    atRiskNodeIds,
    atRiskEdgeIds,
    primarySpreadNodeId: primary.nodeId,
    primarySpreadEdgeId: primary.edgeId,
  }
}
