import assert from 'node:assert/strict'
import test from 'node:test'
import '../shared/tgnnCore.js'
import { applyCityModelOverlay } from './cityContext.js'
import { loadCityModelFromDisk } from '../server/loadCityModel.js'
import { getYamlMetricNames } from './telemetryKeys.js'
import { BASE_CITY_FEATURE_KEYS, CITY_FEATURE_KEYS } from './tgnnFeatures.js'
import { TGNN_PARAMS } from './tgnnCore.js'
import { buildCitySnapshot } from '../server/telemetry/citySnapshot.js'
import { adaptCitySnapshot } from '../server/detection/adapter.js'
import { runTgnnAnomaly } from '../server/detection/tgnn.js'
import { createCalibrator } from '../server/detection/calibrator.js'

test('CITY_FEATURE_KEYS stays frozen at relational encoder channels', () => {
  const model = loadCityModelFromDisk()
  assert.ok(applyCityModelOverlay(model))
  const yamlNames = getYamlMetricNames()
  assert.ok(yamlNames.length > 0)
  assert.equal(CITY_FEATURE_KEYS.length, BASE_CITY_FEATURE_KEYS.length)
  assert.equal(TGNN_PARAMS.featureDim, BASE_CITY_FEATURE_KEYS.length)
  assert.equal(TGNN_PARAMS.W_IN[0].length, BASE_CITY_FEATURE_KEYS.length)
})

test('runTgnnAnomaly on a healthy snapshot returns no graph anomalies', () => {
  const model = loadCityModelFromDisk()
  assert.ok(applyCityModelOverlay(model))
  const node = {
    id: 'ep-traffic_management',
    data: {
      type: 'traffic_management',
      sector: 'Transportation',
      label: 'Traffic',
      telemetry: {
        packetsPerSecond: 16_000,
        httpRequestsPerMin: 70,
        filesDownloaded: 2,
        failedLoginsPerMin: 1,
      },
    },
  }
  const snapshot = buildCitySnapshot({
    id: 'r1',
    phase: 'playing',
    simulationTick: 4,
    nodes: [node],
    edges: [{ id: 'e1', source: 'ep-traffic_management', target: 'ep-traffic_management', data: { packetsPerSecond: 1000 } }],
    hackSimulator: { active: true },
  })
  const input = adaptCitySnapshot(snapshot)
  const result = runTgnnAnomaly(input, { calibrator: createCalibrator() })
  assert.deepEqual(result.anomalyNodeIds, [])
})
