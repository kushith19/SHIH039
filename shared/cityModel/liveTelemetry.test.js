import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCityModelOverlay,
  contextMultiplier,
  endpointFamily,
  expectedTelemetry,
} from '../cityContext.js'
import { loadCityModelFromDisk } from '../../server/loadCityModel.js'
import { catalogTypeForYaml, resolveCityEndpoint, yamlIdForCatalogType } from './endpointMap.js'
import { LIVE_CITY_GRAPH_TYPES } from './liveGraphTypes.js'
import { sampleEndpointTelemetry, jitterFactor, telemetryFromIngestedReadings, sampleEndpointYamlTelemetry, actorLoadForEndpoint, operationalStateName } from './liveTelemetry.js'
import { inspectorMetricKeys } from '../telemetryKeys.js'
import { buildCitySnapshot, overlaySnapshotFromIngested } from '../../server/telemetry/citySnapshot.js'
import { hasTelemetryDrift } from '../../server/detection/features.js'

const BASELINE = {
  packetsPerSecond: 16_000,
  httpRequestsPerMin: 70,
  filesDownloaded: 2,
  failedLoginsPerMin: 1,
}

function sample(args) {
  return sampleEndpointTelemetry({
    contextMultiplier,
    endpointFamily,
    ...args,
  })
}

test('catalog types resolve to city-model endpoints', () => {
  const model = loadCityModelFromDisk()
  assert.ok(model)
  const traffic = resolveCityEndpoint({ type: 'traffic_management', id: 'ep-traffic_management' }, model.endpoints)
  assert.equal(traffic?.id, 'traffic-management-controller')
  const hospital = resolveCityEndpoint({ type: 'hospital_gateway' }, model.endpoints)
  assert.equal(hospital?.id, 'hospital-api-gateway')
  const unknown = resolveCityEndpoint({ type: 'street_lighting', id: 'ep-street_lighting' }, model.endpoints)
  assert.equal(unknown, null)
  const digitalBanking = resolveCityEndpoint({ type: 'digital_banking_platform' }, model.endpoints)
  assert.equal(digitalBanking?.id, 'digital-banking-platform')
  const bankGw = resolveCityEndpoint({ type: 'bank_gateway' }, model.endpoints)
  assert.equal(bankGw?.id, 'bank-gateway')
  assert.equal(catalogTypeForYaml('digital-banking-platform'), 'digital_banking_platform')
  assert.equal(catalogTypeForYaml('bank-gateway'), 'bank_gateway')
  assert.equal(catalogTypeForYaml('payment-processing-system'), 'payment_processing_system')
  assert.equal(catalogTypeForYaml('atm-network-gateway'), 'atm_network_gateway')
})

test('live city graph is ~40 YAML-backed endpoints', () => {
  const model = loadCityModelFromDisk()
  assert.equal(LIVE_CITY_GRAPH_TYPES.length, 40)
  const yamlIds = new Set()
  for (const type of LIVE_CITY_GRAPH_TYPES) {
    const id = yamlIdForCatalogType(type)
    assert.ok(id, `missing yaml map for ${type}`)
    assert.ok(model.endpoints[id], `missing city-model endpoint ${id} for ${type}`)
    yamlIds.add(id)
  }
  assert.equal(yamlIds.size, LIVE_CITY_GRAPH_TYPES.length)
})

test('live sampler: jitter changes observed, expected is stable, values stay in range', () => {
  const model = loadCityModelFromDisk()
  applyCityModelOverlay(model)
  const meta = {
    id: 'ep-traffic_management',
    type: 'traffic_management',
    sector: 'Transportation',
  }
  const expectedA = sample({
    baseline: BASELINE,
    context: 'rush_hour',
    meta,
    tick: 1,
    jitter: false,
    simHour: 9,
    model,
  })
  const expectedB = sample({
    baseline: BASELINE,
    context: 'rush_hour',
    meta,
    tick: 2,
    jitter: false,
    simHour: 9,
    model,
  })
  assert.deepEqual(expectedA, expectedB)

  const obs1 = sample({
    baseline: BASELINE,
    context: 'rush_hour',
    meta,
    tick: 1,
    jitter: true,
    simHour: 9,
    model,
  })
  const obs2 = sample({
    baseline: BASELINE,
    context: 'rush_hour',
    meta,
    tick: 2,
    jitter: true,
    simHour: 9,
    model,
  })
  assert.notDeepEqual(obs1, obs2)

  const yaml = model.endpoints['traffic-management-controller']
  for (const key of Object.keys(BASELINE)) {
    assert.ok(obs1[key] >= 0)
    assert.ok(obs2[key] >= 0)
    assert.ok(expectedA[key] >= 0)
  }
  assert.ok(yaml.metrics.length > 0)
})

