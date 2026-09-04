/**
 * Compact RAG retrieval query from live commander context.
 * Only uses fields present on context — does not invent MITRE IDs or classifications.
 */

function pushUnique(parts, value) {
  const s = String(value ?? '').trim()
  if (!s) return
  const lower = s.toLowerCase()
  if (parts.some((p) => p.toLowerCase() === lower)) return
  parts.push(s)
}

function evidenceHints(context) {
  const raw = Array.isArray(context?.anomalyEvidence) ? context.anomalyEvidence : []
  const hints = []
  for (const ev of raw.slice(0, 8)) {
    if (ev?.metric) pushUnique(hints, String(ev.metric).replace(/([A-Z])/g, ' $1').toLowerCase())
    if (ev?.code) pushUnique(hints, String(ev.code).replace(/_/g, ' '))
    if (ev?.kind) pushUnique(hints, String(ev.kind).replace(/_/g, ' '))
  }
  return hints
}

function mitreFromContextOnly(context) {
  const candidates =
    context?.mitreCandidates ||
    context?.mitre ||
    (Array.isArray(context?.primary?.mitreCandidates) ? context.primary.mitreCandidates : null)
  if (!Array.isArray(candidates)) return []
  return candidates
    .map((c) => c?.techniqueId || c?.technique_id || c?.id)
    .filter(Boolean)
    .map(String)
    .slice(0, 4)
}

/**
 * @param {object|null|undefined} context commander-context
 * @returns {{ query: string, hints: object }}
 */
export function buildKnowledgeRetrievalQuery(context) {
  const parts = []
  const type =
    context?.incidentType ||
    context?.detectionType ||
    context?.primary?.typeLabel ||
    null
  if (type) pushUnique(parts, String(type).replace(/_/g, ' '))

  const asset =
    context?.affectedAsset?.summary ||
    context?.affectedAsset?.id ||
    null
  if (asset) pushUnique(parts, asset)

  const sector = context?.affectedAsset?.sector || context?.sector || null
  if (sector) pushUnique(parts, sector)

  const preset =
    context?.attackType ||
    context?.presetType ||
    context?.campaignType ||
    null
  if (preset) pushUnique(parts, String(preset).replace(/_/g, ' '))

  const evHints = evidenceHints(context)
  for (const h of evHints.slice(0, 4)) pushUnique(parts, h)

  const path =
    (Array.isArray(context?.primaryPathLabels) && context.primaryPathLabels) ||
    (Array.isArray(context?.primaryPath) && context.primaryPath) ||
    []
  if (path.length > 1) {
    pushUnique(parts, `propagation ${path.slice(0, 3).join(' ')}`)
  }

  const mitre = mitreFromContextOnly(context)
  for (const id of mitre) pushUnique(parts, id)

  const query = parts.join(' ').replace(/\s+/g, ' ').trim() || 'cybersecurity incident response anomaly'

  return {
    query,
    hints: {
      incidentType: type ? String(type) : null,
      detectionType: type ? String(type) : null,
      asset: asset ? String(asset) : null,
      sector: sector ? String(sector) : null,
      attackType: preset ? String(preset) : null,
      evidenceHints: evHints,
      mitreCandidates: mitre,
      pathLabels: path.map(String).slice(0, 6),
    },
  }
}

/**
 * @param {string} question
 * @returns {boolean}
 */
export function isKnowledgeFollowUpQuestion(question) {
  const q = String(question ?? '').trim().toLowerCase()
  if (!q) return false
  // Live-fact / plan questions stay deterministic
  if (
    q.includes('response plan') ||
    q.includes('what should i do') ||
    q.includes('financial') ||
    q.includes('rupee') ||
    q.includes('₹') ||
    q.includes('isolate every') ||
    q.includes('related incident') ||
    q.includes('priority')
  ) {
    return false
  }
  const knowledgeSignals = [
    'why did this happen',
    'why is this',
    'what does this',
    'what does that',
    'attack pattern',
    'how does this attack',
    'how can this',
    'prevent',
    'prevention',
    'harden',
    'hardening',
    'vulnerable',
    'vulnerability',
    'what does this mean',
    'pattern mean',
    'commonly',
    'best practice',
    'defensive',
    'mitre',
    'ttp',
    'technique',
    'knowledge',
  ]
  return knowledgeSignals.some((s) => q.includes(s))
}

