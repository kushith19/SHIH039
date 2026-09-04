import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findDirectedDependencyEdge,
  listEligibleSpreadTargets,
  validateSpreadAttack,
} from '../../shared/attackSpread.js'
import { applyManualPreset, abortAndClearAttacks, spreadAttack } from '../campaign/engine.js'
import { buildCitySnapshot } from '../telemetry/citySnapshot.js'
import { setNodeQuarantined } from '../response/quarantineNode.js'
import { peerExposureFromFlags } from '../../shared/trustModel.js'
import { propagateGraphRisk } from '../../shared/graphPropagation.js'
import { rankPropagationCandidates } from '../../shared/propagationRisk.js'
import { resetMetricsDbForTests } from '../metrics/store.js'
import { runtimeStateOf } from '../infrastructureNode.js'

function tel(pps = 100) {
  return {
    packetsPerSecond: pps,
    httpRequestsPerMin: 40,
    filesDownloaded: 2,
    failedLoginsPerMin: 1,
  }
}

function node(id, label = id) {
  return {
    id,
    data: {
      label,
      type: id,
      sector: 'test',
      criticality: 'medium',
      telemetry: tel(),
      runtimeState: { provenance: 'legitimate', quarantined: false },
      behaviour: { intrinsicTrust: 70 },
    },
  }
}

/**
 * Graph: A → B → C
 *         A → X
 *         X → Y
 */
function makeRoom(overrides = {}) {
  resetMetricsDbForTests()
  const nodes = [node('A', 'Alpha'), node('B', 'Bravo'), node('C', 'Charlie'), node('X', 'Xray'), node('Y', 'Yankee')]
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-bc', source: 'B', target: 'C' },
    { id: 'e-ax', source: 'A', target: 'X' },
    { id: 'e-xy', source: 'X', target: 'Y' },
  ]
  const detection = {
    anomalyNodeIds: ['A'],
    peerExposedNodeIds: ['B', 'X'],
    propagatedNodeIds: ['B', 'C', 'X', 'Y'],
    atRiskNodeIds: ['B', 'C', 'X', 'Y'],
    propagationRiskByNode: { B: 50, C: 25, X: 50, Y: 25 },
    primarySpreadNodeId: 'B',
  }
  return {
    id: 'SPREAD',
    phase: 'playing',
    simulationTick: 3,
    matchNodeIds: nodes.map((n) => n.id),
    matchEdgeIds: edges.map((e) => e.id),
    nodes,
    edges,
    detection,
    hackSimulator: {
      active: true,
      nodeOverrides: {
        A: { packetsPerSecond: 90_000, httpRequestsPerMin: 500 },
      },
      edgeOverrides: {},
      nodeScenarioBaselines: Object.fromEntries(nodes.map((n) => [n.id, tel()])),
      edgeScenarioBaselines: {},
    },
    activeAttackSequences: {},
    ...overrides,
  }
}

test('findDirectedDependencyEdge requires source→target', () => {
  const edges = [{ id: 'e1', source: 'A', target: 'B' }]
  assert.equal(findDirectedDependencyEdge(edges, 'A', 'B')?.id, 'e1')
  assert.equal(findDirectedDependencyEdge(edges, 'B', 'A'), null)
  assert.equal(findDirectedDependencyEdge(edges, 'A', 'C'), null)
})

test('eligible targets are direct + risk-relevant only (not multi-hop)', () => {
  const room = makeRoom()
  const eligible = listEligibleSpreadTargets(room, 'A')
  const ids = eligible.map((t) => t.nodeId).sort()
  assert.deepEqual(ids, ['B', 'X'])
  assert.equal(eligible.find((t) => t.nodeId === 'B')?.highestRiskCandidate, true)
  assert.ok(!ids.includes('C'))
  assert.ok(!ids.includes('Y'))
})

test('A → B valid spread succeeds and writes nodeOverride', () => {
  const room = makeRoom()
  const beforePrimary = room.detection.primarySpreadNodeId
  const result = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'B',
    presetId: 'traffic_flood',
  })
  assert.equal(result.ok, true)
  assert.equal(result.edgeId, 'e-ab')
  assert.ok(room.hackSimulator.nodeOverrides.B)
  assert.ok(
    Number(room.hackSimulator.nodeOverrides.B.packetsPerSecond) >
      Number(room.hackSimulator.nodeScenarioBaselines.B.packetsPerSecond)
  )
  // Assessment field unchanged by spread write
  assert.equal(room.detection.primarySpreadNodeId, beforePrimary)
})

test('A → C rejected when only A → B → C exists', () => {
  const room = makeRoom()
  const result = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'C',
    presetId: 'traffic_flood',
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /directed dependency|exposed|risk/i)
  assert.equal(room.hackSimulator.nodeOverrides.C, undefined)
})

