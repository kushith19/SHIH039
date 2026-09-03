import { TRUST_CONFIG } from './trustConfig.js'
import { BASE_CITY_FEATURE_KEYS } from './tgnnFeatures.js'
import { TGNN_CHECKPOINT } from './tgnn_checkpoint.js'

function weight(row, col, seed) {
  const scale = seed === 1 || seed === 4 ? 0.55 : 0.22
  return Math.sin(row * 12.9898 + col * 78.233 + seed) * scale
}

function matrix(rows, cols, seed) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => weight(r, c, seed))
  )
}

function cloneMatrix(m) {
  return (m ?? []).map((row) => [...row])
}

export function matVecMul(vec, m) {
  return m.map((row) => row.reduce((acc, w, j) => acc + w * (vec[j] ?? 0), 0))
}

export function tanhVec(vec) {
  return vec.map((v) => Math.tanh(v))
}

export function neighborMean(embeddings, adj) {
  return embeddings.map((emb, i) => {
    const neighbors = adj[i]
    if (!neighbors?.length) return [...emb]
    const mean = Array(emb.length).fill(0)
    for (const j of neighbors) {
      const nb = embeddings[j]
      for (let k = 0; k < mean.length; k++) mean[k] += nb[k] ?? 0
    }
    for (let k = 0; k < mean.length; k++) mean[k] /= neighbors.length
    return mean
  })
}

export function directedPool(embeddings, adjIn, adjOut) {
  const up = neighborMean(embeddings, adjIn)
  const down = neighborMean(embeddings, adjOut)
  return embeddings.map((_, i) => [...up[i], ...down[i]])
}

function checkpointMatches(checkpoint, featureDim, embedDim, temporalWindow) {
  if (!checkpoint?.W_IN?.length) return false
  return (
    Number(checkpoint.featureDim) === featureDim &&
    Number(checkpoint.embedDim) === embedDim &&
    Number(checkpoint.temporalWindow) === temporalWindow &&
    checkpoint.W_IN.length === embedDim &&
    checkpoint.W_IN[0]?.length === featureDim
  )
}

/**
 * Encoder weights. Product path loads the trained checkpoint; sin-seed is tests / fallback.
 */
export function createTgnnParams({
  featureDim = BASE_CITY_FEATURE_KEYS.length,
  embedDim = TRUST_CONFIG.tgnn.embedDim ?? 8,
  temporalWindow = TRUST_CONFIG.tgnn.temporalWindow ?? 3,
  useSinFallback = false,
  checkpoint = TGNN_CHECKPOINT,
} = {}) {
  const msgIn = embedDim * 2
  const tempIn = embedDim * temporalWindow
  if (!useSinFallback && checkpointMatches(checkpoint, featureDim, embedDim, temporalWindow)) {
    return {
      featureDim,
      embedDim,
      temporalWindow,
      fromCheckpoint: true,
      trainedAt: checkpoint.trainedAt ?? null,
      finalLoss: checkpoint.finalLoss ?? null,
      W_IN: cloneMatrix(checkpoint.W_IN),
      W_MSG: cloneMatrix(checkpoint.W_MSG),
      W_OUT: cloneMatrix(checkpoint.W_OUT),
      W_TEMP: cloneMatrix(checkpoint.W_TEMP),
    }
  }
  return {
    featureDim,
    embedDim,
    temporalWindow,
    fromCheckpoint: false,
    trainedAt: null,
    finalLoss: null,
    W_IN: matrix(embedDim, featureDim, 1),
    W_MSG: matrix(embedDim, msgIn, 2),
    W_OUT: matrix(embedDim, msgIn, 3),
    W_TEMP: matrix(embedDim, tempIn, 4),
  }
}

export function rebuildTgnnParams(opts) {
  TGNN_PARAMS = createTgnnParams(opts)
  return TGNN_PARAMS
}

export let TGNN_PARAMS = createTgnnParams()

function spatialForward(featureRows, adjIn, adjOut, params) {
  const h0 = featureRows.map((x) => tanhVec(matVecMul(x, params.W_IN)))
  const n1 = directedPool(h0, adjIn, adjOut)
  const h1 = h0.map((h, i) =>
    tanhVec(h.map((v, k) => v + (matVecMul(n1[i], params.W_MSG)[k] ?? 0)))
  )
  const n2 = directedPool(h1, adjIn, adjOut)
  return h1.map((h, i) =>
    tanhVec(h.map((v, k) => v + (matVecMul(n2[i], params.W_OUT)[k] ?? 0)))
  )
}

function padFrames(frames, K) {
  const padded = []
  if (!Array.isArray(frames) || frames.length === 0) return padded
  const first = frames[0]
  for (let k = 0; k < K; k++) {
    padded.push(frames[k] ?? frames[frames.length - 1] ?? first)
  }
  return padded
}

/**
 * Spatial GNN on each city-graph frame, then temporal concat of embeddings.
 *
 * @param {number[][][]} frames  K × N × F
 * @param {number[][]} adjIn
 * @param {number[][]} adjOut
 * @param {ReturnType<typeof createTgnnParams>} [params]
 * @returns {number[][]} N embeddings of length embedDim
 */
export function tgnnForwardWindow(frames, adjIn, adjOut, params = TGNN_PARAMS) {
  const K = params.temporalWindow
  const padded = padFrames(frames, K)
  if (!padded.length) return []
  const spatial = padded.map((X) => spatialForward(X, adjIn, adjOut, params))
  const n = spatial[0]?.length ?? 0
  const embeddings = []
  const last = spatial[K - 1]
  for (let i = 0; i < n; i++) {
    const concat = []
    for (let k = 0; k < K; k++) concat.push(...(spatial[k][i] ?? []))
    const temporal = tanhVec(matVecMul(concat, params.W_TEMP))
    const current = last[i] ?? temporal
    embeddings.push(tanhVec(temporal.map((v, k) => v + (current[k] ?? 0))))
  }
  return embeddings
}

export function l2Distance(a, b) {
  let sum = 0
  const n = Math.max(a?.length ?? 0, b?.length ?? 0)
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    sum += d * d
  }
  return Math.sqrt(sum)
}

export function distToScore(dist, alpha = TRUST_CONFIG.tgnn.scoreAlpha) {
  return 1 / (1 + Math.exp(-alpha * dist))
}

/** Z-scored residual → [0,1]. Idle (z≈0) sits near 0, not 0.5. */
export function residualToScore(
  dist,
  sigma,
  {
    alpha = TRUST_CONFIG.tgnn.scoreAlpha,
    zOffset = TRUST_CONFIG.tgnn.scoreZOffset ?? 1.25,
    minSigma = TRUST_CONFIG.tgnn.calibratorMinSigma ?? 0.05,
  } = {}
) {
  const s = Math.max(Number(sigma) || 0, minSigma)
  const z = (Number(dist) || 0) / s
  return 1 / (1 + Math.exp(-alpha * (z - zOffset)))
}
