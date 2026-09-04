/**
 * Post-Analysis persistence — SQLite archive that survives match wipes.
 * Separate from match-scoped `incidents` table.
 */

import { getMetricsDb } from '../metrics/store.js'
import {
  POST_ANALYSIS_STATUS,
  RECOMMENDATION_STATUS,
  isOpenLikeStatus,
} from '../../shared/postAnalysis/schema.js'
import { buildRecommendationFingerprint } from '../../shared/postAnalysis/fingerprint.js'

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function rowToArchiveIncident(row) {
  if (!row) return null
  return {
    archiveId: row.archive_id,
    persistentIncidentId: row.persistent_incident_id || null,
    liveIncidentId: row.live_incident_id,
    roomId: row.room_id,
    firstDetectedAtMs: row.first_detected_at_ms,
    lastSeenAtMs: row.last_seen_at_ms,
    attackType: row.attack_type,
    attackCategory: row.attack_category,
    affectedAssetId: row.affected_asset_id,
    affectedNodeId: row.affected_node_id,
    affectedLabel: row.affected_label,
    severity: row.severity,
    status: row.status,
    detectionSignals: parseJson(row.detection_signals_json, []),
    evidence: parseJson(row.evidence_json, []),
    telemetrySummary: parseJson(row.telemetry_summary_json, null),
    trustScore: row.trust_score,
    anomalyScore: row.anomaly_score,
    drift: parseJson(row.drift_json, null),
    graphContext: parseJson(row.graph_context_json, null),
    propagation: parseJson(row.propagation_json, null),
    orchestrationPerformed: Boolean(row.orchestration_performed),
    responseActions: parseJson(row.response_actions_json, []),
    recoveryStatus: row.recovery_status,
    postAnalysisStatus: row.post_analysis_status,
    postAnalysisAtMs: row.post_analysis_at_ms,
    postAnalysisError: row.post_analysis_error,
    source: row.source,
    payload: parseJson(row.payload_json, null),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  }
}

