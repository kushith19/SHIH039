import { isLiveCampaignStatus } from './campaigns.js'
import { isFinanceSector } from './campaignCatalog.js'
import { composeRisk } from './commanderRisk.js'

function sectorCounts(incidents) {
  const by = new Map()
  for (const inc of incidents ?? []) {
    const s = String(inc?.sector ?? '').trim() || 'unknown'
    by.set(s, (by.get(s) || 0) + 1)
  }
  let top = null
  let n = 0
  for (const [sector, count] of by) {
    if (count > n) {
      top = sector
      n = count
    }
  }
  return { top, distinct: [...by.keys()] }
}

function criticalAtRisk(incidents) {
  return (incidents ?? []).filter((inc) => {
    const c = String(inc?.criticality ?? '').toLowerCase()
    return c === 'critical' || c === 'high'
  })
}

/**
 * Deterministic city posture from room state. No LLM.
 */
export function composeCityPosture(room) {
  const detection = room?.detection ?? {}
  const incidents = Array.isArray(detection.incidents) ? detection.incidents : []
  const campaigns = (room?.campaigns ?? []).filter((c) => isLiveCampaignStatus(c.status))
  const rm = detection.riskMomentum ?? {}
  const { top, distinct } = sectorCounts(incidents)
  const crit = criticalAtRisk(incidents)
  const peakAnomaly = incidents.reduce((m, inc) => Math.max(m, Number(inc.anomalyScore) || 0), 0)
  const minTrust = incidents.reduce((m, inc) => {
    const t = Number(inc.trustScore)
    if (!Number.isFinite(t)) return m
    return m == null ? t : Math.min(m, t)
  }, null)
  const risk = composeRisk({
    anomalyScore: peakAnomaly,
    trustScore: minTrust,
    criticality: crit[0]?.criticality,
    evidence: incidents.flatMap((i) => i.evidence ?? []),
  })
  const finance = incidents.some((i) => isFinanceSector(i.sector)) || campaigns.some((c) =>
    (c.sectors ?? []).some((s) => isFinanceSector(s))
  )
  let overallLabel = 'nominal'
  if (risk.overall >= 75 || String(rm.trajectory).toLowerCase() === 'critical') overallLabel = 'high'
  else if (risk.overall >= 45 || campaigns.length > 0) overallLabel = 'elevated'
  return {
    overallRisk: overallLabel,
    overallScore: risk.overall,
    risk,
    activeIncidents: incidents.length,
    activeCampaigns: campaigns.length,
    criticalAssetsAtRisk: crit.length,
    mostAtRiskSector: top,
    sectors: distinct,
    riskTrend: rm.trajectory ?? 'stable',
    mostConcerningPath: [],
    priorityAsset:
      crit[0]?.endpointLabel || crit[0]?.endpointId || incidents[0]?.endpointLabel || null,
    financeRelevant: finance === true,
    knowledgeStatus: 'unavailable',
    source: 'deterministic-posture',
  }
}
