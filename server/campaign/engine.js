import { computePresetOverrides, isAttackPresetId } from '../../shared/attackPresets.js'
import { isLiveCampaignStatus } from '../../shared/campaigns.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { clearPersistedIncidentHistory } from '../metrics/incidents.js'
import { mergeMetrics, normalizeMetricPatch, normalizeMetricSnapshot } from '../nodeMetrics.js'
import { clearSpreadTargetLocks } from '../../shared/spreadTargetLock.js'

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

function applyOverride(room, nodeId, presetId) {
  const baseline = nodeBaseline(room, nodeId)
  const patch = normalizeMetricPatch(computePresetOverrides(presetId, baseline))
  if (Object.keys(patch).length === 0) {
    return false
  }
  const sim = room.hackSimulator ?? { nodeOverrides: {}, edgeOverrides: {}, active: true }
  const prev = normalizeMetricPatch(sim.nodeOverrides?.[nodeId])
  sim.nodeOverrides = { ...(sim.nodeOverrides ?? {}) }
  sim.nodeOverrides[nodeId] = mergeMetrics(prev, patch)
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
  try {
    if (room?.id) clearPersistedIncidentHistory(room.id)
  } catch {
    // store may not be initialized yet
  }
  const sim = room.hackSimulator ?? {}
  room.hackSimulator = {
    ...sim,
    nodeOverrides: {},
    edgeOverrides: {},
  }
  if (!Array.isArray(room.nodes)) return
  room.nodes = room.nodes.map((n) => {
    const prev = n?.data ?? {}
    if (runtimeStateOf(prev).quarantined !== true) return n
    return {
      ...n,
      data: {
        ...prev,
        runtimeState: { ...runtimeStateOf(prev), quarantined: false },
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
  if (!id || !sim?.nodeOverrides || sim.nodeOverrides[id] == null) return false
  const nodeOverrides = { ...sim.nodeOverrides }
  delete nodeOverrides[id]
  room.hackSimulator = { ...sim, nodeOverrides }
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
  applyOverride(room, nodeId, presetId)
  return { ok: true }
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