function rowToRecommendation(row) {
  if (!row) return null
  return {
    recommendationId: row.recommendation_id,
    fingerprint: row.fingerprint,
    roomId: row.room_id,
    title: row.title,
    problem: row.problem,
    recommendation: row.recommendation,
    reason: row.reason,
    priority: row.priority,
    category: row.category,
    status: row.status,
    softwareOnly: Boolean(row.software_only),
    occurrenceCount: row.occurrence_count,
    firstSeenAtMs: row.first_seen_at_ms,
    lastSeenAtMs: row.last_seen_at_ms,
    completedAtMs: row.completed_at_ms,
    dismissedAtMs: row.dismissed_at_ms,
    recurredAtMs: row.recurred_at_ms,
    attackCategory: row.attack_category,
    affectedAssetId: row.affected_asset_id,
    source: row.source,
    priorCompletionNote: row.prior_completion_note,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  }
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Upsert an archive episode. Prefer linking by persistentIncidentId when present;
 * otherwise refresh the latest open-ish row for the same liveIncidentId within a short window.
 */
export function upsertArchiveIncident(record) {
  const conn = getMetricsDb()
  const nowMs = Number(record.updatedAtMs ?? Date.now())
  const roomId = String(record.roomId ?? '')
  const liveId = String(record.liveIncidentId ?? '')
  if (!roomId || !liveId) return null

  let existing = null
  if (record.persistentIncidentId) {
    existing = conn
      .prepare(
        `SELECT * FROM post_analysis_incidents
         WHERE room_id = ? AND persistent_incident_id = ?
         LIMIT 1`
      )
      .get(roomId, record.persistentIncidentId)
  }
  if (!existing) {
    // Same live id seen within 2 hours → refresh last_seen (one episode).
    existing = conn
      .prepare(
        `SELECT * FROM post_analysis_incidents
         WHERE room_id = ? AND live_incident_id = ?
           AND last_seen_at_ms > ?
         ORDER BY last_seen_at_ms DESC
         LIMIT 1`
      )
      .get(roomId, liveId, nowMs - 2 * 60 * 60 * 1000)
  }

  if (existing) {
    conn
      .prepare(
        `UPDATE post_analysis_incidents SET
          persistent_incident_id = COALESCE(?, persistent_incident_id),
          last_seen_at_ms = ?,
          attack_type = COALESCE(?, attack_type),
          attack_category = COALESCE(?, attack_category),
          affected_asset_id = COALESCE(?, affected_asset_id),
          affected_node_id = COALESCE(?, affected_node_id),
          affected_label = COALESCE(?, affected_label),
          severity = COALESCE(?, severity),
          status = COALESCE(?, status),
          detection_signals_json = COALESCE(?, detection_signals_json),
          evidence_json = COALESCE(?, evidence_json),
          telemetry_summary_json = COALESCE(?, telemetry_summary_json),
          trust_score = COALESCE(?, trust_score),
          anomaly_score = COALESCE(?, anomaly_score),
          drift_json = COALESCE(?, drift_json),
          graph_context_json = COALESCE(?, graph_context_json),
          propagation_json = COALESCE(?, propagation_json),
          orchestration_performed = MAX(orchestration_performed, ?),
          response_actions_json = COALESCE(?, response_actions_json),
          recovery_status = COALESCE(?, recovery_status),
          payload_json = COALESCE(?, payload_json),
          updated_at_ms = ?
         WHERE archive_id = ?`
      )
      .run(
        record.persistentIncidentId ?? null,
        nowMs,
        record.attackType ?? null,
        record.attackCategory ?? null,
        record.affectedAssetId ?? null,
        record.affectedNodeId ?? null,
        record.affectedLabel ?? null,
        record.severity ?? null,
        record.status ?? null,
        record.detectionSignals != null ? JSON.stringify(record.detectionSignals) : null,
        record.evidence != null ? JSON.stringify(record.evidence) : null,
        record.telemetrySummary != null ? JSON.stringify(record.telemetrySummary) : null,
        record.trustScore ?? null,
        record.anomalyScore ?? null,
        record.drift != null ? JSON.stringify(record.drift) : null,
        record.graphContext != null ? JSON.stringify(record.graphContext) : null,
        record.propagation != null ? JSON.stringify(record.propagation) : null,
        record.orchestrationPerformed ? 1 : 0,
        record.responseActions != null ? JSON.stringify(record.responseActions) : null,
        record.recoveryStatus ?? null,
        record.payload != null ? JSON.stringify(record.payload) : null,
        nowMs,
        existing.archive_id
      )
    return rowToArchiveIncident(
      conn.prepare(`SELECT * FROM post_analysis_incidents WHERE archive_id = ?`).get(existing.archive_id)
    )
  }

  const archiveId = record.archiveId || newId('pa-inc')
  const first = Number(record.firstDetectedAtMs ?? nowMs)
  conn
    .prepare(
      `INSERT INTO post_analysis_incidents (
        archive_id, persistent_incident_id, live_incident_id, room_id,
        first_detected_at_ms, last_seen_at_ms, attack_type, attack_category,
        affected_asset_id, affected_node_id, affected_label, severity, status,
        detection_signals_json, evidence_json, telemetry_summary_json,
        trust_score, anomaly_score, drift_json, graph_context_json, propagation_json,
        orchestration_performed, response_actions_json, recovery_status,
        post_analysis_status, post_analysis_at_ms, post_analysis_error, source,
        payload_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      archiveId,
      record.persistentIncidentId ?? null,
      liveId,
      roomId,
      first,
      nowMs,
      record.attackType ?? null,
      record.attackCategory ?? null,
      record.affectedAssetId ?? null,
      record.affectedNodeId ?? null,
      record.affectedLabel ?? null,
      record.severity ?? null,
      record.status ?? 'open',
      JSON.stringify(record.detectionSignals ?? []),
      JSON.stringify(record.evidence ?? []),
      JSON.stringify(record.telemetrySummary ?? null),
      record.trustScore ?? null,
      record.anomalyScore ?? null,
      JSON.stringify(record.drift ?? null),
      JSON.stringify(record.graphContext ?? null),
      JSON.stringify(record.propagation ?? null),
      record.orchestrationPerformed ? 1 : 0,
      JSON.stringify(record.responseActions ?? []),
      record.recoveryStatus ?? null,
      record.postAnalysisStatus ?? POST_ANALYSIS_STATUS.PENDING,
      record.postAnalysisAtMs ?? null,
      record.postAnalysisError ?? null,
      record.source ?? 'live',
      JSON.stringify(record.payload ?? null),
      nowMs,
      nowMs
    )

  return rowToArchiveIncident(
    conn.prepare(`SELECT * FROM post_analysis_incidents WHERE archive_id = ?`).get(archiveId)
  )
}

export function getArchiveIncident(archiveId) {
  const row = getMetricsDb()
    .prepare(`SELECT * FROM post_analysis_incidents WHERE archive_id = ?`)
    .get(String(archiveId ?? ''))
  return rowToArchiveIncident(row)
}

export function getArchiveIncidentByPersistentId(roomId, persistentId) {
  const row = getMetricsDb()
    .prepare(
      `SELECT * FROM post_analysis_incidents
       WHERE room_id = ? AND persistent_incident_id = ?
       LIMIT 1`
    )
    .get(String(roomId ?? ''), String(persistentId ?? ''))
  return rowToArchiveIncident(row)
}

export function listArchiveIncidents(roomId, { order = 'desc', limit, attackCategory, severity, status, q } = {}) {
  const conn = getMetricsDb()
  const clauses = ['room_id = ?']
  const params = [String(roomId ?? '')]
  if (attackCategory) {
    clauses.push('attack_category = ?')
    params.push(String(attackCategory))
  }
  if (severity) {
    clauses.push('severity = ?')
    params.push(String(severity))
  }
  if (status) {
    clauses.push('status = ?')
    params.push(String(status))
  }
  if (q) {
    clauses.push(
      `(affected_label LIKE ? OR affected_asset_id LIKE ? OR attack_type LIKE ? OR attack_category LIKE ? OR archive_id LIKE ?)`
    )
    const like = `%${String(q)}%`
    params.push(like, like, like, like, like)
  }
  const dir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const cap = Math.floor(Number(limit))
  const hasLimit = Number.isFinite(cap) && cap > 0
  const sql = `SELECT * FROM post_analysis_incidents WHERE ${clauses.join(' AND ')}
    ORDER BY first_detected_at_ms ${dir}, archive_id ${dir}${hasLimit ? ' LIMIT ?' : ''}`
  if (hasLimit) params.push(cap)
  return conn.prepare(sql).all(...params).map(rowToArchiveIncident)
}

export function updateArchivePostAnalysisStatus(archiveId, patch) {
  const conn = getMetricsDb()
  const nowMs = Date.now()
  conn
    .prepare(
      `UPDATE post_analysis_incidents SET
        post_analysis_status = COALESCE(?, post_analysis_status),
        post_analysis_at_ms = COALESCE(?, post_analysis_at_ms),
        post_analysis_error = ?,
        orchestration_performed = MAX(orchestration_performed, ?),
        response_actions_json = COALESCE(?, response_actions_json),
        recovery_status = COALESCE(?, recovery_status),
        status = COALESCE(?, status),
        updated_at_ms = ?
       WHERE archive_id = ?`
    )
    .run(
      patch.postAnalysisStatus ?? null,
      patch.postAnalysisAtMs ?? null,
      patch.postAnalysisError !== undefined ? patch.postAnalysisError : null,
      patch.orchestrationPerformed ? 1 : 0,
      patch.responseActions != null ? JSON.stringify(patch.responseActions) : null,
      patch.recoveryStatus ?? null,
      patch.status ?? null,
      nowMs,
      String(archiveId)
    )
  return getArchiveIncident(archiveId)
}

export function listRecommendations(roomId, { status, priority, limit } = {}) {
  const conn = getMetricsDb()
  const clauses = ['room_id = ?']
  const params = [String(roomId ?? '')]
  if (status) {
    if (Array.isArray(status)) {
      clauses.push(`status IN (${status.map(() => '?').join(',')})`)
      params.push(...status.map(String))
    } else {
      clauses.push('status = ?')
      params.push(String(status))
    }
  }
  if (priority) {
    clauses.push('priority = ?')
    params.push(String(priority))
  }
  const cap = Math.floor(Number(limit))
  const hasLimit = Number.isFinite(cap) && cap > 0
  const sql = `SELECT * FROM post_analysis_recommendations WHERE ${clauses.join(' AND ')}
    ORDER BY
      CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      last_seen_at_ms DESC${hasLimit ? ' LIMIT ?' : ''}`
  if (hasLimit) params.push(cap)
  return conn.prepare(sql).all(...params).map(rowToRecommendation)
}

export function getRecommendation(recommendationId) {
  const row = getMetricsDb()
    .prepare(`SELECT * FROM post_analysis_recommendations WHERE recommendation_id = ?`)
    .get(String(recommendationId ?? ''))
  return rowToRecommendation(row)
}

export function findOpenRecommendationByFingerprint(roomId, fingerprint) {
  const row = getMetricsDb()
    .prepare(
      `SELECT * FROM post_analysis_recommendations
       WHERE room_id = ? AND fingerprint = ?
         AND status IN ('open', 'in_progress', 'recurred')
       ORDER BY last_seen_at_ms DESC
       LIMIT 1`
    )
    .get(String(roomId ?? ''), String(fingerprint ?? ''))
  return rowToRecommendation(row)
}

export function findLatestCompletedByFingerprint(roomId, fingerprint) {
  const row = getMetricsDb()
    .prepare(
      `SELECT * FROM post_analysis_recommendations
       WHERE room_id = ? AND fingerprint = ? AND status = ?
       ORDER BY completed_at_ms DESC
       LIMIT 1`
    )
    .get(String(roomId ?? ''), String(fingerprint ?? ''), RECOMMENDATION_STATUS.COMPLETED)
  return rowToRecommendation(row)
}

export function linkRecommendationIncident(recommendationId, archiveId, atMs = Date.now()) {
  getMetricsDb()
    .prepare(
      `INSERT OR IGNORE INTO post_analysis_recommendation_incidents
        (recommendation_id, archive_id, linked_at_ms)
       VALUES (?, ?, ?)`
    )
    .run(String(recommendationId), String(archiveId), atMs)
}

export function listIncidentIdsForRecommendation(recommendationId) {
  return getMetricsDb()
    .prepare(
      `SELECT archive_id AS archiveId, linked_at_ms AS linkedAtMs
       FROM post_analysis_recommendation_incidents
       WHERE recommendation_id = ?
       ORDER BY linked_at_ms DESC`
    )
    .all(String(recommendationId))
}

export function listRecommendationsForArchive(archiveId) {
  const rows = getMetricsDb()
    .prepare(
      `SELECT r.*
       FROM post_analysis_recommendations r
       JOIN post_analysis_recommendation_incidents l
         ON l.recommendation_id = r.recommendation_id
       WHERE l.archive_id = ?
       ORDER BY r.last_seen_at_ms DESC`
    )
    .all(String(archiveId))
  return rows.map(rowToRecommendation)
}

/**
 * Upsert recommendation with dedup / recurrence semantics.
 * @returns {{ recommendation: object, action: 'created'|'duplicate'|'recurred' }}
 */
export function upsertRecommendationFromValidated(roomId, validated, meta = {}) {
  const conn = getMetricsDb()
  const nowMs = Number(meta.nowMs ?? Date.now())
  const fingerprint =
    meta.fingerprint ||
    buildRecommendationFingerprint({
      attackCategory: meta.attackCategory,
      affectedAssetId: meta.affectedAssetId,
      recommendation: validated.recommendation,
      title: validated.title,
    })

  const open = findOpenRecommendationByFingerprint(roomId, fingerprint)
  if (open) {
    conn
      .prepare(
        `UPDATE post_analysis_recommendations SET
          occurrence_count = occurrence_count + 1,
          last_seen_at_ms = ?,
          updated_at_ms = ?,
          priority = CASE
            WHEN ? = 'critical' THEN 'critical'
            WHEN priority = 'critical' THEN 'critical'
            WHEN ? = 'high' OR priority = 'high' THEN 'high'
            WHEN ? = 'medium' OR priority = 'medium' THEN 'medium'
            ELSE priority
          END
         WHERE recommendation_id = ?`
      )
      .run(
        nowMs,
        nowMs,
        validated.priority,
        validated.priority,
        validated.priority,
        open.recommendationId
      )
    if (meta.archiveId) linkRecommendationIncident(open.recommendationId, meta.archiveId, nowMs)
    return {
      recommendation: getRecommendation(open.recommendationId),
      action: 'duplicate',
    }
  }

  const completed = findLatestCompletedByFingerprint(roomId, fingerprint)
  if (completed) {
    const recommendationId = newId('pa-rec')
    const note = `Recurring issue: returned after recommendation was completed${
      completed.completedAtMs
        ? ` on ${new Date(completed.completedAtMs).toISOString().slice(0, 10)}`
        : ''
    }.`
    conn
      .prepare(
        `INSERT INTO post_analysis_recommendations (
          recommendation_id, fingerprint, room_id, title, problem, recommendation, reason,
          priority, category, status, software_only, occurrence_count,
          first_seen_at_ms, last_seen_at_ms, completed_at_ms, dismissed_at_ms, recurred_at_ms,
          attack_category, affected_asset_id, source, prior_completion_note,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        recommendationId,
        fingerprint,
        String(roomId),
        validated.title,
        validated.problem,
        validated.recommendation,
        validated.reason,
        validated.priority,
        validated.category,
        RECOMMENDATION_STATUS.RECURRED,
        nowMs,
        nowMs,
        nowMs,
        meta.attackCategory ?? null,
        meta.affectedAssetId ?? null,
        meta.source ?? 'llm',
        note,
        nowMs,
        nowMs
      )
    if (meta.archiveId) linkRecommendationIncident(recommendationId, meta.archiveId, nowMs)
    return {
      recommendation: getRecommendation(recommendationId),
      action: 'recurred',
    }
  }

  const recommendationId = newId('pa-rec')
  conn
    .prepare(
      `INSERT INTO post_analysis_recommendations (
        recommendation_id, fingerprint, room_id, title, problem, recommendation, reason,
        priority, category, status, software_only, occurrence_count,
        first_seen_at_ms, last_seen_at_ms, completed_at_ms, dismissed_at_ms, recurred_at_ms,
        attack_category, affected_asset_id, source, prior_completion_note,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?, ?)`
    )
    .run(
      recommendationId,
      fingerprint,
      String(roomId),
      validated.title,
      validated.problem,
      validated.recommendation,
      validated.reason,
      validated.priority,
      validated.category,
      RECOMMENDATION_STATUS.OPEN,
      nowMs,
      nowMs,
      meta.attackCategory ?? null,
      meta.affectedAssetId ?? null,
      meta.source ?? 'llm',
      nowMs,
      nowMs
    )
  if (meta.archiveId) linkRecommendationIncident(recommendationId, meta.archiveId, nowMs)
  return {
    recommendation: getRecommendation(recommendationId),
    action: 'created',
  }
}

export function patchRecommendationStatus(recommendationId, status, { nowMs = Date.now() } = {}) {
  const allowed = Object.values(RECOMMENDATION_STATUS)
  if (!allowed.includes(status)) {
    return { ok: false, message: `Invalid status: ${status}` }
  }
  const existing = getRecommendation(recommendationId)
  if (!existing) return { ok: false, message: 'Recommendation not found' }

  const completedAt =
    status === RECOMMENDATION_STATUS.COMPLETED ? nowMs : existing.completedAtMs
  const dismissedAt =
    status === RECOMMENDATION_STATUS.DISMISSED ? nowMs : existing.dismissedAtMs
  const recurredAt =
    status === RECOMMENDATION_STATUS.RECURRED ? nowMs : existing.recurredAtMs

  getMetricsDb()
    .prepare(
      `UPDATE post_analysis_recommendations SET
        status = ?,
        completed_at_ms = ?,
        dismissed_at_ms = ?,
        recurred_at_ms = ?,
        updated_at_ms = ?
       WHERE recommendation_id = ?`
    )
    .run(status, completedAt ?? null, dismissedAt ?? null, recurredAt ?? null, nowMs, recommendationId)

  return { ok: true, recommendation: getRecommendation(recommendationId) }
}

/**
 * Aggregate overview metrics for Analyze dashboard.
 */
export function buildAnalyzeOverview(roomId) {
  const incidents = listArchiveIncidents(roomId)
  const recommendations = listRecommendations(roomId)

  const byDay = new Map()
  const byType = new Map()
  const byAsset = new Map()
  for (const inc of incidents) {
    const day = new Date(inc.firstDetectedAtMs).toISOString().slice(0, 10)
    byDay.set(day, (byDay.get(day) || 0) + 1)
    const t = inc.attackCategory || inc.attackType || 'unknown'
    byType.set(t, (byType.get(t) || 0) + 1)
    const a = inc.affectedAssetId || inc.affectedNodeId || 'unknown'
    byAsset.set(a, (byAsset.get(a) || 0) + 1)
  }

  const openRecs = recommendations.filter(
    (r) =>
      r.status === RECOMMENDATION_STATUS.OPEN ||
      r.status === RECOMMENDATION_STATUS.IN_PROGRESS
  )
  const recurred = recommendations.filter((r) => r.status === RECOMMENDATION_STATUS.RECURRED)
  const completed = recommendations.filter((r) => r.status === RECOMMENDATION_STATUS.COMPLETED)
  const inProgress = recommendations.filter((r) => r.status === RECOMMENDATION_STATUS.IN_PROGRESS)

  const patternMap = new Map()
  for (const inc of incidents) {
    const key = `${inc.attackCategory || inc.attackType || 'unknown'}|${inc.affectedAssetId || inc.affectedNodeId || 'unknown'}`
    if (!patternMap.has(key)) {
      patternMap.set(key, {
        patternKey: key,
        attackCategory: inc.attackCategory || inc.attackType,
        affectedAssetId: inc.affectedAssetId || inc.affectedNodeId,
        affectedLabel: inc.affectedLabel,
        count: 0,
        firstSeenAtMs: inc.firstDetectedAtMs,
        lastSeenAtMs: inc.lastSeenAtMs,
        archiveIds: [],
      })
    }
    const p = patternMap.get(key)
    p.count += 1
    p.firstSeenAtMs = Math.min(p.firstSeenAtMs, inc.firstDetectedAtMs)
    p.lastSeenAtMs = Math.max(p.lastSeenAtMs, inc.lastSeenAtMs)
    p.archiveIds.push(inc.archiveId)
  }

  const recurringPatterns = [...patternMap.values()]
    .filter((p) => p.count >= 2)
    .sort((a, b) => b.count - a.lastSeenAtMs + a.lastSeenAtMs || b.count - a.count)
    .sort((a, b) => b.count - a.count || b.lastSeenAtMs - a.lastSeenAtMs)
    .slice(0, 12)
    .map((p) => {
      const related = recommendations.filter(
        (r) =>
          (r.attackCategory === p.attackCategory || !r.attackCategory) &&
          (r.affectedAssetId === p.affectedAssetId || !r.affectedAssetId) &&
          (r.fingerprint?.startsWith(
            `${String(p.attackCategory || '').toLowerCase()}|${String(p.affectedAssetId || '').toLowerCase()}`
          ) ||
            (r.attackCategory === p.attackCategory && r.affectedAssetId === p.affectedAssetId))
      )
      return {
        ...p,
        recommendations: related.slice(0, 3),
      }
    })

  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const weekAgo = now - 7 * dayMs
  const monthAgo = now - 30 * dayMs

  return {
    totals: {
      incidents: incidents.length,
      attacksAnalyzed: incidents.filter(
        (i) =>
          i.postAnalysisStatus === POST_ANALYSIS_STATUS.COMPLETE ||
          i.postAnalysisStatus === POST_ANALYSIS_STATUS.UNAVAILABLE
      ).length,
      openRecommendations: openRecs.length,
      recurringIssues: recurred.length,
      completedImprovements: completed.length,
      recommendations: recommendations.length,
      inProgress: inProgress.length,
    },
    priorityBreakdown: {
      critical: recommendations.filter((r) => r.priority === 'critical' && isOpenLikeStatus(r.status)).length,
      high: recommendations.filter((r) => r.priority === 'high' && isOpenLikeStatus(r.status)).length,
      medium: recommendations.filter((r) => r.priority === 'medium' && isOpenLikeStatus(r.status)).length,
      low: recommendations.filter((r) => r.priority === 'low' && isOpenLikeStatus(r.status)).length,
    },
    attackTrends: {
      daily: [...byDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, count]) => ({ date, count })),
      last7Days: incidents.filter((i) => i.firstDetectedAtMs >= weekAgo).length,
      last30Days: incidents.filter((i) => i.firstDetectedAtMs >= monthAgo).length,
      byType: [...byType.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      byAsset: [...byAsset.entries()]
        .map(([assetId, count]) => ({ assetId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    },
    recurringPatterns,
  }
}

/** Test helper — wipe only post-analysis tables. */
export function clearPostAnalysisForTests(roomId) {
  const conn = getMetricsDb()
  const id = String(roomId ?? '')
  const tx = conn.transaction(() => {
    if (id) {
      conn
        .prepare(
          `DELETE FROM post_analysis_recommendation_incidents
           WHERE recommendation_id IN (
             SELECT recommendation_id FROM post_analysis_recommendations WHERE room_id = ?
           ) OR archive_id IN (
             SELECT archive_id FROM post_analysis_incidents WHERE room_id = ?
           )`
        )
        .run(id, id)
      conn.prepare(`DELETE FROM post_analysis_recommendations WHERE room_id = ?`).run(id)
      conn.prepare(`DELETE FROM post_analysis_incidents WHERE room_id = ?`).run(id)
    } else {
      conn.prepare(`DELETE FROM post_analysis_recommendation_incidents`).run()
      conn.prepare(`DELETE FROM post_analysis_recommendations`).run()
      conn.prepare(`DELETE FROM post_analysis_incidents`).run()
    }
  })
  tx()
}
