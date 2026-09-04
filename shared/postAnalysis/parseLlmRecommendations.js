/**
 * Parse structured JSON recommendations from LLM chat content.
 */

import { validateSoftwareOnlyRecommendation } from './validateRecommendation.js'

function extractJsonBlock(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null

  // Prefer fenced ```json ... ```
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence ? fence[1].trim() : raw

  // Object or array
  const startObj = candidate.indexOf('{')
  const startArr = candidate.indexOf('[')
  let start = -1
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) start = startObj
  else if (startArr >= 0) start = startArr
  if (start < 0) return null

  const slice = candidate.slice(start)
  try {
    return JSON.parse(slice)
  } catch {
    // Truncated trailing junk — try balancing braces/brackets
    const endObj = slice.lastIndexOf('}')
    const endArr = slice.lastIndexOf(']')
    const end = Math.max(endObj, endArr)
    if (end > 0) {
      try {
        return JSON.parse(slice.slice(0, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * @param {string} text
 * @returns {{
 *   ok: boolean,
 *   drafts: object[],
 *   validated: object[],
 *   rejected: { draft: object, reason: string, code: string }[],
 *   parseError?: string,
 * }}
 */
export function parseAndValidateLlmRecommendations(text) {
  const parsed = extractJsonBlock(text)
  if (parsed == null) {
    return {
      ok: false,
      drafts: [],
      validated: [],
      rejected: [],
      parseError: 'Could not parse JSON from LLM response',
    }
  }

  let drafts = []
  if (Array.isArray(parsed)) {
    drafts = parsed
  } else if (Array.isArray(parsed.recommendations)) {
    drafts = parsed.recommendations
  } else if (parsed.title || parsed.recommendation) {
    drafts = [parsed]
  } else {
    return {
      ok: false,
      drafts: [],
      validated: [],
      rejected: [],
      parseError: 'JSON missing recommendations array',
    }
  }

  const validated = []
  const rejected = []
  for (const draft of drafts) {
    const result = validateSoftwareOnlyRecommendation(draft)
    if (result.ok) validated.push(result.recommendation)
    else rejected.push({ draft, reason: result.reason, code: result.code })
  }

  return {
    ok: validated.length > 0,
    drafts,
    validated,
    rejected,
  }
}
