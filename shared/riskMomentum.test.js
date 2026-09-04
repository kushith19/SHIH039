import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RISK_WINDOW_TICKS,
  TRAJECTORY,
  appendRiskSample,
  classifyTrajectory,
  currentResidualScore,
  exposedSetCount,
  formatMomentumLine,
  formatScoreOver100,
  isPlateauAtCeiling,
  momentumFromHistory,
  peakResidualScore,
  scoreFromDetection,
  trajectoryLabel,
} from './riskMomentum.js'

test('peak residual maps to 0–100 and clamps', () => {
  assert.equal(peakResidualScore({ a: 0.781, b: 0.2 }), 78)
  assert.equal(peakResidualScore({ a: 1.4 }), 100)
  assert.equal(peakResidualScore({}), 0)
})

test('score is null while the idle-window calibrator is running', () => {
  assert.equal(
    currentResidualScore({
      tgnnCalibrating: true,
      anomalyNodeIds: ['a'],
      isolationScoresByNodeId: { a: 0.9 },
    }),
    null
  )
  assert.equal(
    scoreFromDetection({
      tgnnCalibrating: true,
      isolationScoresByNodeId: { a: 0.9 },
    }),
    null
  )
})

test('current residual ignores ungated isolation scores when no nodes are anomalous', () => {
  assert.equal(
    currentResidualScore({
      anomalyNodeIds: [],
      isolationScoresByNodeId: { 'node-a': 0.98, 'node-b': 0.04 },
    }),
    0
  )
  assert.equal(
    scoreFromDetection({
      isolationScoresByNodeId: { 'node-a': 0.98, 'node-b': 0.04 },
    }),
    0
  )
  assert.equal(peakResidualScore({ 'node-a': 0.98, 'node-b': 0.04 }), 98)
})

test('current residual is the peak among currently gated anomalous nodes', () => {
  assert.equal(
    currentResidualScore({
      anomalyNodeIds: ['node-a'],
      isolationScoresByNodeId: { 'node-a': 0.98, 'node-b': 0.04 },
    }),
    98
  )
  assert.equal(
    currentResidualScore({
      anomalyNodeIds: ['node-a', 'node-b'],
      isolationScoresByNodeId: { 'node-a': 0.7, 'node-b': 0.92, 'node-c': 0.3 },
    }),
    92
  )
})

test('contained node explainability residual does not keep Current at the ceiling', () => {
  let history = []
  const attack = {
    simulationTick: 1,
    anomalyNodeIds: ['node-a'],
    isolationScoresByNodeId: { 'node-a': 1, 'node-b': 0.04 },
  }
  history = appendRiskSample(history, {
    tick: 1,
    score: currentResidualScore(attack),
    exposedCount: 1,
  })
  const afterClear = {
    simulationTick: 2,
    anomalyNodeIds: [],
    isolationScoresByNodeId: { 'node-a': 0.95, 'node-b': 0.04 },
  }
  history = appendRiskSample(history, {
    tick: 2,
    score: currentResidualScore(afterClear),
    exposedCount: 0,
  })
  const snap = momentumFromHistory(history)
  assert.equal(snap.score, 0)
  assert.equal(Math.max(...snap.series.map((p) => p.score)), 100)
})

test('historical peak is the recent-series maximum, not the current gated residual', () => {
  const snap = momentumFromHistory([
    { tick: 1, score: 10, exposedCount: 0 },
    { tick: 2, score: 20, exposedCount: 0 },
    { tick: 3, score: 80, exposedCount: 1 },
    { tick: 4, score: 100, exposedCount: 1 },
    { tick: 5, score: 3, exposedCount: 0 },
  ])
  assert.equal(snap.score, 3)
  assert.equal(Math.max(...snap.series.map((p) => p.score)), 100)
})

test('exposed set is the unique union of anomaly, compromised, and at-risk ids', () => {
  assert.equal(
    exposedSetCount({
      anomalyNodeIds: ['a'],
      compromisedNodeIds: ['a', 'b'],
      atRiskNodeIds: ['c', 'b'],
    }),
    3
  )
})

