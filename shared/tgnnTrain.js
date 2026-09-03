import { TRUST_CONFIG } from './trustConfig.js'
import { BASE_CITY_FEATURE_KEYS, directedAdjacency, extractCityFeatureFrame } from './tgnnFeatures.js'
import { expectedTelemetry } from './cityContext.js'
import {
  createTgnnParams,
  directedPool,
  matVecMul,
  tanhVec,
  l2Distance,
} from './tgnnCore.js'

function zerosLike(m) {
  return m.map((row) => row.map(() => 0))
}

function cloneMatrix(m) {
  return m.map((row) => [...row])
}

function cloneParams(params) {
  return {
    featureDim: params.featureDim,
    embedDim: params.embedDim,
    temporalWindow: params.temporalWindow,
    fromCheckpoint: false,
    W_IN: cloneMatrix(params.W_IN),
    W_MSG: cloneMatrix(params.W_MSG),
    W_OUT: cloneMatrix(params.W_OUT),
    W_TEMP: cloneMatrix(params.W_TEMP),
  }
}

function emptyGrads(params) {
  return {
    W_IN: zerosLike(params.W_IN),
    W_MSG: zerosLike(params.W_MSG),
    W_OUT: zerosLike(params.W_OUT),
    W_TEMP: zerosLike(params.W_TEMP),
  }
}

function tanhBackward(y, dY) {
  return y.map((v, i) => (1 - v * v) * (dY[i] ?? 0))
}

function addInPlace(a, b) {
  for (let i = 0; i < a.length; i++) a[i] += b[i] ?? 0
  return a
}

function matVecMulBackward(dY, vec, m, dM, dVec) {
  for (let r = 0; r < m.length; r++) {
    const dy = dY[r] ?? 0
    const row = m[r]
    for (let c = 0; c < row.length; c++) {
      dM[r][c] += dy * (vec[c] ?? 0)
      if (dVec) dVec[c] += dy * row[c]
    }
  }
}

function neighborMeanBackward(dOut, embeddings, adj) {
  const dim = embeddings[0]?.length ?? 0
  const dEmb = embeddings.map(() => Array(dim).fill(0))
  for (let i = 0; i < embeddings.length; i++) {
    const neighbors = adj[i]
    const d = dOut[i]
    if (!neighbors?.length) {
      addInPlace(dEmb[i], d)
      continue
    }
    const inv = 1 / neighbors.length
    for (const j of neighbors) {
      for (let k = 0; k < dim; k++) dEmb[j][k] += (d[k] ?? 0) * inv
    }
  }
  return dEmb
}

function directedPoolBackward(dPool, embeddings, adjIn, adjOut) {
  const dim = embeddings[0]?.length ?? 0
  const dUp = dPool.map((row) => row.slice(0, dim))
  const dDown = dPool.map((row) => row.slice(dim))
  const dEmb = embeddings.map(() => Array(dim).fill(0))
  const fromUp = neighborMeanBackward(dUp, embeddings, adjIn)
  const fromDown = neighborMeanBackward(dDown, embeddings, adjOut)
  for (let i = 0; i < dEmb.length; i++) {
    addInPlace(dEmb[i], fromUp[i])
    addInPlace(dEmb[i], fromDown[i])
  }
  return dEmb
}

