import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCityModelOverlay } from '../../shared/cityContext.js'
import { loadCityModelFromDisk } from '../loadCityModel.js'
import {
  indexLatestByEndpoint,
  infrastructureFromSnapshot,
  liveTelemetryByNodeId,
  nodeIdsByCityEndpoint,
  samplesFromIngestedRows,
  toIngestSnapshot,
} from './ingestionClient.js'

const rows = [
  {
    endpointId: 'hospital-api-gateway',
    metricName: 'packets_per_second',
    value: 100,
    unit: 'packets/s',
    time: '2026-08-29T10:00:00.000Z',
    simulationTick: 1,
  },
  {
    endpointId: 'hospital-api-gateway',
    metricName: 'requests_per_second',
    value: 1,
    unit: 'requests/s',
    time: '2026-08-29T10:00:00.000Z',
    simulationTick: 1,
  },
  {
    endpointId: 'hospital-api-gateway',
    metricName: 'packets_per_second',
    value: 250,
    unit: 'packets/s',
    time: '2026-08-29T10:00:01.000Z',
    simulationTick: 2,
  },
]

test('indexLatestByEndpoint keeps every metric from the latest tick', () => {
  const latest = indexLatestByEndpoint([
    {
      endpointId: 'campus-network-gateway',
      metricName: 'cpu_usage',
      value: 40,
      time: '2026-08-29T10:00:00.000Z',
      simulationTick: 9,
    },
    {
      endpointId: 'campus-network-gateway',
      metricName: 'packet_loss',
      value: 2,
      time: '2026-08-29T10:00:00.400Z',
      simulationTick: 9,
    },
    {
      endpointId: 'campus-network-gateway',
      metricName: 'cpu_usage',
      value: 12,
      time: '2026-08-29T09:59:00.000Z',
      simulationTick: 8,
    },
  ])
  assert.equal(latest['campus-network-gateway'].cpu_usage, 40)
  assert.equal(latest['campus-network-gateway'].packet_loss, 2)
  assert.equal(latest['campus-network-gateway'].tick, 9)
})

test('indexLatestByEndpoint keeps the newest tick per city endpoint', () => {
  const latest = indexLatestByEndpoint(rows)
  assert.equal(latest['hospital-api-gateway'].packetsPerSecond, 250)
  assert.equal(latest['hospital-api-gateway'].tick, 2)
})

test('samplesFromIngestedRows remap city endpoint ids onto graph node ids', () => {
  const nodes = [
    {
      id: 'ep-hospital_gateway',
      data: { type: 'hospital_gateway', cityEndpointId: 'hospital-api-gateway' },
    },
  ]
  const samples = samplesFromIngestedRows(rows, nodeIdsByCityEndpoint(nodes))
  assert.ok(samples.some((s) => s.endpointId === 'ep-hospital_gateway' && s.metricKey === 'packetsPerSecond' && s.value === 250))
  assert.ok(samples.some((s) => s.endpointId === 'ep-hospital_gateway' && s.metricKey === 'requests_per_second'))
  assert.ok(samples.every((s) => s.endpointId !== 'hospital-api-gateway'))
})

test('liveTelemetryByNodeId indexes ingested metrics by graph node id', () => {
  const nodes = [
    {
      id: 'ep-hospital_gateway',
      data: { type: 'hospital_gateway', cityEndpointId: 'hospital-api-gateway' },
    },
  ]
  const byNode = liveTelemetryByNodeId(nodes, indexLatestByEndpoint(rows))
  assert.equal(byNode['ep-hospital_gateway'].packetsPerSecond, 250)
})

test('toIngestSnapshot uses city endpoint ids and ingest metric names', () => {
  const payload = toIngestSnapshot({
    timestamp: '2026-08-29T10:00:00.000Z',
    simulationTick: 7,
    endpoints: [
      {
        id: 'ep-hospital_gateway',
        cityEndpointId: 'hospital-api-gateway',
        label: 'Hospital API Gateway',
        type: 'hospital_gateway',
        telemetry: {
          packetsPerSecond: 1200,
          httpRequestsPerMin: 60,
          filesDownloaded: 3,
          failedLoginsPerMin: 2,
        },
      },
      {
        id: 'dup',
        cityEndpointId: 'hospital-api-gateway',
        label: 'Hospital API Gateway',
        type: 'hospital_gateway',
        telemetry: {
          packetsPerSecond: 999,
          httpRequestsPerMin: 12,
          filesDownloaded: 1,
          failedLoginsPerMin: 0,
        },
      },
    ],
  })
  assert.equal(payload.simulationTick, 7)
  assert.equal(payload.endpoints.length, 1)
  assert.equal(payload.endpoints[0].endpoint.id, 'hospital-api-gateway')
  const names = payload.endpoints[0].telemetry.map((m) => m.name)
  assert.deepEqual(names, [
    'packets_per_second',
    'http_requests_per_min',
    'files_downloaded',
    'failed_logins_per_min',
  ])
  assert.equal(payload.endpoints[0].telemetry[0].value, 999)
})

test('toIngestSnapshot posts native YAML metric names before game keys', () => {
  const payload = toIngestSnapshot({
    timestamp: '2026-08-29T10:00:00.000Z',
    simulationTick: 3,
    endpoints: [
      {
        cityEndpointId: 'campus-network-gateway',
        label: 'Campus',
        type: 'campus_network_gateway',
        telemetry: {
          packetsPerSecond: 10,
          httpRequestsPerMin: 20,
          filesDownloaded: 1,
          failedLoginsPerMin: 0,
        },
        yamlTelemetry: [
          { name: 'cpu_usage', value: 41, unit: 'percent' },
          { name: 'packet_loss', value: 2, unit: 'percent' },
          { name: 'requests_per_second', value: 5, unit: 'requests/s' },
        ],
      },
    ],
  })
  const names = payload.endpoints[0].telemetry.map((m) => m.name)
  assert.ok(names.includes('cpu_usage'))
  assert.ok(names.includes('packet_loss'))
  assert.ok(names.includes('requests_per_second'))
  assert.ok(!names.includes('packets_per_second') || names.indexOf('cpu_usage') < names.indexOf('packets_per_second'))
  assert.equal(
    payload.endpoints[0].telemetry.find((m) => m.name === 'packet_loss').value,
    2
  )
})

test('infrastructureFromSnapshot dedupes by city endpoint id', () => {
  const batch = infrastructureFromSnapshot(
    {
      endpoints: [
        {
          cityEndpointId: 'hospital-api-gateway',
          label: 'A',
          type: 'hospital_gateway',
          sector: 'healthcare',
          criticality: 'high',
        },
        { cityEndpointId: 'hospital-api-gateway', label: 'B', type: 'hospital_gateway' },
      ],
    },
    { endpoints: {} }
  )
  assert.equal(batch.length, 1)
  assert.equal(batch[0].id, 'hospital-api-gateway')
  assert.equal(batch[0].name, 'B')
})

test('infrastructureFromSnapshot includes every city-model endpoint', () => {
  const model = loadCityModelFromDisk()
  applyCityModelOverlay(model)
  const batch = infrastructureFromSnapshot({ endpoints: [] }, model)
  const ids = new Set(batch.map((row) => row.id))
  for (const id of Object.keys(model.endpoints)) {
    assert.ok(ids.has(id), `missing ${id}`)
  }
  assert.ok(batch.length >= 40)
})
