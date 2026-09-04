/**
 * Recommendation fingerprint for deduplication / recurrence.
 * Key: attackCategory + affectedAsset + normalizedRecommendationText
 */

function collapseWhitespace(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strip filler verbs so "Rotate the API key" ≈ "rotate api key". */
function normalizeRecommendationText(text) {
  let t = collapseWhitespace(text)
  const fillers = [
    'please',
    'should',
    'must',
    'need to',
    'needs to',
    'the',
    'a',
    'an',
    'all',
    'associated',
    'affected',
    'existing',
  ]
  for (const w of fillers) {
    t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), ' ')
  }
  return collapseWhitespace(t)
}

/**
 * @param {{
 *   attackCategory?: string,
 *   attackType?: string,
 *   affectedAssetId?: string,
 *   affectedNodeId?: string,
 *   recommendation?: string,
 *   title?: string,
 * }} input
 */
export function buildRecommendationFingerprint(input) {
  const attack =
    collapseWhitespace(input.attackCategory || input.attackType || 'unknown') || 'unknown'
  const asset =
    collapseWhitespace(input.affectedAssetId || input.affectedNodeId || 'unknown') || 'unknown'
  const rec =
    normalizeRecommendationText(input.recommendation || input.title || '') || 'unspecified'
  return `${attack}|${asset}|${rec}`
}

/**
 * Lightweight attack-pattern key (without recommendation text).
 * Used for recurring attack intelligence surfaces.
 */
export function buildAttackPatternKey({ attackCategory, attackType, affectedAssetId, affectedNodeId }) {
  const attack =
    collapseWhitespace(attackCategory || attackType || 'unknown') || 'unknown'
  const asset =
    collapseWhitespace(affectedAssetId || affectedNodeId || 'unknown') || 'unknown'
  return `${attack}|${asset}`
}
