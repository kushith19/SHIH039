/**
 * Race-safe application of Commander incident-intel responses.
 * Only the latest request for a room/incident/mode may update state.
 * A successful RAG payload must replace stale unavailable knowledge.
 * An older unavailable response must never overwrite a newer success.
 */

export function intelRequestIdentity({ roomId, incidentId, mode } = {}) {
  return `${String(roomId || '')}::${String(incidentId || '')}::${String(mode || '')}`
}

/**
 * @param {{ requestSeq: number, latestSeq: number, identity: string, latestIdentity: string }} meta
 * @returns {boolean}
 */
export function shouldApplyIntelUpdate(meta = {}) {
  const requestSeq = Number(meta.requestSeq)
  const latestSeq = Number(meta.latestSeq)
  if (!Number.isFinite(requestSeq) || !Number.isFinite(latestSeq)) return false
  if (requestSeq !== latestSeq) return false
  if (String(meta.identity || '') !== String(meta.latestIdentity || '')) return false
  return true
}

/**
 * Merge rules when applying a fresh intel payload.
 * Successful knowledge always wins over a soft-fail for the same incident+mode.
 * Never carry RAG from a different incident identity.
 */
export function mergeIntelKnowledge(prevIntel, nextIntel) {
  if (!nextIntel || typeof nextIntel !== 'object') return prevIntel ?? null
  if (!prevIntel || typeof prevIntel !== 'object') return nextIntel

  const prevKc = prevIntel.knowledgeContext
  const nextKc = nextIntel.knowledgeContext
  if (nextKc?.retrieved === true) {
    return {
      ...nextIntel,
      knowledgeContext: nextKc,
      knowledgeStatus: nextKc.knowledgeStatus || nextIntel.knowledgeStatus || 'success',
    }
  }

  const sameIncident =
    String(prevIntel?.primary?.incidentId ?? '') ===
      String(nextIntel?.primary?.incidentId ?? '') &&
    String(prevIntel?.mode ?? '') === String(nextIntel?.mode ?? '')

  if (sameIncident && prevKc?.retrieved === true && nextKc?.retrieved !== true) {
    return {
      ...nextIntel,
      knowledgeContext: prevKc,
      knowledgeStatus: prevKc.knowledgeStatus || prevIntel.knowledgeStatus || 'success',
    }
  }
  return nextIntel
}
