import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { getTelemetryKeys, isTelemetryMetaKey } from '../../shared/telemetryKeys.js'
import { emptyLookback } from '../detection/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_PATH = path.join(DATA_DIR, 'metrics.sqlite')

export const RETENTION_TICKS = 600
export const LOOKBACK_TICKS = 10

let db

const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS snapshot_index (
      room_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      ts_ms INTEGER NOT NULL,
      PRIMARY KEY (room_id, tick)
    );
    CREATE TABLE IF NOT EXISTS metric_samples (
      room_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      ts_ms INTEGER NOT NULL,
      endpoint_id TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      value REAL NOT NULL,
      PRIMARY KEY (room_id, tick, endpoint_id, metric_key)
    );
    CREATE TABLE IF NOT EXISTS detection_runs (
      room_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      ts_ms INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (room_id, tick)
    );
    CREATE INDEX IF NOT EXISTS idx_samples_endpoint
      ON metric_samples (room_id, endpoint_id, metric_key, tick);
    CREATE INDEX IF NOT EXISTS idx_samples_room_tick
      ON metric_samples (room_id, tick);
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      playbook_id TEXT NOT NULL,
      status TEXT NOT NULL,
      seed_node_id TEXT NOT NULL,
      started_tick INTEGER NOT NULL,
      completed_tick INTEGER,
      fingerprint TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_room
      ON campaigns (room_id, started_tick);
    CREATE TABLE IF NOT EXISTS campaign_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_events
      ON campaign_events (campaign_id, tick);
    CREATE TABLE IF NOT EXISTS campaign_incidents (
      campaign_id TEXT NOT NULL,
      incident_id TEXT NOT NULL,
      endpoint_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      PRIMARY KEY (campaign_id, incident_id)
    );
    CREATE TABLE IF NOT EXISTS incidents (
      incident_id TEXT PRIMARY KEY,
      live_incident_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      incident_type TEXT,
      severity TEXT,
      status TEXT NOT NULL,
      affected_node_id TEXT,
      risk_score REAL,
      trust_score REAL,
      summary TEXT,
      evidence_json TEXT,
      graph_context_json TEXT,
      financial_context_json TEXT,
      campaign_id TEXT,
      actions_taken_json TEXT,
      detected_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_room_status
      ON incidents (room_id, status, updated_at_ms);
    CREATE INDEX IF NOT EXISTS idx_incidents_room_live
      ON incidents (room_id, live_incident_id, status);
    CREATE INDEX IF NOT EXISTS idx_incidents_room_detected
      ON incidents (room_id, detected_at_ms);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_one_open_live
      ON incidents (room_id, live_incident_id)
      WHERE status = 'open';
    CREATE TABLE IF NOT EXISTS incident_relationships (
      source_incident_id TEXT NOT NULL,
      target_incident_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      reason TEXT,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (source_incident_id, target_incident_id, relationship_type)
    );
    CREATE INDEX IF NOT EXISTS idx_incident_rel_target
      ON incident_relationships (target_incident_id);
`

function migrate(conn) {
  conn.exec(SCHEMA_SQL)

  // Incremental migrations — safe to run repeatedly on existing databases.
  // Each ALTER TABLE is wrapped individually so one already-present column
  // does not abort the others.
  const alterIfMissing = (table, col, def) => {
    try {
      const cols = conn.prepare(`PRAGMA table_info(${table})`).all()
      const exists = cols.some((c) => c.name === col)
      if (!exists) {
        conn.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
      }
    } catch (err) {
      console.warn(`[store] migrate alter ${table}.${col} skipped:`, err.message)
    }
  }

  // incidents table — added in the Persistent Incident Intelligence module.
  // These are no-ops when the DB was created fresh with SCHEMA_SQL above.
  alterIfMissing('incidents', 'incident_id', 'TEXT')
  alterIfMissing('incidents', 'live_incident_id', 'TEXT NOT NULL DEFAULT ""')
  alterIfMissing('incidents', 'room_id', 'TEXT NOT NULL DEFAULT ""')
  alterIfMissing('incidents', 'incident_type', 'TEXT')
  alterIfMissing('incidents', 'severity', 'TEXT')
  alterIfMissing('incidents', 'status', 'TEXT NOT NULL DEFAULT "open"')
  alterIfMissing('incidents', 'affected_node_id', 'TEXT')
  alterIfMissing('incidents', 'risk_score', 'REAL')
  alterIfMissing('incidents', 'trust_score', 'REAL')
  alterIfMissing('incidents', 'summary', 'TEXT')
  alterIfMissing('incidents', 'evidence_json', 'TEXT')
  alterIfMissing('incidents', 'graph_context_json', 'TEXT')
  alterIfMissing('incidents', 'financial_context_json', 'TEXT')
  alterIfMissing('incidents', 'campaign_id', 'TEXT')
  alterIfMissing('incidents', 'actions_taken_json', 'TEXT')
  alterIfMissing('incidents', 'detected_at_ms', 'INTEGER NOT NULL DEFAULT 0')
  alterIfMissing('incidents', 'updated_at_ms', 'INTEGER NOT NULL DEFAULT 0')

  // incident_relationships — added in the same module.
  alterIfMissing('incident_relationships', 'source_incident_id', 'TEXT NOT NULL DEFAULT ""')
  alterIfMissing('incident_relationships', 'target_incident_id', 'TEXT NOT NULL DEFAULT ""')
  alterIfMissing('incident_relationships', 'relationship_type', 'TEXT NOT NULL DEFAULT ""')
  alterIfMissing('incident_relationships', 'reason', 'TEXT')
  alterIfMissing('incident_relationships', 'created_at_ms', 'INTEGER NOT NULL DEFAULT 0')

  try {
    conn.exec(
      `CREATE INDEX IF NOT EXISTS idx_incidents_room_detected
       ON incidents (room_id, detected_at_ms)`
    )
  } catch (err) {
    console.warn('[store] migrate idx_incidents_room_detected skipped:', err.message)
  }
  try {
    conn.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_one_open_live
       ON incidents (room_id, live_incident_id)
       WHERE status = 'open'`
    )
  } catch (err) {
    console.warn('[store] migrate idx_incidents_one_open_live skipped:', err.message)
  }
}

