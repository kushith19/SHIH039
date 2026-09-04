/**
 * Live Correlation Engine
 *
 * Answers: "Which currently OPEN incidents are related?"
 * Does NOT answer: "Which incident caused the other?"
 * Does NOT answer: "Which incident should be resolved first?" (recovery ranking is a later stage)
 *
 * Correlation is triage context only — never attack attribution or confirmed kill-chain.
 * History campaigns (camp-h-*) and historyCorrelation.js remain separate and untouched.
 *
 * Graph semantics: edge source → target = provider → dependent.
 * A directed edge between two incident endpoints is a STRONG relatedness signal,
 * not proof that one incident caused the other.
 */

import { isActiveResponseIncident } from '../incidentStatus.js'

export const LIVE_CORRELATION = Object.freeze({
  temporalWindowMs: 5 * 60 * 1000,
  maxGraphHops: 2,
  minPairScore: 0.35,
  weights: Object.freeze({
    same_node: 1,
    direct_dependency: 0.5,
    temporal_proximity: 0.2,
    graph_proximity: 0.3,
    exposure_overlap: 0.35,
    shared_dependency_context: 0.35,
    evidence_similarity: 0.05,
    historical_relationship: 0.1,
  }),
})

export const REASON_TYPES = Object.freeze({
  SAME_NODE: 'same_node',
  DIRECT_DEPENDENCY: 'direct_dependency',
  TEMPORAL_PROXIMITY: 'temporal_proximity',
  GRAPH_PROXIMITY: 'graph_proximity',
  EXPOSURE_OVERLAP: 'exposure_overlap',
  SHARED_DEPENDENCY_CONTEXT: 'shared_dependency_context',
  EVIDENCE_SIMILARITY: 'evidence_similarity',
  HISTORICAL_RELATIONSHIP: 'historical_relationship',
})

const REASON_LABELS = Object.freeze({
  [REASON_TYPES.SAME_NODE]: 'Same affected endpoint',
  [REASON_TYPES.DIRECT_DEPENDENCY]: 'Direct dependency',
  [REASON_TYPES.TEMPORAL_PROXIMITY]: 'Detected within 5 minutes',
  [REASON_TYPES.GRAPH_PROXIMITY]: 'Nearby in dependency graph',
  [REASON_TYPES.EXPOSURE_OVERLAP]: 'Shared exposure context',
  [REASON_TYPES.SHARED_DEPENDENCY_CONTEXT]: 'Shared dependency context',
  [REASON_TYPES.EVIDENCE_SIMILARITY]: 'Similar detection evidence',
  [REASON_TYPES.HISTORICAL_RELATIONSHIP]: 'Prior recorded relationship',
})

function configOf(overrides = {}) {
  const base = LIVE_CORRELATION
  return {
    temporalWindowMs: Number(overrides.temporalWindowMs ?? base.temporalWindowMs),
    maxGraphHops: Number(overrides.maxGraphHops ?? base.maxGraphHops),
    minPairScore: Number(overrides.minPairScore ?? base.minPairScore),
    weights: { ...base.weights, ...(overrides.weights ?? {}) },
    nowMs: overrides.nowMs,
  }
}

function round4(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.round(Math.max(0, Math.min(1, x)) * 10000) / 10000
}