test('rush hour expected load exceeds night on the same transport endpoint', () => {
  const model = loadCityModelFromDisk()
  applyCityModelOverlay(model)
  const meta = {
    type: 'traffic_management',
    sector: 'Transportation',
    id: 'ep-traffic_management',
  }
  const rush = expectedTelemetry(BASELINE, 'rush_hour', { ...meta, tick: 8, simHour: 9 })
  const night = expectedTelemetry(BASELINE, 'night', { ...meta, tick: 40, simHour: 2 })
  assert.ok(
    rush.packetsPerSecond > night.packetsPerSecond,
    `rush ${rush.packetsPerSecond} vs night ${night.packetsPerSecond}`
  )
})

test('unmapped catalog nodes still emit four metrics with jitter', () => {
  const model = loadCityModelFromDisk()
  applyCityModelOverlay(model)
  const meta = { id: 'ep-street_lighting', type: 'street_lighting', sector: 'Urban Infrastructure' }
  const expected = sample({
    baseline: BASELINE,
    context: 'normal_day',
    meta,
    tick: 1,
    jitter: false,
    model,
  })
  const a = sample({
    baseline: BASELINE,
    context: 'normal_day',
    meta,
    tick: 1,
    jitter: true,
    model,
  })
  const b = sample({
    baseline: BASELINE,
    context: 'normal_day',
    meta,
    tick: 2,
    jitter: true,
    model,
  })
  assert.equal(Object.keys(expected).length, 4)
  assert.ok(expected.packetsPerSecond > 0)
  assert.deepEqual(
    sample({
      baseline: BASELINE,
      context: 'normal_day',
      meta,
      tick: 9,
      jitter: false,
      model,
    }),
    expected
  )
  assert.notDeepEqual(a, b)
})

test('YAML min/max clamp same-name yaml metrics', () => {
  const model = loadCityModelFromDisk()
  const tight = {
    ...model,
    endpoints: {
      ...model.endpoints,
      'clamp-test': {
        id: 'clamp-test',
        behaviour: { peak: { networkActivity: 'very_high', expectedUsers: 'very_high' } },
        metrics: [{ name: 'requests_per_second', unit: 'requests/s', min: 0, max: 2 }],
        operatingSchedule: { defaultPhase: '24x7', phases: [] },
      },
    },
  }
  const out = sample({
    baseline: BASELINE,
    context: 'rush_hour',
    meta: { cityEndpointId: 'clamp-test', type: 'hospital_gateway' },
    tick: 3,
    jitter: true,
    simHour: 9,
    model: tight,
  })
  assert.ok(out.requests_per_second <= 2 + 1e-6, `rps ${out.requests_per_second}`)
})

test('city snapshot telemetry changes across ticks', () => {
  const model = loadCityModelFromDisk()
  applyCityModelOverlay(model)
  const node = {
    id: 'ep-traffic_management',
    data: {
      type: 'traffic_management',
      sector: 'Transportation',
      label: 'Traffic',
      telemetry: BASELINE,
    },
  }
  const roomA = {
    id: 'r1',
    phase: 'playing',
    simulationTick: 4,
    nodes: [node],
    edges: [{ id: 'e1', source: 'a', target: 'b', data: { packetsPerSecond: 1000 } }],
    hackSimulator: { active: true },
  }
  const a = buildCitySnapshot(roomA)
  const b = buildCitySnapshot({ ...roomA, simulationTick: 5 })
  assert.equal(a.endpoints[0].expectedTelemetry.packetsPerSecond, b.endpoints[0].expectedTelemetry.packetsPerSecond)
  assert.notEqual(a.endpoints[0].telemetry.packetsPerSecond, b.endpoints[0].telemetry.packetsPerSecond)
  assert.notEqual(a.dependencies[0].packetsPerSecond, b.dependencies[0].packetsPerSecond)
  assert.ok(a.endpoints.some((ep) => ep.cityEndpointId === 'water-treatment-control'))
  const traffic = a.endpoints.find((ep) => ep.cityEndpointId === 'traffic-management-controller')
  assert.ok(traffic.telemetry.cpu_usage > 0)
  assert.ok(a.endpoints.some((ep) => Number(ep.telemetry?.water_flow_rate) > 0))
  assert.equal(
    hasTelemetryDrift(a.endpoints[0].expectedTelemetry, a.endpoints[0].telemetry),
    false,
    'healthy jitter must not count as drift'
  )
})

