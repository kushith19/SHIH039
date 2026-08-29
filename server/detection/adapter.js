import { emptyLookback } from './types.js'
import { cityContextAt, normalizeCityContext, simHourAt } from '../../shared/cityContext.js'
import { undirectedNeighbors } from '../../shared/trustModel.js'
import {
  getTelemetryKeys,
  numericTelemetryBag,
} from '../../shared/telemetryKeys.js'

export const NEIGHBOR_LOOKBACK_TICKS = 10

function asTelemetry(raw) {
  return numericTelemetryBag(raw)
}

function asLookback(raw) {
  const base = emptyLookback()
  if (!raw || typeof raw !== 'object') return base
  for (const key of Object.keys(raw)) {
    const series = Array.isArray(raw[key]) ? raw[key] : []
    base[key] = series
      .map((s) => ({
        tick: Number(s.tick) || 0,
        value: Number(s.value) || 0,
      }))
      .filter((s) => Number.isFinite(s.tick) && Number.isFinite(s.value))
  }
  return base
}

/**
 * Map a CitySnapshot (telemetry producer) onto DetectionInput (detection consumer).
 * Does not read room state or hackSimulator.
 *
 * @param {import('../telemetry/citySnapshot.js').CitySnapshot | null | undefined} snapshot
 * @returns {import('./types.js').DetectionInput}
 */
export function adaptCitySnapshot(snapshot) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {}
  const endpointsIn = Array.isArray(snap.endpoints) ? snap.endpoints : []
  const depsIn = Array.isArray(snap.dependencies) ? snap.dependencies : []

  const endpoints = endpointsIn.map((ep) => {
    const runtime = ep.runtimeState && typeof ep.runtimeState === 'object' ? ep.runtimeState : {}
    const behaviour = ep.behaviour && typeof ep.behaviour === 'object' ? ep.behaviour : {}
    const contexts = ep.activeContexts && typeof ep.activeContexts === 'object' ? ep.activeContexts : {}
    return {
      id: String(ep.id ?? ''),
      type: String(ep.type ?? ep.assetType ?? ''),
      label: String(ep.label ?? ep.id ?? ''),
      sector: String(ep.sector ?? ''),
      criticality: String(ep.criticality ?? ''),
      cityEndpointId: ep.cityEndpointId ? String(ep.cityEndpointId) : undefined,
      telemetry: asTelemetry(ep.telemetry),
      baselineTelemetry: asTelemetry(ep.baselineTelemetry ?? ep.telemetry),
      expectedTelemetry: asTelemetry(ep.expectedTelemetry ?? ep.baselineTelemetry ?? ep.telemetry),
      runtimeState: {
        quarantined: runtime.quarantined === true,
        provenance: runtime.provenance === 'injected' ? 'injected' : 'legitimate',
        matchLocked: runtime.matchLocked === true,
      },
      behaviour: {
        attackOverrideActive: behaviour.attackOverrideActive === true,
        intrinsicTrust:
          typeof behaviour.intrinsicTrust === 'number' &&
          Number.isFinite(behaviour.intrinsicTrust)
            ? behaviour.intrinsicTrust
            : typeof behaviour.intrinsicTrustHint === 'number' &&
                Number.isFinite(behaviour.intrinsicTrustHint)
              ? behaviour.intrinsicTrustHint
              : 50,
      },
      activeContexts: {
        phase: String(contexts.phase ?? ''),
        matchActive: contexts.matchActive === true,
        overrideActive: contexts.overrideActive === true,
        cityContext: normalizeCityContext(contexts.cityContext ?? snap.cityContext),
      },
      lookback: emptyLookback(),
      neighborLookback: [],
    }
  })

  const matchActive = endpoints.some((e) => e.activeContexts.matchActive)

  const ts = String(snap.timestamp ?? new Date().toISOString())
  const tsMs = Date.parse(ts)
  const simulationTick = Number(snap.simulationTick) || 0
  const cityContext = normalizeCityContext(snap.cityContext ?? cityContextAt(simulationTick))
  return {
    roomId: String(snap.roomId ?? ''),
    timestamp: ts,
    tsMs: Number.isFinite(tsMs) ? tsMs : Date.now(),
    simulationTick,
    cityContext,
    simHour: Number.isFinite(Number(snap.simHour)) ? Number(snap.simHour) : simHourAt(simulationTick),
    matchActive,
    endpoints,
    dependencies: depsIn.map((d) => ({
      id: String(d.id ?? ''),
      source: String(d.source ?? ''),
      target: String(d.target ?? ''),
      packetsPerSecond: Number.isFinite(Number(d.packetsPerSecond))
        ? Math.max(0, Number(d.packetsPerSecond))
        : 0,
      baselinePacketsPerSecond: Number.isFinite(Number(d.baselinePacketsPerSecond))
        ? Math.max(0, Number(d.baselinePacketsPerSecond))
        : Number.isFinite(Number(d.packetsPerSecond))
          ? Math.max(0, Number(d.packetsPerSecond))
          : 0,
      expectedPacketsPerSecond: Number.isFinite(Number(d.expectedPacketsPerSecond))
        ? Math.max(0, Number(d.expectedPacketsPerSecond))
        : Number.isFinite(Number(d.baselinePacketsPerSecond))
          ? Math.max(0, Number(d.baselinePacketsPerSecond))
          : Number.isFinite(Number(d.packetsPerSecond))
            ? Math.max(0, Number(d.packetsPerSecond))
            : 0,
    })),
  }
}