function fnv1a(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function liveIncidentId(inc) {
  return String(inc?.id ?? inc?.liveIncidentId ?? '')
}

function endpointIdOf(inc) {
  return String(inc?.endpointId ?? inc?.affectedNodeId ?? '')
}

function detectedAtMsOf(inc, nowMs) {
  const fromMs = Number(inc?.detectedAtMs)
  if (Number.isFinite(fromMs) && fromMs > 0) return fromMs
  if (inc?.timestamp != null) {
    const parsed = Date.parse(inc.timestamp)
    if (Number.isFinite(parsed)) return parsed
  }
  return Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
}

function isOpenIncident(inc) {
  // Shared active-response semantic — same population as recovery scoring / planning.
  return isActiveResponseIncident(inc)
}

/**
 * Undirected hop distance for CORRELATION proximity only.
 * Do not use for recovery-impact (recovery must follow directed provider→dependent).
 */
export function undirectedHopDistance(edges, a, b) {
  const start = String(a ?? '')
  const end = String(b ?? '')
  if (!start || !end) return Infinity
  if (start === end) return 0
  const adj = new Map()
  for (const e of edges ?? []) {
    const s = String(e?.source ?? '')
    const t = String(e?.target ?? '')
    if (!s || !t || s === t) continue
    if (!adj.has(s)) adj.set(s, [])
    if (!adj.has(t)) adj.set(t, [])
    adj.get(s).push(t)
    adj.get(t).push(s)
  }
  const q = [[start, 0]]
  const seen = new Set([start])
  while (q.length) {
    const [id, d] = q.shift()
    for (const n of adj.get(id) ?? []) {
      if (seen.has(n)) continue
      if (n === end) return d + 1
      seen.add(n)
      q.push([n, d + 1])
    }
  }
  return Infinity
}

function hasDirectedEdge(edges, a, b) {
  const sa = String(a)
  const sb = String(b)
  for (const e of edges ?? []) {
    const s = String(e?.source ?? '')
    const t = String(e?.target ?? '')
    if (s === sa && t === sb) return true
  }
  return false
}

function peerSet(inc) {
  const graph = inc?.graphContext && typeof inc.graphContext === 'object' ? inc.graphContext : {}
  const list = Array.isArray(inc?.peerExposedNodeIds)
    ? inc.peerExposedNodeIds
    : Array.isArray(graph.peerExposedNodeIds)
      ? graph.peerExposedNodeIds
      : []
  return new Set(list.map(String).filter(Boolean))
}

function propagatedSet(inc) {
  const graph = inc?.graphContext && typeof inc.graphContext === 'object' ? inc.graphContext : {}
  const list = Array.isArray(inc?.propagatedNodeIds)
    ? inc.propagatedNodeIds
    : Array.isArray(graph.propagatedNodeIds)
      ? graph.propagatedNodeIds
      : []
  return new Set(list.map(String).filter(Boolean))
}

function exposureSet(inc) {
  return new Set([...peerSet(inc), ...propagatedSet(inc)])
}

function evidenceCodeSet(inc) {
  const codes = new Set()
  for (const ev of inc?.evidence ?? []) {
    const code = String(ev?.code ?? '').trim()
    if (code) codes.add(code)
  }
  return codes
}

function typeSet(inc) {
  const types = new Set()
  const primary = String(inc?.detectionType ?? inc?.incidentType ?? '')
    .trim()
    .toLowerCase()
  if (primary) types.add(primary)
  for (const t of inc?.detectionTypes ?? []) {
    const s = String(t ?? '')
      .trim()
      .toLowerCase()
    if (s) types.add(s)
  }
  return types
}

function setOverlap(a, b) {
  let n = 0
  for (const id of a) {
    if (b.has(id)) n += 1
  }
  return n
}

function makeReason(type, detail = null) {
  return {
    type,
    label: REASON_LABELS[type] ?? String(type),
    ...(detail != null ? { detail } : {}),
  }
}

function historicalPairKey(idA, idB) {
  return idA <= idB ? `${idA}|${idB}` : `${idB}|${idA}`
}

/**
 * Build optional historical pair keys from relatedIncidents / explicit pairs.
 * Weak prior only — never source of truth for live groups.
 */
export function historicalRelationshipKeys(incidents = [], explicitPairs = []) {
  const keys = new Set()
  for (const pair of explicitPairs ?? []) {
    const a = String(pair?.incidentAId ?? pair?.a ?? '')
    const b = String(pair?.incidentBId ?? pair?.b ?? '')
    if (a && b && a !== b) keys.add(historicalPairKey(a, b))
  }
  for (const inc of incidents ?? []) {
    const id = liveIncidentId(inc)
    if (!id) continue
    for (const rel of inc?.relatedIncidents ?? []) {
      const other = String(rel?.liveIncidentId ?? rel?.incidentId ?? rel?.id ?? '')
      if (!other || other === id) continue
      // Prefer matching by live id when present among open set later.
      keys.add(historicalPairKey(id, other))
      if (rel?.liveIncidentId && rel?.incidentId) {
        keys.add(historicalPairKey(id, String(rel.liveIncidentId)))
      }
    }
  }
  return keys
}

/**
 * Pairwise live correlation. Related ≠ caused.
 *
 * @returns {{
 *   incidentAId: string,
 *   incidentBId: string,
 *   score: number,
 *   linked: boolean,
 *   reasons: Array<{ type: string, label: string, detail?: string }>
 * }}
 */
export function correlateLiveIncidentPair(rawA, rawB, edges = [], overrides = {}) {
  const cfg = configOf(overrides)
  const idA = liveIncidentId(rawA)
  const idB = liveIncidentId(rawB)
  const nodeA = endpointIdOf(rawA)
  const nodeB = endpointIdOf(rawB)
  const [first, second] = idA <= idB ? [rawA, rawB] : [rawB, rawA]
  const incidentAId = liveIncidentId(first)
  const incidentBId = liveIncidentId(second)
  const endpointA = endpointIdOf(first)
  const endpointB = endpointIdOf(second)

  const reasons = []
  let score = 0
  const w = cfg.weights

  const sameNode = Boolean(endpointA && endpointB && endpointA === endpointB)
  if (sameNode) {
    score += w.same_node
    reasons.push(makeReason(REASON_TYPES.SAME_NODE))
  }

  const directed =
    !sameNode &&
    endpointA &&
    endpointB &&
    (hasDirectedEdge(edges, endpointA, endpointB) || hasDirectedEdge(edges, endpointB, endpointA))
  if (directed) {
    score += w.direct_dependency
    reasons.push(makeReason(REASON_TYPES.DIRECT_DEPENDENCY))
  }

  const tA = detectedAtMsOf(first, cfg.nowMs)
  const tB = detectedAtMsOf(second, cfg.nowMs)
  const temporal = Number.isFinite(tA) && Number.isFinite(tB) && Math.abs(tA - tB) <= cfg.temporalWindowMs
  if (temporal) {
    score += w.temporal_proximity
    reasons.push(makeReason(REASON_TYPES.TEMPORAL_PROXIMITY))
  }

  let hops = Infinity
  if (!sameNode && endpointA && endpointB) {
    hops = undirectedHopDistance(edges, endpointA, endpointB)
  }
  const graphNear = Number.isFinite(hops) && hops >= 1 && hops <= cfg.maxGraphHops
  // Direct edge already covers hop=1 with a stronger signal; still allow proximity for hop=2,
  // and for hop=1 when somehow no directed flag (should not happen with room.edges).
  if (graphNear && !directed) {
    score += w.graph_proximity
    reasons.push(
      makeReason(REASON_TYPES.GRAPH_PROXIMITY, hops === 1 ? '1 hop' : `${hops} hops`)
    )
  } else if (graphNear && directed && hops > 1) {
    // unreachable when directed implies hops===1, kept for clarity
    score += w.graph_proximity
    reasons.push(makeReason(REASON_TYPES.GRAPH_PROXIMITY, `${hops} hops`))
  }

  const expA = exposureSet(first)
  const expB = exposureSet(second)
  const overlap = setOverlap(expA, expB)
  if (overlap > 0) {
    score += w.exposure_overlap
    reasons.push(makeReason(REASON_TYPES.EXPOSURE_OVERLAP, `${overlap} shared node(s)`))
  }

  const sharedCtx =
    !sameNode &&
    ((endpointA && (expB.has(endpointA) || peerSet(second).has(endpointA) || propagatedSet(second).has(endpointA))) ||
      (endpointB && (expA.has(endpointB) || peerSet(first).has(endpointB) || propagatedSet(first).has(endpointB))))
  if (sharedCtx) {
    score += w.shared_dependency_context
    reasons.push(makeReason(REASON_TYPES.SHARED_DEPENDENCY_CONTEXT))
  }

  const typesA = typeSet(first)
  const typesB = typeSet(second)
  let typeHit = false
  for (const t of typesA) {
    if (typesB.has(t)) {
      typeHit = true
      break
    }
  }
  const codesA = evidenceCodeSet(first)
  const codesB = evidenceCodeSet(second)
  const codeHit = setOverlap(codesA, codesB) > 0
  if (typeHit || codeHit) {
    score += w.evidence_similarity
    reasons.push(makeReason(REASON_TYPES.EVIDENCE_SIMILARITY))
  }

  const histKeys = overrides.historicalKeys instanceof Set ? overrides.historicalKeys : null
  if (histKeys?.has(historicalPairKey(incidentAId, incidentBId))) {
    score += w.historical_relationship
    reasons.push(makeReason(REASON_TYPES.HISTORICAL_RELATIONSHIP))
  } else if (histKeys && (nodeA || nodeB)) {
    // also allow keys built from persistent ids present on relatedIncidents
    for (const rel of [...(first.relatedIncidents ?? []), ...(second.relatedIncidents ?? [])]) {
      const otherLive = String(rel?.liveIncidentId ?? '')
      const otherPersisted = String(rel?.incidentId ?? rel?.id ?? '')
      if (
        (otherLive && histKeys.has(historicalPairKey(incidentAId, otherLive))) ||
        (otherPersisted && histKeys.has(historicalPairKey(incidentAId, otherPersisted))) ||
        (otherLive && histKeys.has(historicalPairKey(incidentBId, otherLive))) ||
        (otherPersisted && histKeys.has(historicalPairKey(incidentBId, otherPersisted)))
      ) {
        score += w.historical_relationship
        reasons.push(makeReason(REASON_TYPES.HISTORICAL_RELATIONSHIP))
        break
      }
    }
  }

  score = round4(Math.min(1, score))

  const structural =
    sameNode ||
    directed ||
    graphNear ||
    overlap > 0 ||
    sharedCtx
  const linked = structural && score >= cfg.minPairScore

  return {
    incidentAId,
    incidentBId,
    score,
    linked,
    reasons,
  }
}

function unionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]))
  const find = (x) => {
    const p = parent.get(x)
    if (p !== x) parent.set(x, find(p))
    return parent.get(x)
  }
  const unite = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    if (ra < rb) parent.set(rb, ra)
    else parent.set(ra, rb)
  }
  return { find, unite }
}