test('overlaySnapshotFromIngested uses GET metrics and leaves expected unchanged', () => {
  const produced = {
    simulationTick: 4,
    endpoints: [
      {
        id: 'ep-traffic_management',
        cityEndpointId: 'traffic-management-controller',
        telemetry: { packetsPerSecond: 100, httpRequestsPerMin: 1, filesDownloaded: 1, failedLoginsPerMin: 1 },
        expectedTelemetry: {
          packetsPerSecond: 16_000,
          httpRequestsPerMin: 70,
          filesDownloaded: 2,
          failedLoginsPerMin: 1,
        },
      },
    ],
    dependencies: [{ id: 'e1', packetsPerSecond: 50 }],
  }
  const overlaid = overlaySnapshotFromIngested(produced, {
    'traffic-management-controller': { packetsPerSecond: 42_000, httpRequestsPerMin: 11 },
  })
  assert.equal(overlaid.endpoints[0].telemetry.packetsPerSecond, 42_000)
  assert.equal(overlaid.endpoints[0].telemetry.httpRequestsPerMin, 11)
  assert.equal(overlaid.endpoints[0].expectedTelemetry.packetsPerSecond, 16_000)
  assert.equal(overlaid.dependencies[0].packetsPerSecond, 50)
})

test('overlay ignores ingest from a different simulation tick', () => {
  const produced = {
    simulationTick: 8,
    endpoints: [
      {
        id: 'n1',
        cityEndpointId: 'traffic-management-controller',
        telemetry: {
          packetsPerSecond: 16_100,
          httpRequestsPerMin: 70,
          filesDownloaded: 2,
          failedLoginsPerMin: 1,
          cpu_usage: 41,
        },
        expectedTelemetry: {
          packetsPerSecond: 16_000,
          httpRequestsPerMin: 70,
          filesDownloaded: 2,
          failedLoginsPerMin: 1,
          cpu_usage: 40,
        },
      },
    ],
  }
  const overlaid = overlaySnapshotFromIngested(produced, {
    'traffic-management-controller': {
      tick: 2,
      packetsPerSecond: 99_000,
      cpu_usage: 9,
    },
  })
  assert.equal(overlaid.endpoints[0].telemetry.packetsPerSecond, 16_100)
  assert.equal(overlaid.endpoints[0].telemetry.cpu_usage, 41)
  assert.equal(
    hasTelemetryDrift(overlaid.endpoints[0].expectedTelemetry, overlaid.endpoints[0].telemetry),
    false
  )
})

test('inspector lists only keys present on the selected node', () => {
  applyCityModelOverlay(loadCityModelFromDisk())
  const keys = inspectorMetricKeys(
    { packetsPerSecond: 1, httpRequestsPerMin: 1, filesDownloaded: 1, failedLoginsPerMin: 1, cpu_usage: 40 },
    { packetsPerSecond: 1, httpRequestsPerMin: 1, filesDownloaded: 1, failedLoginsPerMin: 1, cpu_usage: 41 }
  )
  assert.ok(keys.includes('cpu_usage'))
  assert.ok(keys.includes('packetsPerSecond'))
  assert.ok(!keys.includes('active_leases'))
  assert.ok(!keys.includes('water_flow_rate'))
})

test('healthy jitter stays inside ±1.5% and is not treated as drift', () => {
  for (let tick = 0; tick < 40; tick += 1) {
    const f = jitterFactor(tick, 'ep-traffic_management', 'packetsPerSecond')
    assert.ok(f >= 0.985 && f <= 1.015, `jitter ${f} at tick ${tick}`)
  }
  const expected = {
    packetsPerSecond: 16_000,
    httpRequestsPerMin: 70,
    filesDownloaded: 2,
    failedLoginsPerMin: 1,
  }
  const observed = {
    packetsPerSecond: 16_000 * 1.015,
    httpRequestsPerMin: 70 * 0.985,
    filesDownloaded: 2,
    failedLoginsPerMin: 1,
  }
  assert.equal(hasTelemetryDrift(expected, observed), false)
  assert.equal(
    hasTelemetryDrift(expected, { ...observed, packetsPerSecond: 16_000 * 1.5 }),
    true
  )
})

