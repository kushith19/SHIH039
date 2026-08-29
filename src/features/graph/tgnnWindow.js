import { TRUST_CONFIG } from '@shared/trustConfig.js'
import {
  cityContextOfSim,
  expectedEdgePackets,
  expectedTelemetry,
} from '@shared/cityContext.js'
import { getNodeTypeTrust, runtimeStateOf } from './infrastructureNode'
import {
  getDefaultNodeMetrics,
  mergeMetrics,
  normalizeMetricPatch,
  normalizeMetricSnapshot,
} from './nodeMetrics'
import { ingestedTelemetryPatch, mergeTelemetryBags } from '@shared/telemetryKeys.js'

function windowSize() {
  const n = Number(TRUST_CONFIG.tgnn.temporalWindow)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3
}

function nodeBaseline(n, sim) {
  const live = getDefaultNodeMetrics(n)
  if (sim?.active !== true) return live
  const locked = sim.nodeScenarioBaselines?.[n.id]
  if (locked !== undefined) return normalizeMetricSnapshot(locked, n)
  return live
}

function nodeExpected(n, sim) {
  const baseline = nodeBaseline(n, sim)
  if (sim?.active !== true) return baseline
  return expectedTelemetry(baseline, cityContextOfSim(sim), {
    sector: n?.data?.sector,
    type: n?.data?.type,
    id: n?.id,
    tick: sim?.simulationTick,
    cityEndpointId: n?.data?.cityEndpointId,
  })
}

function nodeEffective(n, sim) {
  const expected = nodeExpected(n, sim)
  const ingested = ingestedTelemetryPatch(sim?.liveTelemetryByNodeId?.[n.id])
  const live = Object.keys(ingested).length ? mergeTelemetryBags(expected, ingested) : expected
  if (sim?.active !== true) return live
  return mergeMetrics(live, normalizeMetricPatch(sim.nodeOverrides?.[n.id]))
}

function edgeBaselinePps(e, sim) {
  const live = Number.isFinite(Number(e.data?.packetsPerSecond))
    ? Number(e.data.packetsPerSecond)
    : 0
  if (sim?.active !== true) return live
  const locked = sim.edgeScenarioBaselines?.[e.id]
  if (locked !== undefined && Number.isFinite(locked)) return locked
  return live
}

function edgeExpectedPps(e, sim) {
  const baseline = edgeBaselinePps(e, sim)
  if (sim?.active !== true) return baseline
  return expectedEdgePackets(baseline, cityContextOfSim(sim), undefined, {
    tick: sim?.simulationTick,
    edgeId: e?.id,
  })
}

function edgeEffectivePps(e, sim) {
  const expected = edgeExpectedPps(e, sim)
  if (sim?.active !== true) return expected
  const o = sim.edgeOverrides?.[e.id]
  if (o !== undefined && Number.isFinite(o)) return o
  return expected
}

function canvasGraphState(nodes, edges, sim, mode) {
  const safeSim = sim ?? { active: false }
  const cityContext = safeSim.active === true ? cityContextOfSim(safeSim) : undefined
  const endpoints = nodes.map((n) => {
    const expected = nodeExpected(n, safeSim)
    const telemetry = mode === 'expected' ? expected : nodeEffective(n, safeSim)
    const override = safeSim.nodeOverrides?.[n.id]
    const attackOverrideActive =
      override != null && typeof override === 'object' && Object.keys(override).length > 0
    return {
      id: n.id,
      telemetry,
      expectedTelemetry: expected,
      baselineTelemetry: nodeBaseline(n, safeSim),
      criticality: n.data?.criticality,
      typeTrust: getNodeTypeTrust(n.data),
      runtimeState: runtimeStateOf(n.data),
      attackOverrideActive,
      cityContext,
      sector: n.data?.sector,
      type: n.data?.type,
    }
  })
  const nodeIds = new Set(nodes.map((n) => n.id))
  const dependencies = edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => {
      const expected = edgeExpectedPps(e, safeSim)
      return {
        source: e.source,
        target: e.target,
        packetsPerSecond: mode === 'expected' ? expected : edgeEffectivePps(e, safeSim),
        expectedPacketsPerSecond: expected,
      }
    })
  return { endpoints, dependencies }
}

/**
 * Client has no metric lookback. Pad with expected frames so the last slot
 * is the live city graph: [expected, expected, current].
 */
export function buildClientTgnnWindows(nodes, edges, sim) {
  const K = windowSize()
  const expected = canvasGraphState(nodes, edges, sim, 'expected')
  const current = canvasGraphState(nodes, edges, sim, 'current')
  const observed = Array.from({ length: K }, (_, i) => (i === K - 1 ? current : expected))
  const baseline = Array.from({ length: K }, () => expected)
  return { observed, baseline }
}
