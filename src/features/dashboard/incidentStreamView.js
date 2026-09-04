/**
 * Incident stream UI helpers — consume server recoveryPriority / correlation only.
 * Do not recalculate recovery impact or correlation scores on the client.
 */

import { compareByRecoveryPriority } from '../../../shared/recovery/priorityRank.js'

function hasRecoveryPriority(inc) {
  const n = Number(inc?.recoveryPriority ?? inc?.recoveryImpact?.score)
  return Number.isFinite(n)
}

function severityRankAsc(severity) {
  switch (String(severity ?? '').toLowerCase()) {
    case 'critical':
      return 0
    case 'high':
      return 1
    case 'medium':
      return 2
    default:
      return 3
  }
}

function compareBySeverityFallback(a, b) {
  const d = severityRankAsc(a?.severity) - severityRankAsc(b?.severity)
  if (d !== 0) return d
  const la = String(a?.endpointLabel || a?.endpointId || '')
  const lb = String(b?.endpointLabel || b?.endpointId || '')
  return la.localeCompare(lb)
}

/**
 * Rank live incidents for the SOC queue.
 * Uses server recoveryPriority when any incident has it; otherwise severity → label.
 */
export function orderLiveIncidents(incidents = []) {
  const list = Array.isArray(incidents) ? [...incidents] : []
  const anyPriority = list.some(hasRecoveryPriority)
  if (!anyPriority) return list.sort(compareBySeverityFallback)
  return list.sort(compareByRecoveryPriority)
}

export function recoveryPriorityValue(inc) {
  const n = Number(inc?.recoveryPriority ?? inc?.recoveryImpact?.score)
  return Number.isFinite(n) ? n : null
}

/** Compact band for demo readability — not a second scoring algorithm. */
export function recoveryImpactBand(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  if (n >= 40) return 'High'
  if (n >= 20) return 'Medium'
  if (n > 0) return 'Low'
  return null
}

export function reliefCount(inc) {
  const n = inc?.recoveryImpact?.reliefCandidateIds?.length
  if (Number.isFinite(Number(n))) return Number(n)
  const exp = inc?.recoveryImpact?.explanation?.exposureRelief?.count
  return Number.isFinite(Number(exp)) ? Number(exp) : 0
}

export function relatedLiveCount(inc) {
  const fromCorr = inc?.correlation?.relatedLiveIds
  if (Array.isArray(fromCorr) && fromCorr.length) return fromCorr.length
  const fromImpact = inc?.recoveryImpact?.relatedOpenIncidentIds
  if (Array.isArray(fromImpact)) return fromImpact.length
  return 0
}

export function correlationGroupId(inc) {
  const id = inc?.correlation?.groupId
  return id ? String(id) : null
}

