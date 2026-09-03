import { hopDistance } from './graphHops.js'

/**
 * History-based campaign correlation.
 * Analyzes persisted (or normalized) incidents + existing graph edges only.
 * Ignores attacker presets, scenario names, and attack-button labels.
 */
export const HISTORY_CORRELATION = Object.freeze({
  temporalWindowMs: 5 * 60 * 1000,
  maxGraphHops: 2,
  minPairScore: 0.35,
  weights: Object.freeze({
    temporal: 0.25,
    graphRelated: 0.35,
    propagationRelated: 0.35,
    incidentSimilar: 0.05,
  }),
})

const SEVERITY_RANK = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
})

function configOf(overrides) {
  const base = HISTORY_CORRELATION
  const weights = { ...base.weights, ...(overrides?.weights ?? {}) }
  return {
    temporalWindowMs: Number(overrides?.temporalWindowMs ?? base.temporalWindowMs),
    maxGraphHops: Number(overrides?.maxGraphHops ?? base.maxGraphHops),
    minPairScore: Number(overrides?.minPairScore ?? base.minPairScore),
    weights,
    nowMs: overrides?.nowMs,
    lookbackMs: overrides?.lookbackMs,
  }
}

function fnv1a(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function round4(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.round(Math.max(0, Math.min(1, x)) * 10000) / 10000
}

function evidenceCodes(evidence) {
  const codes = []
  for (const ev of evidence ?? []) {
    const code = String(ev?.code ?? ev?.detail ?? '').trim()
    if (code) codes.push(code)
  }
  return codes
}

function normalizeType(type) {
  return String(type ?? '')
    .trim()
    .toLowerCase()
    .replace(/behavioral_anomaly/g, 'behavioural_anomaly')
}

export function normalizeHistoryIncident(raw) {
  const graph = raw?.graphContext && typeof raw.graphContext === 'object' ? raw.graphContext : {}
  const detected = Number(raw?.detectedAtMs)
  const fromTs = raw?.timestamp != null ? Date.parse(raw.timestamp) : NaN
  return {
    incidentId: String(raw?.incidentId ?? raw?.id ?? ''),
    roomId: String(raw?.roomId ?? ''),
    affectedNodeId: String(raw?.affectedNodeId ?? raw?.endpointId ?? ''),
    incidentType: raw?.incidentType ?? raw?.detectionType ?? null,
    severity: String(raw?.severity ?? 'low').toLowerCase(),
    status: String(raw?.status ?? 'open').toLowerCase(),
    detectedAtMs: Number.isFinite(detected) && detected > 0 ? detected : Number.isFinite(fromTs) ? fromTs : 0,
    evidence: Array.isArray(raw?.evidence) ? raw.evidence : [],
    peerExposedNodeIds: Array.isArray(graph.peerExposedNodeIds)
      ? graph.peerExposedNodeIds
      : Array.isArray(raw?.peerExposedNodeIds)
        ? raw.peerExposedNodeIds
        : [],
    propagatedNodeIds: Array.isArray(graph.propagatedNodeIds)
      ? graph.propagatedNodeIds
      : Array.isArray(raw?.propagatedNodeIds)
        ? raw.propagatedNodeIds
        : [],
    propagationPaths:
      graph.propagationPaths && typeof graph.propagationPaths === 'object'
        ? graph.propagationPaths
        : raw?.propagationPaths && typeof raw.propagationPaths === 'object'
          ? raw.propagationPaths
          : {},
    primaryPath: Array.isArray(graph.primaryPath) ? graph.primaryPath : [],
  }
}

function pathNodeSet(incident) {
  const ids = new Set()
  for (const id of incident.primaryPath ?? []) {
    if (id) ids.add(String(id))
  }
  for (const path of Object.values(incident.propagationPaths ?? {})) {
    if (!Array.isArray(path)) continue
    for (const id of path) {
      if (id) ids.add(String(id))
    }
  }
  for (const id of incident.peerExposedNodeIds ?? []) {
    if (id) ids.add(String(id))
  }
  for (const id of incident.propagatedNodeIds ?? []) {
    if (id) ids.add(String(id))
  }
  if (incident.affectedNodeId) ids.add(String(incident.affectedNodeId))
  return ids
}

function temporalRelated(a, b, windowMs) {
  const delta = Math.abs(Number(a.detectedAtMs) - Number(b.detectedAtMs))
  return Number.isFinite(delta) && delta <= windowMs
}

function graphRelated(a, b, edges, maxHops) {
  const na = a.affectedNodeId
  const nb = b.affectedNodeId
  if (!na || !nb || na === nb) return { related: false, hops: Infinity }
  const hops = hopDistance(edges, na, nb)
  return { related: hops >= 1 && hops <= maxHops, hops }
}

function propagationRelated(a, b, edges) {
  const seedA = a.affectedNodeId
  const seedB = b.affectedNodeId
  if (!seedA || !seedB || seedA === seedB) return false
  const setA = pathNodeSet(a)
  const setB = pathNodeSet(b)
  if (setA.has(seedB) || setB.has(seedA)) return true
  for (const id of setA) {
    const hops = hopDistance(edges, id, seedB)
    if (hops >= 0 && hops <= 1) return true
  }
  for (const id of setB) {
    const hops = hopDistance(edges, id, seedA)
    if (hops >= 0 && hops <= 1) return true
  }
  return false
}

function incidentSimilar(a, b) {
  const typeA = normalizeType(a.incidentType)
  const typeB = normalizeType(b.incidentType)
  if (typeA && typeB && typeA === typeB) return true
  const codesA = new Set(evidenceCodes(a.evidence))
  for (const code of evidenceCodes(b.evidence)) {
    if (codesA.has(code)) return true
  }
  return false
}

function pairScore(flags, weights) {
  let score = 0
  if (flags.temporal) score += weights.temporal
  if (flags.graphRelated) score += weights.graphRelated
  if (flags.propagationRelated) score += weights.propagationRelated
  if (flags.incidentSimilar) score += weights.incidentSimilar
  return round4(score)
}

function pairReasons(flags, graphHops) {
  const reasons = []
  if (flags.temporal) reasons.push('Detected within the configured time window')
  if (flags.graphRelated) {
    reasons.push(
      Number.isFinite(graphHops)
        ? `Affected nodes are connected on the city graph (${graphHops} hop${graphHops === 1 ? '' : 's'})`
        : 'Affected nodes are connected on the city graph'
    )
  }
  if (flags.propagationRelated) {
    reasons.push('One incident propagation or peer-exposure set includes or approaches the other affected node')
  }
  if (flags.incidentSimilar) reasons.push('Incident type or evidence codes overlap')
  return reasons
}

function orderedPair(a, b) {
  return a.incidentId <= b.incidentId ? [a, b] : [b, a]
}

/**
 * Pairwise correlation evidence. Attacker preset / scenario names are ignored.
 */
export function correlateIncidentPair(rawA, rawB, edges = [], overrides = {}) {
  const cfg = configOf(overrides)
  const [a, b] = orderedPair(normalizeHistoryIncident(rawA), normalizeHistoryIncident(rawB))
  const temporal = temporalRelated(a, b, cfg.temporalWindowMs)
  const graph = graphRelated(a, b, edges, cfg.maxGraphHops)
  const propagation = propagationRelated(a, b, edges)
  const similar = incidentSimilar(a, b)
  const flags = {
    temporal,
    graphRelated: graph.related,
    propagationRelated: propagation,
    incidentSimilar: similar,
  }
  const score = pairScore(flags, cfg.weights)
  const linked = (flags.graphRelated || flags.propagationRelated) && score >= cfg.minPairScore
  return {
    incidentIdA: a.incidentId,
    incidentIdB: b.incidentId,
    ...flags,
    score,
    linked,
    reasons: pairReasons(flags, graph.hops),
    graphHops: Number.isFinite(graph.hops) ? graph.hops : null,
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

function maxSeverity(rows) {
  let best = 'low'
  let bestRank = -1
  for (const row of rows) {
    const sev = String(row.severity ?? 'low').toLowerCase()
    const rank = SEVERITY_RANK[sev] ?? 0
    if (rank > bestRank) {
      best = sev
      bestRank = rank
    }
  }
  return best
}

function campaignStatus(rows) {
  return rows.some((r) => r.status === 'open') ? 'suspected' : 'expired'
}

function campaignIdFor(roomId, incidentIds) {
  const key = `${roomId}\0${incidentIds.join('\0')}`
  return `camp-h-${fnv1a(key)}`
}

/**
 * Group strongly related incidents into campaign candidates.
 * Requires at least two distinct affected nodes. Does not read preset names.
 */
export function correlateIncidentCampaigns(rawIncidents, { roomId = '', edges = [] } = {}, overrides = {}) {
  void overrides?.attackName
  void overrides?.presetName
  void overrides?.playbookId
  void overrides?.scenarioName

  const cfg = configOf(overrides)
  const nowMs = Number.isFinite(Number(cfg.nowMs)) ? Number(cfg.nowMs) : Date.now()
  const lookback = Number(cfg.lookbackMs)
  const normalized = (rawIncidents ?? [])
    .map(normalizeHistoryIncident)
    .filter((row) => row.incidentId && row.affectedNodeId)
    .filter((row) => !Number.isFinite(lookback) || nowMs - row.detectedAtMs <= lookback)
    .sort((a, b) => {
      if (a.incidentId < b.incidentId) return -1
      if (a.incidentId > b.incidentId) return 1
      return 0
    })

  const pairs = []
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      pairs.push(correlateIncidentPair(normalized[i], normalized[j], edges, cfg))
    }
  }
  pairs.sort((a, b) => {
    const ka = `${a.incidentIdA}|${a.incidentIdB}`
    const kb = `${b.incidentIdA}|${b.incidentIdB}`
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })

  const { find, unite } = unionFind(normalized.map((r) => r.incidentId))
  for (const pair of pairs) {
    if (!pair.linked) continue
    unite(pair.incidentIdA, pair.incidentIdB)
  }

  const byId = new Map(normalized.map((r) => [r.incidentId, r]))
  const groups = new Map()
  for (const row of normalized) {
    const root = find(row.incidentId)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(row)
  }

  const campaigns = []
  for (const members of groups.values()) {
    const nodeIds = [...new Set(members.map((m) => m.affectedNodeId))].sort()
    if (members.length < 2 || nodeIds.length < 2) continue
    const incidentIds = members.map((m) => m.incidentId).sort()
    const memberSet = new Set(incidentIds)
    const pairHits = pairs.filter(
      (p) => p.linked && memberSet.has(p.incidentIdA) && memberSet.has(p.incidentIdB)
    )
    const reasonSet = []
    const seenReason = new Set()
    for (const p of pairHits) {
      for (const reason of p.reasons) {
        if (seenReason.has(reason)) continue
        seenReason.add(reason)
        reasonSet.push(reason)
      }
    }
    const detected = members.map((m) => m.detectedAtMs)
    const room = roomId || members.find((m) => m.roomId)?.roomId || ''
    campaigns.push({
      campaignId: campaignIdFor(room, incidentIds),
      roomId: room,
      incidentIds,
      affectedNodeIds: nodeIds,
      firstDetectedAtMs: Math.min(...detected),
      lastDetectedAtMs: Math.max(...detected),
      correlationReasons: reasonSet,
      severity: maxSeverity(members),
      status: campaignStatus(members),
    })
  }

  campaigns.sort((a, b) => {
    if (a.firstDetectedAtMs !== b.firstDetectedAtMs) return a.firstDetectedAtMs - b.firstDetectedAtMs
    return a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0
  })

  return { pairs, campaigns }
}
