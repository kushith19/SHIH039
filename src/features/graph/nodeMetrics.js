/** @typedef {'packetsPerSecond' | 'httpRequestsPerMin' | 'filesDownloaded' | 'failedLoginsPerMin'} NodeMetricKey */

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

function metricBag(data) {
  const nested =
    data?.telemetry && typeof data.telemetry === 'object' ? data.telemetry : {}
  return { ...(data ?? {}), ...nested }
}

/**
 * Telemetry already stored on the node (nested or legacy flat). No type maps.
 * @param {import('@xyflow/react').Node | { data?: Record<string, unknown> }} n
 */
export function getDefaultNodeMetrics(n) {
  const merged = metricBag(n?.data ?? {})
  return {
    packetsPerSecond: clampNonNegative(merged.packetsPerSecond ?? 0),
    httpRequestsPerMin: clampNonNegative(merged.httpRequestsPerMin ?? 0),
    filesDownloaded: clampNonNegative(merged.filesDownloaded ?? 0),
    failedLoginsPerMin: clampNonNegative(merged.failedLoginsPerMin ?? 0),
  }
}

/**
 * @param {unknown} raw
 * @returns {Partial<Record<NodeMetricKey, number>>}
 */
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
    if (src[key] !== undefined) {
      out[key] = clampNonNegative(src[key])
    }
  }
  return out
}

/**
 * @param {unknown} raw
 * @returns {Record<NodeMetricKey, number>}
 */
export function normalizeMetricSnapshot(raw, fallbackNode) {
  const defaults = getDefaultNodeMetrics(fallbackNode ?? { data: {} })
  const patch = normalizeMetricPatch(raw)
  return {
    packetsPerSecond: patch.packetsPerSecond ?? defaults.packetsPerSecond,
    httpRequestsPerMin: patch.httpRequestsPerMin ?? defaults.httpRequestsPerMin,
    filesDownloaded: patch.filesDownloaded ?? defaults.filesDownloaded,
    failedLoginsPerMin: patch.failedLoginsPerMin ?? defaults.failedLoginsPerMin,
  }
}

/**
 * @param {Record<NodeMetricKey, number>} baseline
 * @param {Partial<Record<NodeMetricKey, number>>} override
 */
export function mergeMetrics(baseline, override) {
  const out = { ...baseline }
  for (const key of NODE_METRIC_KEYS) {
    if (override[key] !== undefined) out[key] = clampNonNegative(override[key])
  }
  return out
}

/**
 * @param {Record<NodeMetricKey, number>} baseline
 * @param {Record<NodeMetricKey, number>} effective
 */
export function metricsEqual(baseline, effective) {
  return NODE_METRIC_KEYS.every((k) => baseline[k] === effective[k])
}

/**
 * Strip override keys that match baseline.
 * @param {Partial<Record<NodeMetricKey, number>>} override
 * @param {Record<NodeMetricKey, number>} baseline
 */
export function pruneOverrideToBaseline(override, baseline) {
  const out = { ...override }
  for (const key of NODE_METRIC_KEYS) {
    if (out[key] !== undefined && out[key] === baseline[key]) {
      delete out[key]
    }
  }
  return out
}

/**
 * @param {import('@xyflow/react').Node[]} nodes
 * @param {import('@xyflow/react').Edge[]} edges
 */
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
