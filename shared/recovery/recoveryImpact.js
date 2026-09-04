/**
 * Recovery Impact Engine (read-only / counterfactual)
 *
 * Answers: "If the defender resolves this OPEN incident first, what is certain
 * to be addressed, and what downstream exposure may potentially be relieved?"
 *
 * Does NOT answer:
 * - "Which incident caused the other?" (not attack attribution)
 * - "Will dependents automatically restore?" (no cascade recovery)
 *
 * Graph semantics: edge source → target = provider → dependent.
 * Recovery traversal follows source → target (downstream dependents).
 *
 * Exposure sets (peerExposed / propagated) are assessment context only —
 * never treated as confirmed compromise.
 */

import { isActiveResponseIncident } from '../incidentStatus.js'
import { SEVERITY_LEVELS } from '../incidents.js'

/** Central weights for explainable recovery prioritization (heuristic, not optimal). */
export const RECOVERY_IMPACT_WEIGHTS = Object.freeze({
  /** Multiplier for the seed's criticality contribution (certain recovery). */
  certain: 10,
  /** Multiplier for each relief candidate's criticality contribution. */
  relief: 4,
  /**
   * Small leverage for related OPEN incidents whose endpoints sit in this
   * seed's downstream∩exposure context. Does not claim those incidents clear.
   */
  related: 1.5,
  /** Small urgency tie-break — must not dominate relief. */
  severity: 0.5,
  /**
   * Optional simulated/illustrative finance contribution (capped).
   * Never the sole recovery metric.
   */
  finance: 0.15,
  financeCap: 5,
})

/** Existing criticality taxonomy → deterministic numeric contribution. */
export const CRITICALITY_WEIGHT = Object.freeze({
  low: 1,
  medium: 2,
  high: 3.5,
  critical: 5,
})

const SEVERITY_BONUS = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
})

function clampNonNeg(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x < 0) return 0
  return x
}

function round2(n) {
  return Math.round(clampNonNeg(n) * 100) / 100
}

export function criticalityWeight(criticality) {
  const key = String(criticality ?? '').toLowerCase()
  return CRITICALITY_WEIGHT[key] ?? CRITICALITY_WEIGHT.medium
}

export function severityBonus(severity) {
  const key = String(severity ?? '').toLowerCase()
  return SEVERITY_BONUS[key] ?? 0
}

function isOpenIncident(inc) {
  // Shared active-response semantic (open + operator workflow aliases).
  // Cleared/closed/resolved are excluded. Formula unchanged.
  return isActiveResponseIncident(inc)
}

function liveId(inc) {
  return String(inc?.id ?? inc?.liveIncidentId ?? '')
}

function endpointId(inc) {
  return String(inc?.endpointId ?? inc?.affectedNodeId ?? '')
}

function nodeCriticality(node) {
  return node?.data?.criticality ?? node?.criticality ?? 'medium'
}

function nodeLabel(node, fallbackId) {
  const label = node?.data?.label ?? node?.label
  if (label != null && String(label).trim()) return String(label)
  return String(fallbackId)
}

function isQuarantinedNode(node) {
  if (!node) return false
  const rs = node.data?.runtimeState
  return rs?.quarantined === true || node.data?.quarantined === true || node.quarantined === true
}

function hasOverride(overrides, nodeId) {
  const id = String(nodeId ?? '')
  const patch = overrides?.[id]
  if (!patch || typeof patch !== 'object') return false
  return Object.keys(patch).some((k) => patch[k] !== undefined && patch[k] !== null)
}

function exposureNodeSet(incident) {
  const graph = incident?.graphContext && typeof incident.graphContext === 'object' ? incident.graphContext : {}
  const peer = Array.isArray(incident?.peerExposedNodeIds)
    ? incident.peerExposedNodeIds
    : Array.isArray(graph.peerExposedNodeIds)
      ? graph.peerExposedNodeIds
      : []
  const propagated = Array.isArray(incident?.propagatedNodeIds)
    ? incident.propagatedNodeIds
    : Array.isArray(graph.propagatedNodeIds)
      ? graph.propagatedNodeIds
      : []
  return new Set([...peer, ...propagated].map(String).filter(Boolean))
}

/**
 * Directed BFS: provider → dependent (source → target).
 * Returns Map<nodeId, depth>. Does not include the seed. Cycle-safe.
 *
 * @param {Array<{ source?: string, target?: string }>} edges
 * @param {string} seedId
 * @returns {Map<string, number>}
 */
export function directedDownstreamReachable(edges, seedId) {
  const seed = String(seedId ?? '')
  const depths = new Map()
  if (!seed) return depths

  /** @type {Map<string, Set<string>>} */
  const adj = new Map()
  for (const e of edges ?? []) {
    const s = String(e?.source ?? '')
    const t = String(e?.target ?? '')
    if (!s || !t || s === t) continue
    if (!adj.has(s)) adj.set(s, new Set())
    adj.get(s).add(t)
  }

  const queue = [{ id: seed, depth: 0 }]
  const visited = new Set([seed])

  while (queue.length) {
    const cur = queue.shift()
    for (const next of adj.get(cur.id) ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      const depth = cur.depth + 1
      depths.set(next, depth)
      queue.push({ id: next, depth })
    }
  }
  return depths
}