/**
 * Attach SQLite lookback series onto a DetectionInput. Mutates a shallow copy.
 *
 * @param {import('./types.js').DetectionInput} input
 * @param {Record<string, import('./types.js').EndpointLookback>} lookbackByEndpoint
 * @returns {import('./types.js').DetectionInput}
 */
export function attachLookback(input, lookbackByEndpoint) {
  const map = lookbackByEndpoint && typeof lookbackByEndpoint === 'object' ? lookbackByEndpoint : {}
  return {
    ...input,
    endpoints: input.endpoints.map((ep) => ({
      ...ep,
      lookback: asLookback(map[ep.id] ?? ep.lookback),
    })),
  }
}

/**
 * Current undirected neighbor ids per endpoint.
 * @param {import('./types.js').DetectionInput} input
 * @returns {Record<string, string[]>}
 */
export function neighborIdsByEndpoint(input) {
  const ids = new Set((input?.endpoints ?? []).map((e) => e.id))
  const neighbors = undirectedNeighbors(input?.dependencies ?? [], ids)
  const out = {}
  for (const ep of input?.endpoints ?? []) {
    out[ep.id] = [...(neighbors.get(ep.id) ?? [])].sort()
  }
  return out
}

/**
 * Attach prior neighbor-set snapshots (not including the current tick).
 *
 * @param {import('./types.js').DetectionInput} input
 * @param {Array<{ tick: number, tsMs: number, byEndpoint: Record<string, string[]> }>} history
 * @returns {import('./types.js').DetectionInput}
 */
export function attachNeighborLookback(input, history) {
  const snaps = Array.isArray(history) ? history : []
  return {
    ...input,
    endpoints: input.endpoints.map((ep) => ({
      ...ep,
      neighborLookback: snaps.map((snap) => ({
        tick: Number(snap.tick) || 0,
        tsMs: Number(snap.tsMs) || 0,
        neighborIds: Array.isArray(snap.byEndpoint?.[ep.id]) ? snap.byEndpoint[ep.id] : [],
      })),
    })),
  }
}

/**
 * Append the current neighbor snapshot and keep a bounded ring.
 *
 * @param {Array<{ tick: number, tsMs: number, byEndpoint: Record<string, string[]> }>} history
 * @param {import('./types.js').DetectionInput} input
 * @param {number} [maxLen]
 */
export function pushNeighborSnapshot(history, input, maxLen = NEIGHBOR_LOOKBACK_TICKS) {
  const next = [
    ...(Array.isArray(history) ? history : []),
    {
      tick: Number(input.simulationTick) || 0,
      tsMs: Number(input.tsMs) || 0,
      byEndpoint: neighborIdsByEndpoint(input),
    },
  ]
  const cap = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : NEIGHBOR_LOOKBACK_TICKS
  if (next.length > cap) next.splice(0, next.length - cap)
  return next
}
