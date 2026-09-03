/**
 * Incident-level AI Commander intelligence.
 * Formats backend commander-context into INVESTIGATE / RESPOND outputs.
 * Does not recalculate risk, propagation, or financial exposure.
 *
 * RAG note: the live SOC path (/rooms/.../commander/ask + this module) is
 * deterministic and does not call Qdrant. The cleanest RAG hook for a future
 * lab path is ai-com-v1 POST /commander/analyze with toDetectionInput(incident)
 * — same LangGraph retrieve_knowledge pipeline used for campaign briefings.
 * Do not invent a second vector store.
 */

import { detectionTypeLabel, formatEvidenceItem } from './incidents.js'

export const COMMANDER_MODES = Object.freeze({
  INVESTIGATE: 'investigate',
  RESPOND: 'respond',
})

/** Map supplied severity to response priority — no new scoring formula. */
export function responsePriorityFromContext(context) {
  const sev = String(context?.severity ?? '').toLowerCase()
  if (sev === 'critical') return 'CRITICAL'
  if (sev === 'high') return 'HIGH'
  if (sev === 'medium') return 'MEDIUM'
  if (sev === 'low') return 'LOW'
  const risk = Number(context?.riskScore)
  if (Number.isFinite(risk)) {
    if (risk >= 0.85 || risk >= 85) return 'CRITICAL'
    if (risk >= 0.65 || risk >= 65) return 'HIGH'
    if (risk >= 0.4 || risk >= 40) return 'MEDIUM'
  }
  return 'MEDIUM'
}

function assetLabel(context) {
  return (
    context?.affectedAsset?.summary ||
    context?.affectedAsset?.id ||
    'Unknown asset'
  )
}

function pathLabels(context) {
  if (Array.isArray(context?.primaryPathLabels) && context.primaryPathLabels.length) {
    return context.primaryPathLabels.map(String)
  }
  if (Array.isArray(context?.primaryPath) && context.primaryPath.length) {
    return context.primaryPath.map(String)
  }
  const paths = context?.propagationPaths
  if (paths && typeof paths === 'object') {
    const longest = Object.values(paths).sort(
      (a, b) => (Array.isArray(b) ? b.length : 0) - (Array.isArray(a) ? a.length : 0)
    )[0]
    if (Array.isArray(longest) && longest.length) return longest.map(String)
  }
  const origin = assetLabel(context)
  return origin !== 'Unknown asset' ? [origin] : []
}

function evidenceLines(context) {
  const raw = Array.isArray(context?.anomalyEvidence) ? context.anomalyEvidence : []
  return raw.map(formatEvidenceItem).filter(Boolean).slice(0, 12)
}

function formatRisk(riskScore) {
  if (riskScore == null || !Number.isFinite(Number(riskScore))) return null
  const n = Number(riskScore)
  if (n <= 1) return Math.round(n * 100)
  return Math.round(n)
}

function formatTrust(trustScore) {
  if (trustScore == null || !Number.isFinite(Number(trustScore))) return null
  return Math.round(Number(trustScore))
}

function relatedSummaries(context) {
  const related = Array.isArray(context?.relatedIncidents) ? context.relatedIncidents : []
  return related.slice(0, 8).map((r) => ({
    incidentId: r.incidentId ?? r.liveIncidentId ?? null,
    label: r.summary || r.affectedNodeId || r.incidentType || 'Related incident',
    severity: r.severity ?? null,
    incidentType: r.incidentType ?? null,
    role: 'context',
  }))
}

function simulatedFinance(context) {
  const fin = context?.financialExposure
  if (!fin || fin.simulated !== true) {
    return {
      simulated: true,
      available: false,
      exposureLabel: null,
      services: [],
      narrative:
        'No simulated financial exposure is attached to this incident context.',
    }
  }
  const services = Array.isArray(fin.affectedServiceIds)
    ? fin.affectedServiceIds.map(String)
    : Array.isArray(fin.services)
      ? fin.services.map((s) => (typeof s === 'string' ? s : s.label || s.id || s.serviceId)).filter(Boolean)
      : []
  const label = fin.exposureLabel || null
  const asset = assetLabel(context)
  let narrative =
    'SIMULATED EXPOSURE only — not actual financial loss. Values are scenario-based demo estimates.'
  if (label && label !== '₹0') {
    narrative = `SIMULATED EXPOSURE ${label} on ${asset}. This is a scenario-based estimate, not actual loss.`
    if (services.length) {
      narrative += ` Finance-tagged services in scope: ${services.slice(0, 6).join(', ')}.`
    } else if (fin.explanation) {
      narrative += ` ${fin.explanation}`
    }
    const path = pathLabels(context)
    if (path.length > 1) {
      narrative +=
        ' Propagation toward financially critical dependencies increases potential business impact along the observed path.'
    }
  }
  return {
    simulated: true,
    available: Boolean(label && label !== '₹0'),
    exposureLabel: label,
    services,
    narrative,
  }
}

