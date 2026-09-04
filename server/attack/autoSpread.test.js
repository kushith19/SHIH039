import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAttackSpreadMode,
  isAttackSpreadMode,
  normalizeAttackSpreadMode,
} from '../../shared/attackSpreadMode.js'
import { listEligibleSpreadTargets } from '../../shared/attackSpread.js'
import {
  applyManualPreset,
  abortAndClearAttacks,
  spreadAttack,
} from '../campaign/engine.js'
import {
  clearAutoSpreadGuards,
  evaluateAutoSpread,
  resolvePresetForAutoSpread,
  AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN,
  getAutoSpreadSuccessCount,
} from './autoSpread.js'
import { setNodeQuarantined } from '../response/quarantineNode.js'
import { resetMetricsDbForTests } from '../metrics/store.js'
import { sanitizeHackSimulator } from '../validators.js'
import { DEFAULT_HACK_SIMULATOR } from '../roomStore.js'
import { buildAttackLayerFromGraph } from '../nodeMetrics.js'

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

/** Graph: A → B → C, A → D, A → E (E high risk but we control scores) */
function makeRoom(overrides = {}) {
  resetMetricsDbForTests()
  const nodes = [
    node('A', 'Alpha'),
    node('B', 'Bravo'),
    node('C', 'Charlie'),
    node('D', 'Delta'),
    node('E', 'Echo'),
  ]
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-bc', source: 'B', target: 'C' },
    { id: 'e-ad', source: 'A', target: 'D' },
    { id: 'e-ae', source: 'A', target: 'E' },
  ]
  const detection = {
    anomalyNodeIds: ['A'],
    peerExposedNodeIds: ['B', 'D', 'E'],
    propagatedNodeIds: ['B', 'C', 'D', 'E'],
    atRiskNodeIds: ['B', 'C', 'D', 'E'],
    propagationRiskByNode: { B: 40, C: 10, D: 70, E: 90 },
    primarySpreadNodeId: 'E',
    tgnnCalibrating: false,
  }
  return {
    id: 'AUTO',
    phase: 'playing',
    simulationTick: 5,
    matchNodeIds: nodes.map((n) => n.id),
    matchEdgeIds: edges.map((e) => e.id),
    nodes,
    edges,
    detection,
    hackSimulator: {
      active: true,
      attackSpreadMode: 'manual',
      nodeOverrides: {
        A: { packetsPerSecond: 90_000, httpRequestsPerMin: 500 },
      },
      edgeOverrides: {},
      nodeScenarioBaselines: Object.fromEntries(nodes.map((n) => [n.id, tel()])),
      edgeScenarioBaselines: {},
    },
    activeAttackSequences: {},
    autoSpreadDoneBySource: {},
    autoSpreadInFlight: false,
    autoSpreadSuccessCount: 0,
    ...overrides,
  }
}

function setMode(room, mode) {
  room.hackSimulator = {
    ...room.hackSimulator,
    attackSpreadMode: normalizeAttackSpreadMode(mode),
  }
}

test('default mode is manual', () => {
  assert.equal(DEFAULT_HACK_SIMULATOR.attackSpreadMode, 'manual')
  assert.equal(getAttackSpreadMode({}), 'manual')
  assert.equal(getAttackSpreadMode(makeRoom()), 'manual')
  const layer = buildAttackLayerFromGraph([node('A')], [])
  assert.equal(layer.attackSpreadMode, 'manual')
})

test('normalize / isAttackSpreadMode validate enum', () => {
  assert.equal(normalizeAttackSpreadMode('auto'), 'auto')
  assert.equal(normalizeAttackSpreadMode('manual'), 'manual')
  assert.equal(normalizeAttackSpreadMode('AUTO'), 'manual')
  assert.equal(normalizeAttackSpreadMode('nope'), 'manual')
  assert.equal(isAttackSpreadMode('auto'), true)
  assert.equal(isAttackSpreadMode('manual'), true)
  assert.equal(isAttackSpreadMode('burst'), false)
})

