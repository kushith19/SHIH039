import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyStablePresentationOrder,
  clearAllSpreadOrderLocks,
  clearSpreadOrderForSource,
} from './stableSpreadOrder.js'

function targets(...ids) {
  return ids.map((nodeId) => ({ nodeId, propagationRisk: 0 }))
}

test('first call locks live order', () => {
  const store = {}
  const display = applyStablePresentationOrder('A', targets('B', 'C', 'D'), store)
  assert.deepEqual(
    display.map((t) => t.nodeId),
    ['B', 'C', 'D']
  )
  assert.deepEqual(store.A, ['B', 'C', 'D'])
})

test('risk-ranked live list does not reshuffle locked order', () => {
  const store = { A: ['B', 'C', 'D'] }
  const live = [
    { nodeId: 'D', propagationRisk: 99 },
    { nodeId: 'C', propagationRisk: 50 },
    { nodeId: 'B', propagationRisk: 10 },
  ]
  const display = applyStablePresentationOrder('A', live, store)
  assert.deepEqual(
    display.map((t) => t.nodeId),
    ['B', 'C', 'D']
  )
  assert.equal(display[0].propagationRisk, 10)
  assert.equal(display[2].propagationRisk, 99)
})

test('ineligible targets drop; remaining keep relative order', () => {
  const store = { A: ['B', 'C', 'D'] }
  const display = applyStablePresentationOrder('A', targets('C', 'D'), store)
  assert.deepEqual(
    display.map((t) => t.nodeId),
    ['C', 'D']
  )
  assert.deepEqual(store.A, ['C', 'D'])
})

test('new eligible targets append at end', () => {
  const store = { A: ['C', 'D'] }
  const display = applyStablePresentationOrder('A', targets('E', 'D', 'C'), store)
  assert.deepEqual(
    display.map((t) => t.nodeId),
    ['C', 'D', 'E']
  )
})

test('sources keep independent locks', () => {
  const store = {}
  applyStablePresentationOrder('A', targets('B', 'C'), store)
  applyStablePresentationOrder('B', targets('C', 'D'), store)
  assert.deepEqual(store.A, ['B', 'C'])
  assert.deepEqual(store.B, ['C', 'D'])
})

test('clear helpers reset locks', () => {
  const store = { A: ['B'], X: ['Y'] }
  clearSpreadOrderForSource(store, 'A')
  assert.equal(store.A, undefined)
  assert.deepEqual(store.X, ['Y'])
  clearAllSpreadOrderLocks(store)
  assert.deepEqual(store, {})
})
