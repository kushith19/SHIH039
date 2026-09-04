/**
 * Smoke: Orchestrate Planner + existing RAG (fetchKnowledgeContext).
 * Run: node server/response/plannerRag.smoke.mjs
 */
import { createEmptyRoom } from '../roomStore.js'
import { attachAvailableResponseActions } from '../../shared/responseActions.js'
import { attachResponseClassification } from '../../shared/responsePolicy.js'
import {
  clearLlmCommanderTestCaller,
  clearLlmCommanderRagFetcher,
  getLastLlmResponse,
  requestLlmCommanderActions,
} from './llmCommanderClient.js'

clearLlmCommanderTestCaller()
clearLlmCommanderRagFetcher()

function node(id, sector = 'Finance', type = 'payment_processing_system') {
  return {
    id,
    data: {
      label: id.toUpperCase(),
      type,
      sector,
      criticality: 'critical',
      runtimeState: { quarantined: false, provenance: 'catalog' },
    },
  }
}

const scenarios = [
  {
    name: 'data_exfiltration',
    incidentType: 'data_exfiltration',
    endpointId: 'pay',
    sector: 'Finance',
    type: 'payment_processing_system',
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'filesDownloaded',
        observed: 820,
        expected: 12,
        deviationPct: 6733,
      },
    ],
  },
  {
    name: 'credential_spray',
    incidentType: 'credential_spray',
    endpointId: 'auth',
    sector: 'Municipal IT',
    type: 'identity_provider',
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'failedLoginsPerMin',
        observed: 240,
        expected: 4,
        deviationPct: 5900,
      },
    ],
  },
  {
    name: 'power_substation_anomaly',
    incidentType: 'behavioral_anomaly',
    endpointId: 'substation',
    sector: 'Energy',
    type: 'power_substation',
    evidence: [
      {
        code: 'metric_deviation',
        metric: 'packetsPerSecond',
        observed: 1400,
        expected: 90,
        deviationPct: 1455,
      },
    ],
  },
]

const scenarioName = process.argv[2] || 'data_exfiltration'
const scenario = scenarios.find((s) => s.name === scenarioName) || scenarios[0]

const room = createEmptyRoom('SMOKE')
room.phase = 'playing'
room.nodes = [
  node(scenario.endpointId, scenario.sector, scenario.type),
  node('gw', 'Telecom', 'gateway'),
]
room.edges = [{ id: 'e1', source: scenario.endpointId, target: 'gw' }]
room.detection = {
  incidents: [
    {
      id: `inc-${scenario.name}`,
      persistentId: `inc-${scenario.name}`,
      endpointId: scenario.endpointId,
      endpointLabel: scenario.endpointId.toUpperCase(),
      status: 'open',
      severity: 'high',
      anomalyScore: 0.92,
      criticality: 'critical',
      detectionType: scenario.incidentType,
      evidence: scenario.evidence,
      peerExposedNodeIds: ['gw'],
      propagatedNodeIds: [],
      actionsTaken: [],
    },
  ],
}

const live = room.detection.incidents[0]
const context = attachAvailableResponseActions(
  attachResponseClassification(
    {
      incidentId: live.persistentId,
      liveIncidentId: live.id,
      incidentType: live.detectionType,
      severity: live.severity,
      status: live.status,
      affectedAsset: {
        id: live.endpointId,
        summary: live.endpointLabel,
        type: scenario.type,
        sector: scenario.sector,
        criticality: 'critical',
        quarantined: false,
      },
      riskScore: live.anomalyScore,
      trustScore: 28,
      anomalyEvidence: live.evidence,
      peerExposure: live.peerExposedNodeIds,
      propagatedNodeIds: [],
      actionsAlreadyTaken: [],
      isExposureIncident: false,
      relatedIncidents: [],
    },
    room.nodes
  )
)

console.log(`\n=== PLANNER RAG SMOKE: ${scenario.name} ===\n`)
const result = await requestLlmCommanderActions(context, { room })
const debug = getLastLlmResponse()

console.log('\n=== SMOKE SUMMARY ===')
console.log('validated.ok=', result.ok)
console.log('ragUsed=', debug.ragUsed)
console.log('ragChunkCount=', debug.ragChunkCount)
console.log('ragQuery=', debug.ragQuery)
console.log('ragSources=', JSON.stringify(debug.ragSources, null, 2))
console.log(
  'actions=',
  JSON.stringify(result.actions ?? debug.parsedActions ?? [], null, 2)
)
console.log(
  'retrievedKnowledge.status=',
  debug.inputContext?.retrievedKnowledge?.status
)

if (!debug.ragUsed) {
  console.error('SMOKE FAIL: expected ragUsed=true')
  process.exit(1)
}
if (!result.ok) {
  console.error('SMOKE FAIL: planner validation failed', result.error || result.code)
  process.exit(1)
}
console.log('SMOKE OK')
process.exit(0)
