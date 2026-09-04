import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ATTACK_PRESET_IDS,
  ATTACK_PRESETS,
  catalogTypeToNodeId,
  computePresetOverrides,
  getAttackPreset,
  isAttackPresetId,
  listAttackPresets,
  preferredNodeIdsForPreset,
  registerAttackPreset,
  resolvePresetStage,
  stableVariationFactor,
} from './attackPresets.js'
import { LIVE_CITY_GRAPH_TYPES } from './cityModel/liveGraphTypes.js'
import { GAME_METRIC_KEYS } from './telemetryKeys.js'

const LEGACY_IDS = [
  'traffic_flood',
  'data_exfiltration',
  'api_abuse',
  'credential_spray',
]

const NEW_IDS = [
  'iot_lateral',
  'internet_facing_compromise',
  'credential_compromise',
  'botnet_flood',
  'malicious_peer',
  'service_disruption',
  'coordinated_multi_node',
  'cascade_propagation',
]

const BASE = {
  packetsPerSecond: 5000,
  httpRequestsPerMin: 40,
  filesDownloaded: 10,
  failedLoginsPerMin: 2,
}

test('built-in presets are registered with required UI metadata', () => {
  const listed = listAttackPresets()
  assert.equal(listed.length, ATTACK_PRESET_IDS.length)
  assert.equal(ATTACK_PRESETS.length, ATTACK_PRESET_IDS.length)

  for (const id of [...LEGACY_IDS, ...NEW_IDS]) {
    assert.equal(isAttackPresetId(id), true, `missing ${id}`)
    const p = getAttackPreset(id)
    assert.ok(p, id)
    assert.equal(p.id, id)
    assert.ok(p.title)
    assert.ok(p.name)
    assert.ok(p.description)
    assert.ok(p.attackType)
    assert.ok(Array.isArray(p.stages) && p.stages.length >= 1)
    assert.ok(p.expectedBehavior)
    assert.ok(Array.isArray(p.preferredSeedTypes))
  }
})

test('registerAttackPreset rejects duplicates and incomplete defs', () => {
  assert.throws(() => registerAttackPreset(getAttackPreset('traffic_flood')), /already registered/)
  assert.throws(
    () =>
      registerAttackPreset({
        id: 'tmp_bad',
        title: 'Bad',
        description: 'x',
        attackType: 'x',
        preferredSeedTypes: ['not_a_live_type'],
        stages: [{ id: 's', name: 'S', profile: 'traffic_flood' }],
        expectedBehavior: 'x',
      }),
    /not a live city graph type/
  )
})

test('preferred seed types are live city graph types only', () => {
  const live = new Set(LIVE_CITY_GRAPH_TYPES)
  for (const preset of listAttackPresets()) {
    for (const type of preset.preferredSeedTypes) {
      assert.ok(live.has(type), `${preset.id} → ${type}`)
      assert.equal(catalogTypeToNodeId(type), `ep-${type}`)
    }
    const ids = preferredNodeIdsForPreset(preset.id)
    assert.deepEqual(
      ids,
      preset.preferredSeedTypes.map((t) => `ep-${t}`)
    )
    const filtered = preferredNodeIdsForPreset(preset.id, [ids[0]].filter(Boolean))
    if (ids.length) assert.deepEqual(filtered, [ids[0]])
  }
})

test('legacy preset formulas are unchanged at default variation', () => {
  assert.deepEqual(computePresetOverrides('traffic_flood', BASE), {
    packetsPerSecond: Math.max(5000 * 15, 5000 + 50_000, 80_000),
    httpRequestsPerMin: Math.max(40 * 3, 40 + 120, 500),
  })
  assert.deepEqual(computePresetOverrides('data_exfiltration', BASE), {
    filesDownloaded: Math.max(10 + 500, 800),
    packetsPerSecond: Math.max(5000 * 4, 5000 + 8_000, 25_000),
    httpRequestsPerMin: Math.max(40 * 2, 40 + 40, 200),
  })
  assert.deepEqual(computePresetOverrides('api_abuse', BASE), {
    httpRequestsPerMin: Math.max(40 * 40, 40 + 2_000, 5_000),
    packetsPerSecond: Math.max(5000 * 3, 5000 + 5_000, 18_000),
  })
  assert.deepEqual(computePresetOverrides('credential_spray', BASE), {
    failedLoginsPerMin: Math.max(2 * 50, 2 + 200, 350),
    httpRequestsPerMin: Math.max(40 * 8, 40 + 300, 800),
  })
})

test('telemetry overrides only touch game metric keys', () => {
  for (const id of ATTACK_PRESET_IDS) {
    const stages = getAttackPreset(id).stages
    for (let i = 0; i < stages.length; i++) {
      const ov = computePresetOverrides(id, BASE, { stageIndex: i })
      assert.ok(Object.keys(ov).length > 0, `${id} stage ${i}`)
      for (const key of Object.keys(ov)) {
        assert.ok(GAME_METRIC_KEYS.includes(key), `${id} unexpected key ${key}`)
        assert.ok(Number.isFinite(ov[key]) && ov[key] >= 0)
      }
    }
  }
})

test('multi-stage presets progress metric profiles by stageIndex', () => {
  const cascade = getAttackPreset('cascade_propagation')
  assert.ok(cascade.stages.length >= 3)

  const s0 = computePresetOverrides('cascade_propagation', BASE, { stageIndex: 0 })
  const s1 = computePresetOverrides('cascade_propagation', BASE, { stageIndex: 1 })
  const s2 = computePresetOverrides('cascade_propagation', BASE, { stageIndex: 2 })
  const sClamped = computePresetOverrides('cascade_propagation', BASE, { stageIndex: 99 })

  assert.ok(s1.packetsPerSecond > s0.packetsPerSecond)
  assert.ok(s2.packetsPerSecond > s1.packetsPerSecond)
  assert.deepEqual(sClamped, s2)

  const resolved = resolvePresetStage('iot_lateral', 1)
  assert.equal(resolved.index, 1)
  assert.equal(resolved.stage.profile, 'peer_c2')
})

test('stableVariationFactor is deterministic and optional on overrides', () => {
  const a = stableVariationFactor('cascade_propagation|ep-power_substation')
  const b = stableVariationFactor('cascade_propagation|ep-power_substation')
  assert.equal(a, b)
  assert.ok(a >= 0.94 && a <= 1.06)

  const base = computePresetOverrides('botnet_flood', BASE)
  const varied = computePresetOverrides('botnet_flood', BASE, { variation: 1.05 })
  assert.ok(varied.packetsPerSecond !== base.packetsPerSecond)
  assert.equal(
    varied.packetsPerSecond,
    Math.round(base.packetsPerSecond * 1.05)
  )
})

test('unknown preset yields empty overrides', () => {
  assert.deepEqual(computePresetOverrides('not_a_preset', BASE), {})
  assert.equal(isAttackPresetId('not_a_preset'), false)
})