test('sanitizeHackSimulator strips client attackSpreadMode', () => {
  const sanitized = sanitizeHackSimulator({
    active: true,
    attackSpreadMode: 'auto',
    nodeOverrides: { A: { packetsPerSecond: 9 } },
    edgeOverrides: {},
  })
  assert.equal(sanitized.attackSpreadMode, undefined)
  assert.ok(sanitized.nodeOverrides.A)
})

test('manual mode does not auto-spread', () => {
  const room = makeRoom()
  setMode(room, 'manual')
  const before = { ...room.hackSimulator.nodeOverrides }
  const result = evaluateAutoSpread(room)
  assert.equal(result.reason, 'manual')
  assert.deepEqual(result.spreads, [])
  assert.deepEqual(room.hackSimulator.nodeOverrides, before)
})

test('auto mode spreads A→highest-risk eligible (E)', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  applyManualPreset(room, 'A', 'api_abuse')
  const result = evaluateAutoSpread(room)
  assert.equal(result.ok, true)
  assert.equal(result.spreads.length, 1)
  assert.equal(result.spreads[0].sourceNodeId, 'A')
  assert.equal(result.spreads[0].targetNodeId, 'E')
  assert.ok(room.hackSimulator.nodeOverrides.E)
  assert.ok(room.autoSpreadDoneBySource.A)
})

test('auto selects highest risk among eligible (C=90 over B/D)', () => {
  const room = makeRoom({
    detection: {
      anomalyNodeIds: ['A'],
      peerExposedNodeIds: ['B', 'D', 'E'],
      propagatedNodeIds: ['B', 'D', 'E'],
      atRiskNodeIds: ['B', 'D', 'E'],
      propagationRiskByNode: { B: 40, D: 70, E: 90 },
      primarySpreadNodeId: null,
      tgnnCalibrating: false,
    },
  })
  setMode(room, 'auto')
  const eligible = listEligibleSpreadTargets(room, 'A')
  assert.equal(eligible[0].nodeId, 'E')
  const result = evaluateAutoSpread(room)
  assert.equal(result.spreads[0]?.targetNodeId, 'E')
})

test('tie break is deterministic via listEligibleSpreadTargets order', () => {
  const room = makeRoom({
    detection: {
      anomalyNodeIds: ['A'],
      peerExposedNodeIds: ['B', 'D'],
      propagatedNodeIds: ['B', 'D'],
      atRiskNodeIds: ['B', 'D'],
      // Equal risk; highestRiskCandidate neither — nodeId localeCompare
      propagationRiskByNode: { B: 91, D: 91 },
      primarySpreadNodeId: null,
      tgnnCalibrating: false,
    },
  })
  setMode(room, 'auto')
  const eligible = listEligibleSpreadTargets(room, 'A')
  const result = evaluateAutoSpread(room)
  assert.equal(result.spreads[0]?.targetNodeId, eligible[0].nodeId)
})

test('non-adjacent high-risk C is not selected from A', () => {
  const room = makeRoom({
    detection: {
      anomalyNodeIds: ['A'],
      peerExposedNodeIds: ['B', 'C', 'D'],
      propagatedNodeIds: ['B', 'C', 'D'],
      atRiskNodeIds: ['B', 'C', 'D'],
      propagationRiskByNode: { B: 10, C: 99, D: 20 },
      primarySpreadNodeId: 'C',
      tgnnCalibrating: false,
    },
  })
  setMode(room, 'auto')
  const result = evaluateAutoSpread(room)
  assert.notEqual(result.spreads[0]?.targetNodeId, 'C')
  assert.ok(['B', 'D', 'E'].includes(result.spreads[0]?.targetNodeId))
})

test('quarantined target is skipped; next eligible chosen', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  setNodeQuarantined(room, 'E', true)
  const result = evaluateAutoSpread(room)
  assert.equal(result.spreads[0]?.targetNodeId, 'D')
  assert.equal(room.hackSimulator.nodeOverrides.E, undefined)
})

test('already-attacked target is not selected', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  room.hackSimulator.nodeOverrides.E = { packetsPerSecond: 80_000 }
  const result = evaluateAutoSpread(room)
  assert.notEqual(result.spreads[0]?.targetNodeId, 'E')
  assert.ok(result.spreads[0]?.targetNodeId)
})

