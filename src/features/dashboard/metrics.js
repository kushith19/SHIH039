export const METRIC_KEYS = [
  { key: 'packetsPerSecond', label: 'Packets / s', short: 'PPS', color: '#22d3ee' },
  { key: 'httpRequestsPerMin', label: 'HTTP / min', short: 'HTTP', color: '#a78bfa' },
  { key: 'filesDownloaded', label: 'Files', short: 'Files', color: '#fbbf24' },
  { key: 'failedLoginsPerMin', label: 'Failed logins / min', short: 'Logins', color: '#fb7185' },
]

export const CITY_CONTEXT_LABELS = {
  normal_day: 'Normal day',
  rush_hour: 'Rush hour',
  night: 'Night',
  weekend: 'Weekend',
  heavy_rain: 'Heavy rain',
  major_event: 'Major event',
}

export function derivePosture(incidents = [], anomalyCount = 0) {
  const high = incidents.filter(
    (i) => i.severity === 'critical' || i.severity === 'high'
  ).length
  if (high > 0) {
    return {
      key: 'critical',
      label: 'Critical',
      blurb: `${high} high-severity detection${high === 1 ? '' : 's'} on the mesh.`,
    }
  }
  if (incidents.length > 0) {
    return {
      key: 'watch',
      label: 'Elevated',
      blurb: `${incidents.length} open incident${incidents.length === 1 ? '' : 's'} passed detection criteria.`,
    }
  }
  if (anomalyCount > 0) {
    return {
      key: 'watch',
      label: 'Watch',
      blurb: `${anomalyCount} node${anomalyCount === 1 ? '' : 's'} flagged by TGNN.`,
    }
  }
  return {
    key: 'calm',
    label: 'Nominal',
    blurb: 'No detections past threshold. Mesh looks quiet.',
  }
}

export function seriesByTick(samples, metricKey, endpointId = null, { sum = false } = {}) {
  const byTick = new Map()
  for (const s of samples) {
    if (s.metricKey !== metricKey) continue
    if (endpointId && s.endpointId !== endpointId) continue
    const v = Number(s.value || 0)
    byTick.set(s.tick, sum ? (byTick.get(s.tick) ?? 0) + v : v)
  }
  return [...byTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, value]) => ({ tick, value }))
}

export function latestByEndpoint(samples, metricKey) {
  const latest = new Map()
  for (const s of samples) {
    if (s.metricKey !== metricKey) continue
    const prev = latest.get(s.endpointId)
    if (!prev || s.tick >= prev.tick) latest.set(s.endpointId, s)
  }
  return latest
}

export function fmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Math.round(Number(n)).toLocaleString()
}

export function lastValue(series) {
  if (!series?.length) return 0
  return Number(series[series.length - 1].value) || 0
}

/**
 * Y domain padded around the series so a flat idle line sits mid-chart
 * instead of filling from 0.
 */
export function paddedDomainFromSeries(series, dataKey = 'value') {
  const vals = (series ?? [])
    .map((p) => Number(p?.[dataKey]))
    .filter((n) => Number.isFinite(n))
  if (!vals.length) return [0, 1]
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo
  const pad = span > 0 ? span * 0.4 : Math.max(Math.abs(hi) * 0.15, 1)
  return [lo - pad, hi + pad]
}

/** Percent change of observed vs expected city-context load. Idle → ~0. */
export function vsExpectedPct(observed, expected) {
  const obs = Number(observed)
  const exp = Number(expected)
  if (!Number.isFinite(obs) || !Number.isFinite(exp)) return null
  if (exp <= 0) return obs === 0 ? 0 : null
  return ((obs - exp) / exp) * 100
}

export function fmtSignedPct(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return '—'
  const rounded = Math.round(Number(pct))
  if (rounded === 0) return '0%'
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

/**
 * Shared Y domain for fleet sparklines of % vs expected.
 * Always includes 0 so idle sits at the baseline and spikes sit higher.
 */
export function sharedSparkPctDomain(seriesList) {
  const vals = []
  for (const series of seriesList ?? []) {
    for (const p of series ?? []) {
      const n = Number(p?.value)
      if (Number.isFinite(n)) vals.push(n)
    }
  }
  if (!vals.length) return [-10, 20]
  const lo = Math.min(0, ...vals)
  const hi = Math.max(0, ...vals)
  const span = hi - lo
  const pad = span > 0 ? Math.max(span * 0.12, 8) : 15
  return [lo - pad, hi + pad]
}
