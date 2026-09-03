import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { cityContextAt, expectedEdgePackets, expectedTelemetry } from '../../shared/cityContext.js'

function windowSize() {
  const n = Number(TRUST_CONFIG.tgnn.temporalWindow)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3
}

function lookbackTicks(input) {
  const ticks = new Set()
  const current = Number(input.simulationTick) || 0
  ticks.add(current)
  for (const ep of input.endpoints ?? []) {
    for (const series of Object.values(ep.lookback ?? {})) {
      if (!Array.isArray(series)) continue
      for (const s of series) {
        const t = Number(s.tick) || 0
        if (t > current) continue
        ticks.add(t)
      }
    }
  }
  return [...ticks].sort((a, b) => a - b)
}

/**
 * Last K ticks at or before the current simulation tick, left-padded by repeating
 * the oldest eligible tick. Never includes a sample from a future tick.
 * @param {import('./types.js').DetectionInput} input
 * @returns {number[]}
 */
export function collectWindowTicks(input) {
  const K = windowSize()
  const current = Number(input.simulationTick) || 0
  const all = lookbackTicks(input)
  if (all.length === 0) return Array.from({ length: K }, () => current)
  const slice = all.slice(-K)
  if (slice[slice.length - 1] !== current) {
    slice.push(current)
    while (slice.length > K) slice.shift()
  }
  while (slice.length < K) slice.unshift(slice[0] ?? current)
  return slice
}

function sampleLookback(ep, tick, currentTick) {
  const fallback = ep.telemetry && typeof ep.telemetry === 'object' ? ep.telemetry : {}
  if (Number(tick) === Number(currentTick)) return { ...fallback }
  const out = { ...fallback }
  for (const [key, series] of Object.entries(ep.lookback ?? {})) {
    if (!Array.isArray(series) || series.length === 0) continue
    let best = null
    for (const s of series) {
      const t = Number(s.tick) || 0
      if (t > currentTick) continue
      if (t === tick) {
        best = s
        break
      }
      if (t <= tick) best = s
    }
    if (best) out[key] = best.value
  }
  return out
}

function endpointToFeatureNode(ep, tick, mode, currentTick) {
  const meta = { sector: ep.sector, type: ep.type, id: ep.id, tick }
  const context = cityContextAt(tick)
  const expected = expectedTelemetry(ep.baselineTelemetry, context, meta)
  const telemetry = mode === 'baseline' ? expected : sampleLookback(ep, tick, currentTick)
  return {
    id: ep.id,
    telemetry,
    expectedTelemetry: expected,
    baselineTelemetry: ep.baselineTelemetry,
    criticality: ep.criticality,
    typeTrust: ep.behaviour?.intrinsicTrust,
    runtimeState: ep.runtimeState,
    attackOverrideActive: ep.behaviour?.attackOverrideActive === true,
    cityContext: context,
    sector: ep.sector,
    type: ep.type,
  }
}

function dependencyToFeatureEdge(d, tick, mode) {
  const context = cityContextAt(tick)
  const expected = expectedEdgePackets(d.baselinePacketsPerSecond ?? d.packetsPerSecond, context, undefined, {
    tick,
    edgeId: d.id,
  })
  return {
    source: d.source,
    target: d.target,
    packetsPerSecond: mode === 'baseline' ? expected : d.packetsPerSecond,
    expectedPacketsPerSecond: expected,
  }
}

function graphStateAt(input, tick, mode) {
  const currentTick = Number(input.simulationTick) || 0
  return {
    endpoints: (input.endpoints ?? []).map((ep) => endpointToFeatureNode(ep, tick, mode, currentTick)),
    dependencies: (input.dependencies ?? []).map((d) => dependencyToFeatureEdge(d, tick, mode)),
  }
}

/**
 * Observed vs context-correct expected city-graph windows (t-K+1 … t).
 *
 * @param {import('./types.js').DetectionInput} input
 */
export function buildTgnnWindows(input) {
  const ticks = collectWindowTicks(input)
  return {
    ticks,
    observed: ticks.map((tick) => graphStateAt(input, tick, 'observed')),
    baseline: ticks.map((tick) => graphStateAt(input, tick, 'baseline')),
  }
}