test('trajectory classifier: rising, escalating, critical, stable falling', () => {
  assert.equal(classifyTrajectory({ score: 50, delta: 5, exposedDelta: 0 }), TRAJECTORY.RISING)
  assert.equal(classifyTrajectory({ score: 50, delta: 15, exposedDelta: 0 }), TRAJECTORY.ESCALATING)
  assert.equal(classifyTrajectory({ score: 80, delta: 12, exposedDelta: 0 }), TRAJECTORY.CRITICAL)
  assert.equal(classifyTrajectory({ score: 80, delta: 0, exposedDelta: 0 }), TRAJECTORY.CRITICAL)
  assert.equal(classifyTrajectory({ score: 75, delta: 3, exposedDelta: 2 }), TRAJECTORY.CRITICAL)
  assert.equal(classifyTrajectory({ score: 78, delta: -15, exposedDelta: 0 }), TRAJECTORY.STABLE)
  assert.equal(classifyTrajectory({ score: 80, delta: null }), TRAJECTORY.STABLE)
})

function scoredHistory(fromTick, count, scoreAt) {
  const rows = []
  for (let i = 0; i < count; i += 1) {
    const tick = fromTick + i
    rows.push({
      tick,
      score: scoreAt(tick, i),
      exposedCount: 1,
    })
  }
  return rows
}

test('momentum is null until a scored sample exists at t-k', () => {
  const short = scoredHistory(16, 9, () => 40)
  const early = momentumFromHistory(short)
  assert.equal(early.delta, null)
  assert.equal(early.trajectory, TRAJECTORY.STABLE)
  assert.equal(early.available, true)

  const full = scoredHistory(16, RISK_WINDOW_TICKS + 1, (_t, i) => 40 + i)
  const later = momentumFromHistory(full)
  assert.equal(later.score, 50)
  assert.equal(later.delta, 10)
  assert.equal(later.trajectory, TRAJECTORY.RISING)
})

test('calibrating samples do not fake a zero delta', () => {
  const history = []
  for (let t = 1; t <= 15; t += 1) history.push({ tick: t, score: null, exposedCount: 0 })
  for (let t = 16; t <= 20; t += 1) history.push({ tick: t, score: 55, exposedCount: 1 })
  const snap = momentumFromHistory(history)
  assert.equal(snap.score, 55)
  assert.equal(snap.delta, null)
  assert.equal(snap.available, true)
})

test('10-tick delta and CRITICAL via exposure growth', () => {
  const history = scoredHistory(1, RISK_WINDOW_TICKS + 1, (tick) => (tick === 11 ? 75 : 72))
  history[0].exposedCount = 1
  history[history.length - 1].exposedCount = 4
  const snap = momentumFromHistory(history)
  assert.equal(snap.delta, 3)
  assert.equal(snap.trajectory, TRAJECTORY.CRITICAL)
})

test('high residual plateau stays critical when the 10-tick delta flattens', () => {
  const history = scoredHistory(1, RISK_WINDOW_TICKS + 1, () => 80)
  const snap = momentumFromHistory(history)
  assert.equal(snap.score, 80)
  assert.equal(snap.delta, 0)
  assert.equal(snap.trajectory, TRAJECTORY.CRITICAL)
})

test('appendRiskSample caps the ring', () => {
  let hist = []
  for (let i = 0; i < 45; i += 1) hist = appendRiskSample(hist, { tick: i, score: 1 }, 40)
  assert.equal(hist.length, 40)
  assert.equal(hist[0].tick, 5)
})

test('copy helpers', () => {
  assert.equal(formatScoreOver100(78), '78 / 100')
  assert.equal(formatScoreOver100(null), '— / 100')
  assert.equal(formatMomentumLine(23), '↑ +23 in last 10 sec')
  assert.equal(formatMomentumLine(-12), '↓ -12 in last 10 sec')
  assert.equal(formatMomentumLine(null), '—')
  assert.equal(trajectoryLabel('escalating'), 'ESCALATING')
})

test('plateau at residual ceiling is score 100 with near-zero momentum', () => {
  assert.equal(
    isPlateauAtCeiling({ available: true, score: 100, delta: 0 }),
    true
  )
  assert.equal(
    isPlateauAtCeiling({ available: true, score: 100, delta: 12 }),
    false
  )
  assert.equal(isPlateauAtCeiling({ available: true, score: 80, delta: 0 }), false)
})
