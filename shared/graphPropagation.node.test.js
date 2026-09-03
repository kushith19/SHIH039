import assert from 'node:assert/strict'
import test from 'node:test'
import { propagateGraphRisk } from './graphPropagation.js'

test('propagates multi-hop correctly up to maxHops', () => {
  const result = propagateGraphRisk({
    edges: [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
      { source: 'D', target: 'E' },
    ],
    seedNodeIds: ['A'],
    maxHops: 3,
  })
  assert.deepEqual(result.propagatedNodeIds, ['B', 'C', 'D'])
  assert.deepEqual(result.propagationPaths.D, ['A', 'B', 'C', 'D'])
  assert.equal(result.propagationRiskByNode.B, 50)
})

test('union of two independent seed traversals', () => {
  const result = propagateGraphRisk({
    edges: [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
      { source: 'X', target: 'Y' },
    ],
    seedNodeIds: ['A', 'X'],
    maxHops: 3,
  })
  assert.deepEqual(result.propagatedNodeIds, ['B', 'C', 'Y'])
  assert.deepEqual(result.propagationPaths.B, ['A', 'B'])
  assert.deepEqual(result.propagationPaths.Y, ['X', 'Y'])
})

test('no module-level visited leakage between calls', () => {
  const edges = [{ source: 'A', target: 'B' }]
  const first = propagateGraphRisk({ edges, seedNodeIds: ['A'] })
  const second = propagateGraphRisk({
    edges: [{ source: 'X', target: 'Y' }],
    seedNodeIds: ['X'],
  })
  assert.deepEqual(first.propagatedNodeIds, ['B'])
  assert.deepEqual(second.propagatedNodeIds, ['Y'])
  assert.equal(second.propagatedNodeIds.includes('B'), false)
})
