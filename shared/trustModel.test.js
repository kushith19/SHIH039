import assert from 'node:assert/strict'
import test from 'node:test'
import { TRUST_CONFIG } from './trustConfig.js'
import { peerExposureFromFlags, peerFromNeighborLocal } from './trustModel.js'

test('peer aggregate min: one crashed neighbor is not washed out by degree', () => {
  const localById = new Map([
    ['seed', 40],
    ['n0', 90],
    ['n1', 90],
    ['n2', 90],
    ['n3', 90],
    ['n4', 90],
    ['n5', 90],
    ['n6', 90],
  ])
  const neighborIds = ['seed', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']
  const minPeer = peerFromNeighborLocal(localById, neighborIds, 'n0')
  const meanPeer = peerFromNeighborLocal(localById, neighborIds, 'n0', {
    ...TRUST_CONFIG,
    peer: { ...TRUST_CONFIG.peer, aggregate: 'mean' },
  })
  assert.equal(minPeer, 40)
  assert.ok(meanPeer > 80, `mean should stay high, got ${meanPeer}`)
  assert.ok(minPeer < meanPeer - 30)
})

test('isolated node uses its own local posture', () => {
  const localById = new Map([['alone', 72]])
  assert.equal(peerFromNeighborLocal(localById, [], 'alone'), 72)
})

test('peer exposure is undirected 1-hop of residual flags, not the seeds', () => {
  const edges = [
    { id: 'e-ab', source: 'a', target: 'b' },
    { id: 'e-bc', source: 'b', target: 'c' },
    { id: 'e-cd', source: 'c', target: 'd' },
  ]
  const { atRiskNodeIds, atRiskEdgeIds } = peerExposureFromFlags(edges, ['a'], ['a', 'b', 'c', 'd'])
  assert.deepEqual(atRiskNodeIds, ['b'])
  assert.deepEqual(atRiskEdgeIds, ['e-ab'])
  assert.ok(!atRiskNodeIds.includes('a'))
  assert.ok(!atRiskNodeIds.includes('c'))
})
