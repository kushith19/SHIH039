/**
 * Shared incident status semantics for live response workflows.
 *
 * Distinguishes:
 * - Active / live response incidents — eligible for correlation, recovery scoring,
 *   Commander primary selection, and orchestration planning.
 * - Closed / historical incidents — excluded from those live populations.
 *
 * Canonical persisted statuses today are primarily `open` and `cleared`.
 * Operator workflow aliases (acknowledged / investigating / contained) are treated
 * as still-active if present so recovery scoring and planning share one population.
 */

export const ACTIVE_RESPONSE_STATUSES = Object.freeze([
  'open',
  'acknowledged',
  'investigating',
  'contained',
])

export const CLOSED_OR_HISTORICAL_STATUSES = Object.freeze([
  'cleared',
  'closed',
  'resolved',
])

const ACTIVE = new Set(ACTIVE_RESPONSE_STATUSES)
const CLOSED = new Set(CLOSED_OR_HISTORICAL_STATUSES)

/**
 * True when the incident may participate in live correlation, recovery impact,
 * recovery priority, and orchestration planning.
 * Empty / missing status defaults to active (`open`).
 */
export function isActiveResponseIncident(inc) {
  if (!inc || typeof inc !== 'object') return false
  const status = String(inc.status ?? 'open').toLowerCase().trim()
  if (!status) return true
  if (CLOSED.has(status)) return false
  return ACTIVE.has(status)
}

/**
 * True when the incident is closed/historical and must not drive live response.
 */
export function isClosedOrHistoricalIncident(inc) {
  if (!inc || typeof inc !== 'object') return false
  const status = String(inc.status ?? '').toLowerCase().trim()
  return CLOSED.has(status)
}

export function filterActiveResponseIncidents(incidents = []) {
  return (Array.isArray(incidents) ? incidents : []).filter(isActiveResponseIncident)
}
