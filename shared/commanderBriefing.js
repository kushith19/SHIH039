import { composeRisk } from './commanderRisk.js'
import { campaignTitle } from './campaigns.js'

export const DEFAULT_SAFE_PLAN = Object.freeze([
  {
    phase: 'contain',
    priority: 'P0',
    action:
      'Isolate the affected network segment and restrict suspicious communications while preserving monitoring.',
    rationale: 'Containment without shutting down OT/ICS processes.',
    safetyStatus: 'approved',
  },
  {
    phase: 'investigate',
    priority: 'P1',
    action:
      'Inspect authentication and communication evidence on flagged endpoints and compare telemetry to expected load.',
    rationale: 'Level-1 facts first.',
    safetyStatus: 'approved',
  },
  {
    phase: 'validate',
    priority: 'P1',
    action:
      'Coordinate with the responsible plant or operator team before any physical intervention; confirm process conditions.',
    rationale: 'OT/ICS safety — Commander does not execute physical actions.',
    safetyStatus: 'approved',
  },
  {
    phase: 'recover',
    priority: 'P2',
    action: 'Restore normal communication paths only after validation; continue enhanced monitoring.',
    rationale: 'Recovery is operator-led.',
    safetyStatus: 'approved',
  },
])

export function fallbackBriefing({ campaign = null, incidents = [], detection = null } = {}) {
  const live = Array.isArray(incidents) ? incidents : []
  const peakAnomaly = live.reduce((m, inc) => Math.max(m, Number(inc.anomalyScore) || 0), 0)
  const minTrust = live.reduce((m, inc) => {
    const t = Number(inc.trustScore)
    if (!Number.isFinite(t)) return m
    return m == null ? t : Math.min(m, t)
  }, null)
  const risk = composeRisk({
    anomalyScore: peakAnomaly,
    trustScore: minTrust,
    criticality: live[0]?.criticality,
    evidence: live.flatMap((i) => i.evidence ?? []),
  })
  const summary = campaign
    ? `Pattern match: ${campaignTitle(campaign)}. ${live.length} promoted detection(s) on catalog edges. Assessment, not a confirmed attacker campaign.`
    : live[0]
      ? `${live[0].endpointLabel || live[0].endpointId} was flagged by the residual detector. Numeric evidence remains Level-1.`
      : 'No promoted detections this tick.'
  const mitre = (campaign?.mitreCandidates ?? []).map((id) => ({
    techniqueId: String(id),
    reason: 'Catalog candidate from correlated pattern — not proof of execution',
    confidence: null,
  }))
  const sev = risk.overall >= 75 ? 'high' : risk.overall >= 45 ? 'medium' : 'low'
  return {
    analysisMode: campaign ? 'campaign' : 'incident',
    incidentId: live[0]?.id ?? null,
    campaignId: campaign?.id ?? null,
    assessment: {
      severity: sev,
      summary,
      confidence: Number(campaign?.campaignMatchScore) || Number(live[0]?.confidence) || 0,
    },
    risk,
    graphContext: {
      affectedNodes: campaign?.endpointIds ?? live.map((i) => i.endpointId),
      affectedEdges: [],
      propagationPath: [],
      hopCount: 0,
      exposedCount: live.length,
    },
    mitreCandidates: mitre,
    impact: {
      affectedEndpoints: campaign?.endpointIds ?? live.map((i) => i.endpointId),
      affectedSectors: campaign?.sectors ?? [...new Set(live.map((i) => i.sector).filter(Boolean))],
      criticalInfrastructure: live
        .filter((i) => ['critical', 'high'].includes(String(i.criticality).toLowerCase()))
        .map((i) => i.endpointId),
    },
    responsePlan: [...DEFAULT_SAFE_PLAN],
    investigationSteps: [
      'Validate Level-1 metric deviations on the origin endpoint',
      'Review residual, trust, and telemetry on the flagged node',
    ],
    citations: [],
    uncertainties: [
      'Knowledge retrieval unavailable — assessment uses observed telemetry and graph evidence only.',
    ],
    knowledgeStatus: 'unavailable',
    recommendations: DEFAULT_SAFE_PLAN.map((s) => ({ action: s.action, priority: s.priority })),
    evidence: [],
    financialImpact: campaign?.financialExposure
      ? 'Qualitative finance exposure in the correlated set — no monetary loss figure.'
      : null,
    source: 'deterministic-briefing',
  }
}
