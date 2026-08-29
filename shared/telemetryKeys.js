export const GAME_METRIC_KEYS = Object.freeze([
  'packetsPerSecond',
  'httpRequestsPerMin',
  'filesDownloaded',
  'failedLoginsPerMin',
])

export const GAME_INGEST_TO_KEY = Object.freeze({
  packets_per_second: 'packetsPerSecond',
  http_requests_per_min: 'httpRequestsPerMin',
  files_downloaded: 'filesDownloaded',
  failed_logins_per_min: 'failedLoginsPerMin',
})

export const GAME_KEY_TO_INGEST = Object.freeze({
  packetsPerSecond: { name: 'packets_per_second', unit: 'packets/s' },
  httpRequestsPerMin: { name: 'http_requests_per_min', unit: 'requests/min' },
  filesDownloaded: { name: 'files_downloaded', unit: 'files' },
  failedLoginsPerMin: { name: 'failed_logins_per_min', unit: 'attempts/min' },
})

const META = new Set(['yaml', 'tick', 'tsMs', 'telemetryUnits'])
const GAME_KEY_SET = new Set(GAME_METRIC_KEYS)

/** @type {string[]} */
let yamlMetricNames = []

/** @type {Array<(names: string[]) => void>} */
const yamlNameListeners = []

export function onYamlMetricNamesChange(fn) {
  if (typeof fn === 'function') yamlNameListeners.push(fn)
}

export function normalizeMetricName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
}

export function yamlMetricNamesFromModel(model) {
  const names = new Set()
  for (const ep of Object.values(model?.endpoints ?? {})) {
    for (const m of ep.metrics ?? []) {
      const n = normalizeMetricName(m?.name)
      if (n) names.add(n)
    }
  }
  return [...names].sort()
}

export function setYamlMetricNames(names) {
  yamlMetricNames = Array.isArray(names) ? [...names] : []
  for (const fn of yamlNameListeners) fn(yamlMetricNames)
}

export function getYamlMetricNames() {
  return yamlMetricNames
}

export function getTelemetryKeys() {
  return [...GAME_METRIC_KEYS, ...yamlMetricNames]
}

export function isGameMetricKey(key) {
  return GAME_KEY_SET.has(String(key))
}

export function metricPresent(bag, key) {
  const n = bag?.[key]
  return n != null && Number.isFinite(Number(n))
}

export function deviationMetricKeys(expected, observed, keys = getTelemetryKeys()) {
  return keys.filter((key) => metricPresent(expected, key) && metricPresent(observed, key))
}

export function inspectorMetricKeys(expected, observed) {
  const out = [...GAME_METRIC_KEYS]
  const seen = new Set(GAME_METRIC_KEYS)
  const extra = new Set()
  for (const bag of [expected, observed]) {
    if (!bag || typeof bag !== 'object') continue
    for (const key of Object.keys(bag)) {
      if (seen.has(key) || isTelemetryMetaKey(key) || Array.isArray(bag[key])) continue
      if (!metricPresent(bag, key)) continue
      extra.add(key)
    }
  }
  out.push(...[...extra].sort())
  return out
}

export function lookbackMetricKeys(lookback, extraBags = []) {
  const keys = new Set(getTelemetryKeys())
  if (lookback && typeof lookback === 'object') {
    for (const key of Object.keys(lookback)) keys.add(key)
  }
  for (const bag of extraBags) {
    if (!bag || typeof bag !== 'object') continue
    for (const key of Object.keys(bag)) {
      if (!isTelemetryMetaKey(key) && !Array.isArray(bag[key])) keys.add(key)
    }
  }
  return [...keys]
}

export function ingestedTelemetryPatch(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const [key, value] of Object.entries(src)) {
    if (isTelemetryMetaKey(key) || Array.isArray(value) || (value && typeof value === 'object')) continue
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0) out[key] = n
  }
  return out
}

export function isTelemetryMetaKey(key) {
  return META.has(String(key))
}

export function numericTelemetryBag(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const [key, value] of Object.entries(src)) {
    if (isTelemetryMetaKey(key) || key === 'yaml') continue
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0) out[key] = n
  }
  for (const key of GAME_METRIC_KEYS) {
    if (out[key] === undefined) out[key] = 0
  }
  return out
}

export function mergeTelemetryBags(baseline, override) {
  const out = numericTelemetryBag(baseline)
  const src = override && typeof override === 'object' ? override : {}
  for (const [key, value] of Object.entries(src)) {
    if (isTelemetryMetaKey(key) || Array.isArray(value) || (value && typeof value === 'object')) continue
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0) out[key] = n
  }
  return out
}
