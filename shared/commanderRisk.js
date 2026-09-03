/** Risk components from observed detection fields. Not an LLM score. */

const CRIT = Object.freeze({
  critical: 95,
  high: 80,
  medium: 50,
  low: 25,
})

function clamp100(n) {
  if (!Number.isFinite(Number(n))) return null
  return Math.max(0, Math.min(100, Math.round(Number(n))))
}

export function criticalityComponent(criticality) {
  const key = String(criticality ?? '').toLowerCase()
  return CRIT[key] ?? 40
}

export function behavioralComponent(evidence, anomalyScore) {
  let maxDev = 0
  let found = false
  for (const ev of evidence ?? []) {
    const d = Math.abs(Number(ev?.deviationPct))
    if (!Number.isFinite(d)) continue
    found = true
    maxDev = Math.max(maxDev, d)
  }
  if (found) return clamp100(Math.min(100, maxDev))
  const a = Number(anomalyScore)
  if (!Number.isFinite(a)) return null
  return clamp100(a <= 1 ? a * 100 : a)
}

export function graphComponent(anomalyScore) {
  const a = Number(anomalyScore)
  if (!Number.isFinite(a)) return null
  return clamp100(a <= 1 ? a * 100 : a)
}

export function composeRisk({
  anomalyScore = null,
  trustScore = null,
  criticality = '',
  evidence = [],
} = {}) {
  const behavioral = behavioralComponent(evidence, anomalyScore) ?? 0
  const graph = graphComponent(anomalyScore) ?? 0
  const trust = clamp100(trustScore)
  const crit = criticalityComponent(criticality)
  const trustRisk = trust == null ? 50 : Math.max(0, 100 - trust)
  const overall = clamp100(0.3 * behavioral + 0.3 * graph + 0.2 * trustRisk + 0.2 * crit)
  return {
    overall: overall ?? 0,
    behavioral,
    graph,
    trust,
    criticality: crit,
  }
}

export function knowledgeStatusFromRetrieval({ chunkCount = 0, retrievalStatus = '' } = {}) {
  const n = Number(chunkCount) || 0
  const st = String(retrievalStatus ?? '').toLowerCase()
  if (n > 0 && (st === 'success' || st === 'partial')) return st === 'partial' ? 'degraded' : 'success'
  if (st === 'unavailable' || n === 0) return 'unavailable'
  return 'degraded'
}
