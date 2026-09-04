import {
  NODE_METRIC_KEYS,
  clampNonNegative,
  mergeMetrics,
  normalizeMetricPatch,
  normalizeMetricSnapshot,
} from '../nodeMetrics.js'

import {
  getNodeTypeTrust,
  nodeTypeOf,
  runtimeStateOf,
} from '../infrastructureNode.js'

import {
  expectedEdgePackets,
  expectedTelemetry,
  getCityModelOverlay,
  observedEdgePackets,
  observedTelemetry,
  resolveRoomCityContext,
  simHourAt,
} from '../../shared/cityContext.js'
import { ingestedTelemetryPatch, mergeTelemetryBags } from '../../shared/telemetryKeys.js'
import { yamlIdForCatalogType } from '../../shared/cityModel/endpointMap.js'

export { NODE_METRIC_KEYS }

/**
 * Producer contract for the Telemetry Generator.
 *
 * @typedef {{
 *   packetsPerSecond: number
 *   httpRequestsPerMin: number
 *   filesDownloaded: number
 *   failedLoginsPerMin: number
 * }} SnapshotTelemetry
 *
 * @typedef {{
 *   quarantined: boolean
 *   provenance: string
 *   matchLocked: boolean
 * }} SnapshotRuntimeState
 *
 * @typedef {{
 *   attackOverrideActive: boolean
 *   intrinsicTrust: number
 * }} SnapshotBehaviour
 *
 * @typedef {{
 *   phase: string
 *   matchActive: boolean
 *   overrideActive: boolean
 *   cityContext: string
 * }} SnapshotActiveContexts
 *
 * @typedef {{
 *   id: string
 *   type: string
 *   label: string
 *   sector: string
 *   criticality: string
 *   telemetry: SnapshotTelemetry
 *   baselineTelemetry: SnapshotTelemetry
 *   expectedTelemetry: SnapshotTelemetry
 *   runtimeState: SnapshotRuntimeState
 *   behaviour: SnapshotBehaviour
 *   activeContexts: SnapshotActiveContexts
 * }} SnapshotEndpoint
 *
 * @typedef {{
 *   id: string
 *   source: string
 *   target: string
 *   packetsPerSecond: number
 *   baselinePacketsPerSecond: number
 *   expectedPacketsPerSecond: number
 * }} SnapshotDependency
 *
 * @typedef {{
 *   roomId: string
 *   timestamp: string
 *   simulationTick: number
 *   cityContext: string
 *   simHour: number
 *   endpoints: SnapshotEndpoint[]
 *   dependencies: SnapshotDependency[]
 * }} CitySnapshot
 */

function emptyTelemetry() {
  return {
    packetsPerSecond: 0,
    httpRequestsPerMin: 0,
    filesDownloaded: 0,
    failedLoginsPerMin: 0,
  }
}

function nodeBaseline(node, sim) {
  const live = normalizeMetricSnapshot(node?.data, node)
  if (sim?.active !== true) return live
  const locked = sim.nodeScenarioBaselines?.[node.id]
  if (locked !== undefined) return normalizeMetricSnapshot(locked, node)
  return live
}

function nodeAttackStateActive(sim, nodeId) {
  const states = sim?.nodeAttackStates
  if (!states || typeof states !== 'object') return false
  return states[nodeId] === true || states[nodeId] === 'under_attack'
}

function nodeMeta(node, tick, simHour, extra = {}) {
  const type = nodeTypeOf(node?.data)
  return {
    id: node?.id,
    nodeId: node?.id,
    sector: node?.data?.sector,
    type,
    cityEndpointId: node?.data?.cityEndpointId || yamlIdForCatalogType(type),
    tick,
    simHour,
    quarantined: extra.quarantined === true,
    // Explicit attack simulation only — not mere telemetry overrides.
    attackOverrideActive: extra.attackOverrideActive === true,
  }
}

function nodeExpected(node, sim, context, tick, simHour) {
  const baseline = nodeBaseline(node, sim)
  return expectedTelemetry(baseline, context, nodeMeta(node, tick, simHour))
}

function nodeEffective(node, sim, context, tick, simHour, extra = {}) {
  const baseline = nodeBaseline(node, sim)
  const observed = observedTelemetry(baseline, context, nodeMeta(node, tick, simHour, extra))
  if (sim?.active !== true) return observed
  // Containment wins: quarantined nodes do not re-apply attack metric overrides
  // (stale sim:patch can otherwise restore floods and re-open incidents).
  if (extra.quarantined === true) return observed
  return mergeMetrics(observed, normalizeMetricPatch(sim.nodeOverrides?.[node.id]))
}

function edgeBaselinePps(edge, sim) {
  const live = clampNonNegative(
    Number.isFinite(Number(edge.data?.packetsPerSecond))
      ? Number(edge.data.packetsPerSecond)
      : 0
  )
  if (sim?.active !== true) return live
  const locked = sim.edgeScenarioBaselines?.[edge.id]
  if (locked !== undefined && Number.isFinite(locked)) return clampNonNegative(locked)
  return live
}

function edgeExpectedPps(edge, sim, context, tick) {
  const baseline = edgeBaselinePps(edge, sim)
  return expectedEdgePackets(baseline, context, undefined, { tick, edgeId: edge?.id })
}

function edgeEffectivePps(edge, sim, context, tick) {
  const baseline = edgeBaselinePps(edge, sim)
  const observed = observedEdgePackets(baseline, context, undefined, {
    tick,
    edgeId: edge?.id,
  })
  if (sim?.active !== true) return observed
  const o = sim.edgeOverrides?.[edge.id]
  if (o !== undefined && Number.isFinite(o)) return clampNonNegative(o)
  return observed
}

/**
 * @param {object} room
 * @returns {CitySnapshot}
 */
