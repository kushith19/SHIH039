import {
  computePresetOverrides,
  isAttackPresetId,
} from '../../shared/attackPresets.js'
import { validateSpreadAttack } from '../../shared/attackSpread.js'
import { isLiveCampaignStatus } from '../../shared/campaigns.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { clearAutoSpreadGuards } from '../attack/autoSpread.js'
import { mergeMetrics, normalizeMetricPatch, normalizeMetricSnapshot } from '../nodeMetrics.js'
import { clearSpreadTargetLocks } from '../../shared/spreadTargetLock.js'
import {
  clearActiveAttackSequences,
  listActiveSequences,
  recordSeedAttackEvent,
  recordSpreadAttackEvent,
} from '../attack/events.js'
import { normalizeAttackSpreadMode } from '../../shared/attackSpreadMode.js'

function nodeById(room, nodeId) {
  return room.nodes.find((n) => n.id === nodeId) ?? null
}

function nodeBaseline(room, nodeId) {
  const node = nodeById(room, nodeId)
  const sim = room.hackSimulator
  const live = normalizeMetricSnapshot(node?.data, node)
  if (sim?.active !== true) return live
  const locked = sim.nodeScenarioBaselines?.[nodeId]
  if (locked !== undefined) return normalizeMetricSnapshot(locked, node)
  return live
}

/**
 * Hop depth for the next spread target: seed = stage 0, first hop = 1, …
 * Uses the active attack sequence whose tip is sourceNodeId.
 */
function stageIndexForSpread(room, sourceNodeId) {
  const source = String(sourceNodeId ?? '')
  if (!source) return 1
  const tipSeq = listActiveSequences(room)
    .filter((s) => s.status === 'active' && s.nodePath?.[s.nodePath.length - 1] === source)
    .sort((a, b) => (Number(b.lastTick) || 0) - (Number(a.lastTick) || 0))[0]
  const depth = tipSeq?.nodePath?.length
  return Number.isFinite(Number(depth)) && Number(depth) > 0 ? Number(depth) : 1
}

function applyOverride(room, nodeId, presetId, { stageIndex = 0 } = {}) {
  const baseline = nodeBaseline(room, nodeId)
  const patch = normalizeMetricPatch(
    computePresetOverrides(presetId, baseline, { stageIndex })
  )
  if (Object.keys(patch).length === 0) {
    return false
  }
  const sim = room.hackSimulator ?? { nodeOverrides: {}, edgeOverrides: {}, active: true }
  const prev = normalizeMetricPatch(sim.nodeOverrides?.[nodeId])
  sim.nodeOverrides = { ...(sim.nodeOverrides ?? {}) }
  sim.nodeOverrides[nodeId] = mergeMetrics(prev, patch)
  // Attack presets are explicit operational attacks — enable under_attack sampling.
  sim.nodeAttackStates = { ...(sim.nodeAttackStates ?? {}) }
  sim.nodeAttackStates[nodeId] = true
  sim.nodePresetIds = { ...(sim.nodePresetIds ?? {}) }
  sim.nodePresetIds[nodeId] = String(presetId)
  room.hackSimulator = sim
  return true
}

export function expireRecognizedCampaigns(room, tick = 0) {
  const now = Number(tick) || Number(room?.simulationTick) || 0
  let changed = false
  for (const campaign of room?.campaigns ?? []) {
    if (!isLiveCampaignStatus(campaign.status)) continue
    campaign.status = 'expired'
    campaign.completedTick = now
    changed = true
  }
  return changed
}

export function clearIncidentLedger(room) {
  if (room) room.incidentLedger = []
}

export function abortAndClearAttacks(room) {
  expireRecognizedCampaigns(room)
  clearIncidentLedger(room)
  clearSpreadTargetLocks(room)
  clearActiveAttackSequences(room)
  clearAutoSpreadGuards(room)
  // Live attack state only — durable SQLite incident history is retained.
  const sim = room.hackSimulator ?? {}
  room.hackSimulator = {
    ...sim,
    nodeOverrides: {},
    edgeOverrides: {},
    nodeAttackStates: {},
    // Preserve defender mode across Clear Attacks; reset only on match rebuild.
    attackSpreadMode: normalizeAttackSpreadMode(sim.attackSpreadMode),
  }
  if (!Array.isArray(room.nodes)) return
  room.nodes = room.nodes.map((n) => {
    const prev = n?.data ?? {}
    const rs = runtimeStateOf(prev)
    if (rs.quarantined !== true) return n
    return {
      ...n,
      data: {
        ...prev,
        runtimeState: { ...rs, quarantined: false },
      },
    }
  })
}

