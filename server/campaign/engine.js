import { nanoid } from 'nanoid'
import { computePresetOverrides, isAttackPresetId } from '../../shared/attackPresets.js'
import {
  MANUAL_PLAYBOOK_ID,
  activeCampaign,
  campaignFingerprint,
  clonePlaybookStages,
  getPlaybook,
  nextPendingStage,
  playbookTitle,
} from '../../shared/campaigns.js'
import { runtimeStateOf } from '../infrastructureNode.js'
import { mergeMetrics, normalizeMetricPatch, normalizeMetricSnapshot } from '../nodeMetrics.js'
import { appendCampaignEvent, upsertCampaign } from '../metrics/store.js'

function ensureList(room) {
  if (!Array.isArray(room.campaigns)) room.campaigns = []
  return room.campaigns
}

export function persistCampaign(campaign, eventKind, eventPayload) {
  try {
    upsertCampaign(campaign)
    if (eventKind) {
      appendCampaignEvent(
        campaign.id,
        Number(campaign.startedTick) || 0,
        eventKind,
        eventPayload ?? {}
      )
    }
  } catch (err) {
    console.error('[campaign] persist failed', err)
  }
}

function rememberCampaign(room, campaign) {
  const list = ensureList(room)
  const idx = list.findIndex((c) => c.id === campaign.id)
  if (idx >= 0) list[idx] = campaign
  else list.unshift(campaign)
  if (list.length > 24) list.length = 24
}

function nodeById(room, nodeId) {
  return room.nodes.find((n) => n.id === nodeId) ?? null
}

function isQuarantined(node) {
  return runtimeStateOf(node?.data).quarantined === true
}

