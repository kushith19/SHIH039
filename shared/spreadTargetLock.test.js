import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applySpreadTargetLocks,
  clearSpreadTargetLocks,
  compareSpreadLocks,
  invalidateSpreadLocksForNode,
} from './spreadTargetLock.js'

test('TEST 6/1: first valid candidate locks; later higher score does not replace', () => {
  const locks = {}
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-ac', source: 'A', target: 'C' },
  ]
  const first = applySpreadTargetLocks({
    locks,
    anomalyNodeIds: ['A'],
    assessmentsBySeedId: {
      A: {
        nodeId: 'B',
        score: 70,
        path: ['A', 'B'],
        seedNodeId: 'A',
        components: {},
      },
    },
    knownNodeIds: new Set(['A', 'B', 'C']),
    quarantinedNodeIds: new Set(),
    edges,
    simulationTick: 10,
  })
  assert.equal(first.primarySpreadNodeId, 'B')
  assert.equal(locks.A.primarySpreadNodeId, 'B')

  const second = applySpreadTargetLocks({
    locks,
    anomalyNodeIds: ['A'],
    assessmentsBySeedId: {
      A: {
        nodeId: 'C',
        score: 99,
        path: ['A', 'C'],
        seedNodeId: 'A',
        components: {},
      },
    },
    knownNodeIds: new Set(['A', 'B', 'C']),
    quarantinedNodeIds: new Set(),
    edges,
    simulationTick: 11,
  })
  assert.equal(second.primarySpreadNodeId, 'B')
  assert.equal(locks.A.primarySpreadNodeId, 'B')
  assert.equal(locks.A.scoreAtLock, 70)
})

test('TEST 2: quarantining locked target releases lock; later tick can re-lock', () => {
  const locks = {
    A: {
      primarySpreadNodeId: 'B',
      path: ['A', 'B'],
      scoreAtLock: 70,
      lockedAtTick: 10,
      assessmentAtLock: { nodeId: 'B', score: 70, path: ['A', 'B'], seedNodeId: 'A' },
    },
  }
  const afterQ = applySpreadTargetLocks({
    locks,
    anomalyNodeIds: ['A'],
    assessmentsBySeedId: {
      A: { nodeId: 'C', score: 80, path: ['A', 'C'], seedNodeId: 'A' },
    },
    knownNodeIds: new Set(['A', 'B', 'C']),
    quarantinedNodeIds: new Set(['B']),
    edges: [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
    ],
    simulationTick: 12,
  })
  assert.equal(locks.A, undefined)
  assert.equal(afterQ.primarySpreadNodeId, null)

  const later = applySpreadTargetLocks({
    locks,
    anomalyNodeIds: ['A'],
    assessmentsBySeedId: {
      A: { nodeId: 'C', score: 80, path: ['A', 'C'], seedNodeId: 'A' },
    },
    knownNodeIds: new Set(['A', 'B', 'C']),
    quarantinedNodeIds: new Set(['B']),
    edges: [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
    ],
    simulationTick: 13,
  })
  assert.equal(later.primarySpreadNodeId, 'C')
  assert.equal(locks.A.primarySpreadNodeId, 'C')
})

test('TEST 3: deleted locked target is never published', () => {
  const locks = {
    A: {
      primarySpreadNodeId: 'B',
      path: ['A', 'B'],
      scoreAtLock: 70,
      lockedAtTick: 10,
      assessmentAtLock: { nodeId: 'B', score: 70 },
    },
  }
  const room = { spreadTargetBySeedId: locks }
  invalidateSpreadLocksForNode(room, 'B')
  assert.equal(room.spreadTargetBySeedId.A, undefined)

  const published = applySpreadTargetLocks({
    locks: room.spreadTargetBySeedId,
    anomalyNodeIds: ['A'],
    assessmentsBySeedId: {
      A: { nodeId: 'C', score: 60, path: ['A', 'C'], seedNodeId: 'A' },
    },
    knownNodeIds: new Set(['A', 'C']), // B gone
    quarantinedNodeIds: new Set(),
    edges: [{ source: 'A', target: 'C' }],
    simulationTick: 13,
  })
  // invalidateSpreadLocksForNode already removed the lock; this tick may create C
  assert.notEqual(published.primarySpreadNodeId, 'B')
  assert.equal(published.primarySpreadNodeId, 'C')
})

