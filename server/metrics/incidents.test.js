import assert from 'node:assert/strict'
import test from 'node:test'
import { resetMetricsDbForTests } from './store.js'
import {
  commanderContextFor,
  createIncidentRelationship,
  getIncident,
  listHistoryCampaigns,
  listIncidents,
  listIncidentHistory,
  persistDetectionIncidents,
  updateIncidentStatus,
} from './incidents.js'

function payRoom() {
  return {
    id: 'DEMO',
    nodes: [
      {
        id: 'pay',
        data: {
          label: 'Payment Processing System',
          type: 'payment_processing_system',
          cityEndpointId: 'payment-processing-system',
        },
      },
      { id: 'gw', data: { label: 'Bank Gateway', type: 'bank_gateway' } },
      { id: 'core', data: { label: 'Core Banking', type: 'banking_financial' } },
    ],
    edges: [
      { id: 'e1', source: 'pay', target: 'gw' },
      { id: 'e2', source: 'gw', target: 'core' },
    ],
  }
}

function payDetection() {
  return {
    anomalyNodeIds: ['pay'],
    peerExposedNodeIds: ['gw'],
    propagatedNodeIds: ['gw', 'core'],
    propagationPaths: {
      gw: ['pay', 'gw'],
      core: ['pay', 'gw', 'core'],
    },
    propagationRiskByNode: { gw: 50, core: 25 },
    atRiskNodeIds: ['core', 'gw'],
    incidents: [
      {
        id: 'inc-pay',
        endpointId: 'pay',
        endpointLabel: 'Payment Processing System',
        severity: 'high',
        detectionType: 'behavioural_anomaly',
        anomalyScore: 0.87,
        trustScore: 42,
        evidence: [
          { code: 'tgnn_embed', detail: 'tgnn_embed' },
          { code: 'peer_trust_decrease', previous: 70, current: 42 },
        ],
        peerExposedNodeIds: ['gw'],
        propagatedNodeIds: ['gw', 'core'],
        propagationPaths: {
          gw: ['pay', 'gw'],
          core: ['pay', 'gw', 'core'],
        },
        affectedDependencies: [{ nodeId: 'core', path: ['pay', 'gw', 'core'] }],
        campaignId: 'cmp-1',
      },
    ],
  }
}

test('incident insert then upsert updates the same open row', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  const first = persistDetectionIncidents(room, payDetection())
  assert.equal(first.length, 1)
  const id = first[0].incidentId
  const again = persistDetectionIncidents(room, payDetection())
  assert.equal(again.length, 1)
  assert.equal(again[0].incidentId, id)
  const listed = listIncidents('DEMO', { status: 'open' })
  assert.equal(listed.length, 1)
  assert.equal(listed[0].liveIncidentId, 'inc-pay')
  assert.ok(listed[0].updatedAtMs >= listed[0].detectedAtMs)
})

test('cleared then later attack creates a new incident episode', async () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  persistDetectionIncidents(room, { ...payDetection(), incidents: [] })
  const cleared = listIncidents('DEMO')
  assert.equal(cleared.length, 1)
  assert.equal(cleared[0].status, 'cleared')
  await new Promise((r) => setTimeout(r, 2))
  persistDetectionIncidents(room, payDetection())
  const all = listIncidents('DEMO')
  assert.equal(all.length, 2)
  assert.equal(all.filter((i) => i.status === 'open').length, 1)
})

test('retrieval, status update, commander context preserve graph and finance', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  const detection = payDetection()
  const anomalyBefore = [...detection.anomalyNodeIds]
  const peerBefore = [...detection.peerExposedNodeIds]
  const propBefore = [...detection.propagatedNodeIds]
  const pathsBefore = JSON.stringify(detection.propagationPaths)
  persistDetectionIncidents(room, detection)
  assert.deepEqual(detection.anomalyNodeIds, anomalyBefore)
  assert.deepEqual(detection.peerExposedNodeIds, peerBefore)
  assert.deepEqual(detection.propagatedNodeIds, propBefore)
  assert.equal(JSON.stringify(detection.propagationPaths), pathsBefore)

  const byLive = getIncident('DEMO', 'inc-pay')
  assert.ok(byLive)
  const fetched = getIncident('DEMO', byLive.incidentId)
  assert.equal(fetched.incidentId, byLive.incidentId)
  assert.equal(fetched.graphContext.primaryPath.join(','), 'pay,gw,core')
  assert.equal(fetched.financialContext.simulated, true)
  assert.ok(fetched.financialContext.lakhs > 0)

  const patched = updateIncidentStatus('DEMO', fetched.incidentId, {
    status: 'open',
    actionsTaken: ['segmented monitoring preserved'],
  })
  assert.deepEqual(patched.actionsTaken, ['segmented monitoring preserved'])

  const ctx = commanderContextFor('DEMO', 'inc-pay')
  assert.equal(ctx.liveIncidentId, 'inc-pay')
  assert.deepEqual(ctx.peerExposure, ['gw'])
  assert.deepEqual(ctx.propagatedNodeIds, ['gw', 'core'])
  assert.deepEqual(ctx.primaryPath, ['pay', 'gw', 'core'])
  assert.equal(ctx.campaignId, 'cmp-1')
  assert.ok(ctx.financialExposure.simulated)
  assert.equal(ctx.hopDistance, 2)
})

function requiredHistoryFields(row) {
  assert.ok(row.incidentId)
  assert.ok(row.roomId)
  assert.equal(typeof row.detectedAtMs, 'number')
  assert.equal(typeof row.updatedAtMs, 'number')
  assert.ok(row.affectedNodeId)
  assert.ok(row.incidentType)
  assert.ok(row.severity)
  assert.ok(row.status)
  assert.equal(typeof row.riskScore, 'number')
  assert.equal(typeof row.trustScore, 'number')
  assert.ok(Array.isArray(row.evidence))
  assert.ok(row.graphContext && typeof row.graphContext === 'object')
  assert.ok(row.financialContext && row.financialContext.simulated === true)
}

