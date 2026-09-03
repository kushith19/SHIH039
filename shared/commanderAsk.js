import { formatEvidenceItem } from './incidents.js'
import {
  buildIncidentInvestigation,
  buildIncidentResponsePlan,
  responsePriorityFromContext,
} from './commanderIncidentIntel.js'

function insufficient() {
  return { answer: 'Insufficient observed evidence.', insufficient: true }
}

function textOf(snapshot) {
  try {
    return JSON.stringify(snapshot ?? {})
  } catch {
    return ''
  }
}

function assetFromContext(ctx) {
  return ctx?.affectedAsset?.summary || ctx?.affectedAsset?.id || null
}

function answerFromIncidentContext(q, ctx) {
  if (!ctx) return null
  const asset = assetFromContext(ctx)
  const path =
    (Array.isArray(ctx.primaryPathLabels) && ctx.primaryPathLabels.length
      ? ctx.primaryPathLabels
      : ctx.primaryPath) || []
  const evidence = (Array.isArray(ctx.anomalyEvidence) ? ctx.anomalyEvidence : [])
    .map(formatEvidenceItem)
    .filter(Boolean)

  if (
    q.includes('shouldn\'t i isolate') ||
    q.includes('should not isolate') ||
    q.includes('why not isolate') ||
    (q.includes('isolate') && (q.includes('every') || q.includes('all') || q.includes('core')))
  ) {
    const downstream = Array.isArray(path) && path.length > 1 ? path.slice(1).join(', ') : null
    return {
      answer: `Only ${asset || 'the origin'} is a confirmed anomaly from this incident context. ${
        downstream
          ? `${downstream} appear as propagated / exposed dependencies — monitor and protect them, do not treat them as independently compromised without separate detection evidence.`
          : 'Propagated and peer-exposed nodes are exposure, not extra confirmed anomalies.'
      } Recommended action remains advisory; Commander does not execute isolation.`,
      insufficient: false,
    }
  }

  if (
    q.includes('financial') ||
    q.includes('exposure') ||
    q.includes('rupee') ||
    q.includes('₹') ||
    q.includes('money') ||
    q.includes('loss')
  ) {
    const fin = ctx.financialExposure
    if (!fin || fin.simulated !== true) return insufficient()
    const label = fin.exposureLabel || '—'
    return {
      answer: `SIMULATED EXPOSURE ${label} attached to ${asset || 'this incident'}. Scenario-based demo estimate — not actual financial loss. ${
        Array.isArray(path) && path.length > 1
          ? `Propagation path ${path.join(' → ')} increases potential business impact along financially critical dependencies.`
          : ''
      }`.trim(),
      insufficient: false,
    }
  }

  if (
    (q.includes('evidence') || q.includes('trigger') || q.includes('anomal')) &&
    (q.includes('what') || q.includes('why') || q.includes('show') || q.includes('behind'))
  ) {
    if (evidence.length === 0) return insufficient()
    return {
      answer: `Observed on ${asset || 'origin'}: ${evidence.slice(0, 8).join('; ')}. Assessment from residual detection — not a confirmed attack attribution.`,
      insufficient: false,
    }
  }

  if (
    q.includes('at risk') ||
    q.includes('why is') ||
    (q.includes('propagat') && q.includes('why'))
  ) {
    if (Array.isArray(path) && path.length > 1) {
      return {
        answer: `${path[path.length - 1]} is in the propagation path from confirmed anomaly ${path[0]}: ${path.join(' → ')}. This is propagated risk / exposure on existing graph edges — not an independent confirmed anomaly unless a related detection says so.`,
        insufficient: false,
      }
    }
    if (Array.isArray(ctx.propagatedNodeIds) && ctx.propagatedNodeIds.length) {
      return {
        answer: `${ctx.propagatedNodeIds.length} propagated node(s) from ${asset || 'origin'}. Exposure along existing edges, not extra confirmed anomalies.`,
        insufficient: false,
      }
    }
  }

  if (q.includes('related') || q.includes('other incident')) {
    const related = Array.isArray(ctx.relatedIncidents) ? ctx.relatedIncidents : []
    if (!related.length) return insufficient()
    const lines = related
      .slice(0, 5)
      .map((r) => r.summary || r.affectedNodeId || r.incidentType || r.incidentId)
      .filter(Boolean)
    return {
      answer: `PRIMARY incident is ${asset || ctx.incidentId}. Related incidents (context only): ${lines.join('; ')}. Do not treat every related node as independently compromised.`,
      insufficient: false,
    }
  }

  if (
    q.includes('respond') ||
    q.includes('response plan') ||
    q.includes('what should i do') ||
    q.includes('contain')
  ) {
    const plan = buildIncidentResponsePlan(ctx)
    if (!plan) return insufficient()
    const lines = plan.plan.map((s) => `${s.step}. ${s.title}: ${s.action}`)
    return {
      answer: `RESPONSE PLAN (advisory, priority ${plan.priority}): ${lines.join(' ')}`,
      insufficient: false,
    }
  }

  if (
    q.includes('investigat') ||
    q.includes('what happened') ||
    q.includes('summary') ||
    q.includes('assess')
  ) {
    const inv = buildIncidentInvestigation(ctx)
    if (!inv) return insufficient()
    return {
      answer: `${inv.sections.incidentSummary} Why suspicious: ${inv.sections.whySuspicious.slice(0, 4).join('; ')}. ${inv.sections.graphImpact.lines.join('. ')}.`,
      insufficient: false,
    }
  }

  if (q.includes('priority')) {
    return {
      answer: `Response priority ${responsePriorityFromContext(ctx)} from supplied severity ${ctx.severity ?? '—'} / risk ${ctx.riskScore ?? '—'}. Not a new scoring formula.`,
      insufficient: false,
    }
  }

  return null
}

