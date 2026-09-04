/**
 * Post-Analysis Framework — shared contracts.
 * Software/configuration remediation only. Never physical infrastructure.
 */

export const POST_ANALYSIS_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  UNAVAILABLE: 'unavailable',
  SKIPPED: 'skipped',
})

export const RECOMMENDATION_STATUS = Object.freeze({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  DISMISSED: 'dismissed',
  RECURRED: 'recurred',
})

export const RECOMMENDATION_PRIORITY = Object.freeze({
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
})

/** Software/configuration taxonomy categories. */
export const RECOMMENDATION_CATEGORY = Object.freeze({
  AUTHENTICATION: 'authentication',
  CREDENTIAL_SECURITY: 'credential_security',
  API_SECURITY: 'api_security',
  NETWORK_SECURITY: 'network_security',
  ENDPOINT_SECURITY: 'endpoint_security',
  APPLICATION_SECURITY: 'application_security',
  MONITORING_DETECTION: 'monitoring_detection',
  ACCESS_POLICY: 'access_policy',
  OTHER_SOFTWARE: 'other_software',
})

export const ALLOWED_CATEGORIES = Object.freeze(Object.values(RECOMMENDATION_CATEGORY))
export const ALLOWED_PRIORITIES = Object.freeze(Object.values(RECOMMENDATION_PRIORITY))
export const ALLOWED_REC_STATUSES = Object.freeze(Object.values(RECOMMENDATION_STATUS))

export const POST_ANALYSIS_SOURCE = Object.freeze({
  LLM: 'llm',
  DEMO_SEED: 'demo_seed',
  DETERMINISTIC: 'deterministic',
})

/**
 * Expected LLM recommendation object shape.
 * @typedef {{
 *   title: string,
 *   problem: string,
 *   recommendation: string,
 *   reason: string,
 *   priority: string,
 *   category: string,
 *   softwareOnly: boolean,
 * }} LlmRecommendationDraft
 */

export function normalizePriority(raw) {
  const p = String(raw ?? 'medium').toLowerCase().trim()
  if (p === 'crit' || p === 'critical') return RECOMMENDATION_PRIORITY.CRITICAL
  if (p === 'high') return RECOMMENDATION_PRIORITY.HIGH
  if (p === 'low') return RECOMMENDATION_PRIORITY.LOW
  if (ALLOWED_PRIORITIES.includes(p)) return p
  return RECOMMENDATION_PRIORITY.MEDIUM
}

export function normalizeCategory(raw) {
  const c = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
  const aliases = {
    auth: RECOMMENDATION_CATEGORY.AUTHENTICATION,
    credentials: RECOMMENDATION_CATEGORY.CREDENTIAL_SECURITY,
    credential: RECOMMENDATION_CATEGORY.CREDENTIAL_SECURITY,
    api: RECOMMENDATION_CATEGORY.API_SECURITY,
    network: RECOMMENDATION_CATEGORY.NETWORK_SECURITY,
    endpoint: RECOMMENDATION_CATEGORY.ENDPOINT_SECURITY,
    application: RECOMMENDATION_CATEGORY.APPLICATION_SECURITY,
    app: RECOMMENDATION_CATEGORY.APPLICATION_SECURITY,
    monitoring: RECOMMENDATION_CATEGORY.MONITORING_DETECTION,
    detection: RECOMMENDATION_CATEGORY.MONITORING_DETECTION,
    access: RECOMMENDATION_CATEGORY.ACCESS_POLICY,
    policy: RECOMMENDATION_CATEGORY.ACCESS_POLICY,
  }
  if (aliases[c]) return aliases[c]
  if (ALLOWED_CATEGORIES.includes(c)) return c
  return RECOMMENDATION_CATEGORY.OTHER_SOFTWARE
}

export function isOpenLikeStatus(status) {
  const s = String(status ?? '')
  return (
    s === RECOMMENDATION_STATUS.OPEN ||
    s === RECOMMENDATION_STATUS.IN_PROGRESS ||
    s === RECOMMENDATION_STATUS.RECURRED
  )
}

export function isCompletedStatus(status) {
  return String(status ?? '') === RECOMMENDATION_STATUS.COMPLETED
}
