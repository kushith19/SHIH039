import {
  activeCampaign,
  appliedPresetSequence,
  campaignFingerprint,
  distinctAppliedPresets,
  patternTitleFor,
} from '../../shared/campaigns.js'
import { linkCampaignIncident, upsertAttackPattern, upsertCampaign } from '../metrics/store.js'

function campaignNodeSet(campaign, detection) {
  const ids = new Set()
  if (campaign.seedNodeId) ids.add(campaign.seedNodeId)
  for (const id of campaign.overrideNodeIds ?? []) if (id) ids.add(id)
  for (const stage of campaign.stages ?? []) {
    if (stage.targetNodeId) ids.add(stage.targetNodeId)
  }
  const spreadIds = [
    ...(detection?.compromisedNodeIds ?? []),
    ...(detection?.atRiskNodeIds ?? []),
    detection?.primarySpreadNodeId,
  ].filter(Boolean)
  const owned = ids
  for (const id of spreadIds) {
    if (owned.has(id)) {
      ids.add(id)
    }
  }
  for (const id of spreadIds) {
    if (campaign.status === 'active' && owned.size > 0) {
      const seedTouched = owned.has(campaign.seedNodeId)
      if (seedTouched) ids.add(id)
    }
  }
  return ids
}

function evidenceMetricKeys(incidents) {
  const keys = new Set()
  for (const inc of incidents) {
    for (const ev of inc.evidence ?? []) {
      if (ev.metric) keys.add(String(ev.metric))
    }
  }
  return [...keys]
}

function detectionTypesOf(incidents) {
  const types = new Set()
  for (const inc of incidents) {
    if (inc.detectionType) types.add(inc.detectionType)
    for (const t of inc.detectionTypes ?? []) types.add(t)
  }
  return [...types]
}

function shouldStorePattern(campaign, linkedNow) {
  const applied = (campaign.stages ?? []).filter((s) => s.status === 'applied').length
  const distinct = distinctAppliedPresets(campaign).length
  const incidentCount = (campaign.incidentIds ?? []).length
  if (applied >= 2 && incidentCount >= 1) return true
  if (distinct >= 2 && incidentCount >= 2) return true
  if (incidentCount >= 2 && linkedNow >= 1) return true
  if (campaign.status === 'completed' && applied >= 2 && incidentCount >= 1) return true
  return false
}

export function correlateCampaigns(room, detection) {
  if (!room || !detection) return detection
  const campaigns = Array.isArray(room.campaigns) ? room.campaigns : []
  const incidents = Array.isArray(detection.incidents) ? detection.incidents : []
  const tick = Number(detection.simulationTick ?? room.simulationTick) || 0

  for (const inc of incidents) {
    if (inc.campaignId == null) inc.campaignId = null
  }

  for (const campaign of campaigns) {
    if (campaign.status === 'aborted') continue
    const nodes = campaignNodeSet(campaign, detection)
    const linkedThisTick = []
    for (const inc of incidents) {
      if (!nodes.has(inc.endpointId)) continue
      inc.campaignId = campaign.id
      if (!Array.isArray(campaign.incidentIds)) campaign.incidentIds = []
      if (!campaign.incidentIds.includes(inc.id)) {
        campaign.incidentIds.push(inc.id)
        linkCampaignIncident(campaign.id, inc.id, inc.endpointId, tick)
        linkedThisTick.push(inc)
      }
    }

    const linkedIncidents = incidents.filter((i) => i.campaignId === campaign.id)
    campaign.detectionTypes = detectionTypesOf(linkedIncidents)
    campaign.metricKeys = evidenceMetricKeys(linkedIncidents)
    campaign.fingerprint = campaignFingerprint(campaign)

    const emerged = shouldStorePattern(campaign, linkedThisTick.length)
    if (emerged && !campaign.patternStored) {
      const signature = {
        playbookId: campaign.playbookId,
        stages: appliedPresetSequence(campaign),
        detectionTypes: campaign.detectionTypes,
        metricKeys: campaign.metricKeys,
        sectors: [...new Set(linkedIncidents.map((i) => i.sector).filter(Boolean))],
        evidenceCodes: [
          ...new Set(
            linkedIncidents.flatMap((i) => (i.evidence ?? []).map((ev) => ev.code).filter(Boolean))
          ),
        ].slice(0, 12),
      }
      upsertAttackPattern({
        fingerprint: campaign.fingerprint,
        title: patternTitleFor(campaign),
        roomId: room.id,
        campaignId: campaign.id,
        signature,
      })
      campaign.patternStored = true
    }

    if (linkedThisTick.length > 0 || (emerged && campaign.patternStored)) {
      upsertCampaign(campaign)
    }
  }

  detection.campaigns = campaigns.map((c) => ({
    id: c.id,
    playbookId: c.playbookId,
    title: c.title,
    status: c.status,
    fingerprint: c.fingerprint,
    incidentIds: c.incidentIds ?? [],
    patternStored: c.patternStored === true,
  }))
  return detection
}

export { activeCampaign }
