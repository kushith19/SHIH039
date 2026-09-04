/**
 * Deterministic software-only validator for post-analysis recommendations.
 * Rejects any suggestion that implies adding physical / new infrastructure.
 */

import {
  ALLOWED_CATEGORIES,
  normalizeCategory,
  normalizePriority,
} from './schema.js'

/** Phrases that indicate infrastructure expansion / hardware procurement. */
export const INFRASTRUCTURE_REJECT_PATTERNS = Object.freeze([
  /\badd(?:ing)?\s+(?:a\s+|an\s+|new\s+)?(?:hardware|server|servers|router|routers|switch|switches|sensor|sensors|gateway|gateways|firewall\s+appliance|appliance|device|devices|node|nodes)\b/i,
  /\bdeploy(?:ing)?\s+(?:a\s+|an\s+|new\s+)?(?:hardware|server|servers|router|physical|infrastructure|appliance|sensor|gateway)\b/i,
  /\bpurchase\s+(?:equipment|hardware|server|servers|router|appliance|device)\b/i,
  /\bbuy(?:ing)?\s+(?:a\s+|an\s+|new\s+)?(?:hardware|server|router|switch|sensor|gateway|appliance|device|firewall)\b/i,
  /\bnew\s+(?:physical\s+)?(?:server|servers|router|routers|switch|switches|sensor|sensors|gateway|gateways|firewall\s+appliance|hardware|appliance)\b/i,
  /\bphysical\s+infrastructure\b/i,
  /\binfrastructure\s+expansion\b/i,
  /\binstall\s+(?:a\s+|an\s+)?(?:new\s+)?(?:device|server|router|switch|sensor|gateway|appliance|firewall)\b/i,
  /\badd\s+another\s+(?:server|device|security\s+appliance|router|switch|sensor|gateway)\b/i,
  /\bprocure\s+(?:hardware|equipment|servers?|appliances?)\b/i,
  /\bstand\s*up\s+(?:a\s+)?(?:new\s+)?(?:server|cluster|appliance)\b/i,
  /\bprovision\s+(?:a\s+|an\s+|new\s+)?(?:physical\s+)?(?:server|host|appliance)\b/i,
])

const REQUIRED_FIELDS = ['title', 'recommendation']

/**
 * @param {unknown} draft
 * @returns {{ ok: true, recommendation: object } | { ok: false, reason: string, code: string }}
 */
export function validateSoftwareOnlyRecommendation(draft) {
  if (!draft || typeof draft !== 'object') {
    return { ok: false, reason: 'Recommendation is not an object', code: 'INVALID_SHAPE' }
  }

  for (const field of REQUIRED_FIELDS) {
    if (!String(draft[field] ?? '').trim()) {
      return { ok: false, reason: `Missing required field: ${field}`, code: 'MISSING_FIELD' }
    }
  }

  if (draft.softwareOnly === false) {
    return {
      ok: false,
      reason: 'LLM marked softwareOnly=false',
      code: 'SOFTWARE_ONLY_FALSE',
    }
  }

  const haystack = [
    draft.title,
    draft.problem,
    draft.recommendation,
    draft.reason,
    draft.category,
  ]
    .map((x) => String(x ?? ''))
    .join(' ')

  for (const pattern of INFRASTRUCTURE_REJECT_PATTERNS) {
    if (pattern.test(haystack)) {
      return {
        ok: false,
        reason: `Infrastructure recommendation matched: ${pattern}`,
        code: 'INFRASTRUCTURE_RECOMMENDATION',
      }
    }
  }

  const category = normalizeCategory(draft.category)
  if (!ALLOWED_CATEGORIES.includes(category)) {
    return { ok: false, reason: `Unknown category: ${draft.category}`, code: 'INVALID_CATEGORY' }
  }

  return {
    ok: true,
    recommendation: {
      title: String(draft.title).trim().slice(0, 200),
      problem: String(draft.problem ?? '').trim().slice(0, 800),
      recommendation: String(draft.recommendation).trim().slice(0, 1200),
      reason: String(draft.reason ?? '').trim().slice(0, 800),
      priority: normalizePriority(draft.priority),
      category,
      softwareOnly: true,
    },
  }
}
