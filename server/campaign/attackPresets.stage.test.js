import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computePresetOverrides,
  getAttackPreset,
  preferredNodeIdsForPreset,
} from '../../shared/attackPresets.js'
import { applyManualPreset, spreadAttack } from '../campaign/engine.js'
import { buildCitySnapshot } from '../telemetry/citySnapshot.js'
import { LIVE_CITY_GRAPH_TYPES } from '../../shared/cityModel/liveGraphTypes.js'

const BASE = {
  packetsPerSecond: 4000,
  httpRequestsPerMin: 30,
  filesDownloaded: 5,
  failedLoginsPerMin: 1,
}

function liveNode(type) {
  return {
    id: `ep-${type}`,
    data: {
      type,
      label: type,
      sector: 'Test',
      criticality: 'high',
      ...BASE,
      intrinsicTrust: 80,
      runtimeState: { quarantined: false, provenance: 'legitimate' },
    },
  }
}

function roomWithLiveGraph() {
  const nodes = LIVE_CITY_GRAPH_TYPES.map(liveNode)
  // Minimal directed edges matching cascade / IoT preferred paths on the live canvas.
  const edges = [
    { id: 'e1', source: 'ep-power_substation', target: 'ep-plc_controller' },
    { id: 'e2', source: 'ep-power_substation', target: 'ep-telecom_gateway' },
    { id: 'e3', source: 'ep-telecom_gateway', target: 'ep-hospital_gateway' },
    { id: 'e4', source: 'ep-surveillance_cctv', target: 'ep-police_services' },
    { id: 'e5', source: 'ep-mqtt_broker', target: 'ep-hospital_gateway' },
  ]
  return {
    id: 'attack-preset-room',
    phase: 'playing',
    simulationTick: 20,
    nodes,
    edges,
    matchNodeIds: nodes.map((n) => n.id),
    hackSimulator: {
      active: true,
      nodeOverrides: {},
      edgeOverrides: {},
      nodeAttackStates: {},
      attackSpreadMode: 'manual',
    },
    detection: {
      anomalyNodeIds: [],
      peerExposedNodeIds: [],
      propagatedNodeIds: [],
      atRiskNodeIds: [],
      propagationRiskByNode: {},
      primarySpreadNodeId: null,
    },
    activeAttackSequences: {},
  }
}

test('applyManualPreset writes telemetry overrides for new multi-stage presets', () => {
  const room = roomWithLiveGraph()
  const seedId = preferredNodeIdsForPreset('cascade_propagation')[0]
  assert.ok(seedId)

  const result = applyManualPreset(room, seedId, 'cascade_propagation')
  assert.equal(result.ok, true)

  const expected = computePresetOverrides('cascade_propagation', BASE, { stageIndex: 0 })
  assert.deepEqual(room.hackSimulator.nodeOverrides[seedId], expected)
  assert.equal(room.hackSimulator.nodeAttackStates[seedId], true)

  const snap = buildCitySnapshot(room)
  const ep = snap.endpoints.find((e) => e.id === seedId)
  assert.ok(ep)
  assert.equal(ep.behaviour.attackOverrideActive, true)
  assert.equal(ep.telemetry.packetsPerSecond, expected.packetsPerSecond)
})

test('spreadAttack advances multi-stage metric profile', () => {
  const room = roomWithLiveGraph()
  const source = 'ep-power_substation'
  const target = 'ep-telecom_gateway'

  assert.equal(applyManualPreset(room, source, 'cascade_propagation').ok, true)

  // Detection eligibility for spread (assessment-only; still uses real override path).
  room.detection = {
    anomalyNodeIds: [source],
    peerExposedNodeIds: [target],
    propagatedNodeIds: [target],
    atRiskNodeIds: [target],
    propagationRiskByNode: { [target]: 80 },
    primarySpreadNodeId: target,
  }

  const spread = spreadAttack(room, {
    sourceNodeId: source,
    targetNodeId: target,
    presetId: 'cascade_propagation',
  })
  assert.equal(spread.ok, true)

  const stage0 = computePresetOverrides('cascade_propagation', BASE, { stageIndex: 0 })
  const stage1 = computePresetOverrides('cascade_propagation', BASE, { stageIndex: 1 })
  assert.deepEqual(room.hackSimulator.nodeOverrides[source], stage0)
  assert.deepEqual(room.hackSimulator.nodeOverrides[target], stage1)
  assert.ok(stage1.packetsPerSecond > stage0.packetsPerSecond)
})

test('legacy traffic_flood still seeds via applyManualPreset', () => {
  const room = roomWithLiveGraph()
  const nodeId = 'ep-traffic_management'
  assert.equal(applyManualPreset(room, nodeId, 'traffic_flood').ok, true)
  assert.deepEqual(
    room.hackSimulator.nodeOverrides[nodeId],
    computePresetOverrides('traffic_flood', BASE)
  )
})

test('preferred seeds for new presets exist on live graph fixture', () => {
  const room = roomWithLiveGraph()
  const available = new Set(room.nodes.map((n) => n.id))
  for (const id of [
    'iot_lateral',
    'internet_facing_compromise',
    'credential_compromise',
    'botnet_flood',
    'malicious_peer',
    'service_disruption',
    'coordinated_multi_node',
    'cascade_propagation',
  ]) {
    const preferred = preferredNodeIdsForPreset(id, available)
    assert.ok(preferred.length >= 1, id)
    assert.ok(getAttackPreset(id).stages.length >= 1)
  }
})