test('failed_authentication_attempts stays on its yaml name', () => {
  const model = loadCityModelFromDisk()
  applyCityModelOverlay(model)
  const auth = model.endpoints['hospital-auth']
  assert.ok(auth)
  const out = sample({
    baseline: BASELINE,
    context: 'normal_day',
    meta: { cityEndpointId: 'hospital-auth', type: 'hospital_auth', sector: 'Healthcare' },
    tick: 1,
    jitter: false,
    simHour: 10,
    model,
  })
  const metric = auth.metrics.find((m) => m.name === 'failed_authentication_attempts')
  assert.ok(metric)
  assert.ok(out.failed_authentication_attempts > 0)
  assert.ok(out.failed_authentication_attempts <= metric.max + 1e-6)
  assert.notEqual(out.failedLoginsPerMin, out.failed_authentication_attempts)
})

test('yaml packets_per_second is the expected PPS for government gateway', () => {
  const model = loadCityModelFromDisk()
  applyCityModelOverlay(model)
  const expected = expectedTelemetry(
    {
      packetsPerSecond: 17_000,
      httpRequestsPerMin: 150,
      filesDownloaded: 5,
      failedLoginsPerMin: 3,
    },
    'normal_day',
    {
      type: 'government_services',
      cityEndpointId: 'government-network-gateway',
      sector: 'government',
      tick: 1,
      simHour: 10,
    }
  )
  assert.ok(expected.packets_per_second > 100_000, `yaml pps ${expected.packets_per_second}`)
  assert.equal(expected.packetsPerSecond, expected.packets_per_second)
})

test('ingested readings keep yaml names and fill camelCase from game ingest names', () => {
  const mapped = telemetryFromIngestedReadings([
    { metricName: 'packets_per_second', value: 1200, unit: 'packets/s' },
    { name: 'http_requests_per_min', value: 90, unit: 'requests/min' },
    { name: 'files_downloaded', value: 4, unit: 'files' },
    { name: 'failed_logins_per_min', value: 3, unit: 'attempts/min' },
    { name: 'temperature', value: 21, unit: 'C' },
  ])
  assert.equal(mapped.packetsPerSecond, 1200)
  assert.equal(mapped.packets_per_second, 1200)
  assert.equal(mapped.httpRequestsPerMin, 90)
  assert.equal(mapped.filesDownloaded, 4)
  assert.equal(mapped.failedLoginsPerMin, 3)
  assert.equal(mapped.temperature, 21)
})

test('packet_loss and requests_per_second are not aliased onto game keys', () => {
  const model = loadCityModelFromDisk()
  applyCityModelOverlay(model)
  const mapped = telemetryFromIngestedReadings([
    { name: 'packet_loss', value: 88, unit: 'percent' },
    { name: 'requests_per_second', value: 2, unit: 'requests/s' },
    { name: 'incoming_bandwidth', value: 500, unit: 'bytes/s' },
    { name: 'files_downloaded', value: 9, unit: 'files' },
  ])
  assert.equal(mapped.packetsPerSecond, undefined)
  assert.equal(mapped.httpRequestsPerMin, undefined)
  assert.equal(mapped.packet_loss, 88)
  assert.equal(mapped.requests_per_second, 2)
  assert.equal(mapped.incoming_bandwidth, 500)
  assert.equal(mapped.filesDownloaded, 9)
  assert.equal(mapped.files_downloaded, 9)
  const campus = sample({
    baseline: BASELINE,
    context: 'normal_day',
    meta: { cityEndpointId: 'campus-network-gateway', type: 'campus_network', sector: 'Education' },
    tick: 1,
    jitter: false,
    simHour: 10,
    model,
  })
  const loss = model.endpoints['campus-network-gateway'].metrics.find((m) => m.name === 'packet_loss')
  assert.ok(loss)
  assert.ok(campus.packetsPerSecond > loss.max)
  assert.ok(campus.packet_loss != null)
  assert.ok(campus.packet_loss <= loss.max + 1e-6)
})

