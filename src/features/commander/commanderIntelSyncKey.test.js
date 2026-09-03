import assert from 'node:assert/strict'
import test from 'node:test'
import { commanderIntelSyncKey } from './commanderIntelSyncKey.js'

const baseDetection = {
  anomalyNodeIds: ['pay'],
  peerExposedNodeIds: ['gw'],
  propagatedNodeIds: ['gw'],
  incidents: [{ id: 'inc-1', endpointId: 'pay' }],
}

test('simulationTick alone does not change intel sync key (no RAG on tick)', () => {
  const a = commanderIntelSyncKey(baseDetection)
  const b = commanderIntelSyncKey(baseDetection)
  assert.equal(a, b)
  // Tick is not an input — callers must not fold simulationTick into this key.
  assert.equal(
    commanderIntelSyncKey(baseDetection),
    [
      'pay',
      'gw',
      'gw',
      'inc-1',
    ].join('|')
  )
  assert.ok(!String(a).includes('tick'))
})

test('meaningful incident / flagged-set changes still change sync key', () => {
  const base = commanderIntelSyncKey(baseDetection)
  const cleared = commanderIntelSyncKey({
    ...baseDetection,
    anomalyNodeIds: [],
    peerExposedNodeIds: [],
    propagatedNodeIds: [],
  })
  assert.notEqual(base, cleared)

  const newIncident = commanderIntelSyncKey({
    ...baseDetection,
    incidents: [{ id: 'inc-2', endpointId: 'pay' }],
  })
  assert.notEqual(base, newIncident)

  const newAnomaly = commanderIntelSyncKey({
    ...baseDetection,
    anomalyNodeIds: ['pay', 'sensor'],
  })
  assert.notEqual(base, newAnomaly)
})
