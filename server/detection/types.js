import { getTelemetryKeys } from '../../shared/telemetryKeys.js'
import { emptyRiskMomentum } from '../../shared/riskMomentum.js'

export { NODE_METRIC_KEYS } from '../nodeMetrics.js'

/**
 * Canonical detection-layer input. Produced only by the adapter.
 * The engine and metric store must not import CitySnapshot builders or room/hackSimulator.
 *
 * @typedef {{
 *   packetsPerSecond: number
 *   httpRequestsPerMin: number
 *   filesDownloaded: number
 *   failedLoginsPerMin: number
 * }} DetectionTelemetry
 *
 * @typedef {{ tick: number, value: number }} MetricSample
 *
 * @typedef {{
 *   packetsPerSecond: MetricSample[]
 *   httpRequestsPerMin: MetricSample[]
 *   filesDownloaded: MetricSample[]
 *   failedLoginsPerMin: MetricSample[]
 * }} EndpointLookback
 *
 * @typedef {{
 *   id: string
 *   type: string
 *   label: string
 *   sector: string
 *   criticality: string
 *   telemetry: DetectionTelemetry
 *   baselineTelemetry: DetectionTelemetry
 *   expectedTelemetry: DetectionTelemetry
 *   runtimeState: {
 *     quarantined: boolean
 *     provenance: string
 *     matchLocked: boolean
 *   }
 *   behaviour: {
 *     attackOverrideActive: boolean
 *     telemetryOverrideActive?: boolean
 *     intrinsicTrust: number
 *   }
 *   activeContexts: {
 *     phase: string
 *     matchActive: boolean
 *     overrideActive: boolean
 *     cityContext: string
 *   }
 *   lookback: EndpointLookback
 *   neighborLookback: Array<{ tick: number, tsMs: number, neighborIds: string[] }>
 * }} DetectionEndpoint
 *
 * @typedef {{
 *   id: string
 *   source: string
 *   target: string
 *   packetsPerSecond: number
 *   baselinePacketsPerSecond: number
 *   expectedPacketsPerSecond: number
 * }} DetectionDependency
 *
 * @typedef {{
 *   roomId: string
 *   timestamp: string
 *   tsMs: number
 *   simulationTick: number
 *   cityContext: string
 *   simHour: number
 *   matchActive: boolean
 *   endpoints: DetectionEndpoint[]
 *   dependencies: DetectionDependency[]
 * }} DetectionInput
 */

export function emptyLookback() {
  const out = {}
  for (const key of getTelemetryKeys()) out[key] = []
  return out
}

export function emptyDetectionResult() {
  return {
    nodes: [],
    edges: [],
    anomalyNodeIds: [],
    spreadEdgeIds: [],
    compromisedNodeIds: [],
    atRiskNodeIds: [],
    atRiskEdgeIds: [],
    primarySpreadNodeId: null,
    primarySpreadEdgeId: null,
    primarySpreadAssessment: null,
    isolationScoresByNodeId: {},
    reasonsByNodeId: {},
    incidents: [],
    detectionMode: 'tgnn',
    tgnnCalibrating: false,
    tgnnWarmupCollected: 0,
    tgnnWarmupTicks: 15,
    tgnnSkippedAttackTicks: 0,
    simulationTick: 0,
    cityContext: 'normal_day',
    simHour: 10,
    timestamp: null,
    riskMomentum: emptyRiskMomentum(),
  }
}