export function correlatedGroupId(incidentIds) {
  const sorted = [...incidentIds].map(String).sort()
  return `corr-live-${fnv1a(sorted.join('\0'))}`
}

/**
 * Deduplicate open live incidents: one member per live id, prefer unique endpoints.
 * Same-endpoint re-detections collapse to a single live id (inc-${endpointId}).
 */
export function normalizeOpenIncidents(incidents = [], nowMs = Date.now()) {
  const byId = new Map()
  for (const inc of incidents ?? []) {
    if (!isOpenIncident(inc)) continue
    const id = liveIncidentId(inc)
    const node = endpointIdOf(inc)
    if (!id || !node) continue
    if (!byId.has(id)) {
      byId.set(id, {
        ...inc,
        id,
        endpointId: node,
        detectedAtMs: detectedAtMsOf(inc, nowMs),
      })
    }
  }
  // Collapse accidental duplicates that share endpoint but differ in id (should not happen live)
  const byNode = new Map()
  for (const inc of byId.values()) {
    const node = endpointIdOf(inc)
    if (!byNode.has(node)) byNode.set(node, inc)
  }
  return [...byNode.values()].sort((a, b) => liveIncidentId(a).localeCompare(liveIncidentId(b)))
}

/**
 * Correlate OPEN incidents into live groups.
 *
 * @param {object[]} incidents
 * @param {{ edges?: object[], nowMs?: number, historicalKeys?: Set<string>, historicalPairs?: object[] } & Partial<typeof LIVE_CORRELATION>} [options]
 * @returns {{
 *   groups: object[],
 *   pairs: object[],
 *   generatedAt: number,
 *   byIncidentId: Map<string, { groupId: string|null, relatedLiveIds: string[], reasons: object[] }>
 * }}
 */
