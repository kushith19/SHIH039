/**
 * Sticky per-seed "highest-risk next target" lifecycle.
 *
 * Ranking still runs every tick; this gate decides what is published as
 * primarySpreadNodeId. Locks live on the room object, not in React/SQLite.
 */

/**
 * @typedef {{
 *   primarySpreadNodeId: string
 *   path: string[]
 *   scoreAtLock: number
 *   lockedAtTick: number | null
 *   assessmentAtLock: object | null
 * }} SpreadTargetLock
 */

/**
 * @param {object | null | undefined} room
 * @returns {Record<string, SpreadTargetLock>}
 */
export function ensureSpreadTargetLocks(room) {
  if (!room) return {}
  if (!room.spreadTargetBySeedId || typeof room.spreadTargetBySeedId !== 'object') {
    room.spreadTargetBySeedId = {}
  }
  return room.spreadTargetBySeedId
}

export function clearSpreadTargetLocks(room) {
  if (!room) return
  room.spreadTargetBySeedId = {}
}

/**
 * Drop locks where `nodeId` is the seed or the locked target.
 * @returns {string[]} removed seed ids
 */
export function invalidateSpreadLocksForNode(room, nodeId) {
  const locks = ensureSpreadTargetLocks(room)
  const id = String(nodeId ?? '')
  if (!id) return []
  const removed = []
  for (const seedId of Object.keys(locks)) {
    const lock = locks[seedId]
    if (seedId === id || String(lock?.primarySpreadNodeId ?? '') === id) {
      delete locks[seedId]
      removed.push(seedId)
    }
  }
  return removed
}

function findSpreadEdgeId(edges, seedId, targetId) {
  if (!targetId) return null
  const seed = String(seedId)
  const best = String(targetId)
  const edge = (edges ?? []).find(
    (e) =>
      (String(e?.source ?? '') === seed && String(e?.target ?? '') === best) ||
      (String(e?.target ?? '') === seed && String(e?.source ?? '') === best)
  )
  return edge?.id ?? null
}

function lockStillValid(lock, seedId, {
  anomalySet,
  knownIds,
  quarantinedIds,
}) {
  if (!lock?.primarySpreadNodeId) return false
  const target = String(lock.primarySpreadNodeId)
  if (!anomalySet.has(String(seedId))) return false
  if (knownIds && !knownIds.has(String(seedId))) return false
  if (knownIds && !knownIds.has(target)) return false
  if (quarantinedIds?.has(target)) return false
  if (quarantinedIds?.has(String(seedId))) return false
  return true
}

/**
 * Compare locks for room-level primary: higher frozen score, then seedId, then target.
 */
export function compareSpreadLocks(a, b) {
  const scoreDiff = (Number(b?.scoreAtLock) || 0) - (Number(a?.scoreAtLock) || 0)
  if (scoreDiff !== 0) return scoreDiff
  const seedDiff = String(a?.seedNodeId ?? '').localeCompare(String(b?.seedNodeId ?? ''))
  if (seedDiff !== 0) return seedDiff
  return String(a?.primarySpreadNodeId ?? '').localeCompare(String(b?.primarySpreadNodeId ?? ''))
}

/**
 * Apply sticky lifecycle after ranking.
 * Mutates `locks` in place.
 *
 * @param {{
 *   locks: Record<string, SpreadTargetLock>
 *   anomalyNodeIds: string[]
 *   assessmentsBySeedId?: Record<string, object | null | undefined>
 *   knownNodeIds?: Set<string> | string[]
 *   quarantinedNodeIds?: Set<string> | string[]
 *   edges?: Array<{ id?: string, source: string, target: string }>
 *   simulationTick?: number
 * }} args
 */
export function applySpreadTargetLocks({
  locks,
  anomalyNodeIds,
  assessmentsBySeedId = {},
  knownNodeIds,
  quarantinedNodeIds,
  edges = [],
  simulationTick = null,
}) {
  const store = locks && typeof locks === 'object' ? locks : {}
  const anomalySet = new Set((anomalyNodeIds ?? []).map(String).filter(Boolean))
  const knownIds = knownNodeIds
    ? knownNodeIds instanceof Set
      ? knownNodeIds
      : new Set([...knownNodeIds].map(String))
    : null
  const quarantinedIds = quarantinedNodeIds
    ? quarantinedNodeIds instanceof Set
      ? quarantinedNodeIds
      : new Set([...quarantinedNodeIds].map(String))
    : new Set()

  /** Seeds invalidated this call must not immediately re-lock (wait for a later tick). */
  const invalidatedThisCall = new Set()

  // Invalidate stale locks
  for (const seedId of Object.keys(store)) {
    if (
      !lockStillValid(store[seedId], seedId, {
        anomalySet,
        knownIds,
        quarantinedIds,
      })
    ) {
      delete store[seedId]
      invalidatedThisCall.add(String(seedId))
    }
  }

  // Create locks for seeds that need one (first valid candidate wins)
  for (const seedId of anomalySet) {
    if (store[seedId]) continue
    if (invalidatedThisCall.has(String(seedId))) continue
    const proposed = assessmentsBySeedId[seedId]
    const target = proposed?.nodeId ? String(proposed.nodeId) : null
    if (!target) continue
    if (anomalySet.has(target)) continue
    if (knownIds && !knownIds.has(target)) continue
    if (quarantinedIds.has(target)) continue
    store[seedId] = {
      primarySpreadNodeId: target,
      path: Array.isArray(proposed.path) ? proposed.path.map(String) : [seedId, target],
      scoreAtLock: Number(proposed.score) || 0,
      lockedAtTick: Number.isFinite(Number(simulationTick)) ? Number(simulationTick) : null,
      assessmentAtLock: proposed,
    }
  }

  // Room-level primary from active locks (frozen scoreAtLock — no live score churn)
  const active = Object.entries(store).map(([seedNodeId, lock]) => ({
    seedNodeId,
    ...lock,
  }))
  active.sort(compareSpreadLocks)
  const roomLock = active[0] ?? null
  const primarySpreadNodeId = roomLock?.primarySpreadNodeId ?? null
  const primarySpreadAssessment = roomLock?.assessmentAtLock
    ? {
        ...roomLock.assessmentAtLock,
        nodeId: primarySpreadNodeId,
        score: roomLock.scoreAtLock,
        path: roomLock.path,
        seedNodeId: roomLock.seedNodeId,
        sticky: true,
      }
    : null
  const primarySpreadEdgeId = roomLock
    ? findSpreadEdgeId(edges, roomLock.seedNodeId, primarySpreadNodeId)
    : null

  return {
    primarySpreadNodeId,
    primarySpreadEdgeId,
    primarySpreadAssessment,
    spreadTargetBySeedId: store,
  }
}

/**
 * Resolve published primary for one seed from sticky locks, else fall back.
 */
export function publishedSpreadForSeed(locks, seedNodeId, fallback) {
  const lock = locks?.[String(seedNodeId)]
  if (!lock?.primarySpreadNodeId) return fallback
  return {
    primarySpreadNodeId: String(lock.primarySpreadNodeId),
    primarySpreadAssessment: lock.assessmentAtLock
      ? {
          ...lock.assessmentAtLock,
          nodeId: String(lock.primarySpreadNodeId),
          score: lock.scoreAtLock,
          path: lock.path,
          seedNodeId: String(seedNodeId),
          sticky: true,
        }
      : fallback?.primarySpreadAssessment ?? null,
  }
}
