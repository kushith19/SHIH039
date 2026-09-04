/**
 * Post-analysis pipeline — async analysis layer after detection / recovery.
 * Never blocks live orchestration.
 */

import { POST_ANALYSIS_STATUS, POST_ANALYSIS_SOURCE } from '../../shared/postAnalysis/schema.js'
import { buildRecommendationFingerprint } from '../../shared/postAnalysis/fingerprint.js'
import { markArchiveOrchestrationOutcome } from './archive.js'
import { requestPostAnalysisRecommendations } from './llmClient.js'
import {
  getArchiveIncident,
  listArchiveIncidents,
  listRecommendations,
  updateArchivePostAnalysisStatus,
  upsertRecommendationFromValidated,
} from './store.js'

/** @type {Set<string>} */
const inFlight = new Set()

function shout(msg) {
  console.log(msg)
}

function previousOccurrences(roomId, archive) {
  const all = listArchiveIncidents(roomId, { limit: 200 })
  return all
    .filter(
      (i) =>
        i.archiveId !== archive.archiveId &&
        (i.affectedAssetId === archive.affectedAssetId ||
          i.affectedNodeId === archive.affectedNodeId) &&
        (i.attackCategory === archive.attackCategory ||
          i.attackType === archive.attackType)
    )
    .slice(0, 8)
    .map((i) => ({
      archiveId: i.archiveId,
      firstDetectedAtMs: i.firstDetectedAtMs,
      severity: i.severity,
      recoveryStatus: i.recoveryStatus,
      postAnalysisStatus: i.postAnalysisStatus,
    }))
}

function existingRecommendationsContext(roomId, archive) {
  return listRecommendations(roomId)
    .filter(
      (r) =>
        r.affectedAssetId === archive.affectedAssetId ||
        r.attackCategory === archive.attackCategory
    )
    .slice(0, 10)
    .map((r) => ({
      recommendationId: r.recommendationId,
      title: r.title,
      status: r.status,
      occurrenceCount: r.occurrenceCount,
      completedAtMs: r.completedAtMs,
      fingerprint: r.fingerprint,
    }))
}

function buildContext(archive) {
  const prev = previousOccurrences(archive.roomId, archive)
  const existing = existingRecommendationsContext(archive.roomId, archive)
  return {
    incident: {
      archiveId: archive.archiveId,
      liveIncidentId: archive.liveIncidentId,
      attackType: archive.attackType,
      attackCategory: archive.attackCategory,
      affectedAssetId: archive.affectedAssetId,
      affectedLabel: archive.affectedLabel,
      severity: archive.severity,
      status: archive.status,
      anomalyScore: archive.anomalyScore,
      firstDetectedAtMs: archive.firstDetectedAtMs,
      lastSeenAtMs: archive.lastSeenAtMs,
    },
    attackProfile: archive.attackCategory,
    telemetryEvidence: archive.evidence,
    trustScore: archive.trustScore,
    graphContext: archive.graphContext,
    responseActionsTaken: archive.responseActions,
    recoveryStatus: archive.recoveryStatus,
    previousOccurrences: prev,
    existingRecommendations: existing,
    recurringNote:
      prev.length > 0
        ? `This attack pattern occurred ${prev.length + 1} times against the same asset.`
        : null,
  }
}

/**
 * Run post-analysis for one archived incident. Idempotent while in-flight.
 */