/**
 * INVESTIGATE — structured "what happened and why"
 */
export function buildIncidentInvestigation(context) {
  if (!context) return null
  const asset = assetLabel(context)
  const path = pathLabels(context)
  const evidence = evidenceLines(context)
  const typeLabel = detectionTypeLabel(context.incidentType)
  const peer = Array.isArray(context.peerExposure) ? context.peerExposure : []
  const propagated = Array.isArray(context.propagatedNodeIds)
    ? context.propagatedNodeIds
    : []
  const related = relatedSummaries(context)
  const finance = simulatedFinance(context)
  const risk = formatRisk(context.riskScore)
  const trust = formatTrust(context.trustScore)

  const summary = [
    `Detected ${typeLabel || 'anomaly'} on ${asset}`,
    context.severity ? `(${String(context.severity).toUpperCase()})` : null,
    '— confirmed anomalous origin from residual detection evidence.',
  ]
    .filter(Boolean)
    .join(' ')

  const whySuspicious =
    evidence.length > 0
      ? evidence
      : [
          'No Level-1 evidence items were supplied in this incident context. Do not invent telemetry.',
        ]

  const graphLines = []
  graphLines.push(`Confirmed anomaly: ${asset}`)
  if (peer.length) {
    graphLines.push(
      `Peer exposure (not independently confirmed anomalous): ${peer.length} neighbour(s)`
    )
  }
  if (propagated.length) {
    graphLines.push(
      `Propagated risk (exposure along existing edges): ${propagated.length} node(s)`
    )
  }
  if (path.length > 1) {
    graphLines.push(`Path: ${path.join(' → ')}`)
  }

  return {
    mode: COMMANDER_MODES.INVESTIGATE,
    statusLine: `Analyzing ${asset} incident…`,
    primary: {
      incidentId: context.incidentId ?? null,
      asset,
      assetId: context.affectedAsset?.id ?? null,
      incidentType: context.incidentType ?? null,
      typeLabel: typeLabel || null,
      severity: context.severity ?? null,
      campaignId: context.campaignId ?? null,
    },
    sections: {
      incidentSummary: summary,
      whySuspicious,
      graphImpact: {
        lines: graphLines,
        pathLabels: path,
        confirmedAnomaly: asset,
        peerExposureIds: peer,
        propagatedNodeIds: propagated,
        blastRadius: context.blastRadius ?? null,
        hopDistance: context.hopDistance ?? null,
        distinction:
          'TGNN/residual anomaly ≠ peer exposure ≠ propagated risk. Only the origin is a confirmed anomaly unless related detections say otherwise.',
      },
      financialImpact: finance,
      currentState: {
        riskScore: risk,
        trustScore: trust,
        severity: context.severity ?? null,
        status: context.currentStatus || context.status || null,
      },
      relatedIncidents: related,
    },
    epistemic: {
      observed: whySuspicious.filter((l) => !l.startsWith('No Level-1')),
      calculated: [
        risk != null ? `Risk ${risk}` : null,
        trust != null ? `Trust ${trust}` : null,
        path.length > 1 ? `Propagation path ${path.join(' → ')}` : null,
      ].filter(Boolean),
      recommended: [],
      simulated: finance.available
        ? [`Simulated exposure ${finance.exposureLabel}`]
        : [],
    },
    knowledgeStatus: 'unavailable',
    ragIntegrationPoint:
      'Optional lab enrichment: POST /commander/analyze with toDetectionInput — reuses existing Qdrant RAG. Live SOC path stays deterministic.',
    source: 'deterministic-incident-intel',
  }
}

/**
 * RESPOND — structured incident response plan (advisory only)
 */