export function correlateLiveIncidents(incidents = [], options = {}) {
  const cfg = configOf(options)
  const nowMs = Number.isFinite(Number(cfg.nowMs)) ? Number(cfg.nowMs) : Date.now()
  const edges = options.edges ?? []
  const open = normalizeOpenIncidents(incidents, nowMs)
  const historicalKeys =
    options.historicalKeys instanceof Set
      ? options.historicalKeys
      : historicalRelationshipKeys(open, options.historicalPairs)

  const pairs = []
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      pairs.push(
        correlateLiveIncidentPair(open[i], open[j], edges, {
          ...cfg,
          nowMs,
          historicalKeys,
        })
      )
    }
  }

  const ids = open.map((inc) => liveIncidentId(inc))
  const { find, unite } = unionFind(ids)
  for (const pair of pairs) {
    if (!pair.linked) continue
    unite(pair.incidentAId, pair.incidentBId)
  }

  const byId = new Map(open.map((inc) => [liveIncidentId(inc), inc]))
  const buckets = new Map()
  for (const id of ids) {
    const root = find(id)
    if (!buckets.has(root)) buckets.set(root, [])
    buckets.get(root).push(id)
  }

  const groups = []
  for (const memberIds of buckets.values()) {
    const sortedIds = [...memberIds].sort()
    if (sortedIds.length < 2) continue
    const members = sortedIds.map((id) => byId.get(id)).filter(Boolean)
    const nodeIds = [...new Set(members.map((m) => endpointIdOf(m)).filter(Boolean))].sort()
    // Prefer multi-node groups; same-node-only groups are not published
    if (nodeIds.length < 2) continue

    const memberSet = new Set(sortedIds)
    const pairHits = pairs.filter(
      (p) => p.linked && memberSet.has(p.incidentAId) && memberSet.has(p.incidentBId)
    )
    const reasonMap = new Map()
    for (const p of pairHits) {
      for (const r of p.reasons ?? []) {
        const key = `${r.type}|${r.detail ?? ''}`
        if (!reasonMap.has(key)) reasonMap.set(key, r)
      }
    }
    const times = members.map((m) => detectedAtMsOf(m, nowMs))
    const corrScore =
      pairHits.length > 0
        ? round4(Math.max(...pairHits.map((p) => p.score)))
        : 0

    groups.push({
      groupId: correlatedGroupId(sortedIds),
      incidentIds: sortedIds,
      nodeIds,
      // Recovery-impact ranking selects primary later; leave null for this stage.
      primaryIncidentId: null,
      correlationScore: corrScore,
      relationshipReasons: [...reasonMap.values()],
      firstSeenAt: Math.min(...times),
      lastSeenAt: Math.max(...times),
      openIncidentCount: sortedIds.length,
    })
  }

  groups.sort((a, b) => {
    if (a.firstSeenAt !== b.firstSeenAt) return a.firstSeenAt - b.firstSeenAt
    return a.groupId.localeCompare(b.groupId)
  })

  const byIncidentId = new Map()
  for (const id of ids) {
    byIncidentId.set(id, { groupId: null, relatedLiveIds: [], reasons: [] })
  }
  for (const group of groups) {
    for (const id of group.incidentIds) {
      const related = group.incidentIds.filter((other) => other !== id)
      const reasonMap = new Map()
      for (const p of pairs) {
        if (!p.linked) continue
        if (
          (p.incidentAId === id && related.includes(p.incidentBId)) ||
          (p.incidentBId === id && related.includes(p.incidentAId))
        ) {
          for (const r of p.reasons ?? []) {
            const key = `${r.type}|${r.detail ?? ''}`
            if (!reasonMap.has(key)) reasonMap.set(key, r)
          }
        }
      }
      byIncidentId.set(id, {
        groupId: group.groupId,
        relatedLiveIds: related,
        reasons: [...reasonMap.values()],
      })
    }
  }

  return {
    groups,
    pairs,
    generatedAt: nowMs,
    byIncidentId,
  }
}