/**
 * Live facts block for knowledge ask (Observed / Evidence).
 */
export function liveFactsFromContext(context) {
  if (!context) return { observed: '', evidence: [], summary: '' }
  const asset =
    context.affectedAsset?.summary || context.affectedAsset?.id || 'endpoint'
  const evidence = Array.isArray(context.anomalyEvidence)
    ? context.anomalyEvidence.map((ev) => {
        const metric = ev?.metric || ev?.code || 'metric'
        const obs = ev?.observed ?? ev?.current
        const exp = ev?.expected ?? ev?.previous
        const dev = ev?.deviationPct
        if (obs != null && exp != null) {
          return `${metric}: observed ${obs}, expected ${exp}${dev != null ? ` (${dev}% deviation)` : ''}`
        }
        return ev?.detail || String(metric)
      })
    : []
  const path =
    (Array.isArray(context.primaryPathLabels) && context.primaryPathLabels) ||
    (Array.isArray(context.primaryPath) && context.primaryPath) ||
    []
  const fin = context.financialExposure
  const financial =
    fin && fin.simulated === true
      ? {
          simulated: true,
          exposureLabel: fin.exposureLabel ?? null,
          breakdown: Array.isArray(fin.breakdown)
            ? fin.breakdown.slice(0, 8).map((row) => ({
                id: row?.id ?? null,
                label: row?.label ?? null,
                exposureLabel: row?.exposureLabel ?? null,
              }))
            : [],
        }
      : null
  const summary = `${asset} flagged as ${context.incidentType || 'anomaly'} at severity ${context.severity || '—'}`
  return {
    observed: summary,
    summary,
    evidence: evidence.slice(0, 8),
    asset,
    incidentId: context.incidentId ?? null,
    incidentType: context.incidentType ?? null,
    severity: context.severity ?? null,
    riskScore: context.riskScore ?? null,
    trustScore: context.trustScore ?? null,
    anomalyScore: context.anomalyScore ?? context.isolationScore ?? null,
    primaryPathLabels: path.map(String).slice(0, 8),
    propagatedNodeIds: Array.isArray(context.propagatedNodeIds)
      ? context.propagatedNodeIds.map(String).slice(0, 12)
      : [],
    peerNodeIds: Array.isArray(context.peerNodeIds)
      ? context.peerNodeIds.map(String).slice(0, 12)
      : Array.isArray(context.peerExposedNodeIds)
        ? context.peerExposedNodeIds.map(String).slice(0, 12)
        : [],
    financialExposure: financial,
    responseClassification:
      context.responseClassification ?? context.classification ?? null,
  }
}

/**
 * Attach knowledgeContext without mutating response plan.
 * @returns {object} new intel object
 */
export function attachKnowledgeContext(intel, knowledgeContext) {
  if (!intel || typeof intel !== 'object') return intel
  const kc =
    knowledgeContext && typeof knowledgeContext === 'object'
      ? knowledgeContext
      : {
          retrieved: false,
          reason: 'Knowledge retrieval unavailable',
          knowledgeStatus: 'unavailable',
          attackUnderstanding: [],
          relevantKnowledge: [],
          preventionGuidance: [],
          sources: [],
        }
  const next = {
    ...intel,
    knowledgeContext: kc,
    knowledgeStatus:
      kc.knowledgeStatus ||
      kc.knowledge_status ||
      (kc.retrieved ? 'success' : 'unavailable'),
  }
  // Plan isolation: never copy plan fields from knowledge payload
  if (kc.responsePlan || kc.response_plan || kc.actionId || kc.actions) {
    /* ignore — knowledge must not alter plan */
  }
  if (Array.isArray(intel.plan)) {
    next.plan = intel.plan.map((step) => ({ ...step }))
  }
  return next
}