export function formatPriorityScore(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function nodeLabelFromList(nodes, id) {
  const n = (nodes ?? []).find((node) => String(node.id) === String(id))
  return n?.data?.label ?? n?.label ?? String(id ?? '')
}

/**
 * Compact downstream chain for relief candidates (dependency topology, not attack path).
 */
export function reliefDependencyLabels(inc, nodes = []) {
  const ids = Array.isArray(inc?.recoveryImpact?.reliefCandidateIds)
    ? inc.recoveryImpact.reliefCandidateIds
    : []
  const seed = inc?.endpointId
  const labels = []
  if (seed) labels.push(nodeLabelFromList(nodes, seed))
  for (const id of ids.slice(0, 4)) {
    labels.push(nodeLabelFromList(nodes, id))
  }
  return labels
}

export function correlationReasonLabels(reasons = []) {
  return (reasons ?? [])
    .map((r) => {
      if (r == null) return ''
      if (typeof r === 'string') return r
      return String(r.label ?? r.type ?? '').trim()
    })
    .filter(Boolean)
}

/**
 * Resolve primary incident object for a live correlation group.
 */
export function groupPrimaryIncident(group, incidents = []) {
  const primaryId = group?.primaryIncidentId
  const list = Array.isArray(incidents) ? incidents : []
  if (primaryId) {
    const hit = list.find((inc) => String(inc.id) === String(primaryId))
    if (hit) return hit
  }
  const members = list.filter((inc) =>
    (group?.incidentIds ?? []).some((id) => String(id) === String(inc.id))
  )
  if (!members.length) return null
  return orderLiveIncidents(members)[0] ?? null
}

export function groupMemberIncidents(group, incidents = []) {
  const ids = new Set((group?.incidentIds ?? []).map(String))
  return orderLiveIncidents(
    (incidents ?? []).filter((inc) => ids.has(String(inc.id)))
  )
}

function detectedAtMs(inc) {
  const fromMs = Number(inc?.detectedAtMs)
  if (Number.isFinite(fromMs) && fromMs > 0) return fromMs
  if (inc?.timestamp != null) {
    const parsed = Date.parse(inc.timestamp)
    if (Number.isFinite(parsed)) return parsed
  }
  return Number.POSITIVE_INFINITY
}

/**
 * Chronological timeline of group members (temporal correlation context only).
 * Does not imply causality.
 */
export function groupChronologicalTimeline(group, incidents = []) {
  const ids = new Set((group?.incidentIds ?? []).map(String))
  const members = (incidents ?? []).filter((inc) => ids.has(String(inc.id)))
  const ranked = orderLiveIncidents(members)
  const rankById = new Map(ranked.map((inc, i) => [String(inc.id), i + 1]))
  return [...members]
    .sort((a, b) => {
      const dt = detectedAtMs(a) - detectedAtMs(b)
      if (dt !== 0) return dt
      return String(a.endpointLabel || a.endpointId || '').localeCompare(
        String(b.endpointLabel || b.endpointId || '')
      )
    })
    .map((inc) => ({
      incident: inc,
      detectedAtMs: detectedAtMs(inc),
      recoveryRank: rankById.get(String(inc.id)) ?? null,
    }))
}

function hasDirectedEdge(edges, source, target) {
  const s = String(source)
  const t = String(target)
  for (const e of edges ?? []) {
    if (String(e?.source ?? '') === s && String(e?.target ?? '') === t) return true
  }
  return false
}

/**
 * Longest directed dependency chains among group incident endpoints.
 * Topology / recovery leverage only — not an attack path.
 *
 * @returns {string[][]} arrays of node ids (provider → dependent)
 */
export function groupDependencyChains(group, incidents = [], edges = []) {
  const ids = new Set((group?.incidentIds ?? []).map(String))
  const members = (incidents ?? []).filter((inc) => ids.has(String(inc.id)))
  const nodeIds = [
    ...new Set(
      members
        .map((inc) => String(inc.endpointId ?? inc.affectedNodeId ?? ''))
        .filter(Boolean)
    ),
  ]
  if (nodeIds.length < 2) return []

  /** @type {Map<string, string[]>} */
  const adj = new Map()
  for (const id of nodeIds) adj.set(id, [])
  for (const a of nodeIds) {
    for (const b of nodeIds) {
      if (a === b) continue
      if (hasDirectedEdge(edges, a, b)) adj.get(a).push(b)
    }
  }

  const chains = []
  const visit = (path) => {
    const last = path[path.length - 1]
    const nexts = (adj.get(last) ?? []).filter((n) => !path.includes(n))
    if (nexts.length === 0) {
      if (path.length >= 2) chains.push([...path])
      return
    }
    for (const n of nexts) visit([...path, n])
  }

  for (const id of nodeIds) {
    const hasIncoming = nodeIds.some((other) => hasDirectedEdge(edges, other, id))
    if (!hasIncoming || (adj.get(id) ?? []).length > 0) {
      // Prefer starting from sources (no in-edge within group) to avoid duplicates
      if (!hasIncoming) visit([id])
    }
  }
  // Fallback: if no clear sources produced chains, try each node once
  if (chains.length === 0) {
    for (const id of nodeIds) visit([id])
  }

  // Prefer longest unique chains; drop subchains covered by a longer one
  chains.sort((a, b) => b.length - a.length || a.join('|').localeCompare(b.join('|')))
  const kept = []
  for (const chain of chains) {
    const key = chain.join('>')
    const covered = kept.some((longer) => longer.join('>').includes(key))
    if (!covered) kept.push(chain)
  }
  return kept.slice(0, 3)
}

export function formatTimelineClock(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0 || n === Number.POSITIVE_INFINITY) return '—'
  return new Date(n).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
