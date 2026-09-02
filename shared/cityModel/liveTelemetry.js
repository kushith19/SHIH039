import { METRIC_KEYS, levelScale } from './parseCityModel.js'
import { resolveCityEndpoint } from './endpointMap.js'
import { GAME_INGEST_TO_KEY, GAME_KEY_TO_INGEST, normalizeMetricName } from '../telemetryKeys.js'

const PEAK_CONTEXTS = new Set(['rush_hour', 'major_event'])
const NIGHT_CONTEXTS = new Set(['night'])

export const GAME_INGEST_METRIC_NAMES = Object.freeze(
  Object.values(GAME_KEY_TO_INGEST).map((row) => row.name)
)

function clamp(n, lo, hi) {
  const x = Number(n)
  if (!Number.isFinite(x)) return lo
  return Math.min(hi, Math.max(lo, x))
}

function hourFromClock(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return ((Math.floor(value) % 24) + 24) % 24
  const s = String(value ?? '').trim()
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(s)
  if (!m) return null
  return clamp(Number(m[1]), 0, 23)
}

function hourInRange(hour, start, end) {
  if (start == null || end == null) return false
  if (start === end) return true
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

export function operatingPhaseAt(schedule, simHour) {
  const hour = hourFromClock(simHour) ?? 0
  const phases = Array.isArray(schedule?.phases) ? schedule.phases : []
  let best = null
  let bestPri = -Infinity
  for (const phase of phases) {
    const start = hourFromClock(phase?.start)
    const end = hourFromClock(phase?.end)
    if (!hourInRange(hour, start, end)) continue
    const pri = Number(phase?.priority)
    const p = Number.isFinite(pri) ? pri : 0
    if (p >= bestPri) {
      bestPri = p
      best = phase
    }
  }
  if (best) return String(best.id ?? '')
  return String(schedule?.defaultPhase ?? '')
}

export function behaviourProfileFor(context, phaseId) {
  const phase = String(phaseId ?? '').toLowerCase()
  if (phase.includes('night')) return 'night'
  const ctx = String(context ?? '')
  if (NIGHT_CONTEXTS.has(ctx)) return 'night'
  if (PEAK_CONTEXTS.has(ctx)) return 'peak'
  return 'normal'
}

function behaviourScale(profile) {
  const src = profile && typeof profile === 'object' ? profile : {}
  const activity = levelScale(src.activityLevel) ?? 1
  const network = levelScale(src.networkActivity) ?? activity
  const workload = levelScale(src.workload) ?? activity
  const users = levelScale(src.expectedUsers) ?? 1
  return {
    packetsPerSecond: network,
    httpRequestsPerMin: users,
    filesDownloaded: (activity + workload) / 2,
    failedLoginsPerMin: 1 + (activity - 1) * 0.15,
    healthStatus: String(src.healthStatus ?? 'healthy').toLowerCase(),
    mean: (network + users + (activity + workload) / 2) / 3,
  }
}

function hasState(endpoint, name) {
  return Boolean(endpoint?.states && endpoint.states[name])
}

export function operationalStateName(endpoint, meta = {}, profileName = 'normal') {
  if (meta.quarantined) {
    if (hasState(endpoint, 'degraded')) return 'degraded'
    if (hasState(endpoint, 'recovering')) return 'recovering'
  }
  if (meta.attackOverrideActive) {
    if (hasState(endpoint, 'under_attack')) return 'under_attack'
    if (hasState(endpoint, 'compromised')) return 'compromised'
    if (hasState(endpoint, 'suspicious')) return 'suspicious'
  }
  if (profileName === 'peak' && hasState(endpoint, 'busy')) return 'busy'
  if (hasState(endpoint, 'healthy')) return 'healthy'
  const keys = endpoint?.states && typeof endpoint.states === 'object' ? Object.keys(endpoint.states) : []
  return keys[0] || 'healthy'
}

function stateScale(state) {
  if (!state || typeof state !== 'object') return 1
  const parts = [
    levelScale(state.networkActivity),
    levelScale(state.workload),
    levelScale(state.expectedUsers),
    levelScale(state.activityLevel),
    levelScale(state.administrativeActivity),
  ].filter((n) => n != null)
  if (!parts.length) return 1
  return parts.reduce((a, b) => a + b, 0) / parts.length
}

export function actorLoadForEndpoint(endpointId, actors, context, listedActorIds = []) {
  const id = String(endpointId ?? '')
  const list = Array.isArray(actors) ? actors : []
  const byId = new Map()
  for (const actor of list) {
    const aid = String(actor?.id ?? '')
    if (aid) byId.set(aid, actor)
  }
  const scales = []
  for (const actor of list) {
    const targets = actor?.interactsWith ?? actor?.interacts_with
    if (!Array.isArray(targets) || !targets.includes(id)) continue
    const n = levelScale(actor?.activity?.[context])
    if (n != null) scales.push(n)
  }
  for (const raw of listedActorIds ?? []) {
    const actor = byId.get(String(raw ?? '').trim())
    const n = levelScale(actor?.activity?.[context])
    if (n != null) scales.push(n)
  }
  if (!scales.length) return 1
  return scales.reduce((a, b) => a + b, 0) / scales.length
}

function yamlLerp(metric, load) {
  const min = Number(metric.min)
  const max = Number(metric.max)
  const lo = Number.isFinite(min) ? min : 0
  const hi = Number.isFinite(max) && max > lo ? max : lo
  const t = clamp(0.2 + 0.3 * load, 0.05, 0.95)
  return lo + (hi - lo) * t
}

/**
 * Copy each GET metric onto the bag under its own name.
 * The four ingest names also fill camelCase. YAML names are never aliased onto game keys.
 *
 * @param {Array<{ name?: string, metricName?: string, value?: number, unit?: string }>} readings
 * @returns {Record<string, number> | null}
 */
export function telemetryFromIngestedReadings(readings) {
  const out = {}
  for (const r of readings ?? []) {
    const name = normalizeMetricName(r?.metricName ?? r?.name)
    if (!name) continue
    const n = Number(r.value)
    if (!Number.isFinite(n)) continue
    const value = Math.max(0, n)
    out[name] = value
    const gameKey = GAME_INGEST_TO_KEY[name]
    if (gameKey) out[gameKey] = value
  }
  return Object.keys(out).length ? out : null
}

export function nativeReadingsFromIngested(readings) {
  const game = new Set(GAME_INGEST_METRIC_NAMES)
  const out = []
  for (const r of readings ?? []) {
    const name = normalizeMetricName(r?.metricName ?? r?.name)
    if (!name || game.has(name)) continue
    const n = Number(r.value)
    if (!Number.isFinite(n)) continue
    const unit = String(r.unit ?? '').trim().slice(0, 50) || 'count'
    out.push({ name, value: n, unit })
  }
  return out
}

function hash32(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function jitterFactor(tick, nodeId, key) {
  const n = hash32(`${tick}|${nodeId}|${key}`)
  const u = n / 0xffffffff
  return 0.985 + u * 0.03
}

function emptyMetrics() {
  const out = {}
  for (const key of METRIC_KEYS) out[key] = 0
  return out
}

function baselineOf(baseline) {
  const src = baseline && typeof baseline === 'object' ? baseline : {}
  const out = emptyMetrics()
  for (const key of METRIC_KEYS) {
    const n = Number(src[key])
    out[key] = Number.isFinite(n) && n > 0 ? n : 0
  }
  return out
}

export function sampleYamlMetrics({ endpoint, load, tick = 0, jitter = false, nodeKey = '' }) {
  const metrics = Array.isArray(endpoint?.metrics) ? endpoint.metrics : []
  const id = String(endpoint?.id ?? nodeKey ?? 'ep')
  const factor = Number.isFinite(Number(load)) && Number(load) > 0 ? Number(load) : 1
  const out = []
  for (const m of metrics) {
    const name = normalizeMetricName(m?.name)
    if (!name) continue
    let value = yamlLerp(m, factor)
    if (jitter) value *= jitterFactor(tick, id, name)
    const lo = Number(m.min)
    const hi = Number(m.max)
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) value = clamp(value, lo, hi)
    const unit = String(m.unit ?? '').trim().slice(0, 50) || 'count'
    out.push({ name, value: Math.max(0, value), unit })
  }
  return out
}

function samplingParts({
  baseline,
  context,
  meta = {},
  simHour,
  model = null,
  contextMultiplier,
  endpointFamily,
}) {
  const base = baselineOf(baseline)
  const type = meta.type ?? meta.assetType
  const sector = meta.sector ?? meta.category
  const family = endpointFamily?.(sector, type) ?? 'default'
  const ctxMult = (key) => {
    const n = Number(contextMultiplier?.(context, family, key) ?? 1)
    return Number.isFinite(n) && n > 0 ? n : 1
  }
  const endpoint = resolveCityEndpoint(meta, model?.endpoints)
  const hour = Number.isFinite(Number(simHour)) ? Number(simHour) : null
  const phaseId = endpoint ? operatingPhaseAt(endpoint.operatingSchedule, hour ?? 0) : ''
  const profileName = behaviourProfileFor(context, phaseId)
  const profile = endpoint?.behaviour?.[profileName] ?? endpoint?.behaviour?.normal ?? {}
  const bands = behaviourScale(profile)
  const actorLoad = endpoint
    ? actorLoadForEndpoint(endpoint.id, model?.actors, context, endpoint.actors)
    : 1
  const stateName = endpoint ? operationalStateName(endpoint, meta, profileName) : 'healthy'
  const stateMult = endpoint ? stateScale(endpoint.states?.[stateName]) : 1
  const yamlLoad = bands.mean * actorLoad * ctxMult('packetsPerSecond') * stateMult
  return { base, endpoint, bands, actorLoad, stateName, stateMult, ctxMult, yamlLoad }
}

/**
 * @param {{
 *   baseline: object
 *   context: string
 *   meta?: object
 *   tick?: number
 *   jitter?: boolean
 *   simHour?: number
 *   model?: object | null
 *   contextMultiplier: (context: string, family: string, key: string) => number
 *   endpointFamily: (sector: string, type: string) => string
 * }} args
 */
export function sampleEndpointTelemetry({
  baseline,
  context,
  meta = {},
  tick = 0,
  jitter = false,
  simHour,
  model = null,
  contextMultiplier,
  endpointFamily,
}) {
  const { base, endpoint, bands, actorLoad, ctxMult, stateMult, yamlLoad } = samplingParts({
    baseline,
    context,
    meta,
    simHour,
    model,
    contextMultiplier,
    endpointFamily,
  })

  const nodeKey = String(meta.id ?? meta.nodeId ?? meta.type ?? 'node')
  const out = emptyMetrics()

  for (const key of METRIC_KEYS) {
    const load = (bands[key] ?? 1) * actorLoad * ctxMult(key) * stateMult
    let value = base[key] * load
    if ((bands.healthStatus === 'degraded' || meta.quarantined) && key === 'failedLoginsPerMin') {
      value *= 1.08
    }
    if (jitter) value *= jitterFactor(tick, nodeKey, key)
    out[key] = Math.max(0, value)
  }

  if (endpoint) {
    const yamlRows = sampleYamlMetrics({
      endpoint,
      load: yamlLoad,
      tick,
      jitter,
      nodeKey,
    })
    for (const row of yamlRows) {
      out[row.name] = row.value
      const gameKey = GAME_INGEST_TO_KEY[row.name]
      if (gameKey) out[gameKey] = row.value
    }
  }
  return out
}

export function sampleEndpointYamlTelemetry(args) {
  const { endpoint, yamlLoad } = samplingParts(args)
  if (!endpoint) return []
  const nodeKey = String(args.meta?.id ?? args.meta?.nodeId ?? endpoint.id)
  return sampleYamlMetrics({
    endpoint,
    load: yamlLoad,
    tick: args.tick ?? 0,
    jitter: args.jitter === true,
    nodeKey,
  })
}

export function sampleEdgePackets({
  baselinePps,
  context,
  tick = 0,
  jitter = false,
  edgeId = '',
  contextMultiplier,
}) {
  const base = Number(baselinePps)
  const safe = Number.isFinite(base) && base > 0 ? base : 0
  const mult = Number(contextMultiplier?.(context, 'default', 'packetsPerSecond') ?? 1)
  const scale = Number.isFinite(mult) && mult > 0 ? mult : 1
  let value = safe * scale
  if (jitter) value *= jitterFactor(tick, edgeId || 'edge', 'packetsPerSecond')
  return Math.max(0, value)
}
