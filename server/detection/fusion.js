import { TRUST_CONFIG } from '../../shared/trustConfig.js'
import { endpointIntrinsicTrust } from '../infrastructureNode.js'
import { cityContextOf, expectedTelemetryOf, hasTelemetryDrift } from './features.js'

export const FUSED_THRESHOLD = TRUST_CONFIG.fusion.threshold
export const FUSION_TEMPORAL_WEIGHT = TRUST_CONFIG.fusion.temporalWeight
export const FUSION_TGNN_WEIGHT = TRUST_CONFIG.fusion.tgnnWeight
export const TGNN_REASON_THRESHOLD = TRUST_CONFIG.fusion.tgnnReasonThreshold

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

export function criticalityWeight(criticality) {
  const table = TRUST_CONFIG.fusion.criticalityWeight
  const key = String(criticality ?? '').toLowerCase()
  return table[key] ?? table.medium
}

/**
 * Combine temporal telemetry scores with TGNN isolation scores.
 * Criticality is a numeric sensitivity; sector/type are never read.
 *
 * @param {{
 *   input: import('./types.js').DetectionInput
 *   temporal: { scoresByNodeId: Record<string, number>, reasonsByNodeId: Record<string, string[]> }
 *   tgnn: { isolationScoresByNodeId: Record<string, number> }
 * }} args
 */
export function fuseScores({ input, temporal, tgnn }) {
  /** @type {Record<string, number>} */
  const fusedScoresByNodeId = {}
  /** @type {Record<string, string[]>} */
  const reasonsByNodeId = {}
  const anomalyNodeIds = []
  const nodeResults = []

  const isolation = tgnn?.isolationScoresByNodeId ?? {}
  const temporalScores = temporal?.scoresByNodeId ?? {}
  const temporalReasons = temporal?.reasonsByNodeId ?? {}

  for (const ep of input.endpoints ?? []) {
    const temporalScore = clamp01(temporalScores[ep.id] ?? 0)
    const isolationScore = clamp01(isolation[ep.id] ?? 0)
    const mix =
      FUSION_TEMPORAL_WEIGHT * temporalScore + FUSION_TGNN_WEIGHT * isolationScore

    let bonus = 0
    const extraReasons = []
    const trust = endpointIntrinsicTrust(ep)
    const { lowTrust, injected, override } = TRUST_CONFIG.fusion.bonuses
    if (trust < lowTrust.below) {
      bonus += lowTrust.amount
      extraReasons.push(lowTrust.reason)
    }
    if (ep.runtimeState?.provenance === 'injected') {
      bonus += injected.amount
      extraReasons.push(injected.reason)
    }
    if (ep.behaviour?.attackOverrideActive === true) {
      bonus += override.amount
      extraReasons.push(override.reason)
    }

    const fused = clamp01(mix * criticalityWeight(ep.criticality) + bonus)
    const reasons = [...(temporalReasons[ep.id] ?? [])]
    if (isolationScore >= TGNN_REASON_THRESHOLD) reasons.push('tgnn_embed')
    for (const tag of extraReasons) {
      if (!reasons.includes(tag)) reasons.push(tag)
    }

    const quarantined = ep.runtimeState?.quarantined === true
    const expected = expectedTelemetryOf(ep)
    const drift = hasTelemetryDrift(expected, ep.telemetry)
    const isAnomaly = !quarantined && drift && fused >= FUSED_THRESHOLD
    const context = cityContextOf(ep, input)
    if (drift && context && context !== 'normal_day' && !reasons.includes(`context_mismatch:${context}`)) {
      reasons.push(`context_mismatch:${context}`)
    }

    fusedScoresByNodeId[ep.id] = fused
    reasonsByNodeId[ep.id] = reasons
    if (isAnomaly) anomalyNodeIds.push(ep.id)
    nodeResults.push({
      id: ep.id,
      label: ep.label,
      isolationScore,
      temporalScore,
      fusedScore: fused,
      reasons,
      isAnomaly,
    })
  }

  return {
    fusedScoresByNodeId,
    reasonsByNodeId,
    anomalyNodeIds,
    nodeResults,
  }
}
