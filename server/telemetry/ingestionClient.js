import { telemetryFromIngestedReadings } from '../../shared/cityModel/liveTelemetry.js'
import { yamlIdForCatalogType } from '../../shared/cityModel/endpointMap.js'
import {
  GAME_KEY_TO_INGEST,
  GAME_METRIC_KEYS,
  ingestedTelemetryPatch,
  isTelemetryMetaKey,
  normalizeMetricName,
} from '../../shared/telemetryKeys.js'
import { nodeTypeOf } from '../infrastructureNode.js'
import { getCityModelOverlay } from '../../shared/cityContext.js'

export const TELE_INGESTION_URL = (
  process.env.TELE_INGESTION_URL || 'http://127.0.0.1:3000'
).replace(/\/$/, '')

const FETCH_MS = 2500

async function ingestRequest(path, { method = 'GET', body } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS)
  try {
    const res = await fetch(`${TELE_INGESTION_URL}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    let json = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    return { ok: false, status: 0, json: null, error: err?.message ?? 'fetch failed' }
  } finally {
    clearTimeout(timer)
  }
}

async function ingestFetch(path) {
  const result = await ingestRequest(path)
  if (!result.ok) {
    throw new Error(result.error ?? `HTTP ${result.status}`)
  }
  return result.json
}

function rowTick(row) {
  const tick = Number(row?.simulationTick)
  if (Number.isFinite(tick) && tick >= 0) return tick
  const ts = Date.parse(row?.time)
  return Number.isFinite(ts) ? ts : 0
}

function rowTsMs(row) {
  const ts = Date.parse(row?.time)
  return Number.isFinite(ts) ? ts : 0
}

/**
 * Latest mapped metrics per city endpoint id.
 * @param {object[]} rows
 * @returns {Record<string, Record<string, number> & { tick?: number, tsMs?: number }>}
 */
export function indexLatestByEndpoint(rows) {
  /** @type {Map<string, Map<number, { tsMs: number, readings: object[] }>>} */
  const byEp = new Map()
  for (const row of rows ?? []) {
    const endpointId = String(row?.endpointId ?? '')
    if (!endpointId) continue
    const tsMs = rowTsMs(row)
    const tick = rowTick(row)
    let ticks = byEp.get(endpointId)
    if (!ticks) {
      ticks = new Map()
      byEp.set(endpointId, ticks)
    }
    const cur = ticks.get(tick)
    if (!cur) ticks.set(tick, { tsMs, readings: [row] })
    else {
      cur.readings.push(row)
      if (tsMs > cur.tsMs) cur.tsMs = tsMs
    }
  }
  /** @type {Record<string, object>} */
  const out = {}
  for (const [id, ticks] of byEp) {
    const latestTick = Math.max(...ticks.keys())
    const group = ticks.get(latestTick)
    const metrics = telemetryFromIngestedReadings(group.readings) ?? {}
    if (!Object.keys(metrics).length) continue
    out[id] = {
      ...metrics,
      tick: latestTick,
      tsMs: group.tsMs,
    }
  }
  return out
}

/**
 * Flatten ingested rows into dashboard sample records keyed by room node id.
 * @param {object[]} rows
 * @param {Map<string, string[]>} nodeIdsByCityEndpoint
 */
export function samplesFromIngestedRows(rows, nodeIdsByCityEndpoint) {
  /** @type {Map<string, { endpointId: string, tick: number, tsMs: number, readings: object[] }>} */
  const groups = new Map()
  for (const row of rows ?? []) {
    const endpointId = String(row?.endpointId ?? '')
    if (!endpointId) continue
    const tsMs = rowTsMs(row)
    const tick = rowTick(row)
    const key = `${endpointId}\t${tick}\t${tsMs}`
    const cur = groups.get(key)
    if (cur) cur.readings.push(row)
    else groups.set(key, { endpointId, tick, tsMs, readings: [row] })
  }

  const samples = []
  for (const group of groups.values()) {
    const nodeIds = nodeIdsByCityEndpoint?.get(group.endpointId)
    if (!nodeIds?.length) continue
    const metrics = telemetryFromIngestedReadings(group.readings)
    if (!metrics) continue
    for (const [metricKey, value] of Object.entries(metrics)) {
      if (isTelemetryMetaKey(metricKey)) continue
      const n = Number(value)
      if (!Number.isFinite(n)) continue
      for (const nodeId of nodeIds) {
        samples.push({
          endpointId: nodeId,
          metricKey,
          tick: group.tick,
          tsMs: group.tsMs,
          value: n,
        })
      }
    }
  }
  samples.sort((a, b) => a.tick - b.tick || String(a.endpointId).localeCompare(String(b.endpointId)))
  return samples
}

export function cityEndpointIdOfNode(node) {
  return (
    String(node?.data?.cityEndpointId ?? '').trim() ||
    yamlIdForCatalogType(nodeTypeOf(node?.data)) ||
    ''
  )
}

export function nodeIdsByCityEndpoint(nodes) {
  /** @type {Map<string, string[]>} */
  const map = new Map()
  for (const n of nodes ?? []) {
    const cityId = cityEndpointIdOfNode(n)
    if (!cityId) continue
    const list = map.get(cityId)
    if (list) list.push(n.id)
    else map.set(cityId, [n.id])
  }
  return map
}

export function liveTelemetryByNodeId(nodes, ingestedByEndpoint, simulationTick) {
  const ingested = ingestedByEndpoint && typeof ingestedByEndpoint === 'object' ? ingestedByEndpoint : {}
  const tick = Number(simulationTick)
  /** @type {Record<string, Record<string, number>>} */
  const out = {}
  for (const n of nodes ?? []) {
    const cityId = cityEndpointIdOfNode(n)
    const raw = cityId ? ingested[cityId] : null
    if (!raw) continue
    if (Number.isFinite(tick) && raw.tick != null && Number(raw.tick) !== tick) continue
    const patch = ingestedTelemetryPatch(raw)
    if (Object.keys(patch).length) out[n.id] = patch
  }
  return out
}

export async function getHealth() {
  try {
    const json = await ingestFetch('/health')
    return json?.status === 'healthy' ? 'ok' : 'down'
  } catch {
    return 'down'
  }
}

export async function getInfrastructure() {
  try {
    const json = await ingestFetch('/api/infrastructure')
    const list = Array.isArray(json?.infrastructure) ? json.infrastructure : []
    return { status: list.length ? 'ok' : 'empty', infrastructure: list }
  } catch {
    return { status: 'down', infrastructure: [] }
  }
}

/**
 * @param {number} [minutes]
 * @returns {Promise<{ status: 'ok' | 'empty' | 'down', rows: object[] }>}
 */
export async function getRecentTelemetry(minutes = 5) {
  const window = Math.max(1, Math.min(60, Number(minutes) || 5))
  try {
    const json = await ingestFetch(`/api/telemetry/recent?minutes=${window}`)
    const rows = Array.isArray(json?.data) ? json.data : []
    return { status: rows.length ? 'ok' : 'empty', rows }
  } catch {
    return { status: 'down', rows: [] }
  }
}

export async function getEndpointHistory(endpointId, hours = 24) {
  const id = encodeURIComponent(String(endpointId ?? ''))
  const window = Math.max(1, Math.min(168, Number(hours) || 24))
  try {
    const json = await ingestFetch(`/api/telemetry/history/${id}?hours=${window}`)
    const rows = Array.isArray(json?.samples) ? json.samples : []
    return { status: rows.length ? 'ok' : 'empty', rows }
  } catch {
    return { status: 'down', rows: [] }
  }
}

/**
 * Pull recent telemetry and attach it on the room. Never throws.
 * @param {object} room
 */
export async function refreshRoomIngestion(room) {
  if (!room) return { status: 'down', rows: [], byEndpoint: {} }
  const result = await getRecentTelemetry(5)
  const byEndpoint = indexLatestByEndpoint(result.rows)
  room.ingestionStatus = result.status
  room.ingestedByEndpoint = byEndpoint
  room.ingestedRows = result.rows
  return { ...result, byEndpoint }
}

export const INGEST_METRIC_FIELDS = GAME_METRIC_KEYS.map((key) => ({
  key,
  name: GAME_KEY_TO_INGEST[key].name,
  unit: GAME_KEY_TO_INGEST[key].unit,
}))

export function infrastructureFromCityModel(model) {
  const out = []
  for (const ep of Object.values(model?.endpoints ?? {})) {
    const id = String(ep?.id ?? '').trim()
    if (!id) continue
    out.push({
      id,
      name: String(ep.name || id),
      type: String(ep.type || 'unknown'),
      ...(ep.category ? { sector: String(ep.category) } : {}),
      ...(ep.criticality ? { criticality: String(ep.criticality) } : {}),
    })
  }
  return out
}

export function infrastructureFromSnapshot(snapshot, model = getCityModelOverlay()) {
  const seen = new Map()
  for (const row of infrastructureFromCityModel(model)) {
    seen.set(row.id, row)
  }
  for (const ep of snapshot?.endpoints ?? []) {
    const id = String(ep?.cityEndpointId || '').trim()
    if (!id) continue
    seen.set(id, {
      id,
      name: String(ep.label || id),
      type: String(ep.type || 'unknown'),
      ...(ep.sector ? { sector: String(ep.sector) } : {}),
      ...(ep.criticality ? { criticality: String(ep.criticality) } : {}),
    })
  }
  return [...seen.values()]
}

function pushReading(list, used, name, value, unit) {
  const key = String(name ?? '')
    .toLowerCase()
    .replace(/-/g, '_')
  if (!key || used.has(key)) return
  const n = Number(value)
  if (!Number.isFinite(n)) return
  used.add(key)
  list.push({
    name: String(name),
    value: n,
    unit: String(unit ?? 'count').slice(0, 50) || 'count',
  })
}

export function toIngestSnapshot(snapshot) {
  const byCity = new Map()
  for (const ep of snapshot?.endpoints ?? []) {
    const id = String(ep?.cityEndpointId || '').trim()
    if (!id) continue
    const telemetry = []
    const used = new Set()
    const src = ep.telemetry && typeof ep.telemetry === 'object' ? ep.telemetry : {}
    for (const row of ep.yamlTelemetry ?? []) {
      pushReading(telemetry, used, normalizeMetricName(row.name) || row.name, row.value, row.unit)
    }
    for (const [key, value] of Object.entries(src)) {
      if (isTelemetryMetaKey(key) || GAME_METRIC_KEYS.includes(key)) continue
      pushReading(telemetry, used, key, value, src.telemetryUnits?.[key] ?? 'count')
    }
    for (const field of INGEST_METRIC_FIELDS) {
      pushReading(telemetry, used, field.name, src[field.key], field.unit)
    }
    if (!telemetry.length) continue
    const prev = byCity.get(id)
    byCity.set(id, {
      endpoint: {
        id,
        name: String(ep.label || id),
        type: String(ep.type || 'unknown'),
      },
      telemetry: prev ? mergeIngestTelemetry(prev.telemetry, telemetry) : telemetry,
    })
  }
  const ts = String(snapshot?.timestamp || new Date().toISOString())
  const tick = Number(snapshot?.simulationTick)
  return {
    timestamp: ts,
    simulationTick: Number.isFinite(tick) && tick >= 0 ? Math.floor(tick) : 0,
    endpoints: [...byCity.values()],
  }
}

function mergeIngestTelemetry(a, b) {
  const used = new Set()
  const out = []
  for (const row of b ?? []) {
    pushReading(out, used, row.name, row.value, row.unit)
  }
  for (const row of a ?? []) {
    pushReading(out, used, row.name, row.value, row.unit)
  }
  return out
}

export async function postInfrastructure(batch) {
  const list = Array.isArray(batch) ? batch : []
  if (!list.length) return { ok: true, status: 202, json: { registered: 0 } }
  const result = await ingestRequest('/ingest/infrastructure', { method: 'POST', body: list })
  return result
}

export async function postSnapshot(payload) {
  if (!payload?.endpoints?.length) {
    return { ok: true, status: 202, json: { skipped: true }, empty: true }
  }
  const result = await ingestRequest('/ingest/snapshot', { method: 'POST', body: payload })
  const message = String(result.json?.error ?? result.error ?? '')
  const unknown = /unknown endpoint/i.test(message)
  return { ...result, unknownEndpoints: unknown, message }
}

/**
 * Register snapshot endpoints once per room. Retries when a later snapshot hits unknown FKs.
 * @param {object} room
 * @param {object} snapshot
 */
export async function ensureRoomInfrastructure(room, snapshot) {
  if (room?.infraRegistered === true) return { ok: true, skipped: true }
  const batch = infrastructureFromSnapshot(snapshot)
  if (!batch.length) {
    if (room) room.infraRegistered = true
    return { ok: true, skipped: true }
  }
  const result = await postInfrastructure(batch)
  if (result.ok && room) room.infraRegistered = true
  return result
}
