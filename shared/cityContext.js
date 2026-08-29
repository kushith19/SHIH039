import { TRUST_CONFIG } from './trustConfig.js'
import {
  sampleEdgePackets,
  sampleEndpointTelemetry,
} from './cityModel/liveTelemetry.js'
import { setYamlMetricNames, yamlMetricNamesFromModel, numericTelemetryBag } from './telemetryKeys.js'

const DEFAULT_CITY_CONTEXTS = [
  'normal_day',
  'rush_hour',
  'night',
  'weekend',
  'heavy_rain',
  'major_event',
]

const DEFAULT_CITY_CONTEXT_LABELS = {
  normal_day: 'Normal day',
  rush_hour: 'Rush hour',
  night: 'Night',
  weekend: 'Weekend',
  heavy_rain: 'Heavy rain',
  major_event: 'Major event',
}

const DEFAULT_PRIORITIES = {
  heavy_rain: 20,
  major_event: 15,
  rush_hour: 10,
  night: 5,
  weekend: 3,
  normal_day: 1,
}

export let CITY_CONTEXTS = Object.freeze([...DEFAULT_CITY_CONTEXTS])

export const CITY_CONTEXT_NORMAL = 'normal_day'

let CONTEXT_SET = new Set(CITY_CONTEXTS)
let overlay = null

export function applyCityModelOverlay(model) {
  if (!model?.contexts?.length) {
    overlay = null
    CITY_CONTEXTS = Object.freeze([...DEFAULT_CITY_CONTEXTS])
    CONTEXT_SET = new Set(CITY_CONTEXTS)
    setYamlMetricNames([])
    return false
  }
  overlay = model
  CITY_CONTEXTS = Object.freeze([...model.contexts])
  CONTEXT_SET = new Set(CITY_CONTEXTS)
  const yamlNames = model.yamlMetricNames ?? yamlMetricNamesFromModel(model)
  setYamlMetricNames(yamlNames)
  return true
}

export function getCityModelOverlay() {
  return overlay
}

export function cityContextLabel(id) {
  const key = String(id ?? '')
  return overlay?.labels?.[key] ?? DEFAULT_CITY_CONTEXT_LABELS[key] ?? key
}

function cityCfg(config) {
  const base = config?.cityContext ?? TRUST_CONFIG.cityContext
  if (!overlay) return base
  return {
    ...base,
    multipliers: overlay.multipliers ?? base.multipliers,
    fallback: overlay.fallback ?? base.fallback,
    priorities: overlay.priorities ?? base.priorities ?? DEFAULT_PRIORITIES,
  }
}

