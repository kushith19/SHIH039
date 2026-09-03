import { TRUST_CONFIG } from '../../shared/trustConfig.js'

const WARMUP = () => {
  const n = Number(TRUST_CONFIG.tgnn.warmupTicks)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15
}

const MIN_SIGMA = () => Number(TRUST_CONFIG.tgnn.calibratorMinSigma) || 0.05

/** @type {Map<string, ReturnType<typeof createCalibrator>>} */
const byRoom = new Map()

function createNodeStats(dim) {
  return {
    count: 0,
    mean: Array(dim).fill(0),
    m2: Array(dim).fill(0),
  }
}

export function createCalibrator() {
  return {
    collected: 0,
    ready: false,
    skippedAttackTicks: 0,
    byNodeId: new Map(),
  }
}

export function resetTgnnCalibrator(roomId) {
  const key = String(roomId ?? '')
  byRoom.set(key, createCalibrator())
  return byRoom.get(key)
}

export function getTgnnCalibrator(roomId) {
  const key = String(roomId ?? '')
  if (!byRoom.has(key)) byRoom.set(key, createCalibrator())
  return byRoom.get(key)
}

export function deleteTgnnCalibrator(roomId) {
  byRoom.delete(String(roomId ?? ''))
}

function welfordPush(stats, emb) {
  stats.count += 1
  const n = stats.count
  for (let k = 0; k < stats.mean.length; k++) {
    const x = emb[k] ?? 0
    const delta = x - stats.mean[k]
    stats.mean[k] += delta / n
    const delta2 = x - stats.mean[k]
    stats.m2[k] += delta * delta2
  }
}

function nodeSigma(stats) {
  if (stats.count < 2) return MIN_SIGMA()
  let acc = 0
  for (let k = 0; k < stats.m2.length; k++) {
    acc += stats.m2[k] / (stats.count - 1)
  }
  return Math.max(MIN_SIGMA(), Math.sqrt(acc / Math.max(1, stats.mean.length)))
}

/**
 * Ingest one tick of embeddings. Skips the whole tick if any attack override is active.
 * @returns {{ calibrating: boolean, collected: number, warmupTicks: number, skippedAttackTicks: number }}
 */
export function ingestCalibrationTick(calibrator, nodeIds, embeddings, { attackActive = false } = {}) {
  const warmupTicks = WARMUP()
  const skippedAttackTicks = calibrator?.skippedAttackTicks ?? 0
  if (!calibrator || calibrator.ready) {
    return {
      calibrating: !calibrator?.ready,
      collected: calibrator?.collected ?? 0,
      warmupTicks,
      skippedAttackTicks,
    }
  }
  if (attackActive) {
    calibrator.skippedAttackTicks += 1
    return {
      calibrating: true,
      collected: calibrator.collected,
      warmupTicks,
      skippedAttackTicks: calibrator.skippedAttackTicks,
    }
  }
  const dim = embeddings[0]?.length ?? TRUST_CONFIG.tgnn.embedDim ?? 8
  for (let i = 0; i < nodeIds.length; i++) {
    const id = nodeIds[i]
    if (!calibrator.byNodeId.has(id)) calibrator.byNodeId.set(id, createNodeStats(dim))
    welfordPush(calibrator.byNodeId.get(id), embeddings[i] ?? Array(dim).fill(0))
  }
  calibrator.collected += 1
  if (calibrator.collected >= warmupTicks) calibrator.ready = true
  return {
    calibrating: !calibrator.ready,
    collected: calibrator.collected,
    warmupTicks,
    skippedAttackTicks: calibrator.skippedAttackTicks,
  }
}

export function calibratedResidual(calibrator, nodeId, embedding) {
  const stats = calibrator?.byNodeId?.get(nodeId)
  if (!stats || stats.count < 1) {
    return { dist: 0, sigma: MIN_SIGMA(), mean: embedding ? [...embedding] : [] }
  }
  let sum = 0
  for (let k = 0; k < stats.mean.length; k++) {
    const d = (embedding[k] ?? 0) - stats.mean[k]
    sum += d * d
  }
  return { dist: Math.sqrt(sum), sigma: nodeSigma(stats), mean: stats.mean }
}
