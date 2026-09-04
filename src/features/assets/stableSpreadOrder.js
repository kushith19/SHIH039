/**
 * Client-only presentation order for attacker spread targets.
 * Eligibility stays live via listEligibleSpreadTargets; this only freezes card order.
 */

/**
 * @param {Record<string, string[]>} store
 */
export function clearAllSpreadOrderLocks(store) {
  if (!store || typeof store !== 'object') return
  for (const key of Object.keys(store)) delete store[key]
}

/**
 * @param {Record<string, string[]>} store
 * @param {string} sourceNodeId
 */
export function clearSpreadOrderForSource(store, sourceNodeId) {
  const id = String(sourceNodeId ?? '')
  if (!store || !id) return
  delete store[id]
}

/**
 * Intersect locked order with live eligible targets; append genuinely new ids at end.
 * Mutates `store[sourceNodeId]` in place. Never re-sorts by risk.
 *
 * @template {{ nodeId: string }} T
 * @param {string | null | undefined} sourceNodeId
 * @param {T[]} liveEligibleTargets
 * @param {Record<string, string[]>} store
 * @returns {T[]}
 */
export function applyStablePresentationOrder(
  sourceNodeId,
  liveEligibleTargets,
  store
) {
  const source = String(sourceNodeId ?? '')
  if (!source || !store || typeof store !== 'object') return []

  const live = Array.isArray(liveEligibleTargets) ? liveEligibleTargets : []
  /** @type {Map<string, T>} */
  const byId = new Map()
  for (const t of live) {
    const id = String(t?.nodeId ?? '')
    if (id) byId.set(id, t)
  }
  const liveIds = [...byId.keys()]

  if (liveIds.length === 0) {
    // Keep any existing lock so a temporary empty set does not reshuffle on reappear;
    // callers clear the lock when the source itself becomes invalid.
    return []
  }

  let locked = store[source]
  if (!Array.isArray(locked) || locked.length === 0) {
    store[source] = [...liveIds]
    return liveIds.map((id) => byId.get(id)).filter(Boolean)
  }

  const liveSet = new Set(liveIds)
  const next = locked.map(String).filter((id) => liveSet.has(id))
  for (const id of liveIds) {
    if (!next.includes(id)) next.push(id)
  }
  store[source] = next
  return next.map((id) => byId.get(id)).filter(Boolean)
}
