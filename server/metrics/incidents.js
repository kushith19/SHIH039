import {
  computeFinancialExposure,
  currentExposureForIncident,
} from '../../shared/financialExposure.js'
import { detectionTypeLabel } from '../../shared/incidents.js'
import {
  INCIDENT_STATUS,
  hopDistanceOf,
  nodeLabelFromRoom,
  primaryAttackPath,
} from '../../shared/incidentIntel.js'
import { attachAvailableResponseActions, isExposureIncidentContext } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import { deleteRoomIncidents, getMetricsDb } from './store.js'
import { correlateIncidentCampaigns, HISTORY_CORRELATION } from '../detection/campaigns/historyCorrelation.js'

const OPEN = INCIDENT_STATUS.OPEN
const CLEARED = INCIDENT_STATUS.CLEARED

export function allocateMatchId(roomId, nowMs = Date.now()) {
  return `${String(roomId ?? 'ROOM').toUpperCase()}:m:${Number(nowMs) || Date.now()}`
}

/**
 * Begin a new match session on the room: new match_id, close prior open episodes
 * (status → cleared) without deleting historical rows.
 */
export function beginMatchSession(room, nowMs = Date.now()) {
  if (!room?.id) return null
  const t = Number(nowMs) || Date.now()
  room.currentMatchId = allocateMatchId(room.id, t)
  room.matchStartedAtMs = t
  closeOpenIncidentsForRoom(room.id, { nowMs: t })
  return room.currentMatchId
}

/**
 * Mark all open incidents for a room as cleared. Does not delete rows.
 * Used when a new match starts so the next detection creates a new episode.
 */