function ensureDb() {
  if (db) return db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

export function getMetricsDb() {
  return ensureDb()
}

/** Isolated in-memory DB for unit tests. Do not call from production. */
export function resetMetricsDbForTests() {
  if (db) {
    try {
      db.close()
    } catch {
      // ignore
    }
    db = null
  }
  db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

const insertIndex = () =>
  ensureDb().prepare(
    `INSERT OR REPLACE INTO snapshot_index (room_id, tick, ts_ms) VALUES (?, ?, ?)`
  )

const insertSample = () =>
  ensureDb().prepare(
    `INSERT OR REPLACE INTO metric_samples
      (room_id, tick, ts_ms, endpoint_id, metric_key, value)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

const insertDetection = () =>
  ensureDb().prepare(
    `INSERT OR REPLACE INTO detection_runs (room_id, tick, ts_ms, payload_json)
     VALUES (?, ?, ?, ?)`
  )

/**
 * @param {import('../detection/types.js').DetectionInput} input
 */
export function appendDetectionInput(input) {
  const conn = ensureDb()
  const roomId = input.roomId
  const tick = input.simulationTick
  const tsMs = input.tsMs
  const tx = conn.transaction(() => {
    insertIndex().run(roomId, tick, tsMs)
    for (const ep of input.endpoints) {
      const keys = new Set(getTelemetryKeys())
      for (const key of Object.keys(ep.telemetry ?? {})) {
        if (!isTelemetryMetaKey(key)) keys.add(key)
      }
      for (const key of keys) {
        const n = Number(ep.telemetry?.[key])
        if (!Number.isFinite(n)) continue
        insertSample().run(roomId, tick, tsMs, ep.id, key, n)
      }
    }
    const cutoff = tick - RETENTION_TICKS
    if (cutoff > 0) {
      conn.prepare(`DELETE FROM metric_samples WHERE room_id = ? AND tick <= ?`).run(roomId, cutoff)
      conn.prepare(`DELETE FROM snapshot_index WHERE room_id = ? AND tick <= ?`).run(roomId, cutoff)
      conn.prepare(`DELETE FROM detection_runs WHERE room_id = ? AND tick <= ?`).run(roomId, cutoff)
    }
  })
  tx()
}

/**
 * Telemetry samples for the active TGNN window, anchored to this match's current tick.
 * Never returns rows with tick > currentTick (stale/future ticks from a prior match).
 *
 * @param {string} roomId
 * @param {number} [windowTicks]
 * @param {number} [currentTick] current simulationTick; required to bound the window
 * @returns {Record<string, import('../detection/types.js').EndpointLookback>}
 */
export function getLookback(roomId, windowTicks = LOOKBACK_TICKS, currentTick) {
  const t = Number(currentTick)
  if (!Number.isFinite(t)) return {}
  const conn = ensureDb()
  const n = Math.max(1, Number(windowTicks) || LOOKBACK_TICKS)
  const rows = conn
    .prepare(
      `SELECT endpoint_id, metric_key, tick, value
       FROM metric_samples
       WHERE room_id = ?
         AND tick <= ?
         AND tick > ?
       ORDER BY tick ASC`
    )
    .all(roomId, t, t - n)

  /** @type {Record<string, import('../detection/types.js').EndpointLookback>} */
  const out = {}
  for (const row of rows) {
    if (!out[row.endpoint_id]) out[row.endpoint_id] = emptyLookback()
    if (!Array.isArray(out[row.endpoint_id][row.metric_key])) {
      out[row.endpoint_id][row.metric_key] = []
    }
    out[row.endpoint_id][row.metric_key].push({ tick: row.tick, value: row.value })
  }
  return out
}

/**
 * @param {string} roomId
 * @param {{ endpoint?: string, fromTick?: number, toTick?: number }} query
 */
export function queryMetrics(roomId, query = {}) {
  const conn = ensureDb()
  const clauses = ['room_id = ?']
  const params = [roomId]
  if (query.endpoint) {
    clauses.push('endpoint_id = ?')
    params.push(String(query.endpoint))
  }
  if (query.fromTick != null && Number.isFinite(Number(query.fromTick))) {
    clauses.push('tick >= ?')
    params.push(Number(query.fromTick))
  }
  if (query.toTick != null && Number.isFinite(Number(query.toTick))) {
    clauses.push('tick <= ?')
    params.push(Number(query.toTick))
  }
  return conn
    .prepare(
      `SELECT endpoint_id AS endpointId, metric_key AS metricKey, tick, ts_ms AS tsMs, value
       FROM metric_samples
       WHERE ${clauses.join(' AND ')}
       ORDER BY tick ASC, endpoint_id ASC`
    )
    .all(...params)
}

export function saveDetectionRun(roomId, tick, tsMs, payload) {
  insertDetection().run(roomId, tick, tsMs, JSON.stringify(payload ?? {}))
}

export function getLatestDetection(roomId) {
  const row = ensureDb()
    .prepare(
      `SELECT tick, ts_ms AS tsMs, payload_json AS payloadJson
       FROM detection_runs
       WHERE room_id = ?
       ORDER BY tick DESC
       LIMIT 1`
    )
    .get(roomId)
  if (!row) return null
  try {
    return {
      tick: row.tick,
      tsMs: row.tsMs,
      detection: JSON.parse(row.payloadJson),
    }
  } catch {
    return { tick: row.tick, tsMs: row.tsMs, detection: null }
  }
}

/** Drop incident rows for one room. Does not touch lookback samples or calibrator windows. */
export function deleteRoomIncidents(roomId) {
  const id = String(roomId ?? '')
  if (!id) return
  const conn = ensureDb()
  const tx = conn.transaction(() => {
    conn
      .prepare(
        `DELETE FROM incident_relationships
         WHERE source_incident_id IN (SELECT incident_id FROM incidents WHERE room_id = ?)
            OR target_incident_id IN (SELECT incident_id FROM incidents WHERE room_id = ?)`
      )
      .run(id, id)
    conn.prepare(`DELETE FROM incidents WHERE room_id = ?`).run(id)
  })
  tx()
}

/** Drop operational lookback samples for one room. Does not touch incident/campaign history. */
export function deleteRoomLookbackSamples(roomId) {
  const id = String(roomId ?? '')
  if (!id) return
  const conn = ensureDb()
  const tx = conn.transaction(() => {
    conn.prepare(`DELETE FROM metric_samples WHERE room_id = ?`).run(id)
    conn.prepare(`DELETE FROM snapshot_index WHERE room_id = ?`).run(id)
    conn.prepare(`DELETE FROM detection_runs WHERE room_id = ?`).run(id)
  })
  tx()
}

export function deleteRoomMetrics(roomId) {
  deleteRoomLookbackSamples(roomId)
  deleteRoomIncidents(roomId)
}

export function upsertCampaign(campaign) {
  if (!campaign?.id) return
  ensureDb()
    .prepare(
      `INSERT INTO campaigns (
        id, room_id, playbook_id, status, seed_node_id, started_tick, completed_tick, fingerprint, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        completed_tick = excluded.completed_tick,
        fingerprint = excluded.fingerprint,
        payload_json = excluded.payload_json`
    )
    .run(
      campaign.id,
      campaign.roomId,
      campaign.playbookId,
      campaign.status,
      campaign.seedNodeId,
      Number(campaign.startedTick) || 0,
      campaign.completedTick ?? null,
      campaign.fingerprint ?? '',
      JSON.stringify(campaign)
    )
}

export function appendCampaignEvent(campaignId, tick, kind, payload = {}) {
  if (!campaignId) return
  ensureDb()
    .prepare(
      `INSERT INTO campaign_events (campaign_id, tick, kind, payload_json)
       VALUES (?, ?, ?, ?)`
    )
    .run(campaignId, Number(tick) || 0, String(kind), JSON.stringify(payload ?? {}))
}

export function linkCampaignIncident(campaignId, incidentId, endpointId, tick) {
  if (!campaignId || !incidentId) return false
  const info = ensureDb()
    .prepare(
      `INSERT OR IGNORE INTO campaign_incidents (campaign_id, incident_id, endpoint_id, tick)
       VALUES (?, ?, ?, ?)`
    )
    .run(campaignId, incidentId, String(endpointId ?? ''), Number(tick) || 0)
  return info.changes > 0
}

export function listCampaigns(roomId) {
  const rows = ensureDb()
    .prepare(
      `SELECT payload_json AS payloadJson FROM campaigns WHERE room_id = ? ORDER BY started_tick DESC`
    )
    .all(roomId)
  return rows.map((row) => {
    try {
      return JSON.parse(row.payloadJson)
    } catch {
      return null
    }
  }).filter(Boolean)
}
