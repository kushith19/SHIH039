/**
 * Archive live detection incidents into the post-analysis enrichment store.
 * Used for Post-Analysis recommendations / LLM workflow only.
 * Overview and Analyze → Overview analytics use SQLite `incidents`, not this archive.
 */

import { attachResponseClassification } from '../../shared/responsePolicy.js'
import {
  getArchiveIncidentByPersistentId,
  listArchiveIncidents,
  updateArchivePostAnalysisStatus,
  upsertArchiveIncident,
} from './store.js'

function telemetrySummaryFromEvidence(evidence) {
  const metrics = {}
  for (const e of evidence ?? []) {
    const key = e.metric || e.metricKey || e.key
    if (!key) continue
    metrics[key] = {
      observed: e.observed ?? e.observedValue ?? e.value ?? null,
      expected: e.expected ?? e.expectedValue ?? null,
      deviationPct: e.deviationPct ?? e.deviation ?? null,
      unit: e.unit ?? null,
    }
  }
  return Object.keys(metrics).length ? metrics : null
}

function attackCategoryFromIncident(incident, room) {
  try {
    const classified = attachResponseClassification(
      { ...incident },
      room?.nodes ?? []
    )
    return (
      classified?.responseClassification?.profile ||
      classified?.responseProfile ||
      incident.detectionType ||
      'GENERAL_RESIDUAL_ANOMALY'
    )
  } catch {
    return incident.detectionType || 'GENERAL_RESIDUAL_ANOMALY'
  }
}

/**
 * Build archive payload from a live (or persisted-projection) incident.
 */
export function buildArchiveRecordFromLive(room, incident, { nowMs = Date.now(), orchestration = null } = {}) {
  const liveId = String(incident.id ?? incident.liveIncidentId ?? '')
  if (!liveId) return null
  const evidence = Array.isArray(incident.evidence) ? incident.evidence : []
  const attackCategory = attackCategoryFromIncident(incident, room)
  const nodeId = incident.endpointId || incident.affectedNodeId || null

  const planPrimary = orchestration?.plan?.primaryIncidentId
  const orchestrationPerformed = Boolean(
    (planPrimary && (planPrimary === liveId || planPrimary === incident.persistentId)) ||
      incident.orchestrationPerformed
  )

  return {
    persistentIncidentId: incident.persistentId || incident.incidentId || null,
    liveIncidentId: liveId,
    roomId: String(room.id),
    firstDetectedAtMs: incident.timestamp
      ? Date.parse(incident.timestamp) || nowMs
      : incident.detectedAtMs || nowMs,
    updatedAtMs: nowMs,
    attackType: incident.detectionType || null,
    attackCategory,
    affectedAssetId: nodeId,
    affectedNodeId: nodeId,
    affectedLabel: incident.endpointLabel || incident.affectedLabel || nodeId,
    severity: incident.severity || 'low',
    status: incident.status || 'open',
    detectionSignals: incident.detectionTypes || [incident.detectionType].filter(Boolean),
    evidence,
    telemetrySummary: telemetrySummaryFromEvidence(evidence),
    trustScore: Number.isFinite(Number(incident.trustScore)) ? Number(incident.trustScore) : null,
    anomalyScore: Number.isFinite(Number(incident.anomalyScore))
      ? Number(incident.anomalyScore)
      : null,
    drift: incident.drift ?? null,
    graphContext: incident.graphContext ?? {
      peerExposedNodeIds: incident.peerExposedNodeIds ?? [],
      propagatedNodeIds: incident.propagatedNodeIds ?? [],
      propagationPaths: incident.propagationPaths ?? {},
    },
    propagation: {
      peerExposedNodeIds: incident.peerExposedNodeIds ?? [],
      propagatedNodeIds: incident.propagatedNodeIds ?? [],
      primarySpreadNodeId: incident.primarySpreadNodeId ?? null,
    },
    orchestrationPerformed,
    responseActions: incident.actionsTaken ?? [],
    recoveryStatus: incident.recoveryStatus ?? null,
    source: 'live',
    payload: {
      criticality: incident.criticality ?? null,
      sector: incident.sector ?? null,
      campaignId: incident.campaignId ?? null,
      confidence: incident.confidence ?? null,
    },
  }
}

/**
 * Persist archive rows for this tick's incidents. Safe to call from detection loop.
 */
export function archiveDetectionIncidents(room, detection, { orchestration = null } = {}) {
  if (!room?.id) return []
  const nowMs = Date.now()
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []
  const out = []
  for (const inc of incidents) {
    const record = buildArchiveRecordFromLive(room, inc, {
      nowMs,
      orchestration: orchestration ?? room.responseOrchestration,
    })
    if (!record) continue
    try {
      const saved = upsertArchiveIncident(record)
      if (saved) {
        out.push(saved)
        inc.archiveId = saved.archiveId
      }
    } catch (err) {
      console.error('[POST-ANALYSIS] archive upsert failed', err?.message ?? err)
    }
  }
  return out
}

/**
 * Update archive after orchestration recovery for a focus incident.
 */
export function markArchiveOrchestrationOutcome(
  room,
  {
    liveIncidentId,
    persistentIncidentId,
    responseActions = [],
    recoveryStatus = 'recovered',
  } = {}
) {
  if (!room?.id) return null

  let archived = null
  if (persistentIncidentId) {
    archived = getArchiveIncidentByPersistentId(room.id, persistentIncidentId)
  }
  if (!archived && liveIncidentId) {
    const list = listArchiveIncidents(room.id, { limit: 80 })
    archived =
      list.find((i) => i.liveIncidentId === String(liveIncidentId)) || null
  }
  if (!archived) return null

  return updateArchivePostAnalysisStatus(archived.archiveId, {
    orchestrationPerformed: true,
    responseActions,
    recoveryStatus,
    status: 'cleared',
  })
}