test('auto does not duplicate on repeated evaluate calls', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  const first = evaluateAutoSpread(room)
  assert.equal(first.spreads.length, 1)
  const target = first.spreads[0].targetNodeId
  const second = evaluateAutoSpread(room)
  assert.deepEqual(second.spreads, [])
  // Only one new override from first hop (A already had override)
  assert.ok(room.hackSimulator.nodeOverrides[target])
})

test('B cannot auto-spread until B is anomaly + override', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  // Manual path: A→B
  assert.equal(
    spreadAttack(room, {
      sourceNodeId: 'A',
      targetNodeId: 'B',
      presetId: 'traffic_flood',
    }).ok,
    true
  )
  room.autoSpreadDoneBySource = { A: { targetNodeId: 'B', tick: 1 } }
  // B has override but is NOT anomaly yet
  room.detection = {
    ...room.detection,
    anomalyNodeIds: ['A'],
    peerExposedNodeIds: ['C'],
    propagatedNodeIds: ['C'],
    atRiskNodeIds: ['C'],
    propagationRiskByNode: { C: 80 },
    primarySpreadNodeId: 'C',
  }
  const blocked = evaluateAutoSpread(room)
  assert.deepEqual(blocked.spreads, [])
  assert.equal(room.hackSimulator.nodeOverrides.C, undefined)

  // B becomes confirmed anomaly
  room.detection = {
    ...room.detection,
    anomalyNodeIds: ['A', 'B'],
  }
  const hop = evaluateAutoSpread(room)
  assert.equal(hop.spreads.length, 1)
  assert.equal(hop.spreads[0].sourceNodeId, 'B')
  assert.equal(hop.spreads[0].targetNodeId, 'C')
  assert.ok(room.hackSimulator.nodeOverrides.C)
})

test('auto → manual stops future automatic spreads', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  evaluateAutoSpread(room)
  clearAutoSpreadGuards(room)
  // Restore A-only attack for a fresh attempt
  room.hackSimulator.nodeOverrides = {
    A: { packetsPerSecond: 90_000 },
  }
  room.detection.anomalyNodeIds = ['A']
  setMode(room, 'manual')
  const result = evaluateAutoSpread(room)
  assert.equal(result.reason, 'manual')
  assert.deepEqual(result.spreads, [])
})

test('manual → auto does not mark done without evaluate; one hop per source', () => {
  const room = makeRoom()
  setMode(room, 'manual')
  assert.deepEqual(evaluateAutoSpread(room).spreads, [])
  setMode(room, 'auto')
  const first = evaluateAutoSpread(room)
  assert.equal(first.spreads.length, 1)
  const second = evaluateAutoSpread(room)
  assert.deepEqual(second.spreads, [])
})

test('auto spread produces confirmed spread sequence event like manual', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  applyManualPreset(room, 'A', 'api_abuse')
  evaluateAutoSpread(room)
  const seqs = Object.values(room.activeAttackSequences ?? {})
  assert.ok(seqs.length >= 1)
  const events = seqs.flatMap((s) => s.events ?? [])
  const spreadEv = events.find((e) => e.kind === 'spread')
  assert.ok(spreadEv)
  assert.equal(spreadEv.sourceNodeId, 'A')
  assert.ok(spreadEv.targetNodeId)
})

test('Clear Attacks clears auto guards but preserves mode', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  evaluateAutoSpread(room)
  assert.ok(room.autoSpreadDoneBySource.A)
  assert.equal(getAutoSpreadSuccessCount(room), 1)
  abortAndClearAttacks(room)
  assert.deepEqual(room.autoSpreadDoneBySource, {})
  assert.equal(getAutoSpreadSuccessCount(room), 0)
  assert.equal(getAttackSpreadMode(room), 'auto')
})

test('resolvePresetForAutoSpread uses sequence tip preset', () => {
  const room = makeRoom()
  applyManualPreset(room, 'A', 'credential_spray')
  assert.equal(resolvePresetForAutoSpread(room, 'A'), 'credential_spray')
})