test('TEST 4: seed leaving anomalyNodeIds clears its lock', () => {
  const locks = {
    A: {
      primarySpreadNodeId: 'B',
      path: ['A', 'B'],
      scoreAtLock: 70,
      lockedAtTick: 10,
      assessmentAtLock: { nodeId: 'B', score: 70 },
    },
  }
  applySpreadTargetLocks({
    locks,
    anomalyNodeIds: [],
    assessmentsBySeedId: {},
    knownNodeIds: new Set(['A', 'B']),
    quarantinedNodeIds: new Set(),
    edges: [{ source: 'A', target: 'B' }],
    simulationTick: 14,
  })
  assert.equal(locks.A, undefined)
})

test('TEST 5: multi-seed locks are independent', () => {
  const locks = {}
  const edges = [
    { source: 'A', target: 'B' },
    { source: 'X', target: 'Y' },
  ]
  applySpreadTargetLocks({
    locks,
    anomalyNodeIds: ['A', 'X'],
    assessmentsBySeedId: {
      A: { nodeId: 'B', score: 70, path: ['A', 'B'], seedNodeId: 'A' },
      X: { nodeId: 'Y', score: 65, path: ['X', 'Y'], seedNodeId: 'X' },
    },
    knownNodeIds: new Set(['A', 'B', 'X', 'Y']),
    quarantinedNodeIds: new Set(),
    edges,
    simulationTick: 1,
  })
  assert.equal(locks.A.primarySpreadNodeId, 'B')
  assert.equal(locks.X.primarySpreadNodeId, 'Y')

  applySpreadTargetLocks({
    locks,
    anomalyNodeIds: ['A', 'X'],
    assessmentsBySeedId: {
      A: { nodeId: 'C', score: 99, path: ['A', 'C'], seedNodeId: 'A' },
      X: { nodeId: 'Y', score: 10, path: ['X', 'Y'], seedNodeId: 'X' },
    },
    knownNodeIds: new Set(['A', 'B', 'C', 'X', 'Y']),
    quarantinedNodeIds: new Set(),
    edges: [...edges, { source: 'A', target: 'C' }],
    simulationTick: 2,
  })
  assert.equal(locks.A.primarySpreadNodeId, 'B')
  assert.equal(locks.X.primarySpreadNodeId, 'Y')
})

test('TEST 7: no anomaly seeds → primarySpread null', () => {
  const published = applySpreadTargetLocks({
    locks: {},
    anomalyNodeIds: [],
    assessmentsBySeedId: {
      A: { nodeId: 'B', score: 90, path: ['A', 'B'], seedNodeId: 'A' },
    },
    knownNodeIds: new Set(['A', 'B']),
    quarantinedNodeIds: new Set(),
    edges: [{ source: 'A', target: 'B' }],
  })
  assert.equal(published.primarySpreadNodeId, null)
})

test('TEST 8: clearSpreadTargetLocks wipes all locks', () => {
  const room = {
    spreadTargetBySeedId: {
      A: { primarySpreadNodeId: 'B', path: ['A', 'B'], scoreAtLock: 1, lockedAtTick: 1, assessmentAtLock: null },
      X: { primarySpreadNodeId: 'Y', path: ['X', 'Y'], scoreAtLock: 1, lockedAtTick: 1, assessmentAtLock: null },
    },
  }
  clearSpreadTargetLocks(room)
  assert.deepEqual(room.spreadTargetBySeedId, {})
})

test('room-level primary among locks uses frozen scoreAtLock (deterministic)', () => {
  const a = { seedNodeId: 'A', primarySpreadNodeId: 'B', scoreAtLock: 50 }
  const x = { seedNodeId: 'X', primarySpreadNodeId: 'Y', scoreAtLock: 80 }
  assert.ok(compareSpreadLocks(x, a) < 0)
  const locks = {}
  const published = applySpreadTargetLocks({
    locks,
    anomalyNodeIds: ['A', 'X'],
    assessmentsBySeedId: {
      A: { nodeId: 'B', score: 50, path: ['A', 'B'], seedNodeId: 'A' },
      X: { nodeId: 'Y', score: 80, path: ['X', 'Y'], seedNodeId: 'X' },
    },
    knownNodeIds: new Set(['A', 'B', 'X', 'Y']),
    quarantinedNodeIds: new Set(),
    edges: [
      { source: 'A', target: 'B' },
      { source: 'X', target: 'Y' },
    ],
  })
  assert.equal(published.primarySpreadNodeId, 'Y')
})

test('invalidateSpreadLocksForNode removes seed-side locks', () => {
  const room = {
    spreadTargetBySeedId: {
      A: { primarySpreadNodeId: 'B', path: ['A', 'B'], scoreAtLock: 1, lockedAtTick: 1, assessmentAtLock: null },
    },
  }
  invalidateSpreadLocksForNode(room, 'A')
  assert.equal(room.spreadTargetBySeedId.A, undefined)
})