/**
 * Attach live correlation onto a detection result (mutates incidents + detection.liveCorrelation).
 * Does not touch campaignId or relatedIncidents (history).
 *
 * @param {object|null|undefined} detection
 * @param {{ edges?: object[], nowMs?: number, historicalPairs?: object[] }} [options]
 * @returns {object|null|undefined} detection
 */
export function attachLiveCorrelation(detection, options = {}) {
  if (!detection || typeof detection !== 'object') return detection
  const incidents = Array.isArray(detection.incidents) ? detection.incidents : []
  const result = correlateLiveIncidents(incidents, {
    edges: options.edges ?? [],
    nowMs: options.nowMs,
    historicalPairs: options.historicalPairs,
    historicalKeys: options.historicalKeys,
  })

  for (const inc of incidents) {
    const id = liveIncidentId(inc)
    const meta = result.byIncidentId.get(id)
    if (meta) {
      inc.correlation = {
        groupId: meta.groupId,
        relatedLiveIds: meta.relatedLiveIds,
        reasons: meta.reasons,
      }
    } else if (isOpenIncident(inc) && id) {
      inc.correlation = { groupId: null, relatedLiveIds: [], reasons: [] }
    }
  }

  detection.liveCorrelation = {
    groups: result.groups,
    generatedAt: result.generatedAt,
    pairCount: result.pairs.length,
    linkedPairCount: result.pairs.filter((p) => p.linked).length,
  }
  return detection
}

export function emptyLiveCorrelation() {
  return {
    groups: [],
    generatedAt: null,
    pairCount: 0,
    linkedPairCount: 0,
  }
}
