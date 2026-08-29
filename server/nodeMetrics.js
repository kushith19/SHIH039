export const NODE_METRIC_KEYS = [
  'packetsPerSecond',
  'httpRequestsPerMin',
  'filesDownloaded',
  'failedLoginsPerMin',
]

export function clampNonNegative(n) {
  const num = Number(n)
  if (!Number.isFinite(num) || num < 0) return 0
  return num
}

export function normalizeMetricPatch(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { packetsPerSecond: clampNonNegative(raw) }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const nested =
    raw.telemetry && typeof raw.telemetry === 'object' ? raw.telemetry : null
  const src = nested ? { ...raw, ...nested } : raw
  const out = {}
  for (const key of NODE_METRIC_KEYS) {
    if (src[key] !== undefined) out[key] = clampNonNegative(src[key])
  }
  return out
}

export function mergeMetrics(baseline, override) {
  const out = { ...baseline }
  for (const key of NODE_METRIC_KEYS) {
    if (override[key] !== undefined) out[key] = clampNonNegative(override[key])
  }
  return out
}

export function isNodeMetricPatch(patch) {
  if (!patch || typeof patch !== 'object') return false
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined)
  return keys.length > 0 && keys.every((k) => NODE_METRIC_KEYS.includes(k))
}

function liveTelemetry(data) {
  const nested =
    data?.telemetry && typeof data.telemetry === 'object' ? data.telemetry : {}
  const merged = { ...(data ?? {}), ...nested }
  const out = {}
  for (const key of NODE_METRIC_KEYS) {
    out[key] = clampNonNegative(merged[key] ?? 0)
  }
  return out
}

export function normalizeMetricSnapshot(raw, node) {
  const live = liveTelemetry(node?.data ?? {})
  const patch = normalizeMetricPatch(raw)
  return {
    packetsPerSecond: patch.packetsPerSecond ?? live.packetsPerSecond,
    httpRequestsPerMin: patch.httpRequestsPerMin ?? live.httpRequestsPerMin,
    filesDownloaded: patch.filesDownloaded ?? live.filesDownloaded,
    failedLoginsPerMin: patch.failedLoginsPerMin ?? live.failedLoginsPerMin,
  }
}

/** Defender telemetry edits update live graph data and locked scenario baselines (not attack overrides). */
export function applyDefenderNodeBaseline(room, nodeId, patch) {
  const idx = room.nodes.findIndex((n) => n.id === nodeId)
  if (idx < 0) return false
  const metricPatch = normalizeMetricPatch(patch)
  if (Object.keys(metricPatch).length === 0) return false

  const prev = room.nodes[idx]
  const data = { ...(prev.data ?? {}) }
  const telemetry = mergeMetrics(liveTelemetry(data), metricPatch)
  room.nodes[idx] = {
    ...prev,
    type: 'infrastructureNode',
    data: {
      ...data,
      type: data.type ?? data.assetType ?? 'unknown',
      telemetry,
    },
  }

  const sim = room.hackSimulator
  if (sim?.active === true) {
    const prevLock = sim.nodeScenarioBaselines?.[nodeId]
    const prevObj =
      typeof prevLock === 'number'
        ? { packetsPerSecond: clampNonNegative(prevLock) }
        : prevLock && typeof prevLock === 'object'
          ? prevLock
          : {}
    const nodeScenarioBaselines = { ...(sim.nodeScenarioBaselines ?? {}) }
    nodeScenarioBaselines[nodeId] = normalizeMetricSnapshot(
      { ...prevObj, ...metricPatch },
      room.nodes[idx]
    )
    const nodeOverrides = { ...(sim.nodeOverrides ?? {}) }
    delete nodeOverrides[nodeId]
    room.hackSimulator = {
      ...sim,
      nodeScenarioBaselines,
      nodeOverrides,
    }
  }
  return true
}

export function applyDefenderEdgeBaseline(room, edgeId, packetsPerSecond) {
  const idx = room.edges.findIndex((e) => e.id === edgeId)
  if (idx < 0) return false
  const nextVal = clampNonNegative(packetsPerSecond)

  room.edges[idx] = {
    ...room.edges[idx],
    data: { ...room.edges[idx].data, packetsPerSecond: nextVal },
  }

  const sim = room.hackSimulator
  if (sim?.active === true) {
    const edgeScenarioBaselines = { ...(sim.edgeScenarioBaselines ?? {}) }
    edgeScenarioBaselines[edgeId] = nextVal
    const edgeOverrides = { ...(sim.edgeOverrides ?? {}) }
    delete edgeOverrides[edgeId]
    room.hackSimulator = {
      ...sim,
      edgeScenarioBaselines,
      edgeOverrides,
    }
  }
  return true
}

export function buildAttackLayerFromGraph(nodes, edges) {
  const nodeScenarioBaselines = Object.fromEntries(
    nodes.map((n) => [n.id, normalizeMetricSnapshot(n.data, n)])
  )
  const edgeScenarioBaselines = Object.fromEntries(
    edges.map((e) => [
      e.id,
      clampNonNegative(
        Number.isFinite(Number(e.data?.packetsPerSecond))
          ? Number(e.data.packetsPerSecond)
          : 0
      ),
    ])
  )
  return {
    active: true,
    nodeOverrides: {},
    edgeOverrides: {},
    nodeScenarioBaselines,
    edgeScenarioBaselines,
  }
}