function spatialForwardTape(featureRows, adjIn, adjOut, params) {
  const h0pre = featureRows.map((x) => matVecMul(x, params.W_IN))
  const h0 = h0pre.map(tanhVec)
  const n1 = directedPool(h0, adjIn, adjOut)
  const msg1 = n1.map((v) => matVecMul(v, params.W_MSG))
  const h1pre = h0.map((h, i) => h.map((v, k) => v + (msg1[i][k] ?? 0)))
  const h1 = h1pre.map(tanhVec)
  const n2 = directedPool(h1, adjIn, adjOut)
  const msg2 = n2.map((v) => matVecMul(v, params.W_OUT))
  const h2pre = h1.map((h, i) => h.map((v, k) => v + (msg2[i][k] ?? 0)))
  const h2 = h2pre.map(tanhVec)

  function backward(dH2, grads) {
    const n = h2.length
    const dH1 = h1.map((h) => Array(h.length).fill(0))
    const dH0 = h0.map((h) => Array(h.length).fill(0))
    const dN2 = n2.map((v) => Array(v.length).fill(0))
    const dN1 = n1.map((v) => Array(v.length).fill(0))

    for (let i = 0; i < n; i++) {
      const dPre = tanhBackward(h2[i], dH2[i])
      addInPlace(dH1[i], dPre)
      matVecMulBackward(dPre, n2[i], params.W_OUT, grads.W_OUT, dN2[i])
    }
    const dH1FromPool = directedPoolBackward(dN2, h1, adjIn, adjOut)
    for (let i = 0; i < n; i++) addInPlace(dH1[i], dH1FromPool[i])

    for (let i = 0; i < n; i++) {
      const dPre = tanhBackward(h1[i], dH1[i])
      addInPlace(dH0[i], dPre)
      matVecMulBackward(dPre, n1[i], params.W_MSG, grads.W_MSG, dN1[i])
    }
    const dH0FromPool = directedPoolBackward(dN1, h0, adjIn, adjOut)
    for (let i = 0; i < n; i++) addInPlace(dH0[i], dH0FromPool[i])

    for (let i = 0; i < n; i++) {
      const dPre = tanhBackward(h0[i], dH0[i])
      matVecMulBackward(dPre, featureRows[i], params.W_IN, grads.W_IN, null)
    }
  }

  return { h2, backward }
}

/**
 * Differentiable TGNN forward. `tape.backward(dEmb, grads)` accumulates dW.
 */
export function tgnnForwardWindowTape(frames, adjIn, adjOut, params) {
  const K = params.temporalWindow
  const padded = []
  if (!Array.isArray(frames) || frames.length === 0) {
    return { embeddings: [], backward() {} }
  }
  const first = frames[0]
  for (let k = 0; k < K; k++) padded.push(frames[k] ?? frames[frames.length - 1] ?? first)

  const spatialTapes = padded.map((X) => spatialForwardTape(X, adjIn, adjOut, params))
  const spatial = spatialTapes.map((t) => t.h2)
  const n = spatial[0]?.length ?? 0
  const last = spatial[K - 1]
  const concats = []
  const temporals = []
  const embeddings = []

  for (let i = 0; i < n; i++) {
    const concat = []
    for (let k = 0; k < K; k++) concat.push(...(spatial[k][i] ?? []))
    concats.push(concat)
    const temporal = tanhVec(matVecMul(concat, params.W_TEMP))
    temporals.push(temporal)
    const current = last[i] ?? temporal
    embeddings.push(tanhVec(temporal.map((v, k) => v + (current[k] ?? 0))))
  }

  function backward(dEmb, grads) {
    const dim = params.embedDim
    const dSpatial = spatial.map((nodes) => nodes.map((h) => Array(h.length).fill(0)))
    for (let i = 0; i < n; i++) {
      const out = embeddings[i]
      const dOut = tanhBackward(out, dEmb[i] ?? Array(dim).fill(0))
      const dTempPre = tanhBackward(temporals[i], dOut)
      addInPlace(dSpatial[K - 1][i], dOut)
      const dConcat = Array(concats[i].length).fill(0)
      matVecMulBackward(dTempPre, concats[i], params.W_TEMP, grads.W_TEMP, dConcat)
      for (let k = 0; k < K; k++) {
        const slice = dConcat.slice(k * dim, (k + 1) * dim)
        addInPlace(dSpatial[k][i], slice)
      }
    }
    for (let k = 0; k < K; k++) spatialTapes[k].backward(dSpatial[k], grads)
  }

  return { embeddings, backward }
}

function mul(tel, scale) {
  const out = { ...tel }
  for (const [k, v] of Object.entries(out)) {
    const n = Number(v)
    if (Number.isFinite(n)) out[k] = Math.max(0, n * scale)
  }
  return out
}