export async function runPostAnalysisForArchive(archiveId, { force = false } = {}) {
  const id = String(archiveId ?? '')
  if (!id) return { ok: false, message: 'archiveId required' }
  if (inFlight.has(id)) {
    return { ok: false, message: 'Post-analysis already running', status: 'running' }
  }

  const archive = getArchiveIncident(id)
  if (!archive) return { ok: false, message: 'Archive incident not found' }

  if (
    !force &&
    archive.postAnalysisStatus === POST_ANALYSIS_STATUS.COMPLETE &&
    !archive.postAnalysisError
  ) {
    return { ok: true, skipped: true, message: 'Already analyzed', archive }
  }

  inFlight.add(id)
  shout(`[POST-ANALYSIS] incident=${id} START`)

  try {
    updateArchivePostAnalysisStatus(id, {
      postAnalysisStatus: POST_ANALYSIS_STATUS.RUNNING,
      postAnalysisError: null,
    })

    const context = buildContext(archive)
    const llm = await requestPostAnalysisRecommendations(context, { archiveId: id })

    if (!llm.ok || !llm.validated.length) {
      updateArchivePostAnalysisStatus(id, {
        postAnalysisStatus: POST_ANALYSIS_STATUS.UNAVAILABLE,
        postAnalysisAtMs: Date.now(),
        postAnalysisError: llm.error || 'Analysis unavailable',
      })
      shout(`[POST-ANALYSIS] incident=${id} COMPLETE status=unavailable`)
      return {
        ok: false,
        message: llm.error || 'Analysis unavailable',
        rejected: llm.rejected,
        archive: getArchiveIncident(id),
      }
    }

    const results = []
    for (const validated of llm.validated) {
      const fingerprint = buildRecommendationFingerprint({
        attackCategory: archive.attackCategory,
        affectedAssetId: archive.affectedAssetId,
        recommendation: validated.recommendation,
        title: validated.title,
      })
      const { recommendation, action } = upsertRecommendationFromValidated(
        archive.roomId,
        validated,
        {
          fingerprint,
          archiveId: id,
          attackCategory: archive.attackCategory,
          affectedAssetId: archive.affectedAssetId,
          source: POST_ANALYSIS_SOURCE.LLM,
        }
      )
      const marker =
        action === 'created'
          ? 'CREATED'
          : action === 'duplicate'
            ? 'DUPLICATE_EXISTING'
            : 'RECURRED'
      shout(`[POST-ANALYSIS] recommendation=${recommendation.recommendationId} ${marker}`)
      results.push({ recommendation, action })
    }

    updateArchivePostAnalysisStatus(id, {
      postAnalysisStatus: POST_ANALYSIS_STATUS.COMPLETE,
      postAnalysisAtMs: Date.now(),
      postAnalysisError: null,
    })
    shout(`[POST-ANALYSIS] incident=${id} COMPLETE`)
    return {
      ok: true,
      results,
      rejected: llm.rejected,
      archive: getArchiveIncident(id),
    }
  } catch (err) {
    console.error(`[POST-ANALYSIS] incident=${id} ERROR`, err)
    updateArchivePostAnalysisStatus(id, {
      postAnalysisStatus: POST_ANALYSIS_STATUS.UNAVAILABLE,
      postAnalysisAtMs: Date.now(),
      postAnalysisError: String(err?.message ?? err),
    })
    return { ok: false, message: String(err?.message ?? err), archive: getArchiveIncident(id) }
  } finally {
    inFlight.delete(id)
  }
}

/**
 * Fire-and-forget schedule — never awaits in the caller's critical path.
 */
export function schedulePostAnalysis(archiveId, opts = {}) {
  const id = String(archiveId ?? '')
  if (!id) return
  setTimeout(() => {
    void runPostAnalysisForArchive(id, opts).catch((err) => {
      console.error('[POST-ANALYSIS] scheduled run failed', err)
    })
  }, 0)
}

/**
 * After recovery: mark archive + schedule post-analysis.
 */
export function schedulePostAnalysisAfterRecovery(
  room,
  {
    liveIncidentId,
    persistentIncidentId,
    responseActions = [],
    recoveryStatus = 'recovered',
  } = {}
) {
  try {
    const archived = markArchiveOrchestrationOutcome(room, {
      liveIncidentId,
      persistentIncidentId,
      responseActions,
      recoveryStatus,
    })
    if (archived?.archiveId) {
      schedulePostAnalysis(archived.archiveId)
      return archived
    }

    const list = listArchiveIncidents(room.id, { limit: 50 })
    const hit =
      list.find((i) => i.liveIncidentId === String(liveIncidentId || '')) ||
      list.find((i) => i.persistentIncidentId === String(persistentIncidentId || ''))
    if (hit) {
      updateArchivePostAnalysisStatus(hit.archiveId, {
        orchestrationPerformed: true,
        responseActions,
        recoveryStatus,
        status: 'cleared',
      })
      schedulePostAnalysis(hit.archiveId)
      return getArchiveIncident(hit.archiveId)
    }
  } catch (err) {
    console.error('[POST-ANALYSIS] schedule after recovery failed', err)
  }
  return null
}