function epsOf(config) {
  const n = Number((config ?? TRUST_CONFIG).eps)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function normalizeCityContext(raw, config = TRUST_CONFIG) {
  const key = String(raw ?? '')
  if (CONTEXT_SET.has(key)) return key
  const fallback = cityCfg(config).fallback
  return CONTEXT_SET.has(fallback) ? fallback : CITY_CONTEXT_NORMAL
}

export function cityClockAt(simulationTick, config = TRUST_CONFIG) {
  const cfg = cityCfg(config)
  const tph = Math.max(1, Number(cfg.ticksPerHour) || 8)
  const hpd = Math.max(1, Number(cfg.hoursPerDay) || 24)
  const startHour = Number(cfg.startHour)
  const origin = Number.isFinite(startHour) ? startHour : 10
  const t = Math.max(0, Math.floor(Number(simulationTick) || 0))
  const hourOfDay = Math.floor((t / tph + origin) % hpd)
  const dayIndex = Math.floor((t / tph + origin) / hpd)
  const startDow = Number(cfg.startDayOfWeek)
  const dowOffset = Number.isFinite(startDow) ? startDow : 0
  const dayOfWeek = (((dayIndex + dowOffset) % 7) + 7) % 7
  return {
    hourOfDay,
    dayIndex,
    dayOfWeek,
    isWeekend: dayOfWeek >= 5,
  }
}

export function simHourAt(simulationTick, config = TRUST_CONFIG) {
  return cityClockAt(simulationTick, config).hourOfDay
}

function pickContextByPriority(ids, config) {
  const pri = cityCfg(config).priorities ?? DEFAULT_PRIORITIES
  let best = ids[ids.length - 1] ?? CITY_CONTEXT_NORMAL
  let bestP = -Infinity
  for (const id of ids) {
    const n = Number(pri[id])
    const p = Number.isFinite(n) ? n : 0
    if (p > bestP) {
      bestP = p
      best = id
    }
  }
  return best
}

export function cityContextAt(simulationTick, config = TRUST_CONFIG) {
  const cfg = cityCfg(config)
  const clock = cityClockAt(simulationTick, config)
  const { hourOfDay, dayIndex, isWeekend } = clock

  const rainEvery = Math.max(1, Number(cfg.rainEveryDays) || 3)
  const eventEvery = Math.max(1, Number(cfg.eventEveryDays) || 5)
  const inRain =
    dayIndex % rainEvery === 0 &&
    hourOfDay >= (Number(cfg.rainHourStart) || 13) &&
    hourOfDay <= (Number(cfg.rainHourEnd) || 16)
  const inEvent =
    dayIndex % eventEvery === 0 &&
    hourOfDay >= (Number(cfg.eventHourStart) || 18) &&
    hourOfDay <= (Number(cfg.eventHourEnd) || 21)

  const matches = []
  if (inEvent) matches.push('major_event')
  if (inRain) matches.push('heavy_rain')
  const rushHours = cfg.rushHours ?? []
  if (!isWeekend && rushHours.includes(hourOfDay)) matches.push('rush_hour')
  const nightHours = cfg.nightHours ?? []
  if (nightHours.includes(hourOfDay)) matches.push('night')
  if (isWeekend) matches.push('weekend')
  matches.push(CITY_CONTEXT_NORMAL)
  return pickContextByPriority(matches, config)
}

export function endpointFamily(sector, type) {
  const t = String(type ?? '').toLowerCase()
  const s = String(sector ?? '').toLowerCase()
  if (t.includes('street_light') || t.includes('lighting')) return 'lighting'
  if (
    t.includes('stormwater') ||
    t.includes('flood') ||
    t.includes('weather') ||
    t.includes('air_quality') ||
    t.includes('environmental')
  ) {
    return 'weatherWater'
  }
  if (s.includes('transport')) return 'transport'
  if (s.includes('emergency') || s.includes('safety')) return 'emergency'
  if (s.includes('government') || s.includes('education')) return 'civic'
  if (s.includes('healthcare')) return 'healthcare'
  if (s.includes('environment') || s.includes('water')) return 'weatherWater'
  if (s.includes('energy') || t.includes('power') || t.includes('scada') || t.includes('grid')) {
    return 'energy'
  }
  if (s.includes('telecom') || t.includes('telecom') || t.includes('dns')) return 'telecom'
  if (s.includes('finance') || s.includes('bank') || t.includes('banking')) return 'finance'
  return 'default'
}

export function contextMultiplier(context, family, metricKey, config = TRUST_CONFIG) {
  const ctx = normalizeCityContext(context, config)
  const tables = cityCfg(config).multipliers ?? {}
  const byFamily = tables[ctx] ?? {}
  const normal = tables[CITY_CONTEXT_NORMAL] ?? {}
  const famKey = String(family ?? 'default')
  const famTable =
    famKey === 'default'
      ? (byFamily.default ?? normal.default ?? {})
      : (byFamily[famKey] ?? normal[famKey] ?? {})
  const n = Number(famTable[metricKey] ?? 1)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function expectedValue(baselineValue, context, family, metricKey, config = TRUST_CONFIG) {
  const base = Number(baselineValue)
  const safe = Number.isFinite(base) && base > 0 ? base : 0
  return safe * contextMultiplier(context, family, metricKey, config)
}

export function expectedTelemetry(baseline, context, meta = {}, config = TRUST_CONFIG) {
  const tick = Number(meta.tick ?? meta.simulationTick) || 0
  const hourRaw = meta.simHour
  const simHour = Number.isFinite(Number(hourRaw)) ? Number(hourRaw) : simHourAt(tick, config)
  return sampleEndpointTelemetry({
    baseline,
    context,
    meta,
    tick,
    jitter: false,
    simHour,
    model: overlay,
    contextMultiplier: (ctx, family, key) => contextMultiplier(ctx, family, key, config),
    endpointFamily,
  })
}

export function observedTelemetry(baseline, context, meta = {}, config = TRUST_CONFIG) {
  const tick = Number(meta.tick ?? meta.simulationTick) || 0
  const hourRaw = meta.simHour
  const simHour = Number.isFinite(Number(hourRaw)) ? Number(hourRaw) : simHourAt(tick, config)
  return sampleEndpointTelemetry({
    baseline,
    context,
    meta,
    tick,
    jitter: true,
    simHour,
    model: overlay,
    contextMultiplier: (ctx, family, key) => contextMultiplier(ctx, family, key, config),
    endpointFamily,
  })
}

function yamlTelemetryArgs(baseline, context, meta, config, jitter) {
  const tick = Number(meta.tick ?? meta.simulationTick) || 0
  const hourRaw = meta.simHour
  const simHour = Number.isFinite(Number(hourRaw)) ? Number(hourRaw) : simHourAt(tick, config)
  return {
    baseline,
    context,
    meta,
    tick,
    jitter,
    simHour,
    model: overlay,
    contextMultiplier: (ctx, family, key) => contextMultiplier(ctx, family, key, config),
    endpointFamily,
  }
}

export function expectedYamlTelemetry(baseline, context, meta = {}, config = TRUST_CONFIG) {
  return sampleEndpointYamlTelemetry(yamlTelemetryArgs(baseline, context, meta, config, false))
}

export function observedYamlTelemetry(baseline, context, meta = {}, config = TRUST_CONFIG) {
  return sampleEndpointYamlTelemetry(yamlTelemetryArgs(baseline, context, meta, config, true))
}

export function expectedEdgePackets(baselinePps, context, config = TRUST_CONFIG, extra = {}) {
  const tick = Number(extra.tick ?? extra.simulationTick) || 0
  return sampleEdgePackets({
    baselinePps,
    context,
    tick,
    jitter: false,
    edgeId: extra.edgeId ?? '',
    contextMultiplier: (ctx, family, key) => contextMultiplier(ctx, family, key, config),
  })
}

export function observedEdgePackets(baselinePps, context, config = TRUST_CONFIG, extra = {}) {
  const tick = Number(extra.tick ?? extra.simulationTick) || 0
  return sampleEdgePackets({
    baselinePps,
    context,
    tick,
    jitter: extra.jitter !== false,
    edgeId: extra.edgeId ?? '',
    contextMultiplier: (ctx, family, key) => contextMultiplier(ctx, family, key, config),
  })
}

export function contextResidual(observed, expected, config = TRUST_CONFIG) {
  const eps = epsOf(config)
  const exp = Math.max(Number(expected) || 0, eps)
  return Math.abs((Number(observed) || 0) - (Number(expected) || 0)) / exp
}

export function contextResidualRatio(observed, expected, config = TRUST_CONFIG) {
  const eps = epsOf(config)
  const exp = Math.max(Number(expected) || 0, eps)
  return (Number(observed) || 0) / exp
}

export function activityBandsForContext(cityContext, config = TRUST_CONFIG) {
  const ctx = normalizeCityContext(cityContext, config)
  const byCtx = cityCfg(config).activityBandsByContext
  return byCtx?.[ctx] ?? config.behavioral?.activityBands ?? TRUST_CONFIG.behavioral.activityBands
}

export function resolveExpectedTelemetry(endpoint, config = TRUST_CONFIG) {
  const expected = endpoint?.expectedTelemetry
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return numericTelemetryBag(expected)
  }
  const baseline = endpoint?.baselineTelemetry ?? endpoint?.telemetry ?? {}
  const context = normalizeCityContext(
    endpoint?.activeContexts?.cityContext ?? endpoint?.cityContext,
    config
  )
  return expectedTelemetry(baseline, context, {
    sector: endpoint?.sector,
    type: endpoint?.type,
    id: endpoint?.id,
    cityEndpointId: endpoint?.cityEndpointId,
  }, config)
}

export function parseCityContextOverride(raw) {
  if (raw == null) return null
  const key = String(raw).trim()
  if (key === '' || key === 'auto') return null
  if (CONTEXT_SET.has(key)) return key
  return undefined
}

export function resolveRoomCityContext(room, config = TRUST_CONFIG) {
  const override = parseCityContextOverride(room?.cityContextOverride)
  if (override) return override
  return cityContextAt(room?.simulationTick ?? 0, config)
}

export function cityContextOfSim(sim, config = TRUST_CONFIG) {
  if (sim?.cityContext) return normalizeCityContext(sim.cityContext, config)
  return cityContextAt(sim?.simulationTick ?? 0, config)
}
