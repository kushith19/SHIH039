/**
 * Graph-aware REAL attack spread eligibility.
 *
 * Assessment (TGNN / peer exposure / propagation risk) only decides which
 * direct downstream neighbors may be offered. Writing an override remains a
 * separate attacker action (spreadAttack).
 *
 * Does not modify detection, trust, or propagation formulas.
 */

/**
 * @param {Array<{ id?: string, source?: string, target?: string }>} edges
 * @param {string} sourceNodeId
 * @param {string} targetNodeId
 * @returns {{ id: string, source: string, target: string } | null}
 */
export function findDirectedDependencyEdge(edges, sourceNodeId, targetNodeId) {
  const source = String(sourceNodeId ?? '')
  const target = String(targetNodeId ?? '')
  if (!source || !target || source === target) return null
  for (const e of edges ?? []) {
    const s = String(e?.source ?? '')
    const t = String(e?.target ?? '')
    if (s === source && t === target) {
      return {
        id: String(e.id ?? `${s}|${t}`),
        source: s,
        target: t,
      }
    }
  }
  return null
}

/**
 * @param {object | null | undefined} hackSimulator
 * @param {string} nodeId
 */
export function hasActiveAttackOverride(hackSimulator, nodeId) {
  const id = String(nodeId ?? '')
  const patch = hackSimulator?.nodeOverrides?.[id]
  if (!patch || typeof patch !== 'object') return false
  return Object.keys(patch).some((k) => patch[k] !== undefined && patch[k] !== null)
}

/**
 * Target is risk-relevant using EXISTING detection assessment fields only.
 * Peer exposure is undirected context; callers still require a directed edge.
 *
 * @param {object | null | undefined} detection
 * @param {string} targetNodeId
 */
export function isRiskRelevantSpreadTarget(detection, targetNodeId) {
  const id = String(targetNodeId ?? '')
  if (!id || !detection) return false
  if (String(detection.primarySpreadNodeId ?? '') === id) return true
  const risk = detection.propagationRiskByNode?.[id]
  if (Number(risk) > 0) return true
  const sets = [
    detection.peerExposedNodeIds,
    detection.propagatedNodeIds,
    detection.atRiskNodeIds,
  ]
  for (const list of sets) {
    if (Array.isArray(list) && list.some((x) => String(x) === id)) return true
  }
  return false
}

function nodeLabel(node) {
  return String(node?.data?.label ?? node?.id ?? '')
}

function isQuarantined(node) {
  return node?.data?.runtimeState?.quarantined === true
}

/**
 * List direct downstream neighbors of an anomalous attacked source that are
 * eligible for a real attack spread (UI + server validation share this).
 *
 * @param {{
 *   nodes?: Array<{ id: string, data?: object }>
 *   edges?: Array<{ id?: string, source?: string, target?: string }>
 *   detection?: object | null
 *   hackSimulator?: object | null
 * }} roomLike
 * @param {string} sourceNodeId
 * @returns {Array<{
 *   nodeId: string
 *   label: string
 *   edgeId: string
 *   peerExposed: boolean
 *   propagationRisk: number | null
 *   highestRiskCandidate: boolean
 * }>}
 */