function spikeTelemetry(tel, preset) {
  const pps = tel.packetsPerSecond ?? 0
  const http = tel.httpRequestsPerMin ?? 0
  const files = tel.filesDownloaded ?? 0
  const logins = tel.failedLoginsPerMin ?? 0
  if (preset === 'traffic_flood') {
    return {
      ...tel,
      packetsPerSecond: Math.max(pps * 15, pps + 50_000, 80_000),
      httpRequestsPerMin: Math.max(http * 3, http + 120, 500),
    }
  }
  if (preset === 'data_exfiltration') {
    return {
      ...tel,
      filesDownloaded: Math.max(files + 500, 800),
      packetsPerSecond: Math.max(pps * 4, pps + 8_000, 25_000),
    }
  }
  if (preset === 'api_abuse') {
    return {
      ...tel,
      httpRequestsPerMin: Math.max(http * 40, http + 2_000, 5_000),
      packetsPerSecond: Math.max(pps * 3, pps + 5_000, 18_000),
    }
  }
  return {
    ...tel,
    failedLoginsPerMin: Math.max(logins * 50, logins + 200, 350),
    httpRequestsPerMin: Math.max(http * 8, http + 300, 800),
  }
}

const PRESETS = ['traffic_flood', 'data_exfiltration', 'api_abuse', 'credential_spray']
const CONTEXTS = ['normal_day', 'rush_hour', 'night', 'weekend', 'heavy_rain', 'major_event']

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function makeEndpoints(n, tick, rand) {
  const types = ['gateway', 'sensor', 'plc', 'camera', 'server']
  const endpoints = []
  for (let i = 0; i < n; i++) {
    const baseline = {
      packetsPerSecond: 800 + Math.floor(rand() * 12_000),
      httpRequestsPerMin: 20 + Math.floor(rand() * 80),
      filesDownloaded: 1 + Math.floor(rand() * 8),
      failedLoginsPerMin: 1 + Math.floor(rand() * 3),
    }
    const context = CONTEXTS[Math.floor(rand() * CONTEXTS.length)]
    const expected = expectedTelemetry(baseline, context, {
      sector: 'water',
      type: types[i % types.length],
      id: `n${i}`,
      tick,
    })
    endpoints.push({
      id: `n${i}`,
      type: types[i % types.length],
      sector: 'water',
      criticality: i === 0 ? 'critical' : 'medium',
      typeTrust: 70,
      baselineTelemetry: baseline,
      expectedTelemetry: expected,
      telemetry: expected,
      cityContext: context,
      runtimeState: { provenance: 'legitimate', quarantined: false },
      attackOverrideActive: false,
    })
  }
  return endpoints
}

function makeDeps(n, rand) {
  const deps = []
  for (let i = 1; i < n; i++) {
    deps.push({
      source: `n${Math.floor(rand() * i)}`,
      target: `n${i}`,
      packetsPerSecond: 400,
      expectedPacketsPerSecond: 400,
    })
  }
  if (n > 2) {
    deps.push({
      source: 'n0',
      target: `n${n - 1}`,
      packetsPerSecond: 200,
      expectedPacketsPerSecond: 200,
    })
  }
  return deps
}

function framesFromGraph(endpoints, dependencies, mode, attackIndex, preset, noise, rand) {
  const eps = endpoints.map((ep, i) => {
    let telemetry = ep.expectedTelemetry
    if (mode === 'observed') {
      telemetry = mul(ep.expectedTelemetry, 1 + (rand() - 0.5) * noise)
      if (i === attackIndex) telemetry = spikeTelemetry(telemetry, preset)
    }
    return { ...ep, telemetry }
  })
  return extractCityFeatureFrame({ endpoints: eps, dependencies }).X
}

function l2Grad(a, b) {
  const dist = l2Distance(a, b)
  if (dist < 1e-8) return { dist, dA: a.map(() => 0), dB: b.map(() => 0) }
  const dA = a.map((v, k) => (v - (b[k] ?? 0)) / dist)
  const dB = dA.map((v) => -v)
  return { dist, dA, dB }
}

/**
 * Contrastive SGD: pull normal observed embeddings toward expected, push attack windows away.
 */