/**
 * Remove the active attack metric override for one node.
 * Does not touch other nodes' overrides or edgeOverrides.
 * @returns {boolean} true if an override entry was removed
 */
export function clearNodeAttackOverride(room, nodeId) {
  const id = String(nodeId ?? '')
  const sim = room?.hackSimulator
  if (!id || !sim) return false
  const hadOverride = sim.nodeOverrides?.[id] != null
  const hadAttack = sim.nodeAttackStates?.[id] != null
  if (!hadOverride && !hadAttack) return false
  const nodeOverrides = { ...(sim.nodeOverrides ?? {}) }
  delete nodeOverrides[id]
  const nodeAttackStates = { ...(sim.nodeAttackStates ?? {}) }
  delete nodeAttackStates[id]
  room.hackSimulator = { ...sim, nodeOverrides, nodeAttackStates }
  return true
}

/** @deprecated Overrides are not attached to attacker-declared campaigns. */
export function attachOverrideNodes(_room, _nodeIds) {}

export function applyManualPreset(room, nodeId, presetId) {
  if (!isAttackPresetId(presetId)) return { ok: false, message: 'Unknown preset' }
  const node = nodeById(room, nodeId)
  if (!node) return { ok: false, message: 'Select a target node' }
  if (runtimeStateOf(node?.data).quarantined === true) {
    return { ok: false, message: 'Target is quarantined' }
  }
  const applied = applyOverride(room, nodeId, presetId)
  if (!applied) return { ok: false, message: 'Could not apply attack override' }
  recordSeedAttackEvent(room, {
    targetNodeId: String(nodeId),
    presetId,
  })
  return { ok: true }
}

/**
 * Real attack spread: write a normal metric override on a direct downstream
 * neighbor that current detection marks as exposed/risk-relevant.
 * Does not auto-spread; does not invent detection state.
 *
 * @param {object} room
 * @param {{ sourceNodeId: string, targetNodeId: string, presetId: string }} args
 * @returns {{ ok: true, sourceNodeId: string, targetNodeId: string, edgeId: string, presetId: string }
 *   | { ok: false, message: string }}
 */
export function spreadAttack(room, { sourceNodeId, targetNodeId, presetId }) {
  if (!isAttackPresetId(presetId)) {
    return { ok: false, message: 'Unknown preset' }
  }
  if (room?.phase !== 'playing') {
    return { ok: false, message: 'Spread is only available during play' }
  }

  const target = nodeById(room, targetNodeId)
  if (target && runtimeStateOf(target?.data).quarantined === true) {
    return { ok: false, message: 'Target is quarantined' }
  }

  const check = validateSpreadAttack(room, sourceNodeId, targetNodeId)
  if (!check.ok) return check

  const stageIndex = stageIndexForSpread(room, sourceNodeId)
  const applied = applyOverride(room, String(targetNodeId), presetId, { stageIndex })
  if (!applied) {
    return { ok: false, message: 'Could not apply attack override to target' }
  }

  recordSpreadAttackEvent(room, {
    sourceNodeId: String(sourceNodeId),
    targetNodeId: String(targetNodeId),
    edgeId: check.edgeId,
    presetId,
  })

  return {
    ok: true,
    sourceNodeId: String(sourceNodeId),
    targetNodeId: String(targetNodeId),
    edgeId: check.edgeId,
    presetId,
  }
}

export function publicCampaigns(room) {
  return (room.campaigns ?? []).map((c) => ({
    id: c.id,
    campaignType: c.campaignType,
    title: c.title,
    status: c.status,
    originEndpointId: c.originEndpointId ?? null,
    startedTick: c.startedTick,
    lastSeenTick: c.lastSeenTick,
    completedTick: c.completedTick,
    incidentIds: c.incidentIds ?? [],
    endpointIds: c.endpointIds ?? [],
    sectors: c.sectors ?? [],
    campaignMatchScore: c.campaignMatchScore ?? 0,
    scores: c.scores ?? {},
    financialExposure: c.financialExposure ?? 0,
    propagationPath: c.propagationPath ?? [],
    signals: c.signals ?? [],
    commanderAssessment: c.commanderAssessment ?? null,
    mitreCandidates: c.mitreCandidates ?? [],
  }))
}