test('history is chronological and supports newest/oldest plus limit', async () => {
  resetMetricsDbForTests()
  const room = payRoom()
  persistDetectionIncidents(room, payDetection())
  persistDetectionIncidents(room, { ...payDetection(), incidents: [] })
  await new Promise((r) => setTimeout(r, 2))
  const gwDetection = {
    ...payDetection(),
    anomalyNodeIds: ['gw'],
    incidents: [
      {
        id: 'inc-gw',
        endpointId: 'gw',
        endpointLabel: 'Bank Gateway',
        severity: 'medium',
        detectionType: 'dependency_anomaly',
        anomalyScore: 0.4,
        trustScore: 60,
        evidence: [{ code: 'edge_contract', detail: 'edge_contract' }],
        peerExposedNodeIds: [],
        propagatedNodeIds: ['core'],
        propagationPaths: { core: ['gw', 'core'] },
      },
    ],
  }
  persistDetectionIncidents(room, gwDetection)

  const oldestFirst = listIncidentHistory('DEMO', { order: 'oldest-first' })
  assert.equal(oldestFirst.length, 2)
  assert.equal(oldestFirst[0].liveIncidentId, 'inc-pay')
  assert.equal(oldestFirst[1].liveIncidentId, 'inc-gw')
  assert.ok(oldestFirst[0].detectedAtMs <= oldestFirst[1].detectedAtMs)
  oldestFirst.forEach(requiredHistoryFields)

  const newestFirst = listIncidentHistory('DEMO', { order: 'newest-first' })
  assert.equal(newestFirst[0].liveIncidentId, 'inc-gw')
  assert.equal(newestFirst[1].liveIncidentId, 'inc-pay')

  const limited = listIncidentHistory('DEMO', { order: 'desc', limit: 1 })
  assert.equal(limited.length, 1)
  assert.equal(limited[0].incidentId, newestFirst[0].incidentId)
})

test('separate live incidents stay separate historical records', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  const detection = payDetection()
  detection.incidents.push({
    id: 'inc-gw',
    endpointId: 'gw',
    endpointLabel: 'Bank Gateway',
    severity: 'medium',
    detectionType: 'dependency_anomaly',
    anomalyScore: 0.4,
    trustScore: 60,
    evidence: [{ code: 'edge_contract', detail: 'edge_contract' }],
    peerExposedNodeIds: [],
    propagatedNodeIds: ['core'],
    propagationPaths: { core: ['gw', 'core'] },
  })
  persistDetectionIncidents(room, detection)
  persistDetectionIncidents(room, detection)
  const history = listIncidentHistory('DEMO', { order: 'asc' })
  assert.equal(history.length, 2)
  const ids = new Set(history.map((r) => r.incidentId))
  const lives = new Set(history.map((r) => r.liveIncidentId))
  assert.equal(ids.size, 2)
  assert.deepEqual([...lives].sort(), ['inc-gw', 'inc-pay'])
})

test('relationship creation links related incidents', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  const detection = payDetection()
  detection.incidents.push({
    id: 'inc-gw',
    endpointId: 'gw',
    endpointLabel: 'Bank Gateway',
    severity: 'medium',
    detectionType: 'dependency_anomaly',
    anomalyScore: 0.4,
    trustScore: 60,
    evidence: [{ code: 'edge_contract', detail: 'edge_contract' }],
    peerExposedNodeIds: [],
    propagatedNodeIds: ['core'],
    propagationPaths: { core: ['gw', 'core'] },
    affectedDependencies: [{ nodeId: 'core', path: ['gw', 'core'] }],
    campaignId: 'cmp-1',
  })
  persistDetectionIncidents(room, detection)
  const pay = getIncident('DEMO', 'inc-pay')
  const gw = getIncident('DEMO', 'inc-gw')
  const ctx = commanderContextFor('DEMO', pay.incidentId)
  assert.ok(ctx.relatedIncidents.some((r) => r.incidentId === gw.incidentId))
  const extra = createIncidentRelationship(pay.incidentId, gw.incidentId, 'shared_asset', 'same finance path')
  assert.equal(extra.relationshipType, 'shared_asset')
})

test('listHistoryCampaigns hides a single persisted incident', () => {
  resetMetricsDbForTests()
  persistDetectionIncidents(payRoom(), payDetection())
  const campaigns = listHistoryCampaigns(payRoom())
  assert.equal(campaigns.length, 0)
})

test('listHistoryCampaigns returns one campaign for graph-related incidents', () => {
  resetMetricsDbForTests()
  const room = payRoom()
  const detection = payDetection()
  detection.incidents.push({
    id: 'inc-gw',
    endpointId: 'gw',
    endpointLabel: 'Bank Gateway',
    severity: 'medium',
    detectionType: 'dependency_anomaly',
    anomalyScore: 0.4,
    trustScore: 60,
    evidence: [{ code: 'edge_contract', detail: 'edge_contract' }],
    peerExposedNodeIds: [],
    propagatedNodeIds: ['core'],
    propagationPaths: { core: ['gw', 'core'] },
  })
  persistDetectionIncidents(room, detection)
  const campaigns = listHistoryCampaigns(room)
  assert.equal(campaigns.length, 1)
  assert.equal(campaigns[0].sequence.length, 2)
  assert.ok(campaigns[0].correlationReasons.length > 0)
  assert.equal(campaigns[0].incidentCount, 2)
  const ids = campaigns[0].sequence.map((s) => s.affectedNodeId).sort()
  assert.deepEqual(ids, ['gw', 'pay'])
})