test('independent sources progress independently', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  room.nodes.push(node('X'), node('Y'))
  room.edges.push({ id: 'e-xy', source: 'X', target: 'Y' })
  room.hackSimulator.nodeOverrides.X = { packetsPerSecond: 88_000 }
  room.detection = {
    anomalyNodeIds: ['A', 'X'],
    peerExposedNodeIds: ['B', 'D', 'E', 'Y'],
    propagatedNodeIds: ['B', 'D', 'E', 'Y'],
    atRiskNodeIds: ['B', 'D', 'E', 'Y'],
    propagationRiskByNode: { B: 40, D: 70, E: 90, Y: 55 },
    primarySpreadNodeId: 'E',
    tgnnCalibrating: false,
  }
  room.hackSimulator.nodeScenarioBaselines.X = tel()
  room.hackSimulator.nodeScenarioBaselines.Y = tel()
  const result = evaluateAutoSpread(room)
  const sources = result.spreads.map((s) => s.sourceNodeId).sort()
  assert.deepEqual(sources, ['A', 'X'])
  assert.equal(result.spreads.find((s) => s.sourceNodeId === 'A')?.targetNodeId, 'E')
  assert.equal(result.spreads.find((s) => s.sourceNodeId === 'X')?.targetNodeId, 'Y')
  assert.equal(getAutoSpreadSuccessCount(room), 2)
})

test('AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN is 5', () => {
  assert.equal(AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN, 5)
})

test('AUTO allows five successful spreads then refuses the sixth; seed does not count', () => {
  const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  const nodes = ids.map((id) => node(id))
  const edges = [
    { id: 'e-ab', source: 'A', target: 'B' },
    { id: 'e-bc', source: 'B', target: 'C' },
    { id: 'e-cd', source: 'C', target: 'D' },
    { id: 'e-de', source: 'D', target: 'E' },
    { id: 'e-ef', source: 'E', target: 'F' },
    { id: 'e-fg', source: 'F', target: 'G' },
  ]
  const room = makeRoom({
    nodes,
    edges,
    matchNodeIds: ids,
    matchEdgeIds: edges.map((e) => e.id),
    hackSimulator: {
      active: true,
      attackSpreadMode: 'auto',
      nodeOverrides: {
        A: { packetsPerSecond: 90_000, httpRequestsPerMin: 500 },
      },
      edgeOverrides: {},
      nodeScenarioBaselines: Object.fromEntries(nodes.map((n) => [n.id, tel()])),
      edgeScenarioBaselines: {},
    },
  })
  applyManualPreset(room, 'A', 'traffic_flood')
  assert.equal(getAutoSpreadSuccessCount(room), 0, 'seed must not consume budget')

  const chain = [
    { anomaly: ['A'], next: 'B' },
    { anomaly: ['A', 'B'], next: 'C' },
    { anomaly: ['A', 'B', 'C'], next: 'D' },
    { anomaly: ['A', 'B', 'C', 'D'], next: 'E' },
    { anomaly: ['A', 'B', 'C', 'D', 'E'], next: 'F' },
  ]

  for (let i = 0; i < chain.length; i++) {
    const tip = chain[i].anomaly[chain[i].anomaly.length - 1]
    const next = chain[i].next
    room.detection = {
      anomalyNodeIds: chain[i].anomaly,
      peerExposedNodeIds: [next],
      propagatedNodeIds: [next],
      atRiskNodeIds: [next],
      propagationRiskByNode: { [next]: 90 },
      primarySpreadNodeId: next,
      tgnnCalibrating: false,
    }
    const hop = evaluateAutoSpread(room)
    assert.equal(hop.ok, true, `spread #${i + 1} should succeed`)
    assert.equal(hop.spreads.length, 1)
    assert.equal(hop.spreads[0].sourceNodeId, tip)
    assert.equal(hop.spreads[0].targetNodeId, next)
    assert.equal(getAutoSpreadSuccessCount(room), i + 1)
    assert.ok(room.hackSimulator.nodeOverrides[next])
  }

  assert.equal(getAutoSpreadSuccessCount(room), 5)

  // Sixth hop would be F → G
  room.detection = {
    anomalyNodeIds: ['A', 'B', 'C', 'D', 'E', 'F'],
    peerExposedNodeIds: ['G'],
    propagatedNodeIds: ['G'],
    atRiskNodeIds: ['G'],
    propagationRiskByNode: { G: 90 },
    primarySpreadNodeId: 'G',
    tgnnCalibrating: false,
  }
  const blocked = evaluateAutoSpread(room)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'safety_cap')
  assert.deepEqual(blocked.spreads, [])
  assert.equal(room.hackSimulator.nodeOverrides.G, undefined)
  assert.equal(getAutoSpreadSuccessCount(room), 5)
})