export function trainTgnn({
  epochs = 24,
  graphsPerEpoch = 28,
  lr = 0.04,
  margin = 0.55,
  seed = 20260902,
  log = () => {},
} = {}) {
  const params = cloneParams(
    createTgnnParams({
      featureDim: BASE_CITY_FEATURE_KEYS.length,
      embedDim: TRUST_CONFIG.tgnn.embedDim,
      temporalWindow: TRUST_CONFIG.tgnn.temporalWindow,
      useSinFallback: true,
    })
  )
  const rand = rng(seed)
  const K = params.temporalWindow
  let lastLoss = 0

  for (let epoch = 0; epoch < epochs; epoch++) {
    let epochLoss = 0
    const grads = emptyGrads(params)
    let batch = 0

    for (let g = 0; g < graphsPerEpoch; g++) {
      const n = 4 + Math.floor(rand() * 4)
      const tick = 8 + Math.floor(rand() * 40)
      const attackIndex = Math.floor(rand() * n)
      const preset = PRESETS[Math.floor(rand() * PRESETS.length)]
      const endpoints = makeEndpoints(n, tick, rand)
      const dependencies = makeDeps(n, rand)
      const nodeIds = endpoints.map((e) => e.id)
      const { adjIn, adjOut } = directedAdjacency(nodeIds, dependencies)

      const expectedFrames = []
      const normalFrames = []
      const attackFrames = []
      for (let k = 0; k < K; k++) {
        expectedFrames.push(framesFromGraph(endpoints, dependencies, 'expected', -1, preset, 0, rand))
        normalFrames.push(framesFromGraph(endpoints, dependencies, 'observed', -1, preset, 0.04, rand))
        attackFrames.push(
          framesFromGraph(endpoints, dependencies, 'observed', attackIndex, preset, 0.04, rand)
        )
      }

      const expTape = tgnnForwardWindowTape(expectedFrames, adjIn, adjOut, params)
      const norTape = tgnnForwardWindowTape(normalFrames, adjIn, adjOut, params)
      const atkTape = tgnnForwardWindowTape(attackFrames, adjIn, adjOut, params)

      const dExp = expTape.embeddings.map((e) => Array(e.length).fill(0))
      const dNor = norTape.embeddings.map((e) => Array(e.length).fill(0))
      const dAtk = atkTape.embeddings.map((e) => Array(e.length).fill(0))

      let loss = 0
      for (let i = 0; i < n; i++) {
        const { dist, dA, dB } = l2Grad(norTape.embeddings[i], expTape.embeddings[i])
        loss += dist * dist
        for (let k = 0; k < dA.length; k++) {
          dNor[i][k] += 2 * dist * dA[k]
          dExp[i][k] += 2 * dist * dB[k]
        }
      }
      const { dist: atkDist, dA, dB } = l2Grad(
        atkTape.embeddings[attackIndex],
        expTape.embeddings[attackIndex]
      )
      const hinge = margin - atkDist
      if (hinge > 0) {
        loss += hinge * hinge
        for (let k = 0; k < dA.length; k++) {
          dAtk[attackIndex][k] += -2 * hinge * dA[k]
          dExp[attackIndex][k] += -2 * hinge * dB[k]
        }
      }

      epochLoss += loss
      batch += 1
      norTape.backward(dNor, grads)
      atkTape.backward(dAtk, grads)
      expTape.backward(dExp, grads)
    }

    const scale = lr / Math.max(1, batch)
    for (const key of ['W_IN', 'W_MSG', 'W_OUT', 'W_TEMP']) {
      const W = params[key]
      const dW = grads[key]
      for (let r = 0; r < W.length; r++) {
        for (let c = 0; c < W[r].length; c++) {
          const g = Math.max(-2, Math.min(2, dW[r][c] * scale))
          W[r][c] -= g
        }
      }
    }
    lastLoss = epochLoss / Math.max(1, batch)
    log(`epoch ${epoch + 1}/${epochs} loss=${lastLoss.toFixed(4)}`)
  }

  return {
    featureDim: params.featureDim,
    embedDim: params.embedDim,
    temporalWindow: params.temporalWindow,
    trainedAt: new Date().toISOString(),
    finalLoss: lastLoss,
    W_IN: params.W_IN,
    W_MSG: params.W_MSG,
    W_OUT: params.W_OUT,
    W_TEMP: params.W_TEMP,
  }
}