export function buildIncidentResponsePlan(context) {
  if (!context) return null
  const asset = assetLabel(context)
  const path = pathLabels(context)
  const downstream = path.length > 1 ? path.slice(1) : []
  const peer = Array.isArray(context.peerExposure) ? context.peerExposure : []
  const propagated = Array.isArray(context.propagatedNodeIds)
    ? context.propagatedNodeIds
    : []
  const protectTargets = [
    ...new Set(
      [
        ...downstream,
        ...peer.map(String),
        ...propagated.map(String),
      ].filter((id) => id && id !== context.affectedAsset?.id && id !== asset)
    ),
  ].slice(0, 6)
  const protectLabels =
    downstream.length > 0
      ? downstream
      : protectTargets.length
        ? protectTargets
        : []
  const priority = responsePriorityFromContext(context)
  const evidence = evidenceLines(context)
  const finance = simulatedFinance(context)

  const plan = [
    {
      step: 1,
      phase: 'contain',
      title: 'CONTAIN',
      action: `Isolate the confirmed anomalous ${asset} network segment and restrict suspicious communications while preserving monitoring.`,
      rationale:
        'Contain the detected origin only. Do not automatically isolate every propagated or peer-exposed node.',
      recommended: true,
      executable: false,
    },
    {
      step: 2,
      phase: 'protect',
      title: 'PROTECT',
      action:
        protectLabels.length > 0
          ? `Increase monitoring and protect downstream / exposed services: ${protectLabels.join(', ')}.`
          : `Increase monitoring on neighbours of ${asset}; no downstream path was supplied in context.`,
      rationale:
        'Propagated and peer-exposed nodes are potentially affected — protect and watch, do not treat as confirmed compromised.',
      recommended: true,
      executable: false,
    },
    {
      step: 3,
      phase: 'verify',
      title: 'VERIFY',
      action: [
        evidence.length
          ? 'Re-validate Level-1 detection evidence on the origin endpoint.'
          : 'Inspect origin telemetry against expected load.',
        protectLabels.length
          ? 'Check whether propagated nodes show independent anomaly evidence before treating them as compromised.'
          : null,
        'Validate trust recovery after containment.',
        finance.available
          ? 'Confirm simulated financial exposure remains labelled scenario-based — not actual loss.'
          : null,
      ]
        .filter(Boolean)
        .join(' '),
      rationale: 'Only recommend checks grounded in supplied incident context.',
      recommended: true,
      executable: false,
    },
    {
      step: 4,
      phase: 'recover',
      title: 'RECOVER',
      action: `Restore normal connectivity only after the originating anomaly on ${asset} clears and affected dependencies return to an acceptable trust state.`,
      rationale: 'Recovery is operator-led. Commander does not execute infrastructure actions.',
      recommended: true,
      executable: false,
    },
  ]

  return {
    mode: COMMANDER_MODES.RESPOND,
    statusLine: `Building response plan for ${asset}…`,
    primary: {
      incidentId: context.incidentId ?? null,
      asset,
      severity: context.severity ?? null,
    },
    priority,
    plan,
    sections: {
      graphImpact: {
        pathLabels: path,
        confirmedAnomaly: asset,
        distinction:
          'Isolate confirmed anomaly; monitor exposed / propagated dependencies.',
      },
      financialImpact: finance,
      relatedIncidents: relatedSummaries(context),
    },
    epistemic: {
      observed: evidenceLines(context),
      calculated: [
        `Priority ${priority} from supplied severity/risk`,
        path.length > 1 ? `Path ${path.join(' → ')}` : null,
      ].filter(Boolean),
      recommended: plan.map((p) => `${p.title}: ${p.action}`),
      simulated: finance.available
        ? [`Simulated exposure ${finance.exposureLabel}`]
        : [],
    },
    knowledgeStatus: 'unavailable',
    ragIntegrationPoint:
      'Optional lab enrichment: POST /commander/analyze with toDetectionInput — reuses existing Qdrant RAG. Live SOC path stays deterministic.',
    source: 'deterministic-incident-intel',
  }
}

export function buildIncidentIntel(context, mode = COMMANDER_MODES.INVESTIGATE) {
  const m = String(mode ?? '').toLowerCase()
  if (m === COMMANDER_MODES.RESPOND || m === 'response') {
    return buildIncidentResponsePlan(context)
  }
  return buildIncidentInvestigation(context)
}
