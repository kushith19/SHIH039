import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatPriorityScore,
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
  assert.equal(
    relatedLiveCount({
      recoveryImpact: { relatedOpenIncidentIds: ['inc-x', 'inc-y'] },
    }),
    2
  )
  assert.equal(formatPriorityScore(18.4), '18.4')
})
