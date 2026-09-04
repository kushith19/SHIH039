/**
 * Automatic attack-spread orchestrator.
 *
 * Uses existing listEligibleSpreadTargets + spreadAttack only.
 * Does not live inside detection / TGNN / propagation.
 */

import { listEligibleSpreadTargets } from '../../shared/attackSpread.js'
import {
  ATTACK_SPREAD_MODE_AUTO,
  AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN,
  getAttackSpreadMode,
} from '../../shared/attackSpreadMode.js'
import { isAttackPresetId } from '../../shared/attackPresets.js'
import { spreadAttack } from '../campaign/engine.js'

export { AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN }

/**
 * @param {object | null | undefined} room
 * @returns {number}
 */
export function getAutoSpreadSuccessCount(room) {
  const n = Number(room?.autoSpreadSuccessCount)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * @param {object | null | undefined} room
 */
export function ensureAutoSpreadGuards(room) {
  if (!room) return
  if (!room.autoSpreadDoneBySource || typeof room.autoSpreadDoneBySource !== 'object') {
    room.autoSpreadDoneBySource = {}
  }
  if (!Number.isFinite(Number(room.autoSpreadSuccessCount)) || Number(room.autoSpreadSuccessCount) < 0) {
    room.autoSpreadSuccessCount = 0
  }
}

/**
 * Clear per-source auto-spread guards (Clear Attacks / match reset).
 * Does not change attackSpreadMode.
 * @param {object | null | undefined} room
 */
export function clearAutoSpreadGuards(room) {
  if (!room) return
  room.autoSpreadDoneBySource = {}
  room.autoSpreadInFlight = false
  room.autoSpreadSuccessCount = 0
}

/**
 * Resolve preset used for the active path tip (source), else default.
 * @param {object} room
 * @param {string} sourceNodeId
 */
export function resolvePresetForAutoSpread(room, sourceNodeId) {
  const source = String(sourceNodeId ?? '')
  const store = room?.activeAttackSequences ?? {}
  for (const seq of Object.values(store)) {
    if (!seq || seq.status !== 'active') continue
    const path = Array.isArray(seq.nodePath) ? seq.nodePath : []
    if (String(path[path.length - 1] ?? '') !== source) continue
    const events = Array.isArray(seq.events) ? seq.events : []
    for (let i = events.length - 1; i >= 0; i--) {
      const pid = events[i]?.presetId
      if (isAttackPresetId(pid)) return pid
    }
  }
  return 'traffic_flood'
}

/**
 * If auto mode is on, spread once per valid anomaly source that has not yet
 * auto-spread, picking the live highest-risk eligible target.
 *
 * Enforces AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN on successful auto hops only
 * (seed attacks do not count). Manual spreadAttack is unaffected.
 *
 * @param {object} room
 * @returns {{
 *   ok: boolean
 *   reason?: string
 *   spreads: Array<{ sourceNodeId: string, targetNodeId: string, edgeId: string, presetId: string }>
 * }}
 */
export function evaluateAutoSpread(room) {
  if (!room || room.phase !== 'playing') {
    return { ok: false, reason: 'not_playing', spreads: [] }
  }
  if (getAttackSpreadMode(room) !== ATTACK_SPREAD_MODE_AUTO) {
    return { ok: false, reason: 'manual', spreads: [] }
  }
  if (room.detection?.tgnnCalibrating === true) {
    return { ok: false, reason: 'calibrating', spreads: [] }
  }
  if (room.autoSpreadInFlight === true) {
    return { ok: false, reason: 'in_flight', spreads: [] }
  }

  ensureAutoSpreadGuards(room)

  if (getAutoSpreadSuccessCount(room) >= AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN) {
    return { ok: false, reason: 'safety_cap', spreads: [] }
  }

  room.autoSpreadInFlight = true
  /** @type {Array<{ sourceNodeId: string, targetNodeId: string, edgeId: string, presetId: string }>} */
  const spreads = []

  try {
    const done = room.autoSpreadDoneBySource
    const anomalyIds = [...new Set((room.detection?.anomalyNodeIds ?? []).map(String))]

    for (const sourceNodeId of anomalyIds) {
      if (getAutoSpreadSuccessCount(room) >= AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN) {
        break
      }
      if (!sourceNodeId) continue
      if (done[sourceNodeId]) continue

      const eligible = listEligibleSpreadTargets(room, sourceNodeId)
      if (!eligible.length) continue

      const target = eligible[0]
      const targetNodeId = String(target.nodeId)
      const presetId = resolvePresetForAutoSpread(room, sourceNodeId)

      const result = spreadAttack(room, {
        sourceNodeId,
        targetNodeId,
        presetId,
      })

      if (!result.ok) {
        // Leave unmarked so a later tick can retry (e.g. transient validation miss).
        continue
      }

      room.autoSpreadSuccessCount = getAutoSpreadSuccessCount(room) + 1
      done[sourceNodeId] = {
        targetNodeId,
        tick: Number(room.simulationTick) || 0,
        edgeId: result.edgeId,
        presetId: result.presetId,
      }
      spreads.push({
        sourceNodeId: result.sourceNodeId,
        targetNodeId: result.targetNodeId,
        edgeId: result.edgeId,
        presetId: result.presetId,
      })

      if (room.autoSpreadSuccessCount >= AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN) {
        console.info('[auto-spread] safety cap reached', {
          count: room.autoSpreadSuccessCount,
          cap: AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN,
          roomId: room.id ?? null,
          tick: Number(room.simulationTick) || 0,
        })
      }
    }

    return { ok: true, spreads }
  } finally {
    room.autoSpreadInFlight = false
  }
}