function neighborsOf(room, nodeId) {
  const ids = []
  for (const e of room.edges ?? []) {
    if (e.source === nodeId) ids.push(e.target)
    else if (e.target === nodeId) ids.push(e.source)
  }
  return [...new Set(ids)]
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

function pickPrimarySpread(room, seedNodeId) {
  const detection = room.detection ?? {}
  const primary = detection.primarySpreadNodeId
  if (primary && primary !== seedNodeId && nodeById(room, primary)) return primary
  const atRisk = Array.isArray(detection.atRiskNodeIds) ? detection.atRiskNodeIds : []
  const hop = atRisk.find((id) => id && id !== seedNodeId && nodeById(room, id))
  if (hop) return hop
  const nbs = neighborsOf(room, seedNodeId).filter((id) => nodeById(room, id))
  return nbs[0] ?? null
}

function pickHighFileNeighbor(room, seedNodeId) {
  const nbs = neighborsOf(room, seedNodeId)
  let best = null
  let bestFiles = -1
  for (const id of nbs) {
    const node = nodeById(room, id)
    if (!node || isQuarantined(node)) continue
    const files = Number(nodeBaseline(room, id).filesDownloaded) || 0
    if (files > bestFiles) {
      bestFiles = files
      best = id
    }
  }
  return best ?? pickPrimarySpread(room, seedNodeId)
}

function pickInjected(room, seedNodeId) {
  const nbs = neighborsOf(room, seedNodeId)
  for (const id of nbs) {
    const node = nodeById(room, id)
    if (node && runtimeStateOf(node.data).provenance === 'injected' && !isQuarantined(node)) {
      return id
    }
  }
  const any = room.nodes.find(
    (n) => runtimeStateOf(n.data).provenance === 'injected' && !isQuarantined(n)
  )
  return any?.id ?? null
}

function resolveStageTarget(room, campaign, stage) {
  if (stage.explicitNodeId && nodeById(room, stage.explicitNodeId)) {
    return stage.explicitNodeId
  }
  switch (stage.target) {
    case 'explicit':
      return stage.explicitNodeId ?? campaign.seedNodeId
    case 'primarySpread':
      return pickPrimarySpread(room, campaign.seedNodeId) ?? campaign.seedNodeId
    case 'highFileNeighbor':
      return pickHighFileNeighbor(room, campaign.seedNodeId) ?? campaign.seedNodeId
    case 'injected':
      return pickInjected(room, campaign.seedNodeId)
    case 'seed':
    default:
      return campaign.seedNodeId
  }
}

function addOverrideNode(campaign, nodeId) {
  if (!nodeId) return
  if (!Array.isArray(campaign.overrideNodeIds)) campaign.overrideNodeIds = []
  if (!campaign.overrideNodeIds.includes(nodeId)) campaign.overrideNodeIds.push(nodeId)
}

function markTerminal(campaign, status, tick) {
  campaign.status = status
  campaign.completedTick = Number(tick) || 0
  campaign.fingerprint = campaignFingerprint(campaign)
}

function applyStage(room, campaign, stage) {
  const tick = Number(room.simulationTick) || 0
  const targetId = resolveStageTarget(room, campaign, stage)
  const node = targetId ? nodeById(room, targetId) : null
  if (!node || isQuarantined(node)) {
    stage.status = 'skipped'
    stage.appliedTick = tick
    stage.targetNodeId = targetId ?? null
    appendCampaignEvent(campaign.id, tick, 'stage_skipped', {
      stageId: stage.id,
      targetNodeId: targetId,
      reason: !node ? 'missing' : 'quarantined',
    })
    return 'skipped'
  }
  applyOverride(room, targetId, stage.presetId)
  stage.status = 'applied'
  stage.appliedTick = tick
  stage.targetNodeId = targetId
  addOverrideNode(campaign, targetId)
  appendCampaignEvent(campaign.id, tick, 'stage_applied', {
    stageId: stage.id,
    presetId: stage.presetId,
    targetNodeId: targetId,
  })
  return 'applied'
}

function finishIfDone(room, campaign) {
  if (campaign.playbookId === MANUAL_PLAYBOOK_ID) return
  const pending = nextPendingStage(campaign)
  if (pending) return
  const tick = Number(room.simulationTick) || 0
  const applied = (campaign.stages ?? []).filter((s) => s.status === 'applied').length
  markTerminal(campaign, applied > 0 ? 'completed' : 'aborted', tick)
  appendCampaignEvent(campaign.id, tick, campaign.status, { fingerprint: campaign.fingerprint })
}

function maybeContain(room, campaign) {
  const seed = nodeById(room, campaign.seedNodeId)
  if (!seed || !isQuarantined(seed)) return false
  const pending = nextPendingStage(campaign)
  if (!pending) return false
  const tick = Number(room.simulationTick) || 0
  markTerminal(campaign, 'contained', tick)
  appendCampaignEvent(campaign.id, tick, 'contained', { seedNodeId: campaign.seedNodeId })
  return true
}

function newCampaignId() {
  return `cmp-${nanoid(10)}`
}

export function abortActiveCampaigns(room, status = 'aborted') {
  const tick = Number(room.simulationTick) || 0
  let changed = false
  for (const campaign of ensureList(room)) {
    if (campaign.status !== 'active') continue
    markTerminal(campaign, status, tick)
    persistCampaign(campaign, status, { seedNodeId: campaign.seedNodeId })
    changed = true
  }
  return changed
}

export function abortAndClearAttacks(room) {
  abortActiveCampaigns(room, 'aborted')
  const sim = room.hackSimulator ?? {}
  room.hackSimulator = {
    ...sim,
    nodeOverrides: {},
    edgeOverrides: {},
  }
}

export function attachOverrideNodes(room, nodeIds) {
  const campaign = activeCampaign(ensureList(room))
  if (!campaign) return
  for (const id of nodeIds ?? []) addOverrideNode(campaign, id)
  persistCampaign(campaign)
}

export function startPlaybookCampaign(room, playbookId, seedNodeId) {
  const book = getPlaybook(playbookId)
  if (!book) return { ok: false, message: 'Unknown playbook' }
  const seed = nodeById(room, seedNodeId)
  if (!seed) return { ok: false, message: 'Select a target node' }
  abortAndClearAttacks(room)
  const campaign = {
    id: newCampaignId(),
    roomId: room.id,
    playbookId: book.id,
    title: book.title,
    status: 'active',
    seedNodeId,
    stageIndex: 0,
    startedTick: Number(room.simulationTick) || 0,
    completedTick: null,
    incidentIds: [],
    fingerprint: '',
    stages: clonePlaybookStages(book.id),
    overrideNodeIds: [seedNodeId],
    patternStored: false,
    detectionTypes: [],
    metricKeys: [],
  }
  rememberCampaign(room, campaign)
  persistCampaign(campaign, 'started', { playbookId: book.id, seedNodeId })
  tickCampaigns(room)
  return { ok: true, campaign }
}

export function applyManualPreset(room, nodeId, presetId) {
  if (!isAttackPresetId(presetId)) return { ok: false, message: 'Unknown preset' }
  const node = nodeById(room, nodeId)
  if (!node) return { ok: false, message: 'Select a target node' }
  let campaign = activeCampaign(ensureList(room))
  const tick = Number(room.simulationTick) || 0
  if (!campaign) {
    campaign = {
      id: newCampaignId(),
      roomId: room.id,
      playbookId: MANUAL_PLAYBOOK_ID,
      title: playbookTitle(MANUAL_PLAYBOOK_ID),
      status: 'active',
      seedNodeId: nodeId,
      stageIndex: 0,
      startedTick: tick,
      completedTick: null,
      incidentIds: [],
      fingerprint: '',
      stages: [],
      overrideNodeIds: [nodeId],
      patternStored: false,
      detectionTypes: [],
      metricKeys: [],
    }
    rememberCampaign(room, campaign)
    persistCampaign(campaign, 'started', { playbookId: MANUAL_PLAYBOOK_ID, seedNodeId: nodeId })
  }
  const stage = {
    id: `manual-${campaign.stages.length + 1}`,
    presetId,
    delayTicks: 0,
    target: 'explicit',
    explicitNodeId: nodeId,
    status: 'pending',
    appliedTick: null,
    targetNodeId: null,
  }
  campaign.stages.push(stage)
  applyStage(room, campaign, stage)
  campaign.stageIndex = campaign.stages.filter((s) => s.status !== 'pending').length
  campaign.fingerprint = campaignFingerprint(campaign)
  persistCampaign(campaign)
  rememberCampaign(room, campaign)
  return { ok: true, campaign }
}

export function tickCampaigns(room) {
  if (!room || room.phase !== 'playing') return
  const tick = Number(room.simulationTick) || 0
  for (const campaign of ensureList(room)) {
    if (campaign.status !== 'active') continue
    if (maybeContain(room, campaign)) {
      persistCampaign(campaign)
      continue
    }
    let dirty = false
    while (true) {
      const stage = nextPendingStage(campaign)
      if (!stage) break
      const lastApplied = [...(campaign.stages ?? [])]
        .reverse()
        .find((s) => s.status === 'applied' || s.status === 'skipped')
      const readyFrom = lastApplied?.appliedTick ?? campaign.startedTick
      const delay = Number(stage.delayTicks) || 0
      if (tick < Number(readyFrom) + delay) break
      applyStage(room, campaign, stage)
      campaign.stageIndex = campaign.stages.filter((s) => s.status !== 'pending').length
      campaign.fingerprint = campaignFingerprint(campaign)
      dirty = true
    }
    const statusBefore = campaign.status
    finishIfDone(room, campaign)
    if (dirty || campaign.status !== statusBefore) {
      persistCampaign(campaign)
    }
  }
}

export function publicCampaigns(room) {
  return (room.campaigns ?? []).map((c) => ({
    id: c.id,
    playbookId: c.playbookId,
    title: c.title,
    status: c.status,
    seedNodeId: c.seedNodeId,
    stageIndex: c.stageIndex,
    startedTick: c.startedTick,
    completedTick: c.completedTick,
    incidentIds: c.incidentIds ?? [],
    fingerprint: c.fingerprint,
    stages: c.stages ?? [],
    overrideNodeIds: c.overrideNodeIds ?? [],
    patternStored: c.patternStored === true,
  }))
}