/**
 * Grounded Q&A over a supplied snapshot only. Does not invent telemetry.
 * When incidentContext is present, prefer incident-scoped answers.
 */
export function answerCommanderQuestion(question, snapshot) {
  const q = String(question ?? '').trim().toLowerCase()
  if (!q) return insufficient()
  const briefing = snapshot?.briefing ?? null
  const incidents = Array.isArray(snapshot?.incidents) ? snapshot.incidents : []
  const posture = snapshot?.posture ?? null
  const campaigns = Array.isArray(snapshot?.campaigns) ? snapshot.campaigns : []
  const incidentContext = snapshot?.incidentContext ?? null
  const blob = textOf(snapshot).toLowerCase()

  const scoped = answerFromIncidentContext(q, incidentContext)
  if (scoped) return scoped

  if (q.includes('evidence') || q.includes('behind this')) {
    const lines = incidents.flatMap((inc) =>
      (inc.evidence ?? []).map((ev) => `${inc.endpointLabel || inc.endpointId}: ${formatEvidenceItem(ev)}`)
    )
    if (lines.length === 0) return insufficient()
    return { answer: lines.slice(0, 12).join(' '), insufficient: false }
  }

  if (q.includes('why') && (q.includes('risky') || q.includes('risk') || q.includes('anomal'))) {
    const named = incidents.find((inc) => {
      const id = String(inc.endpointId ?? '').toLowerCase()
      const label = String(inc.endpointLabel ?? '').toLowerCase()
      return (id && q.includes(id.toLowerCase())) || (label && q.includes(label.toLowerCase()))
    })
    const inc = named || incidents[0]
    if (!inc) return insufficient()
    const ev = (inc.evidence ?? []).map(formatEvidenceItem).filter(Boolean)
    if (ev.length === 0 && inc.anomalyScore == null) return insufficient()
    return {
      answer: `${inc.endpointLabel || inc.endpointId} is flagged because residual ${inc.anomalyScore ?? '—'}, trust ${inc.trustScore ?? '—'}. ${ev.slice(0, 4).join('; ')} Assessment, not a confirmed attack.`,
      insufficient: false,
    }
  }

  if (q.includes('campaign') && (q.includes('escalate') || q.includes('why'))) {
    const c = campaigns[0]
    if (!c) return insufficient()
    return {
      answer: `${c.title || c.campaignType}: catalog correlation ${Math.round((c.campaignMatchScore || 0) * 100)}% across ${(c.endpointIds || []).length} endpoints. Status ${c.status}. This is a correlation assessment, not proof of a coordinated attacker.`,
      insufficient: false,
    }
  }

  if (q.includes('affected next') || q.includes('propagate') || q.includes('blast')) {
    const ctx = incidentContext
    const labeled = ctx?.primaryPathLabels
    const fromMap = ctx?.propagationPaths
      ? Object.values(ctx.propagationPaths).sort((a, b) => (b?.length || 0) - (a?.length || 0))[0]
      : null
    const path = Array.isArray(labeled) && labeled.length ? labeled : fromMap
    if (Array.isArray(path) && path.length > 0) {
      return {
        answer: `Observed path (assessment, not a confirmed kill-chain): ${path.join(' → ')}. Blast radius ${ctx.blastRadius ?? '—'}${Number.isFinite(Number(ctx.hopDistance)) ? `, ${ctx.hopDistance} hop(s)` : ''}. Propagated nodes are exposure, not extra confirmed anomalies.`,
        insufficient: false,
      }
    }
    if (Array.isArray(ctx?.propagatedNodeIds) && ctx.propagatedNodeIds.length) {
      return {
        answer: `${ctx.propagatedNodeIds.length} propagated node(s) on existing edges. Not additional confirmed anomalies.`,
        insufficient: false,
      }
    }
    return insufficient()
  }

  if (q.includes('investigate first') || q.includes('what should i')) {
    if (incidentContext) {
      const plan = buildIncidentResponsePlan(incidentContext)
      if (plan?.plan?.[0]) {
        return { answer: `Investigate / respond: ${plan.plan[0].action}`, insufficient: false }
      }
    }
    const step = briefing?.responsePlan?.[0]?.action || briefing?.investigationSteps?.[0]
    const origin = incidents[0]?.endpointLabel || incidents[0]?.endpointId
    if (!step && !origin) return insufficient()
    return {
      answer: step
        ? `Investigate: ${step}`
        : `Start with ${origin} — highest-severity promoted detection this tick.`,
      insufficient: false,
    }
  }

  if (q.includes('30 second') || q.includes('last 30') || q.includes('what changed')) {
    if (!posture && incidents.length === 0) return insufficient()
    return {
      answer: `This tick: ${incidents.length} promoted detection(s), ${campaigns.length} live campaign(s). Trajectory ${posture?.riskTrend || 'unknown'}. Not a 30-second packet capture — only match-clock detection state is available.`,
      insufficient: false,
    }
  }

  if (q.includes('posture') || q.includes('city')) {
    if (!posture) return insufficient()
    return {
      answer: `City posture ${posture.overallRisk} (${posture.overallScore}/100 composed from residual, trust, criticality, and reach). ${posture.activeIncidents} incidents, ${posture.activeCampaigns} campaigns. Most-at-risk sector: ${posture.mostAtRiskSector || '—'}.`,
      insufficient: false,
    }
  }

  if (briefing?.assessment?.summary && blob.includes(q.slice(0, 12))) {
    return { answer: briefing.assessment.summary, insufficient: false }
  }

  if (briefing?.assessment?.summary && (q.includes('summary') || q.includes('assess'))) {
    return { answer: briefing.assessment.summary, insufficient: false }
  }

  return insufficient()
}