test('reverse edge rejected', () => {
  const room = makeRoom({
    edges: [
      { id: 'e-ba', source: 'B', target: 'A' },
      { id: 'e-bc', source: 'B', target: 'C' },
    ],
    detection: {
      anomalyNodeIds: ['A'],
      peerExposedNodeIds: ['B'],
      propagatedNodeIds: ['B'],
      atRiskNodeIds: ['B'],
      propagationRiskByNode: { B: 50 },
      primarySpreadNodeId: 'B',
    },
  })
  const result = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'B',
    presetId: 'traffic_flood',
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /directed dependency/i)
})

test('non-adjacent and non-risk-relevant targets rejected', () => {
  const room = makeRoom({
    detection: {
      anomalyNodeIds: ['A'],
      peerExposedNodeIds: ['B'],
      propagatedNodeIds: ['B'],
      atRiskNodeIds: ['B'],
      propagationRiskByNode: { B: 50 },
      primarySpreadNodeId: 'B',
    },
  })
  // X is adjacent but NOT risk-relevant in this detection snapshot
  const result = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'X',
    presetId: 'api_abuse',
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /exposed|risk-relevant/i)
})

test('quarantined target rejected', () => {
  const room = makeRoom()
  setNodeQuarantined(room, 'B', true)
  const result = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'B',
    presetId: 'traffic_flood',
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /quarantined/i)
})

test('already attacked target rejected', () => {
  const room = makeRoom()
  applyManualPreset(room, 'B', 'traffic_flood')
  const result = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'B',
    presetId: 'api_abuse',
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /already under attack/i)
})

test('source not anomalous rejected', () => {
  const room = makeRoom({
    detection: {
      anomalyNodeIds: [],
      peerExposedNodeIds: ['B'],
      propagatedNodeIds: ['B'],
      atRiskNodeIds: ['B'],
      propagationRiskByNode: { B: 50 },
      primarySpreadNodeId: 'B',
    },
  })
  const result = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'B',
    presetId: 'traffic_flood',
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /anomaly/i)
})

test('source without active override rejected', () => {
  const room = makeRoom({
    hackSimulator: {
      active: true,
      nodeOverrides: {},
      edgeOverrides: {},
      nodeScenarioBaselines: {},
      edgeScenarioBaselines: {},
    },
  })
  const result = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'B',
    presetId: 'traffic_flood',
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /active attack override/i)
})

test('spread outside playing phase rejected', () => {
  const room = makeRoom({ phase: 'lobby' })
  const result = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'B',
    presetId: 'traffic_flood',
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /during play/i)
})

test('successful spread reflects in telemetry snapshot path', () => {
  const room = makeRoom()
  const ok = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'B',
    presetId: 'traffic_flood',
  })
  assert.equal(ok.ok, true)
  const snap = buildCitySnapshot(room)
  const b = snap.endpoints.find((ep) => ep.id === 'B')
  assert.ok(b)
  assert.equal(b.behaviour.attackOverrideActive, true)
  assert.ok(b.telemetry.packetsPerSecond > b.baselineTelemetry.packetsPerSecond)
})

test('after A→B, B→C can become eligible when B is the anomaly source', () => {
  const room = makeRoom()
  assert.equal(
    spreadAttack(room, {
      sourceNodeId: 'A',
      targetNodeId: 'B',
      presetId: 'traffic_flood',
    }).ok,
    true
  )
  // Simulate detection advancing so B is the seed and C is risk-relevant
  room.detection = {
    anomalyNodeIds: ['B'],
    peerExposedNodeIds: ['C', 'A'],
    propagatedNodeIds: ['C'],
    atRiskNodeIds: ['C', 'A'],
    propagationRiskByNode: { C: 55 },
    primarySpreadNodeId: 'C',
  }
  const eligible = listEligibleSpreadTargets(room, 'B')
  assert.deepEqual(
    eligible.map((t) => t.nodeId),
    ['C']
  )
  const result = spreadAttack(room, {
    sourceNodeId: 'B',
    targetNodeId: 'C',
    presetId: 'data_exfiltration',
  })
  assert.equal(result.ok, true)
  assert.ok(room.hackSimulator.nodeOverrides.C)
})

test('assessment helpers remain pure (no auto-spread on detection math)', () => {
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-bc', source: 'B', target: 'C' },
  ]
  const exposure = peerExposureFromFlags(edges, ['A'], new Set(['A', 'B', 'C']))
  const prop = propagateGraphRisk({
    edges,
    seedNodeIds: ['A'],
    validNodeIds: new Set(['A', 'B', 'C']),
    maxHops: 3,
    decayFactor: 0.5,
  })
  const ranked = rankPropagationCandidates({
    edges,
    seedNodeIds: ['A'],
    validNodeIds: new Set(['A', 'B', 'C']),
    maxHops: 3,
    peerMetricsByNodeId: {},
    isolationScoresByNodeId: { A: 0.9, B: 0.1, C: 0.1 },
  })
  assert.ok(exposure.atRiskNodeIds.includes('B'))
  assert.ok(prop.propagatedNodeIds.includes('C'))
  assert.ok(ranked.primarySpreadNodeId === 'B' || ranked.primarySpreadNodeId === 'C')
  // These pure calls must not invent room overrides
  assert.equal(typeof exposure, 'object')
  assert.equal(typeof prop.propagationPaths, 'object')
})