function openIncidentsByEndpoint(incidents) {
  /** @type {Map<string, object>} */
  const map = new Map()
  for (const inc of incidents ?? []) {
    if (!isOpenIncident(inc)) continue
    const ep = endpointId(inc)
    const id = liveId(inc)
    if (!ep || !id) continue
    if (!map.has(ep)) map.set(ep, inc)
  }
  return map
}

function relatedOpenIds() {
  return []
}

function illustrativeFinanceBonus(incident) {
  const fin = incident?.financialContext
  const illus = incident?.illustrativeImpact
  let raw = null
  if (fin && typeof fin === 'object') {
    const cur = Number(fin.currentExposure ?? fin.totalExposure ?? fin.peakExposure)
    if (Number.isFinite(cur) && cur > 0) raw = cur
  }
  if (raw == null && illus && typeof illus === 'object') {
    const v = Number(illus.value ?? illus.index)
    if (Number.isFinite(v) && v > 0) raw = v
  }
  if (raw == null) return { bonus: 0, simulated: false }
  // Compress large currency / index into a small [0, financeCap] contribution.
  const scaled = Math.min(RECOVERY_IMPACT_WEIGHTS.financeCap, Math.log10(1 + raw) * 2)
  return {
    bonus: round2(RECOVERY_IMPACT_WEIGHTS.finance * scaled),
    simulated: true,
  }
}

/**
 * Counterfactual recovery impact for one OPEN incident.
 * Pure: does not mutate room / overrides / quarantine / incidents.
 *
 * @param {{
 *   incident: object,
 *   incidents?: object[],
 *   nodes?: object[],
 *   edges?: object[],
 *   overrides?: Record<string, object> | null,
 *   detection?: object | null,
 *   weights?: Partial<typeof RECOVERY_IMPACT_WEIGHTS>,
 * }} args
 */