export function buildCitySnapshot(room) {
  const sim = room.hackSimulator ?? { active: false }
  const matchActive = room.phase === 'playing' && sim.active === true
  const tick = Number(room.simulationTick) || 0
  const timestamp = new Date().toISOString()
  const matchIds = new Set(room.matchNodeIds ?? [])
  const cityContext = resolveRoomCityContext(room)
  const simHour = simHourAt(tick)

  const endpoints = (room.nodes ?? []).map((n) => {
    const baselineTelemetry = nodeBaseline(n, sim)
    const overridePatch = normalizeMetricPatch(sim.nodeOverrides?.[n.id])
    const quarantined = runtimeStateOf(n.data).quarantined === true
    const telemetryOverrideActive =
      !quarantined && NODE_METRIC_KEYS.some((k) => overridePatch[k] !== undefined)
    // Explicit attack / operational compromise — never inferred from overrides alone.
    const attackStateActive = !quarantined && nodeAttackStateActive(sim, n.id)
    const liveMeta = { quarantined, attackOverrideActive: attackStateActive }
    const expected = nodeExpected(n, sim, cityContext, tick, simHour)
    const telemetry = nodeEffective(n, sim, cityContext, tick, simHour, liveMeta)
    return {
      id: String(n.id),
      type: nodeTypeOf(n.data),
      label: String(n.data?.label ?? n.id),
      sector: String(n.data?.sector ?? ''),
      criticality: String(n.data?.criticality ?? ''),
      cityEndpointId: n.data?.cityEndpointId || yamlIdForCatalogType(nodeTypeOf(n.data)),
      runtimeState: {
        quarantined,
        provenance: runtimeStateOf(n.data).provenance,
        matchLocked: matchIds.has(n.id),
      },
      behaviour: {
        attackOverrideActive: attackStateActive,
        telemetryOverrideActive,
        intrinsicTrust: getNodeTypeTrust(n.data),
      },
      telemetry,
      baselineTelemetry,
      expectedTelemetry: expected,
      activeContexts: {
        phase: String(room.phase ?? 'lobby'),
        matchActive,
        overrideActive: telemetryOverrideActive,
        cityContext,
      },
    }
  })

  const usedCityIds = new Set(endpoints.map((ep) => String(ep.cityEndpointId || '').trim()).filter(Boolean))
  const model = getCityModelOverlay()
  for (const ep of Object.values(model?.endpoints ?? {})) {
    const id = String(ep.id ?? '').trim()
    if (!id || usedCityIds.has(id)) continue
    usedCityIds.add(id)
    const meta = {
      id: `yaml:${id}`,
      nodeId: `yaml:${id}`,
      sector: ep.category,
      type: ep.type,
      cityEndpointId: id,
      tick,
      simHour,
    }
    const baselineTelemetry = emptyTelemetry()
    endpoints.push({
      id: `yaml:${id}`,
      type: String(ep.type || 'unknown'),
      label: String(ep.name || id),
      sector: String(ep.category ?? ''),
      criticality: String(ep.criticality ?? ''),
      cityEndpointId: id,
      yamlOnly: true,
      runtimeState: {
        quarantined: false,
        provenance: 'city_model',
        matchLocked: false,
      },
      behaviour: {
        attackOverrideActive: false,
        intrinsicTrust: 50,
      },
      telemetry: observedTelemetry(baselineTelemetry, cityContext, meta),
      baselineTelemetry,
      expectedTelemetry: expectedTelemetry(baselineTelemetry, cityContext, meta),
      activeContexts: {
        phase: String(room.phase ?? 'lobby'),
        matchActive,
        overrideActive: false,
        cityContext,
      },
    })
  }

  const dependencies = (room.edges ?? []).map((e) => ({
    id: String(e.id),
    source: String(e.source),
    target: String(e.target),
    packetsPerSecond: edgeEffectivePps(e, sim, cityContext, tick),
    baselinePacketsPerSecond: edgeBaselinePps(e, sim),
    expectedPacketsPerSecond: edgeExpectedPps(e, sim, cityContext, tick),
  }))

  return {
    roomId: String(room.id ?? ''),
    timestamp,
    simulationTick: tick,
    cityContext,
    simHour,
    endpoints: endpoints.length ? endpoints : [],
    dependencies,
  }
}

export function emptyTelemetryRecord() {
  return emptyTelemetry()
}

export function ingestedPatchForCityId(cityId, ingestedByEndpoint, simulationTick) {
  const raw = cityId ? ingestedByEndpoint?.[cityId] : null
  if (!raw || typeof raw !== 'object') return {}
  const tick = Number(simulationTick)
  if (Number.isFinite(tick) && raw.tick != null && Number(raw.tick) !== tick) return {}
  return ingestedTelemetryPatch(raw)
}

/**
 * Replace produced node telemetry with GET-backed values. Expected/baseline/deps unchanged.
 * Missing ingest data falls back to expected (not the jittered produced series).
 * @param {CitySnapshot} snapshot
 * @param {Record<string, object>} ingestedByEndpoint
 */
export function overlaySnapshotFromIngested(snapshot, ingestedByEndpoint) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {}
  const endpoints = Array.isArray(snap.endpoints) ? snap.endpoints : []
  return {
    ...snap,
    endpoints: endpoints.map((ep) => {
      const cityId = ep?.cityEndpointId || ep?.id
      const patch = ingestedPatchForCityId(cityId, ingestedByEndpoint, snap.simulationTick)
      const expected = ep?.expectedTelemetry ?? ep?.telemetry ?? emptyTelemetry()
      const produced = ep?.telemetry ?? expected
      const telemetry = Object.keys(patch).length ? mergeTelemetryBags(expected, patch) : produced
      return { ...ep, telemetry }
    }),
  }
}
