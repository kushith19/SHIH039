/**
 * Incident stream UI helpers — consume server recoveryPriority only.
 * Do not recalculate recovery impact on the client.
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
  const fromImpact = inc?.recoveryImpact?.relatedOpenIncidentIds
  if (Array.isArray(fromImpact)) return fromImpact.length
  return 0
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
