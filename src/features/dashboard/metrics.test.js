import test from 'node:test'
import assert from 'node:assert/strict'
import {
  holdAlignedPct,
  lastValue,
  sampleTickAligned,
  samplesForMatch,
  vsExpectedPct,
} from './metrics.js'

test('samplesForMatch drops leftover ticks after the sim clock resets', () => {
  const rows = [
    { endpointId: 'a', metricKey: 'packetsPerSecond', tick: 80, value: 9000 },
    { endpointId: 'a', metricKey: 'packetsPerSecond', tick: 2, value: 100 },
    { endpointId: 'a', metricKey: 'packetsPerSecond', tick: -1, value: 1 },
  ]
  const kept = samplesForMatch(rows, 2)
  assert.deepEqual(
    kept.map((s) => s.tick),
    [2]
  )
})

test('sampleTickAligned allows a one-tick ingest lag', () => {
  assert.equal(sampleTickAligned(9, 10), true)
  assert.equal(sampleTickAligned(10, 10), true)
  assert.equal(sampleTickAligned(8, 10), false)
  assert.equal(sampleTickAligned(undefined, 10), false)
})

test('lastValue is null on an empty series so KPIs do not look like measured zero', () => {
  assert.equal(lastValue([]), null)
  assert.equal(lastValue(null), null)
  assert.equal(lastValue([{ tick: 1, value: 42 }]), 42)
})

test('holdAlignedPct keeps the last stable ratio until ticks line up', () => {
  const stale = vsExpectedPct(492, 100)
  assert.ok(stale > 300)
  assert.equal(holdAlignedPct({ aligned: false, nextPct: stale, heldPct: 1 }), 1)
  assert.equal(holdAlignedPct({ aligned: false, nextPct: stale, heldPct: null }), null)
  assert.equal(holdAlignedPct({ aligned: true, nextPct: 0.4, heldPct: 1 }), 0.4)
})
