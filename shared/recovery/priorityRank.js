/**
 * Recovery priority ranking comparator.
 *
 * Order: recoveryPriority DESC → severity DESC → anomalyScore DESC → endpointLabel ASC
 *
 * Not wired into the UI yet — consumers sort with compareByRecoveryPriority.
 * Does not mutate incidents.
 */

import { SEVERITY_LEVELS } from '../incidents.js'

function severityRankDesc(severity) {
  const key = String(severity ?? '').toLowerCase()
  const idx = SEVERITY_LEVELS.indexOf(key)
  // higher severity → lower sort key when sorting ascending with this rank inverted
  return idx >= 0 ? idx : -1
}

function labelOf(inc) {
  return String(inc?.endpointLabel ?? inc?.endpointId ?? inc?.id ?? '')
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {number} negative if a should rank above b
 */
export function compareByRecoveryPriority(a, b) {
  const pa = Number(a?.recoveryPriority ?? a?.recoveryImpact?.score)
  const pb = Number(b?.recoveryPriority ?? b?.recoveryImpact?.score)
  const sa = Number.isFinite(pa) ? pa : -Infinity
  const sb = Number.isFinite(pb) ? pb : -Infinity
  if (sb !== sa) return sb - sa

  const sev = severityRankDesc(b?.severity) - severityRankDesc(a?.severity)
  if (sev !== 0) return sev

  const aa = Number(a?.anomalyScore)
  const ab = Number(b?.anomalyScore)
  const na = Number.isFinite(aa) ? aa : -Infinity
  const nb = Number.isFinite(ab) ? ab : -Infinity
  if (nb !== na) return nb - na

  return labelOf(a).localeCompare(labelOf(b))
}

/**
 * @param {object[]} incidents
 * @returns {object[]} new sorted array (shallow copy)
 */
export function rankIncidentsByRecoveryPriority(incidents = []) {
  return [...(incidents ?? [])].sort(compareByRecoveryPriority)
}