export function closeOpenIncidentsForRoom(roomId, { nowMs = Date.now() } = {}) {
  const id = String(roomId ?? '')
  if (!id) return 0
  const conn = getMetricsDb()
  const t = Number(nowMs) || Date.now()
  const info = conn
    .prepare(
      `UPDATE incidents SET status = ?, updated_at_ms = ?,
        resolved_at_ms = COALESCE(resolved_at_ms, ?)
       WHERE room_id = ? AND status = ?`
    )
    .run(CLEARED, t, t, id, OPEN)
  return info.changes ?? 0
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function graphContextFor(incident, room, detection) {
  const seed = String(incident.endpointId ?? '')
  const paths = {}
  for (const [nodeId, path] of Object.entries(incident.propagationPaths ?? {})) {
    if (Array.isArray(path) && path[0] === seed) paths[nodeId] = path
  }
  const primaryPath = primaryAttackPath({ ...incident, propagationPaths: paths })
  const peer = Array.isArray(incident.peerExposedNodeIds) ? incident.peerExposedNodeIds : []
  const propagated = Array.isArray(incident.propagatedNodeIds) ? incident.propagatedNodeIds : []
  const blast = new Set([seed, ...peer, ...propagated].filter(Boolean))
  return {
    peerExposedNodeIds: peer,
    propagatedNodeIds: propagated,
    propagationPaths: paths,
    primaryPath,
    primaryPathLabels: primaryPath.map((id) => nodeLabelFromRoom(room, id)),
    hopDistance: hopDistanceOf(primaryPath),
    blastRadius: blast.size,
    propagationRiskByNode: detection?.propagationRiskByNode ?? {},
    primarySpreadNodeId: incident.primarySpreadNodeId ?? detection?.primarySpreadNodeId ?? null,
    primarySpreadEdgeId: incident.primarySpreadEdgeId ?? detection?.primarySpreadEdgeId ?? null,
    primarySpreadAssessment:
      incident.primarySpreadAssessment ?? detection?.primarySpreadAssessment ?? null,
  }
}

function financialContextFor(incident, room, detection) {
  const view = computeFinancialExposure({
    detection: {
      anomalyNodeIds: incident.endpointId ? [incident.endpointId] : [],
      peerExposedNodeIds: incident.peerExposedNodeIds ?? [],
      propagatedNodeIds: incident.propagatedNodeIds ?? [],
      incidents: [incident],
      riskMomentum: detection?.riskMomentum ?? null,
    },
    nodes: room?.nodes ?? [],
    edges: room?.edges ?? [],
  })
  return {
    ...view,
    simulated: true,
  }
}

function rowToIncident(row) {
  if (!row) return null
  const evidence = parseJson(row.evidence_json, [])
  const graphContext = parseJson(row.graph_context_json, {})
  const financialContext = parseJson(row.financial_context_json, null)
  const actionsTaken = parseJson(row.actions_taken_json, [])
  return {
    incidentId: row.incident_id,
    liveIncidentId: row.live_incident_id,
    roomId: row.room_id,
    incidentType: row.incident_type,
    detectionType: row.incident_type,
    severity: row.severity,
    status: row.status,
    affectedNodeId: row.affected_node_id,
    sector: row.sector || null,
    riskScore: row.risk_score,
    trustScore: row.trust_score,
    summary: row.summary,
    evidence,
    graphContext,
    financialContext,
    campaignId: row.campaign_id || null,
    actionsTaken,
    detectedAtMs: row.detected_at_ms,
    updatedAtMs: row.updated_at_ms,
    resolvedAtMs: row.resolved_at_ms ?? null,
    matchId: row.match_id || null,
    sessionStartedAtMs: row.session_started_at_ms ?? null,
  }
}

function isTerminalIncidentStatus(status) {
  const s = String(status ?? '').toLowerCase().trim()
  return s === CLEARED || s === 'closed' || s === 'resolved'
}

function sectorFromRoom(room, incident) {
  const direct = String(incident?.sector ?? '').trim()
  if (direct) return direct
  const id = String(incident?.endpointId ?? incident?.affectedNodeId ?? '')
  if (!id) return null
  const n = (room?.nodes ?? []).find((node) => String(node.id) === id)
  const fromNode = String(n?.data?.sector ?? n?.sector ?? '').trim()
  return fromNode || null
}

function insertIncident(conn, record) {
  conn
    .prepare(
      `INSERT INTO incidents (
        incident_id, live_incident_id, room_id, incident_type, severity, status,
        affected_node_id, risk_score, trust_score, summary, evidence_json,
        graph_context_json, financial_context_json, campaign_id, actions_taken_json,
        detected_at_ms, updated_at_ms, match_id, session_started_at_ms, sector, resolved_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.incidentId,
      record.liveIncidentId,
      record.roomId,
      record.incidentType,
      record.severity,
      record.status,
      record.affectedNodeId,
      record.riskScore,
      record.trustScore,
      record.summary,
      JSON.stringify(record.evidence ?? []),
      JSON.stringify(record.graphContext ?? {}),
      JSON.stringify(record.financialContext ?? null),
      record.campaignId,
      JSON.stringify(record.actionsTaken ?? []),
      record.detectedAtMs,
      record.updatedAtMs,
      record.matchId ?? null,
      record.sessionStartedAtMs ?? null,
      record.sector ?? null,
      record.resolvedAtMs ?? null
    )
}

function updateIncidentRow(conn, incidentId, patch) {
  conn
    .prepare(
      `UPDATE incidents SET
        incident_type = ?,
        severity = ?,
        status = ?,
        risk_score = ?,
        trust_score = ?,
        summary = ?,
        evidence_json = ?,
        graph_context_json = ?,
        financial_context_json = ?,
        campaign_id = ?,
        actions_taken_json = ?,
        updated_at_ms = ?,
        sector = COALESCE(?, sector),
        resolved_at_ms = ?
       WHERE incident_id = ?`
    )
    .run(
      patch.incidentType,
      patch.severity,
      patch.status,
      patch.riskScore,
      patch.trustScore,
      patch.summary,
      JSON.stringify(patch.evidence ?? []),
      JSON.stringify(patch.graphContext ?? {}),
      JSON.stringify(patch.financialContext ?? null),
      patch.campaignId,
      JSON.stringify(patch.actionsTaken ?? []),
      patch.updatedAtMs,
      patch.sector ?? null,
      patch.resolvedAtMs ?? null,
      incidentId
    )
}

/** Non-empty Commander action history — detection payloads usually omit this. */
function hasMeaningfulActionsTaken(actionsTaken) {
  return Array.isArray(actionsTaken) && actionsTaken.length > 0
}

/**
 * Detection upserts must not erase Commander actionsTaken.
 * Prefer incoming history when present; otherwise keep persisted history.
 */
function resolveActionsTakenForUpsert(incoming, existingRow) {
  if (hasMeaningfulActionsTaken(incoming)) return incoming
  if (existingRow) {
    const prior = parseJson(existingRow.actions_taken_json, [])
    if (hasMeaningfulActionsTaken(prior)) return prior
  }
  return Array.isArray(incoming) ? incoming : []
}

function findOpenByLiveId(conn, roomId, liveIncidentId) {
  return conn
    .prepare(
      `SELECT * FROM incidents
       WHERE room_id = ? AND live_incident_id = ? AND status = ?
       ORDER BY detected_at_ms DESC
       LIMIT 1`
    )
    .get(roomId, liveIncidentId, OPEN)
}

function upsertOne(room, detection, incident, nowMs) {
  const conn = getMetricsDb()
  const roomId = String(room.id)
  const liveId = String(incident.id ?? '')
  if (!liveId) return null
  const existing = findOpenByLiveId(conn, roomId, liveId)
  const graphContext = graphContextFor(incident, room, detection)
  const financialContext = financialContextFor(incident, room, detection)
  const summary = `${incident.endpointLabel || incident.endpointId}: ${detectionTypeLabel(incident.detectionType)}`
  const matchId = room.currentMatchId ? String(room.currentMatchId) : null
  const sessionStartedAtMs = Number.isFinite(Number(room.matchStartedAtMs))
    ? Number(room.matchStartedAtMs)
    : null
  const sector = sectorFromRoom(room, incident)
  const basePayload = {
    liveIncidentId: liveId,
    roomId,
    incidentType: incident.detectionType ?? null,
    severity: incident.severity ?? 'low',
    status: OPEN,
    affectedNodeId: incident.endpointId ?? null,
    riskScore: Number.isFinite(Number(incident.anomalyScore)) ? Number(incident.anomalyScore) : null,
    trustScore: Number.isFinite(Number(incident.trustScore)) ? Number(incident.trustScore) : null,
    summary,
    evidence: incident.evidence ?? [],
    graphContext,
    financialContext,
    campaignId: incident.campaignId ?? null,
    updatedAtMs: nowMs,
    matchId,
    sessionStartedAtMs,
    sector,
    resolvedAtMs: null,
  }

  const applyExisting = (row) => {
    const payload = {
      ...basePayload,
      // Preserve original match/session on upsert of the same open episode.
      matchId: row.match_id || matchId,
      sessionStartedAtMs:
        row.session_started_at_ms != null ? row.session_started_at_ms : sessionStartedAtMs,
      sector: sector || row.sector || null,
      resolvedAtMs: null,
      actionsTaken: resolveActionsTakenForUpsert(incident.actionsTaken, row),
    }
    updateIncidentRow(conn, row.incident_id, payload)
    return {
      ...payload,
      incidentId: row.incident_id,
      detectedAtMs: row.detected_at_ms,
    }
  }

  if (existing) return applyExisting(existing)

  const insertPayload = {
    ...basePayload,
    actionsTaken: resolveActionsTakenForUpsert(incident.actionsTaken, null),
  }
  let incidentId = `${liveId}:${nowMs}`
  let suffix = 0
  while (conn.prepare(`SELECT 1 FROM incidents WHERE incident_id = ?`).get(incidentId)) {
    suffix += 1
    incidentId = `${liveId}:${nowMs}:${suffix}`
  }
  try {
    insertIncident(conn, { ...insertPayload, incidentId, detectedAtMs: nowMs })
  } catch (err) {
    const raced = findOpenByLiveId(conn, roomId, liveId)
    if (raced) return applyExisting(raced)
    throw err
  }
  return { ...insertPayload, incidentId, detectedAtMs: nowMs }
}

function closeStaleOpen(roomId, keepPersistentIds, nowMs) {
  const conn = getMetricsDb()
  const openRows = conn
    .prepare(
      `SELECT incident_id, resolved_at_ms FROM incidents WHERE room_id = ? AND status = ?`
    )
    .all(roomId, OPEN)
  const keep = new Set(keepPersistentIds)
  for (const row of openRows) {
    if (keep.has(row.incident_id)) continue
    const resolvedAt = row.resolved_at_ms != null ? row.resolved_at_ms : nowMs
    conn
      .prepare(
        `UPDATE incidents SET status = ?, updated_at_ms = ?, resolved_at_ms = COALESCE(resolved_at_ms, ?)
         WHERE incident_id = ?`
      )
      .run(CLEARED, nowMs, resolvedAt, row.incident_id)
  }
}

function graphSets(record) {
  const g = record.graphContext ?? {}
  return {
    peer: new Set(g.peerExposedNodeIds ?? []),
    propagated: new Set(g.propagatedNodeIds ?? []),
    seed: String(record.affectedNodeId ?? ''),
  }
}

function relatePair(a, b, nowMs) {
  const conn = getMetricsDb()
  const A = graphSets(a)
  const B = graphSets(b)
  const links = []
  if (A.propagated.has(B.seed) || B.propagated.has(A.seed) || A.peer.has(B.seed) || B.peer.has(A.seed)) {
    links.push({
      type: 'propagation_related',
      reason: 'Seed appears on the other incident peer or propagation set',
    })
  }
  const shareProp = [...A.propagated].some((id) => B.propagated.has(id) || B.peer.has(id) || id === B.seed)
  const sharePeer = [...A.peer].some((id) => B.peer.has(id) || B.propagated.has(id))
  if (shareProp || sharePeer) {
    links.push({
      type: 'shared_dependency',
      reason: 'Overlapping peer exposure or propagated nodes',
    })
  }
  if (a.campaignId && a.campaignId === b.campaignId) {
    links.push({
      type: 'temporal_proximity',
      reason: 'Same correlated pattern id',
    })
  }
  const stmt = conn.prepare(
    `INSERT OR IGNORE INTO incident_relationships
      (source_incident_id, target_incident_id, relationship_type, reason, created_at_ms)
     VALUES (?, ?, ?, ?, ?)`
  )
  for (const link of links) {
    stmt.run(a.incidentId, b.incidentId, link.type, link.reason, nowMs)
    stmt.run(b.incidentId, a.incidentId, link.type, link.reason, nowMs)
  }
}

function linkOpenRelationships(roomId, nowMs) {
  const open = listIncidents(roomId, { status: OPEN })
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      relatePair(open[i], open[j], nowMs)
    }
  }
}

function relatedFor(incidentId) {
  const conn = getMetricsDb()
  const rows = conn
    .prepare(
      `SELECT r.relationship_type AS relationshipType, r.reason,
              t.incident_id AS incidentId, t.live_incident_id AS liveIncidentId,
              t.summary, t.severity, t.status, t.incident_type AS incidentType,
              t.affected_node_id AS affectedNodeId
       FROM incident_relationships r
       JOIN incidents t ON t.incident_id = r.target_incident_id
       WHERE r.source_incident_id = ?
       ORDER BY t.updated_at_ms DESC`
    )
    .all(incidentId)
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (seen.has(row.incidentId)) continue
    seen.add(row.incidentId)
    out.push(row)
  }
  return out
}

/**
 * Persist this tick's promoted incidents. Safe to call from the live loop.
 * Mutates incident objects only by attaching persistence projection fields.
 */
export function persistDetectionIncidents(room, detection) {
  if (!room?.id) return []
  const conn = getMetricsDb()
  const nowMs = Date.now()
  const incidents = Array.isArray(detection?.incidents) ? detection.incidents : []

  const persistTick = conn.transaction(() => {
    const persisted = []
    for (const inc of incidents) {
      const row = upsertOne(room, detection, inc, nowMs)
      if (!row) continue
      persisted.push(row)
      inc.persistentId = row.incidentId
      inc.status = OPEN
      inc.graphContext = row.graphContext
      inc.financialContext = row.financialContext
    }
    closeStaleOpen(room.id, persisted.map((r) => r.incidentId), nowMs)
    linkOpenRelationships(room.id, nowMs)
    return persisted
  })

  const persisted = persistTick()
  for (const inc of incidents) {
    if (!inc.persistentId) continue
    inc.relatedIncidents = relatedFor(inc.persistentId)
  }

  try {
    stampHistoryCampaigns(room, incidents)
  } catch (err) {
    console.error('[campaigns] history correlation failed', err)
  }

  return persisted
}

function stampHistoryCampaigns(room, liveIncidents) {
  const history = listIncidentHistory(room.id, { order: 'asc' })
  const { campaigns } = correlateIncidentCampaigns(
    history,
    { roomId: String(room.id), edges: room.edges ?? [] },
    { nowMs: Date.now(), lookbackMs: HISTORY_CORRELATION.temporalWindowMs }
  )
  applyHistoryCampaignIds(campaigns)
  const byPersistent = new Map()
  for (const campaign of campaigns) {
    for (const id of campaign.incidentIds) byPersistent.set(id, campaign.campaignId)
  }
  for (const inc of liveIncidents ?? []) {
    if (inc.campaignId) continue
    const stamped = byPersistent.get(inc.persistentId)
    if (stamped) inc.campaignId = stamped
  }
}

/** Write history-correlation campaign ids onto episode rows that have no catalog id yet. */
export function applyHistoryCampaignIds(campaigns) {
  const conn = getMetricsDb()
  const now = Date.now()
  const update = conn.prepare(
    `UPDATE incidents SET campaign_id = ?, updated_at_ms = ? WHERE incident_id = ?`
  )
  const read = conn.prepare(`SELECT campaign_id FROM incidents WHERE incident_id = ?`)
  for (const campaign of campaigns ?? []) {
    for (const incidentId of campaign.incidentIds ?? []) {
      const row = read.get(incidentId)
      if (!row) continue
      const existing = row.campaign_id
      if (existing && !String(existing).startsWith('camp-h-')) continue
      update.run(campaign.campaignId, now, incidentId)
    }
  }
}

export function normalizeHistoryOrder(order) {
  const raw = String(order ?? 'desc').toLowerCase()
  if (raw === 'asc' || raw === 'oldest' || raw === 'oldest-first') return 'oldest-first'
  return 'newest-first'
}

function historyOrderSql(order) {
  return normalizeHistoryOrder(order) === 'oldest-first' ? 'ASC' : 'DESC'
}

/**
 * Test/admin hard-delete of room incident rows.
 * Production match start / Clear Attacks / teardown must NOT call this.
 * Prefer closeOpenIncidentsForRoom to end open episodes without erasing history.
 */
export function clearPersistedIncidentHistory(roomId) {
  deleteRoomIncidents(roomId)
}

/**
 * Chronological incident history for a room (all statuses).
 * Does not require an in-memory room — queries SQLite directly.
 *
 * @param {string} roomId
 * @param {{
 *   order?: string,
 *   limit?: number,
 *   fromMs?: number,
 *   toMs?: number,
 *   status?: string,
 *   type?: string,
 *   severity?: string,
 *   matchId?: string,
 * }} [opts]
 */
export function listIncidentHistory(roomId, {
  order = 'desc',
  limit,
  fromMs,
  toMs,
  status,
  type,
  severity,
  matchId,
} = {}) {
  const conn = getMetricsDb()
  const id = String(roomId ?? '')
  const dir = historyOrderSql(order)
  const clauses = ['room_id = ?']
  const params = [id]

  const from = Number(fromMs)
  if (Number.isFinite(from) && from > 0) {
    clauses.push('detected_at_ms >= ?')
    params.push(from)
  }
  const to = Number(toMs)
  if (Number.isFinite(to) && to > 0) {
    clauses.push('detected_at_ms <= ?')
    params.push(to)
  }
  if (status != null && String(status).trim()) {
    clauses.push('status = ?')
    params.push(String(status).toLowerCase().trim())
  }
  if (type != null && String(type).trim()) {
    clauses.push('incident_type = ?')
    params.push(String(type).trim())
  }
  if (severity != null && String(severity).trim()) {
    clauses.push('severity = ?')
    params.push(String(severity).toLowerCase().trim())
  }
  if (matchId != null && String(matchId).trim()) {
    clauses.push('match_id = ?')
    params.push(String(matchId).trim())
  }

  const cap = Math.floor(Number(limit))
  const hasLimit = Number.isFinite(cap) && cap > 0
  const where = clauses.join(' AND ')
  const sql = hasLimit
    ? `SELECT * FROM incidents WHERE ${where} ORDER BY detected_at_ms ${dir}, incident_id ${dir} LIMIT ?`
    : `SELECT * FROM incidents WHERE ${where} ORDER BY detected_at_ms ${dir}, incident_id ${dir}`
  const rows = hasLimit ? conn.prepare(sql).all(...params, cap) : conn.prepare(sql).all(...params)
  return rows.map(rowToIncident)
}

/**
 * Lightweight historical aggregates for Overview / analytics.
 * Operates on SQLite only — no in-memory room required.
 */
export function aggregateIncidentHistory(roomId, { nowMs = Date.now() } = {}) {
  const conn = getMetricsDb()
  const id = String(roomId ?? '')
  const now = Number(nowMs) || Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const total = conn.prepare(`SELECT COUNT(*) AS c FROM incidents WHERE room_id = ?`).get(id)?.c ?? 0
  const today =
    conn
      .prepare(`SELECT COUNT(*) AS c FROM incidents WHERE room_id = ? AND detected_at_ms >= ?`)
      .get(id, now - dayMs)?.c ?? 0
  const week =
    conn
      .prepare(`SELECT COUNT(*) AS c FROM incidents WHERE room_id = ? AND detected_at_ms >= ?`)
      .get(id, now - 7 * dayMs)?.c ?? 0
  const month =
    conn
      .prepare(`SELECT COUNT(*) AS c FROM incidents WHERE room_id = ? AND detected_at_ms >= ?`)
      .get(id, now - 30 * dayMs)?.c ?? 0
  const resolved =
    conn
      .prepare(
        `SELECT COUNT(*) AS c FROM incidents
         WHERE room_id = ? AND lower(status) IN ('cleared', 'closed', 'resolved')`
      )
      .get(id)?.c ?? 0
  const byType = conn
    .prepare(
      `SELECT COALESCE(incident_type, 'behavioural_anomaly') AS id, COUNT(*) AS count
       FROM incidents WHERE room_id = ?
       GROUP BY COALESCE(incident_type, 'behavioural_anomaly')
       ORDER BY count DESC`
    )
    .all(id)
  const bySeverity = conn
    .prepare(
      `SELECT lower(COALESCE(severity, 'low')) AS id, COUNT(*) AS count
       FROM incidents WHERE room_id = ?
       GROUP BY lower(COALESCE(severity, 'low'))`
    )
    .all(id)
  const bySector = conn
    .prepare(
      `SELECT COALESCE(NULLIF(trim(sector), ''), 'Unknown') AS sector, COUNT(*) AS count
       FROM incidents WHERE room_id = ?
       GROUP BY COALESCE(NULLIF(trim(sector), ''), 'Unknown')
       ORDER BY count DESC`
    )
    .all(id)
  return {
    roomId: id,
    total: Number(total) || 0,
    today: Number(today) || 0,
    week: Number(week) || 0,
    month: Number(month) || 0,
    resolved: Number(resolved) || 0,
    byType,
    bySeverity,
    bySector,
  }
}

function projectHistoryCampaign(campaign, byId, room) {
  const sequence = (campaign.incidentIds ?? [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => {
      const dt = Number(a.detectedAtMs) - Number(b.detectedAtMs)
      if (dt !== 0) return dt
      return String(a.incidentId).localeCompare(String(b.incidentId))
    })
    .map((row) => ({
      incidentId: row.incidentId,
      detectedAtMs: row.detectedAtMs,
      affectedNodeId: row.affectedNodeId,
      affectedNodeLabel: nodeLabelFromRoom(room, row.affectedNodeId) || row.affectedNodeId,
      incidentType: row.incidentType,
      severity: row.severity,
    }))
  return {
    campaignId: campaign.campaignId,
    roomId: campaign.roomId,
    status: campaign.status,
    severity: campaign.severity,
    incidentCount: sequence.length,
    firstDetectedAtMs: campaign.firstDetectedAtMs,
    lastDetectedAtMs: campaign.lastDetectedAtMs,
    affectedServices: (campaign.affectedNodeIds ?? []).map((id) => ({
      id,
      label: nodeLabelFromRoom(room, id) || id,
    })),
    correlationReasons: [...(campaign.correlationReasons ?? [])],
    sequence,
  }
}

/**
 * Read-only history campaign candidates for the SOC view.
 * Uses persisted incidents + the existing correlator; does not invent campaigns.
 * Accepts a room object or a plain { id, edges?, nodes? } — does not require live roomStore.
 */
export function listHistoryCampaigns(room, overrides = {}) {
  const roomId = typeof room === 'string' ? room : room?.id
  if (!roomId) return []
  const graph = typeof room === 'string' ? { id: roomId, edges: [], nodes: [] } : room
  const history = listIncidentHistory(roomId, { order: 'oldest-first' })
  const { campaigns } = correlateIncidentCampaigns(
    history,
    { roomId: String(roomId), edges: graph.edges ?? [] },
    {
      nowMs: Date.now(),
      lookbackMs: HISTORY_CORRELATION.temporalWindowMs,
      ...overrides,
    }
  )
  const byId = new Map(history.map((row) => [row.incidentId, row]))
  return campaigns
    .filter((c) => (c.incidentIds?.length ?? 0) >= 2)
    .map((c) => projectHistoryCampaign(c, byId, graph))
    .filter((c) => c.sequence.length >= 2)
}

export function listIncidents(roomId, { status } = {}) {
  const conn = getMetricsDb()
  const id = String(roomId ?? '')
  const rows = status
    ? conn
        .prepare(
          `SELECT * FROM incidents WHERE room_id = ? AND status = ? ORDER BY updated_at_ms DESC`
        )
        .all(id, status)
    : conn
        .prepare(`SELECT * FROM incidents WHERE room_id = ? ORDER BY updated_at_ms DESC`)
        .all(id)
  return rows.map(rowToIncident)
}

export function getIncident(roomId, incidentId) {
  const conn = getMetricsDb()
  const room = String(roomId ?? '')
  const id = String(incidentId ?? '')
  if (!room || !id) return null
  const byPk = conn.prepare(`SELECT * FROM incidents WHERE room_id = ? AND incident_id = ?`).get(room, id)
  if (byPk) return rowToIncident(byPk)
  const byLive = conn
    .prepare(
      `SELECT * FROM incidents
       WHERE room_id = ? AND live_incident_id = ?
       ORDER BY CASE WHEN status = ? THEN 0 ELSE 1 END, updated_at_ms DESC
       LIMIT 1`
    )
    .get(room, id, OPEN)
  return rowToIncident(byLive ?? null)
}

export function updateIncidentStatus(roomId, incidentId, { status, actionsTaken } = {}) {
  const current = getIncident(roomId, incidentId)
  if (!current) return null
  const conn = getMetricsDb()
  const nextStatus = status ? String(status) : current.status
  const nextActions = Array.isArray(actionsTaken) ? actionsTaken : current.actionsTaken
  const now = Date.now()
  const resolvedAt =
    isTerminalIncidentStatus(nextStatus)
      ? current.resolvedAtMs != null
        ? current.resolvedAtMs
        : now
      : null
  conn
    .prepare(
      `UPDATE incidents SET status = ?, actions_taken_json = ?, updated_at_ms = ?,
        resolved_at_ms = ?
       WHERE incident_id = ?`
    )
    .run(nextStatus, JSON.stringify(nextActions ?? []), now, resolvedAt, current.incidentId)
  return getIncident(roomId, current.incidentId)
}

export function createIncidentRelationship(sourceId, targetId, type, reason = '') {
  const conn = getMetricsDb()
  const now = Date.now()
  conn
    .prepare(
      `INSERT OR IGNORE INTO incident_relationships
        (source_incident_id, target_incident_id, relationship_type, reason, created_at_ms)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(String(sourceId), String(targetId), String(type), String(reason ?? ''), now)
  return { sourceIncidentId: sourceId, targetIncidentId: targetId, relationshipType: type, reason }
}

/**
 * Build Commander context for an incident.
 * Current economic exposure is recomputed from live room detection when open,
 * and forced to ₹0 when cleared (historical snapshot kept on financialContext).
 * @param {string} roomId
 * @param {string} incidentId
 * @param {{ nodes?: object[], edges?: object[], detection?: object, room?: object }} [options]
 */
export function commanderContextFor(roomId, incidentId, options = {}) {
  const incident = getIncident(roomId, incidentId)
  if (!incident) return null
  const related = relatedFor(incident.incidentId)
  const room = options?.room ?? null
  const nodes = Array.isArray(options?.nodes)
    ? options.nodes
    : Array.isArray(room?.nodes)
      ? room.nodes
      : []
  const edges = Array.isArray(options?.edges)
    ? options.edges
    : Array.isArray(room?.edges)
      ? room.edges
      : []
  const detection =
    options?.detection !== undefined
      ? options.detection
      : room?.detection ?? null
  const liveRoom = room || { nodes, edges, detection }
  const financialExposure = currentExposureForIncident(incident, liveRoom)
  const base = {
    incidentId: incident.incidentId,
    liveIncidentId: incident.liveIncidentId,
    incidentType: incident.incidentType,
    severity: incident.severity,
    status: incident.status,
    affectedAsset: {
      id: incident.affectedNodeId,
      summary: incident.summary,
    },
    riskScore: incident.riskScore,
    trustScore: incident.trustScore,
    anomalyEvidence: incident.evidence,
    peerExposure: incident.graphContext?.peerExposedNodeIds ?? [],
    propagatedNodeIds: incident.graphContext?.propagatedNodeIds ?? [],
    propagationPaths: incident.graphContext?.propagationPaths ?? {},
    primaryPath: incident.graphContext?.primaryPath ?? [],
    primaryPathLabels: incident.graphContext?.primaryPathLabels ?? [],
    blastRadius: incident.graphContext?.blastRadius ?? null,
    hopDistance: incident.graphContext?.hopDistance ?? null,
    financialExposure,
    relatedIncidents: related,
    campaignId: incident.campaignId,
    currentStatus: incident.status,
    actionsAlreadyTaken: incident.actionsTaken ?? [],
    isExposureIncident: isExposureIncidentContext({
      anomalyEvidence: incident.evidence,
    }),
  }
  return attachAvailableResponseActions(attachResponseClassification(base, nodes))
}
