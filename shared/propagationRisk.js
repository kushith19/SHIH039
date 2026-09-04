/**
 * Post-detection propagation / spread ranking.
 *
 * Scores reachable (non-seed) nodes from TGNN-confirmed anomaly seeds using
 * existing behavioral, peer-trust, residual, graph, and hop signals.
 * Does not detect anomalies, mutate trust, or promote incidents.
 */

import { propagateGraphRisk } from './graphPropagation.js'
import { TRUST_CONFIG } from './trustConfig.js'

export const PROPAGATION_RISK_WEIGHTS = Object.freeze({
  behavioral: 0.25,
  peer: 0.25,
  residual: 0.2,
  graph: 0.2,
  hop: 0.1,
})

/** Explicit hop proximity on a 0–100 scale (closer = higher). */
export const HOP_PROXIMITY_BY_DISTANCE = Object.freeze({
  1: 100,
  2: 60,
  3: 30,
})

const DEFAULT_MAX_HOPS = 3

function clamp0100(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function weightsOf(config = TRUST_CONFIG) {
  const w = config?.spread?.riskWeights ?? PROPAGATION_RISK_WEIGHTS
  return {
    behavioral: Number(w.behavioral) || PROPAGATION_RISK_WEIGHTS.behavioral,
    peer: Number(w.peer) || PROPAGATION_RISK_WEIGHTS.peer,
    residual: Number(w.residual) || PROPAGATION_RISK_WEIGHTS.residual,
    graph: Number(w.graph) || PROPAGATION_RISK_WEIGHTS.graph,
    hop: Number(w.hop) || PROPAGATION_RISK_WEIGHTS.hop,
  }
}

function hopTableOf(config = TRUST_CONFIG) {
  return config?.spread?.hopProximity ?? HOP_PROXIMITY_BY_DISTANCE
}

/**
 * Hop proximity risk 0–100. Prefer configured table; else decay-normalized.
 */
export function hopProximityRisk(hop, maxHops = DEFAULT_MAX_HOPS, config = TRUST_CONFIG) {
  const h = Math.max(1, Math.floor(Number(hop) || 1))
  const table = hopTableOf(config)
  if (table[h] != null) return clamp0100(table[h])
  const decay = Number(config?.spread?.decayFactor) > 0 ? Number(config.spread.decayFactor) : 0.5
  const raw = 100 * Math.pow(decay, h)
  const atOne = 100 * decay
  return clamp0100(atOne > 0 ? (raw / atOne) * 100 : 0)
}

/**
 * Graph relationship strength 0–100 from existing directed edges + path.
 * Uses: hop distance, direct seed→candidate edge, fan-in from seed∪reachable set.
 */
export function graphRelationshipRisk({
  hop,
  path,
  edges,
  seedNodeId,
  candidateId,
  reachableIds,
  seedNodeIds,
}) {
  const h = Math.max(1, Math.floor(Number(hop) || 1))
  const hopBase = h === 1 ? 100 : h === 2 ? 65 : 35

  const seed = String(seedNodeId ?? '')
  const cand = String(candidateId ?? '')
  const seedSet = new Set((seedNodeIds ?? [seed]).map(String))
  const upstream = new Set([...(reachableIds ?? []), ...seedSet].map(String))
  upstream.delete(cand)

  let directFromSeed = false
  let fanIn = 0
  for (const e of edges ?? []) {
    const s = String(e?.source ?? '')
    const t = String(e?.target ?? '')
    if (!s || !t || t !== cand) continue
    if (seedSet.has(s)) directFromSeed = true
    if (upstream.has(s)) fanIn += 1
  }

  const directBonus = directFromSeed ? 100 : h === 1 ? 80 : 0
  // Cap fan-in contribution; 1 inbound = ~50, 2+ approaches 100
  const fanInScore = clamp0100(fanIn <= 0 ? 0 : Math.min(100, 40 + fanIn * 30))

  // Path continuity: recorded path from seed to candidate
  const pathOk =
    Array.isArray(path) && path.length >= 2 && String(path[0]) === seed && String(path[path.length - 1]) === cand
  const pathBonus = pathOk ? 100 : 50

  return clamp0100(0.45 * hopBase + 0.3 * directBonus + 0.15 * fanInScore + 0.1 * pathBonus)
}

/**
 * @param {{
 *   behavioralTrust?: number
 *   peerTrust?: number
 *   isolationScore?: number
 *   hop: number
 *   path?: string[]
 *   edges?: Array<{ source: string, target: string }>
 *   seedNodeId: string
 *   candidateId: string
 *   reachableIds?: Iterable<string>
 *   seedNodeIds?: string[]
 *   config?: typeof TRUST_CONFIG
 * }} args
 */
export function scorePropagationCandidate(args) {
  const config = args.config ?? TRUST_CONFIG
  const w = weightsOf(config)

  // behavioralComponent / behavioral.score is trust (100 = normal). Invert to risk.
  // Missing values stay neutral (50) so absence does not dominate ranking.
  const behavioralTrust = Number.isFinite(Number(args.behavioralTrust))
    ? clamp0100(Number(args.behavioralTrust))
    : 50
  const behavioralRisk = clamp0100(100 - behavioralTrust)

  // peerTrust is 0–100 trust from existing peerFromNeighborLocal. Invert to risk.
  // Peer-exposure flags are not added again — neighbor local posture already
  // depresses peerTrust when anomalous neighbors have weak local posture.
  const peerTrust = Number.isFinite(Number(args.peerTrust))
    ? clamp0100(Number(args.peerTrust))
    : 50
  const peerRisk = clamp0100(100 - peerTrust)

  // isolationScore is residual in [0,1] from TGNN (alias field; not IF).
  const residualRisk = clamp0100((Number(args.isolationScore) || 0) * 100)

  const hop = Math.max(1, Math.floor(Number(args.hop) || 1))
  const hopRisk = hopProximityRisk(hop, DEFAULT_MAX_HOPS, config)
  const graphRisk = graphRelationshipRisk({
    hop,
    path: args.path,
    edges: args.edges,
    seedNodeId: args.seedNodeId,
    candidateId: args.candidateId,
    reachableIds: args.reachableIds,
    seedNodeIds: args.seedNodeIds,
  })

  const score =
    w.behavioral * behavioralRisk +
    w.peer * peerRisk +
    w.residual * residualRisk +
    w.graph * graphRisk +
    w.hop * hopRisk

  return {
    nodeId: String(args.candidateId),
    score,
    components: {
      behavioralRisk,
      peerRisk,
      residualRisk,
      graphRelationshipRisk: graphRisk,
      hopProximityRisk: hopRisk,
    },
    hop,
    path: Array.isArray(args.path) ? args.path.map(String) : [],
    seedNodeId: String(args.seedNodeId),
  }
}

/**
 * Deterministic tie-break among scored candidates.
 * 1) higher score  2) lower hop  3) higher graph  4) higher peer risk  5) nodeId
 */
export function comparePropagationAssessments(a, b) {
  const scoreDiff = (Number(b?.score) || 0) - (Number(a?.score) || 0)
  if (scoreDiff !== 0) return scoreDiff
  const hopDiff = (Number(a?.hop) || 99) - (Number(b?.hop) || 99)
  if (hopDiff !== 0) return hopDiff
  const graphDiff =
    (Number(b?.components?.graphRelationshipRisk) || 0) -
    (Number(a?.components?.graphRelationshipRisk) || 0)
  if (graphDiff !== 0) return graphDiff
  const peerDiff =
    (Number(b?.components?.peerRisk) || 0) - (Number(a?.components?.peerRisk) || 0)
  if (peerDiff !== 0) return peerDiff
  return String(a?.nodeId ?? '').localeCompare(String(b?.nodeId ?? ''))
}

export function selectPrimarySpreadAssessment(assessments) {
  const list = (assessments ?? []).filter(Boolean)
  if (!list.length) return null
  return [...list].sort(comparePropagationAssessments)[0]
}

function findPrimarySpreadEdgeId(edges, seedNodeIds, primaryId) {
  if (!primaryId) return null
  const seeds = new Set((seedNodeIds ?? []).map(String))
  const best = String(primaryId)
  const edge = (edges ?? []).find(
    (e) =>
      (seeds.has(String(e?.source ?? '')) && String(e?.target ?? '') === best) ||
      (seeds.has(String(e?.target ?? '')) && String(e?.source ?? '') === best)
  )
  return edge?.id ?? null
}

/**
 * Rank propagation candidates for one or more seeds.
 * Multi-seed: each seed is propagated independently; a candidate reachable from
 * multiple seeds keeps the assessment with the strongest (highest) score.
 *
 * @param {{
 *   edges: Array<{ id?: string, source: string, target: string }>
 *   seedNodeIds: string[]
 *   validNodeIds?: Set<string> | string[]
 *   maxHops?: number
 *   peerMetricsByNodeId: Map<string, { peerTrust?: number, behavioralComponent?: number }> | Record<string, { peerTrust?: number, behavioralComponent?: number }>
 *   isolationScoresByNodeId?: Record<string, number>
 *   config?: typeof TRUST_CONFIG
 * }} opts
 */
export function rankPropagationCandidates(opts) {
  const {
    edges,
    seedNodeIds,
    validNodeIds,
    maxHops = DEFAULT_MAX_HOPS,
    peerMetricsByNodeId,
    isolationScoresByNodeId = {},
    config = TRUST_CONFIG,
  } = opts

  const seeds = [...new Set((seedNodeIds ?? []).map(String).filter(Boolean))]
  const seedSet = new Set(seeds)
  /** @type {Map<string, ReturnType<typeof scorePropagationCandidate>>} */
  const bestByNode = new Map()
  const allPropagated = new Set()
  const bestPaths = {}
  /** @type {Record<string, ReturnType<typeof scorePropagationCandidate>>} */
  const assessmentsBySeedId = {}

  const peerGet = (id) => {
    if (!peerMetricsByNodeId) return null
    if (typeof peerMetricsByNodeId.get === 'function') return peerMetricsByNodeId.get(id)
    return peerMetricsByNodeId[id]
  }

  for (const seed of seeds) {
    const propagation = propagateGraphRisk({
      edges,
      seedNodeIds: [seed],
      validNodeIds,
      maxHops,
      decayFactor: Number(config?.spread?.decayFactor) > 0 ? Number(config.spread.decayFactor) : 0.5,
    })
    const reachable = (propagation.propagatedNodeIds ?? []).filter((id) => !seedSet.has(String(id)))
    for (const id of reachable) allPropagated.add(id)

    let bestForSeed = null
    for (const candidateId of reachable) {
      const path = propagation.propagationPaths?.[candidateId] ?? [seed, candidateId]
      const hop = Math.max(1, path.length - 1)
      const metrics = peerGet(candidateId) ?? {}
      const assessment = scorePropagationCandidate({
        candidateId,
        seedNodeId: seed,
        seedNodeIds: seeds,
        hop,
        path,
        edges,
        reachableIds: reachable,
        behavioralTrust: metrics.behavioralComponent,
        peerTrust: metrics.peerTrust,
        isolationScore: isolationScoresByNodeId[candidateId],
        config,
      })
      const prev = bestByNode.get(assessment.nodeId)
      if (!prev || comparePropagationAssessments(assessment, prev) < 0) {
        bestByNode.set(assessment.nodeId, assessment)
        bestPaths[assessment.nodeId] = assessment.path
      }
      if (!bestForSeed || comparePropagationAssessments(assessment, bestForSeed) < 0) {
        bestForSeed = assessment
      }
    }
    if (bestForSeed) assessmentsBySeedId[seed] = bestForSeed
  }

  const assessments = [...bestByNode.values()]
  const primary = selectPrimarySpreadAssessment(assessments)
  const propagationRiskByNode = {}
  for (const a of assessments) {
    propagationRiskByNode[a.nodeId] = a.score
  }

  const assessmentsByNodeId = {}
  for (const a of assessments) assessmentsByNodeId[a.nodeId] = a

  return {
    propagatedNodeIds: [...allPropagated].sort(),
    propagationPaths: bestPaths,
    propagationRiskByNode,
    assessmentsByNodeId,
    /** Per-seed best assessment (for sticky lock creation; ranking formula unchanged). */
    assessmentsBySeedId,
    primarySpreadAssessment: primary,
    primarySpreadNodeId: primary?.nodeId ?? null,
    primarySpreadEdgeId: findPrimarySpreadEdgeId(edges, seeds, primary?.nodeId ?? null),
  }
}
