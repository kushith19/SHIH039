import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCityModelOverlay, CITY_CONTEXTS, contextMultiplier } from '../shared/cityContext.js'
import { loadCityModelFromDisk } from './loadCityModel.js'

test('city model YAML loads contexts and scales expected telemetry', () => {
  const model = loadCityModelFromDisk()
  assert.ok(model, 'expected overfit/city_model to load')
  assert.ok(applyCityModelOverlay(model))
  assert.deepEqual([...CITY_CONTEXTS], [
    'normal_day',
    'rush_hour',
    'night',
    'weekend',
    'heavy_rain',
    'major_event',
  ])

  const rushTransportPps = contextMultiplier('rush_hour', 'transport', 'packetsPerSecond')
  const nightCivicPps = contextMultiplier('night', 'civic', 'packetsPerSecond')
  const rainWaterPps = contextMultiplier('heavy_rain', 'weatherWater', 'packetsPerSecond')
  const rainEmergencyPps = contextMultiplier('heavy_rain', 'emergency', 'packetsPerSecond')
  const normalDefault = contextMultiplier('normal_day', 'default', 'packetsPerSecond')
  const rushHealthcare = contextMultiplier('rush_hour', 'healthcare', 'packetsPerSecond')
  const rushEnergy = contextMultiplier('rush_hour', 'energy', 'packetsPerSecond')
  const normalHealthcare = contextMultiplier('normal_day', 'healthcare', 'packetsPerSecond')
  const rushFinancePps = contextMultiplier('rush_hour', 'finance', 'packetsPerSecond')
  const nightFinancePps = contextMultiplier('night', 'finance', 'packetsPerSecond')
  const normalFinancePps = contextMultiplier('normal_day', 'finance', 'packetsPerSecond')

  assert.equal(normalDefault, 1)
  assert.ok(rushTransportPps > 1, `rush transport pps ${rushTransportPps}`)
  assert.ok(nightCivicPps < 1, `night civic pps ${nightCivicPps}`)
  assert.ok(rainWaterPps > 1, `rain water pps ${rainWaterPps}`)
  assert.ok(rainEmergencyPps > 1, `rain emergency pps ${rainEmergencyPps}`)
  assert.ok(rushEnergy > 1, `rush energy pps ${rushEnergy}`)
  assert.ok(normalFinancePps > 1, `normal finance pps ${normalFinancePps}`)
  assert.ok(rushFinancePps > normalFinancePps, `rush finance ${rushFinancePps} vs normal ${normalFinancePps}`)
  assert.ok(nightFinancePps < 1, `night finance pps ${nightFinancePps}`)
  assert.equal(
    rushHealthcare,
    normalHealthcare,
    'healthcare must not inherit rush-hour energy/default'
  )
})

test('city model YAML loads infrastructure and actors despite path aliases', () => {
  const model = loadCityModelFromDisk()
  assert.ok(model)
  assert.ok(model.endpoints['hospital-api-gateway'], 'hospital-api-gateway endpoint')
  assert.ok(model.endpoints['hospital-pharmacy'], 'pharmacy alias should load')
  assert.ok(model.endpoints['telecom-backup-gateway'], 'backup telecom stub')
  assert.ok(model.endpoints['hospital-backup-power'])
  assert.ok(model.endpoints['scada-backup-power'])
  assert.ok(model.endpoints['core-banking-backup'])
  assert.ok(Array.isArray(model.dependencies) && model.dependencies.length > 10)
  assert.ok(
    model.dependencies.some(
      (d) => d.source === 'hospital-api-gateway' && d.target === 'telecom-network-gateway'
    )
  )
  assert.ok(
    model.dependencies.some(
      (d) => d.target === 'telecom-backup-gateway' || d.source === 'telecom-backup-gateway'
    )
  )
  assert.ok(model.endpoints['traffic-camera'], 'traffic-camera endpoint')
  assert.ok(model.endpoints['traffic-management-controller'])
  const financeIds = [
    'atm-network-gateway',
    'bank-gateway',
    'core-banking-system',
    'payment-processing-system',
    'digital-banking-platform',
    'customer-identity-service',
    'card-processing-system',
    'fraud-detection-system',
    'transaction-monitoring-system',
    'interbank-payment-gateway',
    'atm-switching-system',
    'financial-data-platform',
  ]
  for (const id of financeIds) {
    assert.ok(model.endpoints[id], `finance endpoint ${id}`)
  }
  assert.ok(
    model.dependencies.some(
      (d) =>
        (d.source === 'citizen-services-portal' && d.target === 'payment-processing-system') ||
        (d.source === 'payment-processing-system' && d.target === 'citizen-services-portal')
    ),
    'citizen portal ↔ payment processing'
  )
  assert.ok(Object.keys(model.endpoints).length >= 40, `got ${Object.keys(model.endpoints).length} endpoints`)
  assert.ok(model.actors.length > 0, 'actors loaded')
  assert.ok(model.actors.some((a) => a.id === 'citizens'))
  assert.ok(model.actors.some((a) => a.interactsWith.includes('hospital-api-gateway')))
})
