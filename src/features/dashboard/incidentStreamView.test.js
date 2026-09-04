import assert from 'node:assert/strict'
import test from 'node:test'
import {
  correlationGroupId,
  formatPriorityScore,
  groupChronologicalTimeline,
  groupDependencyChains,
  orderLiveIncidents,
  recoveryImpactBand,
  recoveryPriorityValue,
  relatedLiveCount,
  reliefCount,
} from './incidentStreamView.js'

test('orderLiveIncidents falls back to severity when priority missing', () => {
  const rows = orderLiveIncidents([
    { id: 'inc-a', endpointId: 'a', endpointLabel: 'A', severity: 'medium' },
    { id: 'inc-b', endpointId: 'b', endpointLabel: 'B', severity: 'critical' },
  ])
  assert.equal(rows[0].id, 'inc-b')
})

test('orderLiveIncidents uses recoveryPriority over severity', () => {
  const rows = orderLiveIncidents([
    {
      id: 'inc-loud',
      endpointId: 'loud',
      endpointLabel: 'Loud',
      severity: 'critical',
      recoveryPriority: 8,
    },
    {
      id: 'inc-hub',
      endpointId: 'hub',
      endpointLabel: 'Hub',
      severity: 'medium',
      recoveryPriority: 42,
    },
  ])
  assert.equal(rows[0].id, 'inc-hub')
  assert.equal(rows[1].id, 'inc-loud')
})

test('equal recoveryPriority falls back to severity then label', () => {
  const rows = orderLiveIncidents([
    {
      id: 'inc-b',
      endpointLabel: 'B',
      severity: 'high',
      anomalyScore: 0.5,
      recoveryPriority: 10,
    },
    {
      id: 'inc-a',
      endpointLabel: 'A',
      severity: 'critical',
      anomalyScore: 0.4,
      recoveryPriority: 10,
    },
  ])
  assert.equal(rows[0].id, 'inc-a')
})

test('recovery helpers tolerate missing fields', () => {
  assert.equal(recoveryPriorityValue({}), null)
  assert.equal(recoveryImpactBand(null), null)
  assert.equal(recoveryImpactBand(45), 'High')
  assert.equal(reliefCount({}), 0)
  assert.equal(relatedLiveCount({}), 0)
  assert.equal(correlationGroupId({}), null)
  assert.equal(formatPriorityScore(18.4), '18.4')
})

test('groupChronologicalTimeline sorts by time and attaches recovery ranks', () => {
  const group = { incidentIds: ['inc-a', 'inc-b', 'inc-c'] }
  const incidents = [
    {
      id: 'inc-b',
      endpointId: 'b',
      endpointLabel: 'Core Banking',
      severity: 'critical',
      recoveryPriority: 40,
      detectedAtMs: 2_000,
    },
    {
      id: 'inc-a',
      endpointId: 'a',
      endpointLabel: 'Payment Gateway',
      severity: 'high',
      recoveryPriority: 20,
      detectedAtMs: 1_000,
    },
    {
      id: 'inc-c',
      endpointId: 'c',
      endpointLabel: 'Transaction Service',
      severity: 'high',
      recoveryPriority: 10,
      detectedAtMs: 3_000,
    },
  ]
  const timeline = groupChronologicalTimeline(group, incidents)
  assert.deepEqual(
    timeline.map((e) => e.incident.id),
    ['inc-a', 'inc-b', 'inc-c']
  )
  assert.equal(timeline[1].recoveryRank, 1)
  assert.equal(timeline[0].recoveryRank, 2)
})

test('groupDependencyChains follows directed edges among group nodes only', () => {
  const group = { incidentIds: ['inc-a', 'inc-b', 'inc-c'] }
  const incidents = [
    { id: 'inc-a', endpointId: 'a', recoveryPriority: 10 },
    { id: 'inc-b', endpointId: 'b', recoveryPriority: 20 },
    { id: 'inc-c', endpointId: 'c', recoveryPriority: 5 },
  ]
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ]
  const chains = groupDependencyChains(group, incidents, edges)
  assert.ok(chains.some((c) => c.join('>') === 'a>b>c'))
  assert.deepEqual(groupDependencyChains(group, incidents, []), [])
})