test('Clear Attacks and clearAutoSpreadGuards reset the AUTO success counter', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  evaluateAutoSpread(room)
  assert.equal(getAutoSpreadSuccessCount(room), 1)

  abortAndClearAttacks(room)
  assert.equal(getAutoSpreadSuccessCount(room), 0)

  setMode(room, 'auto')
  room.hackSimulator.nodeOverrides = {
    A: { packetsPerSecond: 90_000 },
  }
  room.detection.anomalyNodeIds = ['A']
  room.detection.peerExposedNodeIds = ['E']
  room.detection.propagatedNodeIds = ['E']
  room.detection.atRiskNodeIds = ['E']
  room.detection.propagationRiskByNode = { E: 90 }
  room.detection.primarySpreadNodeId = 'E'
  evaluateAutoSpread(room)
  assert.equal(getAutoSpreadSuccessCount(room), 1)

  // Match start / rebuild path
  clearAutoSpreadGuards(room)
  assert.equal(getAutoSpreadSuccessCount(room), 0)
  assert.deepEqual(room.autoSpreadDoneBySource, {})
})

test('manual spreadAttack ignores AUTO safety cap', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  room.autoSpreadSuccessCount = AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN
  room.autoSpreadDoneBySource = { A: { targetNodeId: 'E', tick: 1 } }

  const autoBlocked = evaluateAutoSpread(room)
  assert.equal(autoBlocked.reason, 'safety_cap')
  assert.deepEqual(autoBlocked.spreads, [])

  // Manual spread still works via spreadAttack (eligibility intact)
  room.detection = {
    ...room.detection,
    anomalyNodeIds: ['A'],
    peerExposedNodeIds: ['B', 'D'],
    propagatedNodeIds: ['B', 'D'],
    atRiskNodeIds: ['B', 'D'],
    propagationRiskByNode: { B: 40, D: 70 },
    primarySpreadNodeId: 'D',
  }
  const manual = spreadAttack(room, {
    sourceNodeId: 'A',
    targetNodeId: 'D',
    presetId: 'traffic_flood',
  })
  assert.equal(manual.ok, true)
  assert.ok(room.hackSimulator.nodeOverrides.D)
  assert.equal(
    getAutoSpreadSuccessCount(room),
    AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN,
    'manual hop must not increment AUTO counter'
  )
})

test('safety cap stops mid-tick after remaining budget is used', () => {
  const room = makeRoom()
  setMode(room, 'auto')
  room.autoSpreadSuccessCount = AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN - 1
  room.nodes.push(node('X'), node('Y'))
  room.edges.push({ id: 'e-xy', source: 'X', target: 'Y' })
  room.hackSimulator.nodeOverrides.X = { packetsPerSecond: 88_000 }
  room.hackSimulator.nodeScenarioBaselines.X = tel()
  room.hackSimulator.nodeScenarioBaselines.Y = tel()
  room.detection = {
    anomalyNodeIds: ['A', 'X'],
    peerExposedNodeIds: ['B', 'D', 'E', 'Y'],
    propagatedNodeIds: ['B', 'D', 'E', 'Y'],
    atRiskNodeIds: ['B', 'D', 'E', 'Y'],
    propagationRiskByNode: { B: 40, D: 70, E: 90, Y: 55 },
    primarySpreadNodeId: 'E',
    tgnnCalibrating: false,
  }
  const result = evaluateAutoSpread(room)
  assert.equal(result.spreads.length, 1)
  assert.equal(getAutoSpreadSuccessCount(room), AUTO_ATTACK_MAX_SPREADS_PER_CAMPAIGN)
  const again = evaluateAutoSpread(room)
  assert.equal(again.reason, 'safety_cap')
  assert.deepEqual(again.spreads, [])
})
