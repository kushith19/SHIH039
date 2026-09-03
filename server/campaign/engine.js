import { computePresetOverrides, isAttackPresetId } from '../../shared/attackPresets.js'
import { isLiveCampaignStatus } from '../../shared/campaigns.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { mergeMetrics, normalizeMetricPatch, normalizeMetricSnapshot } from '../nodeMetrics.js'

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
  if (Object.keys(patch).length === 0) return false
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
  const sim = room.hackSimulator ?? {}
  room.hackSimulator = {
    ...sim,
    nodeOverrides: {},
    edgeOverrides: {},
  }
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
