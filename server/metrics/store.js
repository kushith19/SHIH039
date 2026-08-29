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

function ensureDb() {
  if (db) return db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
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
  `)
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
 * @param {string} roomId
 * @param {number} [windowTicks]
 * @returns {Record<string, import('../detection/types.js').EndpointLookback>}
 */
export function getLookback(roomId, windowTicks = LOOKBACK_TICKS) {
  const conn = ensureDb()
  const n = Math.max(1, Number(windowTicks) || LOOKBACK_TICKS)
  const rows = conn
    .prepare(
      `SELECT endpoint_id, metric_key, tick, value
       FROM metric_samples
       WHERE room_id = ?
         AND tick > (SELECT COALESCE(MAX(tick), 0) - ? FROM snapshot_index WHERE room_id = ?)
       ORDER BY tick ASC`
    )
    .all(roomId, n, roomId)

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

export function deleteRoomMetrics(roomId) {
  const conn = ensureDb()
  const tx = conn.transaction(() => {
    conn.prepare(`DELETE FROM metric_samples WHERE room_id = ?`).run(roomId)
    conn.prepare(`DELETE FROM snapshot_index WHERE room_id = ?`).run(roomId)
    conn.prepare(`DELETE FROM detection_runs WHERE room_id = ?`).run(roomId)
  })
  tx()
}