export function listEligibleSpreadTargets(roomLike, sourceNodeId) {
  const source = String(sourceNodeId ?? '')
  const nodes = roomLike?.nodes ?? []
  const edges = roomLike?.edges ?? []
  const detection = roomLike?.detection ?? null
  const sim = roomLike?.hackSimulator ?? null

  if (!source) return []
  const sourceNode = nodes.find((n) => String(n.id) === source)
  if (!sourceNode) return []
  if (isQuarantined(sourceNode)) return []

  const anomalySet = new Set((detection?.anomalyNodeIds ?? []).map(String))
  if (!anomalySet.has(source)) return []
  if (!hasActiveAttackOverride(sim, source)) return []

  const primary = detection?.primarySpreadNodeId
    ? String(detection.primarySpreadNodeId)
    : null
  const peerSet = new Set((detection?.peerExposedNodeIds ?? []).map(String))

  /** @type {Map<string, { nodeId: string, label: string, edgeId: string, peerExposed: boolean, propagationRisk: number | null, highestRiskCandidate: boolean }>} */
  const byId = new Map()

  for (const e of edges) {
    const s = String(e?.source ?? '')
    const t = String(e?.target ?? '')
    if (s !== source || !t || t === source) continue

    const targetNode = nodes.find((n) => String(n.id) === t)
    if (!targetNode) continue
    if (isQuarantined(targetNode)) continue
    if (hasActiveAttackOverride(sim, t)) continue
    if (anomalySet.has(t)) continue
    if (!isRiskRelevantSpreadTarget(detection, t)) continue

    const edge = findDirectedDependencyEdge(edges, source, t)
    if (!edge) continue

    const riskRaw = detection?.propagationRiskByNode?.[t]
    const propagationRisk = Number.isFinite(Number(riskRaw)) ? Number(riskRaw) : null

    byId.set(t, {
      nodeId: t,
      label: nodeLabel(targetNode),
      edgeId: edge.id,
      peerExposed: peerSet.has(t),
      propagationRisk,
      highestRiskCandidate: primary === t,
    })
  }

  return [...byId.values()].sort((a, b) => {
    if (a.highestRiskCandidate !== b.highestRiskCandidate) {
      return a.highestRiskCandidate ? -1 : 1
    }
    const ra = a.propagationRisk ?? -1
    const rb = b.propagationRisk ?? -1
    if (rb !== ra) return rb - ra
    return a.nodeId.localeCompare(b.nodeId)
  })
}

/**
 * Server-side eligibility check for one hop (does not write overrides).
 *
 * @returns {{ ok: true, edgeId: string } | { ok: false, message: string }}
 */
export function validateSpreadAttack(roomLike, sourceNodeId, targetNodeId) {
  const source = String(sourceNodeId ?? '')
  const target = String(targetNodeId ?? '')
  const nodes = roomLike?.nodes ?? []
  const edges = roomLike?.edges ?? []
  const detection = roomLike?.detection ?? null
  const sim = roomLike?.hackSimulator ?? null

  if (!source || !target) {
    return { ok: false, message: 'Source and target nodes are required' }
  }
  if (source === target) {
    return { ok: false, message: 'Cannot spread an attack to the same node' }
  }

  const sourceNode = nodes.find((n) => String(n.id) === source)
  if (!sourceNode) return { ok: false, message: 'Source node not found' }
  const targetNode = nodes.find((n) => String(n.id) === target)
  if (!targetNode) return { ok: false, message: 'Target node not found' }

  if (isQuarantined(sourceNode)) {
    return { ok: false, message: 'Source is quarantined' }
  }
  if (isQuarantined(targetNode)) {
    return { ok: false, message: 'Target is quarantined' }
  }

  const anomalySet = new Set((detection?.anomalyNodeIds ?? []).map(String))
  if (!anomalySet.has(source)) {
    return { ok: false, message: 'Source is not a confirmed anomaly seed' }
  }
  if (!hasActiveAttackOverride(sim, source)) {
    return { ok: false, message: 'Source has no active attack override' }
  }
  if (hasActiveAttackOverride(sim, target)) {
    return { ok: false, message: 'Target is already under attack' }
  }
  if (anomalySet.has(target)) {
    return { ok: false, message: 'Target is already an anomaly seed' }
  }

  const edge = findDirectedDependencyEdge(edges, source, target)
  if (!edge) {
    return { ok: false, message: 'No directed dependency edge from source to target' }
  }

  if (!isRiskRelevantSpreadTarget(detection, target)) {
    return {
      ok: false,
      message: 'Target is not currently exposed or risk-relevant for spread',
    }
  }

  return { ok: true, edgeId: edge.id }
}
