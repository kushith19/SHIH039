import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { endpointIntrinsicTrust } from '../infrastructureNode.js'
import { computePeerTrustMetrics } from './features.js'

export const SPREAD_TRUST_CUTOFF = TRUST_CONFIG.spread.trustCutoff

function nodeResistance(endpointId, input, metrics) {
  const ep = input.endpoints.find((e) => e.id === endpointId)
  if (ep?.runtimeState?.quarantined === true) return 100
  const intrinsic = endpointIntrinsicTrust(ep)
  const peerTrust = metrics.get(endpointId)?.peerTrust ?? intrinsic
  return Math.max(intrinsic, peerTrust)
}

function simulateSpreadReach(seeds, firstHopId, adj, input, metrics) {
  const seedSet = new Set(seeds)
  const compromised = new Set(seeds)
  compromised.add(firstHopId)
  const atRiskEdgeIds = []
  const queue = [firstHopId]

  while (queue.length > 0) {
    const u = queue.shift()
    for (const { neighborId: v, edgeId } of adj.get(u) ?? []) {
      if (compromised.has(v)) continue
      if (nodeResistance(v, input, metrics) >= SPREAD_TRUST_CUTOFF) continue
      compromised.add(v)
      atRiskEdgeIds.push(edgeId)
      queue.push(v)
    }
  }

  const atRiskNodeIds = [...compromised].filter((id) => !seedSet.has(id) && id !== firstHopId)
  return {
    score: compromised.size - seedSet.size,
    atRiskNodeIds,
    atRiskEdgeIds,
  }
}

function pickPrimarySpreadTarget(seeds, adj, input, metrics) {
  const seedSet = new Set(seeds)
  let best = null

  for (const seed of seeds) {
    for (const { neighborId: v, edgeId } of adj.get(seed) ?? []) {
      if (seedSet.has(v)) continue
      const reach = simulateSpreadReach(seeds, v, adj, input, metrics)
      const resistance = nodeResistance(v, input, metrics)
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

function collectAlternateSpreadTargets(seeds, primary, adj) {
  const seedSet = new Set(seeds)
  const primaryNodeId = primary?.nodeId ?? null
  const primaryEdgeId = primary?.edgeId ?? null
  const atRiskNodeIds = []
  const atRiskEdgeIds = []
  for (const seed of seeds) {
    for (const { neighborId: v, edgeId } of adj.get(seed) ?? []) {
      if (seedSet.has(v) || v === primaryNodeId || edgeId === primaryEdgeId) continue
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
 * @param {{ input: import('./types.js').DetectionInput, anomalyNodeIds: string[] }} args
 */
export function computeAttackSpread({ input, anomalyNodeIds }) {
  const metrics = computePeerTrustMetrics(input)
  const nodeIds = new Set(input.endpoints.map((e) => e.id))
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
  for (const d of input.dependencies) {
    if (!nodeIds.has(d.source) || !nodeIds.has(d.target)) continue
    if (!adj.has(d.source)) adj.set(d.source, [])
    if (!adj.has(d.target)) adj.set(d.target, [])
    adj.get(d.source).push({ neighborId: d.target, edgeId: d.id })
    adj.get(d.target).push({ neighborId: d.source, edgeId: d.id })
  }

  const primary = pickPrimarySpreadTarget(seeds, adj, input, metrics)
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
  return {
    compromisedNodeIds: [...seeds, primary.nodeId],
    spreadEdgeIds: [primary.edgeId],
    atRiskNodeIds: merged.atRiskNodeIds.filter((id) => !excludeNodes.has(id)),
    atRiskEdgeIds: merged.atRiskEdgeIds.filter((id) => id !== primary.edgeId),
    primarySpreadNodeId: primary.nodeId,
    primarySpreadEdgeId: primary.edgeId,
  }
}