test('endpoint actor list changes yaml load', () => {
  const actors = [{ id: 'citizens', interactsWith: [], activity: { normal_day: 'high' } }]
  const baseEp = {
    id: 'actor-ep',
    behaviour: {
      normal: {
        networkActivity: 'moderate',
        expectedUsers: 'moderate',
        activityLevel: 'moderate',
        workload: 'moderate',
      },
    },
    metrics: [{ name: 'cpu_usage', unit: 'percent', min: 0, max: 100 }],
    states: {},
    operatingSchedule: { defaultPhase: '24x7', phases: [] },
  }
  const quiet = actorLoadForEndpoint('actor-ep', actors, 'normal_day', [])
  const busy = actorLoadForEndpoint('actor-ep', actors, 'normal_day', ['citizens'])
  assert.equal(quiet, 1)
  assert.ok(busy > quiet)
  const yamlQuiet = sampleEndpointYamlTelemetry({
    baseline: BASELINE,
    context: 'normal_day',
    meta: { cityEndpointId: 'actor-ep' },
    model: { endpoints: { 'actor-ep': { ...baseEp, actors: [] } }, actors },
    contextMultiplier,
    endpointFamily,
  })
  const yamlBusy = sampleEndpointYamlTelemetry({
    baseline: BASELINE,
    context: 'normal_day',
    meta: { cityEndpointId: 'actor-ep' },
    model: { endpoints: { 'actor-ep': { ...baseEp, actors: ['citizens'] } }, actors },
    contextMultiplier,
    endpointFamily,
  })
  const cpuQ = yamlQuiet.find((m) => m.name === 'cpu_usage').value
  const cpuB = yamlBusy.find((m) => m.name === 'cpu_usage').value
  assert.ok(cpuB > cpuQ)
})

test('attack override uses under_attack state for higher yaml load', () => {
  const endpoint = {
    id: 'atk-ep',
    behaviour: {
      normal: {
        networkActivity: 'moderate',
        expectedUsers: 'moderate',
        activityLevel: 'moderate',
        workload: 'moderate',
      },
    },
    metrics: [{ name: 'cpu_usage', unit: 'percent', min: 0, max: 100 }],
    actors: [],
    operatingSchedule: { defaultPhase: '24x7', phases: [] },
    states: {
      healthy: { networkActivity: 'moderate', workload: 'moderate' },
      under_attack: { networkActivity: 'very_high', workload: 'heavy', administrativeActivity: 'very_high' },
    },
  }
  assert.equal(operationalStateName(endpoint, {}, 'normal'), 'healthy')
  assert.equal(operationalStateName(endpoint, { attackOverrideActive: true }, 'normal'), 'under_attack')
  const args = {
    baseline: BASELINE,
    context: 'normal_day',
    meta: { cityEndpointId: 'atk-ep' },
    model: { endpoints: { 'atk-ep': endpoint }, actors: [] },
    contextMultiplier,
    endpointFamily,
  }
  const healthy = sampleEndpointYamlTelemetry(args).find((m) => m.name === 'cpu_usage').value
  const attacked = sampleEndpointYamlTelemetry({
    ...args,
    meta: { cityEndpointId: 'atk-ep', attackOverrideActive: true },
  }).find((m) => m.name === 'cpu_usage').value
  assert.ok(attacked > healthy)
})

test('incoming_bandwidth does not rewrite filesDownloaded', () => {
  const mapped = telemetryFromIngestedReadings([
    { name: 'incoming_bandwidth', value: 800, unit: 'bytes/s' },
    { name: 'files_downloaded', value: 3, unit: 'files' },
  ])
  assert.equal(mapped.incoming_bandwidth, 800)
  assert.equal(mapped.filesDownloaded, 3)
  const overlaid = overlaySnapshotFromIngested(
    {
      endpoints: [
        {
          id: 'n1',
          cityEndpointId: 'campus-network-gateway',
          telemetry: {
            packetsPerSecond: 10,
            httpRequestsPerMin: 1,
            filesDownloaded: 2,
            failedLoginsPerMin: 0,
            incoming_bandwidth: 100,
          },
          expectedTelemetry: {
            packetsPerSecond: 10,
            httpRequestsPerMin: 1,
            filesDownloaded: 2,
            failedLoginsPerMin: 0,
            incoming_bandwidth: 100,
          },
        },
      ],
    },
    {
      'campus-network-gateway': {
        incoming_bandwidth: 800,
        files_downloaded: 3,
        filesDownloaded: 3,
      },
    }
  )
  assert.equal(overlaid.endpoints[0].telemetry.incoming_bandwidth, 800)
  assert.equal(overlaid.endpoints[0].telemetry.filesDownloaded, 3)
})

test('±1.5% yaml jitter is not drift; large cpu_usage is', () => {
  const expected = {
    packetsPerSecond: 16_000,
    httpRequestsPerMin: 70,
    filesDownloaded: 2,
    failedLoginsPerMin: 1,
    cpu_usage: 40,
  }
  const jittered = {
    ...expected,
    cpu_usage: 40 * 1.015,
    packetsPerSecond: 16_000 * 0.985,
  }
  assert.equal(hasTelemetryDrift(expected, jittered), false)
  assert.equal(hasTelemetryDrift(expected, { ...expected, cpu_usage: 80 }), true)
})