test('validateSpreadAttack rejects missing nodes and self-spread', () => {
  const room = makeRoom()
  assert.equal(validateSpreadAttack(room, 'A', 'A').ok, false)
  assert.equal(validateSpreadAttack(room, 'A', 'missing').ok, false)
  assert.equal(validateSpreadAttack(room, 'missing', 'B').ok, false)
})

test('primarySpreadNodeId that is two hops away is not directly eligible', () => {
  const room = makeRoom({
    detection: {
      anomalyNodeIds: ['A'],
      peerExposedNodeIds: ['B', 'X'],
      propagatedNodeIds: ['B', 'C', 'X', 'Y'],
      atRiskNodeIds: ['B', 'C', 'X', 'Y'],
      propagationRiskByNode: { B: 40, C: 80, X: 40, Y: 20 },
      // Ranking quirk: C ranks highest, but is two hops from A
      primarySpreadNodeId: 'C',
    },
  })
  const eligible = listEligibleSpreadTargets(room, 'A')
  const ids = eligible.map((t) => t.nodeId)
  assert.ok(ids.includes('B'))
  assert.ok(ids.includes('X'))
  assert.ok(!ids.includes('C'))
  assert.equal(
    spreadAttack(room, {
      sourceNodeId: 'A',
      targetNodeId: 'C',
      presetId: 'traffic_flood',
    }).ok,
    false
  )
})

/**
 * Regression: replaying A→B→C then A→B must never quarantine C via historical
 * pattern learning (that feature was removed).
 */
test('replaying A→B→C does not quarantine C from historical patterns', async () => {
  const store = await import('../metrics/store.js')
  assert.equal(typeof store.upsertAttackPattern, 'undefined')
  assert.equal(typeof store.listAttackPatterns, 'undefined')

  const room = makeRoom()

  function seedA() {
    room.hackSimulator.nodeOverrides = {
      A: { packetsPerSecond: 90_000, httpRequestsPerMin: 500 },
    }
    room.detection = {
      anomalyNodeIds: ['A'],
      peerExposedNodeIds: ['B', 'X'],
      propagatedNodeIds: ['B', 'C', 'X', 'Y'],
      atRiskNodeIds: ['B', 'C', 'X', 'Y'],
      propagationRiskByNode: { B: 50, C: 25, X: 50, Y: 25 },
      primarySpreadNodeId: 'B',
    }
  }

  function advanceToB() {
    room.detection = {
      anomalyNodeIds: ['B'],
      peerExposedNodeIds: ['C'],
      propagatedNodeIds: ['C'],
      atRiskNodeIds: ['C'],
      propagationRiskByNode: { C: 55 },
      primarySpreadNodeId: 'C',
    }
  }

  function pathABC() {
    seedA()
    assert.equal(
      spreadAttack(room, {
        sourceNodeId: 'A',
        targetNodeId: 'B',
        presetId: 'traffic_flood',
      }).ok,
      true
    )
    advanceToB()
    assert.equal(
      spreadAttack(room, {
        sourceNodeId: 'B',
        targetNodeId: 'C',
        presetId: 'data_exfiltration',
      }).ok,
      true
    )
  }

  pathABC()
  abortAndClearAttacks(room)
  pathABC()
  abortAndClearAttacks(room)

  seedA()
  assert.equal(
    spreadAttack(room, {
      sourceNodeId: 'A',
      targetNodeId: 'B',
      presetId: 'traffic_flood',
    }).ok,
    true
  )

  const c = room.nodes.find((n) => n.id === 'C')
  assert.equal(runtimeStateOf(c.data).quarantined, false)
  assert.equal(runtimeStateOf(c.data).predictedQuarantine, undefined)
  assert.equal(room.predictedQuarantineByNodeId, undefined)

  // Explicit defender quarantine still works.
  advanceToB()
  setNodeQuarantined(room, 'C', true)
  const cAfter = room.nodes.find((n) => n.id === 'C')
  assert.equal(runtimeStateOf(cAfter.data).quarantined, true)
  const blocked = spreadAttack(room, {
    sourceNodeId: 'B',
    targetNodeId: 'C',
    presetId: 'api_abuse',
  })
  assert.equal(blocked.ok, false)
  assert.match(blocked.message, /quarantined/i)
})
