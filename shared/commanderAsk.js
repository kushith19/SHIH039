import { formatEvidenceItem } from './incidents.js'

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

/**
 * Grounded Q&A over a supplied snapshot only. Does not invent telemetry.
 */
export function answerCommanderQuestion(question, snapshot) {
  const q = String(question ?? '').trim().toLowerCase()
  if (!q) return insufficient()
  const briefing = snapshot?.briefing ?? null
  const incidents = Array.isArray(snapshot?.incidents) ? snapshot.incidents : []
  const posture = snapshot?.posture ?? null
  const campaigns = Array.isArray(snapshot?.campaigns) ? snapshot.campaigns : []
  const blob = textOf(snapshot).toLowerCase()

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
      answer: `${c.title || c.campaignType}: catalog correlation ${Math.round((c.campaignMatchScore || 0) * 100)}% across ${(c.endpointIds || []).length} endpoints. Status ${c.status}. This is a pattern match, not proof of a coordinated attacker.`,
      insufficient: false,
    }
  }

  if (q.includes('affected next') || q.includes('propagate') || q.includes('blast')) {
    return insufficient()
  }

  if (q.includes('investigate first') || q.includes('what should i')) {
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
      answer: `This tick: ${incidents.length} promoted detection(s), ${campaigns.length} live pattern(s). Trajectory ${posture?.riskTrend || 'unknown'}. Not a 30-second packet capture — only match-clock detection state is available.`,
      insufficient: false,
    }
  }

  if (q.includes('posture') || q.includes('city')) {
    if (!posture) return insufficient()
    return {
      answer: `City posture ${posture.overallRisk} (${posture.overallScore}/100 composed from residual, trust, criticality, and reach). ${posture.activeIncidents} incidents, ${posture.activeCampaigns} patterns. Most-at-risk sector: ${posture.mostAtRiskSector || '—'}.`,
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