export function calculateRecoveryImpact({
  incident,
  incidents = [],
  nodes = [],
  edges = [],
  overrides = null,
  detection = null,
  weights: weightOverrides = null,
} = {}) {
  void detection
  const W = { ...RECOVERY_IMPACT_WEIGHTS, ...(weightOverrides ?? {}) }
  const seed = endpointId(incident)
  const nodesById = new Map((nodes ?? []).map((n) => [String(n.id), n]))
  const overrideMap =
    overrides && typeof overrides === 'object'
      ? overrides
      : {}

  const certainNodeIds = seed ? [seed] : []
  const downstream = directedDownstreamReachable(edges, seed)
  const exposure = exposureNodeSet(incident)
  const openByEndpoint = openIncidentsByEndpoint(incidents)
  const incidentsById = new Map()
  for (const inc of incidents ?? []) {
    const id = liveId(inc)
    if (id) incidentsById.set(id, inc)
  }

  const reliefCandidateIds = []
  const excludedIndependentIds = []
  const excludedQuarantinedIds = []
  const seenExcludedInd = new Set()
  const seenExcludedQ = new Set()

  for (const [nodeId] of downstream) {
    if (!exposure.has(nodeId)) continue

    const node = nodesById.get(nodeId)
    // Seed's own open incident is not "independent compromise" of a dependent.
    const hasOwnOpen = openByEndpoint.has(nodeId) && nodeId !== seed
    const independentBlock = hasOwnOpen || hasOverride(overrideMap, nodeId)

    if (isQuarantinedNode(node)) {
      if (!seenExcludedQ.has(nodeId)) {
        seenExcludedQ.add(nodeId)
        excludedQuarantinedIds.push(nodeId)
      }
      continue
    }

    if (independentBlock) {
      if (!seenExcludedInd.has(nodeId)) {
        seenExcludedInd.add(nodeId)
        excludedIndependentIds.push(nodeId)
      }
      continue
    }

    reliefCandidateIds.push(nodeId)
  }

  reliefCandidateIds.sort((a, b) => a.localeCompare(b))
  excludedIndependentIds.sort((a, b) => a.localeCompare(b))
  excludedQuarantinedIds.sort((a, b) => a.localeCompare(b))

  const relatedOpenIncidentIds = relatedOpenIds()

  // Related open endpoints that sit in downstream∩exposure (pre-exclusion universe).
  const relatedInExposureContext = []
  for (const rid of relatedOpenIncidentIds) {
    const other = incidentsById.get(rid)
    const ep = endpointId(other)
    if (!ep || ep === seed) continue
    if (downstream.has(ep) && exposure.has(ep)) relatedInExposureContext.push(rid)
  }

  // Related open incidents in exposure context may see reduced shared exposure,
  // but remain independently compromised when they have their own incidents.
  const relatedMayEaseCount = relatedInExposureContext.length

  const seedNode = nodesById.get(seed)
  const seedCrit = criticalityWeight(incident?.criticality ?? nodeCriticality(seedNode))
  const certainValue = seed ? seedCrit : 0

  let reliefValue = 0
  let criticalReliefCount = 0
  for (const nid of reliefCandidateIds) {
    const n = nodesById.get(nid)
    const cw = criticalityWeight(nodeCriticality(n))
    reliefValue += cw
    if (String(nodeCriticality(n)).toLowerCase() === 'critical') criticalReliefCount += 1
  }

  const relatedExposureValue = relatedInExposureContext.length
  const sevBonus = severityBonus(incident?.severity)
  const finance = illustrativeFinanceBonus(incident)

  const score = round2(
    W.certain * certainValue +
      W.relief * reliefValue +
      W.related * relatedExposureValue +
      W.severity * sevBonus +
      finance.bonus
  )

  const seedLabel = nodeLabel(seedNode, seed || 'endpoint')
  const headline = seed ? `Resolve ${seedLabel} first` : 'Resolve incident first'

  const reasons = []
  if (seed) {
    const crit = String(incident?.criticality ?? nodeCriticality(seedNode) ?? '').toLowerCase()
    if (crit === 'critical' || crit === 'high') {
      reasons.push(`Directly addresses a ${crit} infrastructure incident`)
    } else {
      reasons.push('Directly addresses the confirmed incident endpoint')
    }
  }
  if (reliefCandidateIds.length > 0) {
    reasons.push(
      `May reduce exposure across ${reliefCandidateIds.length} downstream endpoint${
        reliefCandidateIds.length === 1 ? '' : 's'
      }`
    )
  }
  if (criticalReliefCount > 0) {
    reasons.push(
      `${criticalReliefCount} downstream endpoint${criticalReliefCount === 1 ? ' is' : 's are'} critical`
    )
  }
  if (excludedIndependentIds.length > 0) {
    reasons.push(
      `${excludedIndependentIds.length} related endpoint${
        excludedIndependentIds.length === 1 ? '' : 's'
      } remain independently compromised`
    )
  }
  if (excludedQuarantinedIds.length > 0) {
    reasons.push(
      `${excludedQuarantinedIds.length} downstream endpoint${
        excludedQuarantinedIds.length === 1 ? ' is' : 's are'
      } contained (quarantined), not counted as newly recovered`
    )
  }
  if (reliefCandidateIds.length === 0 && excludedIndependentIds.length === 0) {
    reasons.push('No additional downstream exposure relief candidates under current assessment context')
  }
  if (finance.simulated && finance.bonus > 0) {
    reasons.push('Includes a small simulated/illustrative financial exposure signal')
  }

  return {
    score,
    certainNodeIds,
    reliefCandidateIds,
    excludedIndependentIds,
    excludedQuarantinedIds,
    relatedOpenIncidentIds,
    explanation: {
      headline,
      certain: {
        count: certainNodeIds.length,
        nodes: [...certainNodeIds],
      },
      exposureRelief: {
        count: reliefCandidateIds.length,
        nodes: [...reliefCandidateIds],
        criticalCount: criticalReliefCount,
      },
      relatedMayEase: {
        count: relatedMayEaseCount,
      },
      excludedIndependent: {
        count: excludedIndependentIds.length,
        nodes: [...excludedIndependentIds],
      },
      excludedQuarantined: {
        count: excludedQuarantinedIds.length,
        nodes: [...excludedQuarantinedIds],
      },
      reasons,
      ...(finance.simulated ? { financialSignal: 'simulated' } : {}),
    },
  }
}

/**
 * Attach recoveryImpact + recoveryPriority onto each OPEN incident.
 *
 * Pure w.r.t. room topology/overrides/quarantine — only mutates detection incident fields.
 *
 * @param {object} detection
 * @param {{
 *   nodes?: object[],
 *   edges?: object[],
 *   overrides?: Record<string, object> | null,
 *   hackSimulator?: object | null,
 * }} [roomLike]
 * @returns {object} detection
 */
export function attachRecoveryImpact(detection, roomLike = {}) {
  if (!detection || typeof detection !== 'object') return detection
  const incidents = Array.isArray(detection.incidents) ? detection.incidents : []
  const nodes = roomLike.nodes ?? []
  const edges = roomLike.edges ?? []
  const overrides =
    roomLike.overrides ??
    roomLike.hackSimulator?.nodeOverrides ??
    null

  for (const inc of incidents) {
    if (!isOpenIncident(inc)) {
      continue
    }
    const impact = calculateRecoveryImpact({
      incident: inc,
      incidents,
      nodes,
      edges,
      overrides,
      detection,
    })
    inc.recoveryImpact = impact
    inc.recoveryPriority = impact.score
  }

  return detection
}

export function emptyRecoveryImpact() {
  return {
    score: 0,
    certainNodeIds: [],
    reliefCandidateIds: [],
    excludedIndependentIds: [],
    excludedQuarantinedIds: [],
    relatedOpenIncidentIds: [],
    explanation: {
      headline: 'Resolve incident first',
      certain: { count: 0, nodes: [] },
      exposureRelief: { count: 0, nodes: [], criticalCount: 0 },
      relatedMayEase: { count: 0 },
      excludedIndependent: { count: 0, nodes: [] },
      excludedQuarantined: { count: 0, nodes: [] },
      reasons: [],
    },
  }
}

export { SEVERITY_LEVELS }
