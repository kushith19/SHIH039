export function knowledgeLabel(status) {
  const s = String(status ?? '').toLowerCase()
  if (s === 'success') return 'Knowledge retrieval: available'
  if (s === 'degraded') return 'Knowledge retrieval: DEGRADED'
  return 'Knowledge retrieval: DEGRADED — using observed telemetry and graph evidence'
}

export function normalizeBriefing(raw) {
  if (!raw) return null
  return {
    ...raw,
    graphContext: raw.graphContext || raw.graph_context,
    responsePlan: raw.responsePlan || raw.response_plan,
    mitreCandidates: raw.mitreCandidates || raw.mitre_candidates,
    knowledgeStatus: raw.knowledgeStatus || raw.knowledge_status,
    investigationSteps: raw.investigationSteps || raw.investigation_steps,
    financialImpact: raw.financialImpact || raw.financial_impact,
  }
}

export function pickBriefing(room) {
  return normalizeBriefing(room?.commanderBriefing ?? null)
}
