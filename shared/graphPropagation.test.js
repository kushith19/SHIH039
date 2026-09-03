import { test, expect } from 'vitest'
import { propagateGraphRisk } from './graphPropagation.js'

test('propagates multi-hop correctly up to maxHops', () => {
  const edges = [
    { source: 'A', target: 'B' },
    { source: 'B', target: 'C' },
    { source: 'C', target: 'D' },
    { source: 'D', target: 'E' },
  ]
  const seedNodeIds = ['A']

  const result = propagateGraphRisk({ edges, seedNodeIds, maxHops: 3 })
  
  // A is seed, B is hop 1, C is hop 2, D is hop 3, E is hop 4 (so not included)
  expect(result.propagatedNodeIds).toEqual(['B', 'C', 'D'])
  expect(result.propagationPaths['B']).toEqual(['A', 'B'])
  expect(result.propagationPaths['C']).toEqual(['A', 'B', 'C'])
  expect(result.propagationPaths['D']).toEqual(['A', 'B', 'C', 'D'])
  expect(result.propagationPaths['E']).toBeUndefined()
  
  // check attenuation
  expect(result.propagationRiskByNode['B']).toBe(100 * 0.5)
  expect(result.propagationRiskByNode['C']).toBe(100 * 0.25)
  expect(result.propagationRiskByNode['D']).toBe(100 * 0.125)
})

test('respects directed edges', () => {
  const edges = [
    { source: 'A', target: 'B' }, // A affects B
  ]
  // B is seed, should not propagate backwards to A
  const result = propagateGraphRisk({ edges, seedNodeIds: ['B'], maxHops: 3 })
  
  expect(result.propagatedNodeIds).toEqual([])
})

test('prevents cycles', () => {
  const edges = [
    { source: 'A', target: 'B' },
    { source: 'B', target: 'C' },
    { source: 'C', target: 'A' },
  ]
  const result = propagateGraphRisk({ edges, seedNodeIds: ['A'], maxHops: 3 })
  
  // A is already a seed, so it shouldn't be added to propagatedNodeIds
  expect(result.propagatedNodeIds).toEqual(['B', 'C'])
})

test('supports multiple seeds', () => {
  const edges = [
    { source: 'A', target: 'B' },
    { source: 'C', target: 'D' },
  ]
  const result = propagateGraphRisk({ edges, seedNodeIds: ['A', 'C'], maxHops: 3 })
  
  expect(result.propagatedNodeIds).toEqual(['B', 'D'])
})

test('respects validNodeIds', () => {
  const edges = [
    { source: 'A', target: 'B' },
    { source: 'B', target: 'C' },
  ]
  // 'C' is not in validNodeIds
  const validNodeIds = new Set(['A', 'B'])
  const result = propagateGraphRisk({ edges, seedNodeIds: ['A'], validNodeIds, maxHops: 3 })
  
  expect(result.propagatedNodeIds).toEqual(['B'])
})
