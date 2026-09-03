/**
 * Stage 1 — deterministic response-profile classification for Commander.
 *
 * Classification only. Does not generate plans, actionIds, or execute anything.
 * Works without attack presetId (preset is not reliably persisted today).
 *
 * Precedence (strongest first):
 *   A. PROPAGATED_EXPOSURE
 *   B. IDENTITY_CREDENTIAL_ATTACK   (strong failed-login signature)
 *   C. DATA_EXFILTRATION            (strong filesDownloaded)
 *   D. SERVICE_API_ABUSE            (strong HTTP)
 *   E. NETWORK_TRAFFIC_FLOOD        (strong PPS)
 *   F. OT_INFRASTRUCTURE_ANOMALY    (OT/cyber-physical node type)
 *   G. FINANCIAL_SERVICE_COMPROMISE (finance context, no stronger signature)
 *   H. GENERAL_RESIDUAL_ANOMALY     (confirmed seed fallback)
 *
 * Dominant metric: highest abs(deviationPct) among live game metrics.
 * Ties resolve in this order: failedLoginsPerMin → filesDownloaded →
 * httpRequestsPerMin → packetsPerSecond (aligned with B–E precedence).
 */

import {
  affectedNodeIdFromContext,
  isExposureIncidentContext,
} from './responseActions.js'

export const RESPONSE_PROFILES = Object.freeze({
  PROPAGATED_EXPOSURE: 'PROPAGATED_EXPOSURE',
  IDENTITY_CREDENTIAL_ATTACK: 'IDENTITY_CREDENTIAL_ATTACK',
  DATA_EXFILTRATION: 'DATA_EXFILTRATION',
  SERVICE_API_ABUSE: 'SERVICE_API_ABUSE',
  NETWORK_TRAFFIC_FLOOD: 'NETWORK_TRAFFIC_FLOOD',
  OT_INFRASTRUCTURE_ANOMALY: 'OT_INFRASTRUCTURE_ANOMALY',
  FINANCIAL_SERVICE_COMPROMISE: 'FINANCIAL_SERVICE_COMPROMISE',
  GENERAL_RESIDUAL_ANOMALY: 'GENERAL_RESIDUAL_ANOMALY',
})

export const CLASSIFICATION_CONFIDENCE = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
})

/** Live encoder / game metrics used for signature inference. */
export const RESPONSE_METRICS = Object.freeze([
  'failedLoginsPerMin',
  'filesDownloaded',
  'httpRequestsPerMin',
  'packetsPerSecond',
])

/** Abs deviation % at or above this counts as a strong attack signature. */
export const STRONG_METRIC_DEVIATION_PCT = 80

/** Repository OT / cyber-physical catalog types (live + known catalog). */
const OT_NODE_TYPES = new Set([
  'power_grid',
  'power_substation',
  'plc_controller',
  'ev_infrastructure',
  'water_supply',
  'wastewater_sewage',
  'flood_management',
  'smart_actuator',
])

/** Identity / authentication catalog types. */
const IDENTITY_NODE_TYPES = new Set([
  'identity_access',
  'hospital_auth',
  'customer_identity_service',
])

/** Finance catalog types on the live canvas / mappings. */
const FINANCE_NODE_TYPES = new Set([
  'banking_financial',
  'bank_gateway',
  'payment_processing_system',
  'digital_banking_platform',
  'atm_network_gateway',
  'card_processing_system',
  'fraud_detection_system',
  'transaction_monitoring_system',
  'interbank_payment_gateway',
  'atm_switching_system',
  'financial_data_platform',
  'core_banking_backup',
])

const TIE_BREAK_METRICS = Object.freeze([
  'failedLoginsPerMin',
  'filesDownloaded',
  'httpRequestsPerMin',
  'packetsPerSecond',
])

function snake(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function evidenceList(context) {
  return [
    ...(Array.isArray(context?.anomalyEvidence) ? context.anomalyEvidence : []),
    ...(Array.isArray(context?.evidence) ? context.evidence : []),
  ]
}

/**
 * Collect abs(deviationPct) per live metric from Level-1 evidence.
 * @returns {Map<string, number>}
 */
export function metricDeviationStrengths(context) {
  const strengths = new Map()
  for (const ev of evidenceList(context)) {
    const code = String(ev?.code ?? '')
    if (code !== 'metric_deviation' && code !== 'edge_pps') continue
    let metric = String(ev?.metric ?? '').trim()
    if (code === 'edge_pps') metric = 'packetsPerSecond'
    if (!RESPONSE_METRICS.includes(metric)) continue
    const pct = Math.abs(Number(ev?.deviationPct))
    if (!Number.isFinite(pct)) continue
    const prev = strengths.get(metric) ?? 0
    if (pct > prev) strengths.set(metric, pct)
  }
  return strengths
}

/**
 * Dominant anomalous metric from evidence, or null if none.
 * Tie-break: failedLogins → files → http → packetsPerSecond.
 */
export function inferDominantMetric(context) {
  const strengths = metricDeviationStrengths(context)
  if (strengths.size === 0) return null
  let bestMetric = null
  let bestPct = -Infinity
  for (const metric of TIE_BREAK_METRICS) {
    const pct = strengths.get(metric)
    if (pct == null) continue
    if (pct > bestPct) {
      bestPct = pct
      bestMetric = metric
    }
  }
  // Any other metric keys (should not happen for live set)
  for (const [metric, pct] of strengths) {
    if (pct > bestPct) {
      bestPct = pct
      bestMetric = metric
    }
  }
  return bestMetric
}

function strengthOf(strengths, metric) {
  return strengths.get(metric) ?? 0
}

function isStrong(strengths, metric) {
  return strengthOf(strengths, metric) >= STRONG_METRIC_DEVIATION_PCT
}

export function nodeTypeFromContext(context) {
  const raw =
    context?.affectedAsset?.type ??
    context?.affectedAsset?.assetType ??
    context?.nodeType ??
    context?.assetType ??
    null
  const t = snake(raw)
  return t || null
}

export function sectorFromContext(context) {
  const raw = context?.affectedAsset?.sector ?? context?.sector ?? null
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  return s || null
}

export function isOtNodeType(type) {
  return OT_NODE_TYPES.has(snake(type))
}

export function isIdentityNodeType(type) {
  return IDENTITY_NODE_TYPES.has(snake(type))
}

export function isFinanceNodeType(type) {
  return FINANCE_NODE_TYPES.has(snake(type))
}

function isFinanceSector(sector) {
  const s = String(sector ?? '').toLowerCase()
  return s.includes('finance') || s === 'financial'
}

function hasSimulatedFinance(context) {
  const fin = context?.financialExposure
  if (!fin || fin.simulated !== true) return false
  if (fin.available === true) return true
  const label = fin.exposureLabel
  return Boolean(label && label !== '₹0')
}

function isFinanceContext(context) {
  const type = nodeTypeFromContext(context)
  if (type && isFinanceNodeType(type)) return true
  if (isFinanceSector(sectorFromContext(context))) return true
  return hasSimulatedFinance(context)
}

/**
 * Lookup type / sector / criticality / quarantined for an affected node from room nodes.
 * quarantined mirrors runtimeState.quarantined (existing simulator field — not invented).
 */
export function assetMetaFromNodes(nodeId, nodes = []) {
  const id = String(nodeId ?? '').trim()
  if (!id) return null
  for (const raw of nodes ?? []) {
    if (!raw || String(raw.id) !== id) continue
    const data = raw.data && typeof raw.data === 'object' ? raw.data : raw
    const type = snake(data.type ?? data.assetType ?? '') || null
    const sector = String(data.sector ?? data.category ?? '').trim() || null
    const criticality = String(data.criticality ?? data.defaultCriticality ?? '').trim() || null
    const rs =
      data.runtimeState && typeof data.runtimeState === 'object' ? data.runtimeState : {}
    const quarantined = rs.quarantined === true || data.quarantined === true
    return { type, sector, criticality, quarantined }
  }
  return null
}

/**
 * Enrich affectedAsset with type/sector/criticality/quarantined from room nodes (additive).
 */
export function enrichAffectedAssetMeta(context, nodes = []) {
  if (!context || typeof context !== 'object') return context
  const nodeId = affectedNodeIdFromContext(context)
  const meta = assetMetaFromNodes(nodeId, nodes)
  if (!meta) return context
  const prev = context.affectedAsset && typeof context.affectedAsset === 'object'
    ? context.affectedAsset
    : { id: nodeId }
  return {
    ...context,
    affectedAsset: {
      ...prev,
      ...(meta.type ? { type: meta.type } : {}),
      ...(meta.sector ? { sector: meta.sector } : {}),
      ...(meta.criticality ? { criticality: meta.criticality } : {}),
      quarantined: meta.quarantined === true,
    },
  }
}

/** actionsAlreadyTaken (commander) or actionsTaken (incident) — existing history. */
export function actionsTakenFromContext(context) {
  if (Array.isArray(context?.actionsAlreadyTaken)) return context.actionsAlreadyTaken
  if (Array.isArray(context?.actionsTaken)) return context.actionsTaken
  return []
}

/**
 * True when Commander previously recorded isolate-node for this target.
 */
export function hasPriorCommanderIsolate(context, nodeId = null) {
  const id = String(nodeId ?? affectedNodeIdFromContext(context) ?? '').trim()
  if (!id) return false
  return actionsTakenFromContext(context).some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    if (String(entry.actionId) !== 'isolate-node') return false
    if (String(entry.targetNodeId ?? '') !== id) return false
    const status = String(entry.status ?? '')
    return status === 'EXECUTED' || status === 'ALREADY_EXECUTED'
  })
}

/** Quarantine flag from enriched affectedAsset / runtimeState already on context. */
export function isAffectedNodeQuarantined(context) {
  if (!context || typeof context !== 'object') return false
  if (context.affectedAsset?.quarantined === true) return true
  if (context.affectedAsset?.runtimeState?.quarantined === true) return true
  if (context.runtimeState?.quarantined === true) return true
  return false
}

function result({
  responseProfile,
  classificationConfidence,
  reasons,
  dominantMetric,
  isSeed,
  isExposureOnly,
  otSafety,
}) {
  return Object.freeze({
    responseProfile,
    classificationConfidence,
    reasons: Object.freeze([...reasons]),
    dominantMetric,
    isSeed: Boolean(isSeed),
    isExposureOnly: Boolean(isExposureOnly),
    otSafety: Boolean(otSafety),
  })
}

/**
 * Deterministic response profile from commander / incident context.
 * @param {object|null} context
 */
export function classifyResponseProfile(context) {
  if (!context || typeof context !== 'object') {
    return result({
      responseProfile: RESPONSE_PROFILES.GENERAL_RESIDUAL_ANOMALY,
      classificationConfidence: CLASSIFICATION_CONFIDENCE.LOW,
      reasons: ['No incident context was supplied for classification'],
      dominantMetric: null,
      isSeed: false,
      isExposureOnly: false,
      otSafety: false,
    })
  }

  const exposureOnly = isExposureIncidentContext(context)
  const nodeId = affectedNodeIdFromContext(context)
  const isSeed = Boolean(nodeId) && !exposureOnly
  const type = nodeTypeFromContext(context)
  const otSafety = isOtNodeType(type)
  const strengths = metricDeviationStrengths(context)
  const dominantMetric = inferDominantMetric(context)
  const financeCtx = isFinanceContext(context)

  // A. Propagated / peer exposure — never treat as confirmed attacker
  if (exposureOnly) {
    return result({
      responseProfile: RESPONSE_PROFILES.PROPAGATED_EXPOSURE,
      classificationConfidence: CLASSIFICATION_CONFIDENCE.HIGH,
      reasons: [
        'Node is exposed through graph propagation or peer exposure but is not a confirmed anomaly seed',
      ],
      dominantMetric,
      isSeed: false,
      isExposureOnly: true,
      otSafety,
    })
  }

  const strongLogin = isStrong(strengths, 'failedLoginsPerMin')
  const strongFiles = isStrong(strengths, 'filesDownloaded')
  const strongHttp = isStrong(strengths, 'httpRequestsPerMin')
  const strongPps = isStrong(strengths, 'packetsPerSecond')
  const identityNode = isIdentityNodeType(type)

  // B. Identity / credential — strong failed-login signature only at this tier
  // (identity node type without a strong login signal is handled after metric tiers)
  if (strongLogin) {
    const reasons = ['failedLoginsPerMin is the dominant anomalous metric']
    if (identityNode) {
      reasons.push('Affected node is an identity/authentication service')
    }
    if (financeCtx) reasons.push('financial_service_context')
    return result({
      responseProfile: RESPONSE_PROFILES.IDENTITY_CREDENTIAL_ATTACK,
      classificationConfidence: CLASSIFICATION_CONFIDENCE.HIGH,
      reasons,
      dominantMetric: dominantMetric || 'failedLoginsPerMin',
      isSeed,
      isExposureOnly: false,
      otSafety,
    })
  }

  // C. Data exfiltration
  if (strongFiles) {
    const reasons = ['filesDownloaded is the dominant anomalous metric']
    if (financeCtx) reasons.push('financial_service_context')
    return result({
      responseProfile: RESPONSE_PROFILES.DATA_EXFILTRATION,
      classificationConfidence: CLASSIFICATION_CONFIDENCE.HIGH,
      reasons,
      dominantMetric: dominantMetric || 'filesDownloaded',
      isSeed,
      isExposureOnly: false,
      otSafety,
    })
  }

  // D. API / service abuse
  if (strongHttp) {
    const reasons = ['httpRequestsPerMin is the dominant anomalous metric']
    if (financeCtx) reasons.push('financial_service_context')
    return result({
      responseProfile: RESPONSE_PROFILES.SERVICE_API_ABUSE,
      classificationConfidence: CLASSIFICATION_CONFIDENCE.HIGH,
      reasons,
      dominantMetric: dominantMetric || 'httpRequestsPerMin',
      isSeed,
      isExposureOnly: false,
      otSafety,
    })
  }

  // E. Network traffic flood
  if (strongPps) {
    const reasons = ['packetsPerSecond is the dominant anomalous metric']
    if (financeCtx) reasons.push('financial_service_context')
    if (type && (type.includes('gateway') || type.includes('telecom'))) {
      reasons.push(`Affected node type suggests a communication path (${type})`)
    }
    return result({
      responseProfile: RESPONSE_PROFILES.NETWORK_TRAFFIC_FLOOD,
      classificationConfidence: CLASSIFICATION_CONFIDENCE.HIGH,
      reasons,
      dominantMetric: dominantMetric || 'packetsPerSecond',
      isSeed,
      isExposureOnly: false,
      otSafety,
    })
  }

  // F. OT / cyber-physical (no stronger metric signature)
  if (otSafety) {
    return result({
      responseProfile: RESPONSE_PROFILES.OT_INFRASTRUCTURE_ANOMALY,
      classificationConfidence: CLASSIFICATION_CONFIDENCE.HIGH,
      reasons: [
        'Affected node belongs to an OT/cyber-physical asset class',
        'Physical-process intervention is not implied',
      ],
      dominantMetric,
      isSeed,
      isExposureOnly: false,
      otSafety: true,
    })
  }

  // G. Finance as primary only when no stronger attack signature
  if (financeCtx) {
    const reasons = []
    if (type && isFinanceNodeType(type)) {
      reasons.push(`Affected node is a finance-mapped service (${type})`)
    } else if (isFinanceSector(sectorFromContext(context))) {
      reasons.push('Affected asset sector is finance')
    }
    if (hasSimulatedFinance(context)) {
      reasons.push('Simulated financial exposure is attached to this seed context')
    }
    return result({
      responseProfile: RESPONSE_PROFILES.FINANCIAL_SERVICE_COMPROMISE,
      classificationConfidence:
        type && isFinanceNodeType(type)
          ? CLASSIFICATION_CONFIDENCE.MEDIUM
          : CLASSIFICATION_CONFIDENCE.MEDIUM,
      reasons: reasons.length ? reasons : ['Finance context without a stronger metric signature'],
      dominantMetric,
      isSeed,
      isExposureOnly: false,
      otSafety: false,
    })
  }

  // Identity node without login metric still hints identity (weaker)
  if (identityNode) {
    return result({
      responseProfile: RESPONSE_PROFILES.IDENTITY_CREDENTIAL_ATTACK,
      classificationConfidence: CLASSIFICATION_CONFIDENCE.MEDIUM,
      reasons: ['Affected node is an identity/authentication service'],
      dominantMetric,
      isSeed,
      isExposureOnly: false,
      otSafety,
    })
  }

  // H. Generic residual
  const reasons = ['Confirmed residual anomaly without a stronger metric or domain signature']
  if (dominantMetric) {
    reasons.unshift(
      `${dominantMetric} is present in evidence but below the strong-signature threshold`
    )
  }
  return result({
    responseProfile: RESPONSE_PROFILES.GENERAL_RESIDUAL_ANOMALY,
    classificationConfidence: CLASSIFICATION_CONFIDENCE.LOW,
    reasons,
    dominantMetric,
    isSeed,
    isExposureOnly: false,
    otSafety: false,
  })
}

/**
 * Enrich asset meta from room nodes and attach namespaced responseClassification.
 * Does not alter availableActions, plans, or execution fields.
 */
export function attachResponseClassification(context, nodes = []) {
  if (!context || typeof context !== 'object') return context
  const enriched = enrichAffectedAssetMeta(context, nodes)
  const responseClassification = classifyResponseProfile(enriched)
  return {
    ...enriched,
    responseClassification,
  }
}

function step(n, phase, title, action, rationale) {
  return {
    step: n,
    phase,
    title,
    action,
    rationale,
    recommended: true,
    executable: false,
  }
}

function protectListText(protectLabels) {
  if (Array.isArray(protectLabels) && protectLabels.length > 0) {
    return protectLabels.join(', ')
  }
  return null
}

function classificationOf(context) {
  if (context?.responseClassification?.responseProfile) {
    return context.responseClassification
  }
  return classifyResponseProfile(context)
}

/**
 * Stage 2 — advisory CONTAIN/PROTECT/VERIFY/RECOVER steps from responseClassification.
 * Deterministic; no actionIds; no execution; no RAG.
 *
 * @param {object} context - commander context (classification used if present, else classified)
 * @param {{ asset: string, protectLabels?: string[], financeAvailable?: boolean, evidencePresent?: boolean }} view
 * @returns {object[]} four plan steps matching existing UI schema
 */
export function buildAdvisoryResponsePlanPhases(context, view = {}) {
  const asset = String(view.asset ?? 'Unknown asset')
  const protectLabels = Array.isArray(view.protectLabels) ? view.protectLabels : []
  const protectText = protectListText(protectLabels)
  const financeAvailable = view.financeAvailable === true
  const evidencePresent = view.evidencePresent === true
  const cls = classificationOf(context)
  const profile = cls.responseProfile || RESPONSE_PROFILES.GENERAL_RESIDUAL_ANOMALY
  const confidence = cls.classificationConfidence || CLASSIFICATION_CONFIDENCE.LOW
  const dominant = cls.dominantMetric || null
  const metricHint = dominant ? `${dominant}` : null

  const protectGeneric = protectText
    ? `Increase monitoring on path / exposed dependencies (not confirmed compromised): ${protectText}.`
    : `Increase monitoring on neighbours of ${asset}; no downstream path was supplied in context.`

  const verifyPeers = protectText
    ? 'Check whether propagated or peer-exposed nodes show independent anomaly evidence before treating them as compromised.'
    : null

  const financeVerify = financeAvailable
    ? 'Confirm simulated financial exposure remains labelled scenario-based — not actual loss.'
    : null

  /** @type {Record<string, () => object[]>} */
  const builders = {
    [RESPONSE_PROFILES.PROPAGATED_EXPOSURE]: () => [
      step(
        1,
        'contain',
        'CONTAIN',
        `Do not isolate ${asset}. Keep this node under observation — it is graph-exposed / peer-exposed, not a confirmed anomaly seed.`,
        'Propagated and peer-exposed nodes are context, not confirmed attackers. Isolation applies only to independently confirmed seeds.'
      ),
      step(
        2,
        'protect',
        'PROTECT',
        protectText
          ? `Monitor the exposure path and dependencies involving ${asset}: ${protectText}.`
          : `Monitor neighbours and path context around ${asset} until independent residual evidence appears.`,
        'Protect and watch exposure paths without treating them as confirmed compromise.'
      ),
      step(
        3,
        'verify',
        'VERIFY',
        [
          'Look for independent Level-1 residual or metric evidence on this node before treating it as compromised.',
          evidencePresent
            ? 'Treat any attached exposure evidence as graph context, not confirmation of origin compromise.'
            : null,
          'Do not escalate to seed containment without a confirmed TGNN/residual seed.',
        ]
          .filter(Boolean)
          .join(' '),
        'Verification must establish an independent anomaly before containment.'
      ),
      step(
        4,
        'recover',
        'RECOVER',
        `Return ${asset} to normal monitoring once exposure and residual conditions clear on the confirmed origin path.`,
        'Recovery here means ending heightened observation — not lifting a quarantine that was never applied to this node.'
      ),
    ],

    [RESPONSE_PROFILES.NETWORK_TRAFFIC_FLOOD]: () => [
      step(
        1,
        'contain',
        'CONTAIN',
        `Recommended action: Isolate Node on ${asset}. ${asset} shows a packet-rate / traffic-flood signature${
          metricHint ? ` (${metricHint})` : ''
        }; isolation is intended to stop the attack-driven traffic source while preserving monitoring.`,
        'Contain the confirmed flood origin only. Do not automatically isolate every propagated or peer-exposed node.'
      ),
      step(
        2,
        'protect',
        'PROTECT',
        protectText
          ? `Protect downstream bandwidth and service dependencies along the observed path: ${protectText}. These nodes are potentially impacted — not independently confirmed compromised.`
          : `Protect neighbouring services of ${asset} from flood spillover; no downstream path was supplied in context.`,
        'Focus on dependency and bandwidth impact. Propagated nodes remain exposure context until independently confirmed.'
      ),
      step(
        3,
        'verify',
        'VERIFY',
        [
          metricHint
            ? `Re-validate ${metricHint} and related Level-1 flood evidence on the origin.`
            : 'Re-validate packet-rate / traffic evidence on the origin.',
          'Confirm packet rates move toward expected load after containment.',
          verifyPeers,
          'Validate trust recovery after containment.',
          financeVerify,
        ]
          .filter(Boolean)
          .join(' '),
        'Verify traffic normalization on the seed before treating downstream nodes as compromised.'
      ),
      step(
        4,
        'recover',
        'RECOVER',
        `Restore connectivity only after the originating anomaly has cleared and the endpoint is ready for operator-led recovery.`,
        'Recovery is operator-led via Restore Connectivity when policy conditions are met. The response plan itself is not executable.'
      ),
    ],

    [RESPONSE_PROFILES.IDENTITY_CREDENTIAL_ATTACK]: () => [
      step(
        1,
        'contain',
        'CONTAIN',
        `Recommended action: Isolate Node on ${asset}. Contain the endpoint generating abnormal failed-login / credential activity${
          metricHint ? ` (${metricHint})` : ''
        }. This is an identity-abuse signature — not a network flood.`,
        'Contain the confirmed authentication anomaly origin only. Do not automatically isolate every propagated or peer-exposed node.'
      ),
      step(
        2,
        'protect',
        'PROTECT',
        protectText
          ? `Protect identity and authentication dependents on the path: ${protectText}. Monitor federated services without treating them as confirmed compromised.`
          : `Increase monitoring on identity/authentication neighbours of ${asset}.`,
        'Focus on auth-dependent services. Exposure ≠ confirmed compromise.'
      ),
      step(
        3,
        'verify',
        'VERIFY',
        [
          metricHint
            ? `Re-validate ${metricHint} and authentication-related Level-1 evidence on the origin.`
            : 'Re-validate failed-login / authentication evidence on the origin.',
          'Advisory only: consider credential rotation or MFA review for affected accounts — the simulator does not execute account changes.',
          verifyPeers,
          'Validate trust recovery after containment.',
          financeVerify,
        ]
          .filter(Boolean)
          .join(' '),
        'Verify authentication behaviour normalizes; credential hygiene remains advisory.'
      ),
      step(
        4,
        'recover',
        'RECOVER',
        `Restore connectivity only after the originating anomaly has cleared and the endpoint is ready for operator-led recovery.`,
        'Recovery is operator-led via Restore Connectivity when policy conditions are met. The response plan itself is not executable.'
      ),
    ],

    [RESPONSE_PROFILES.DATA_EXFILTRATION]: () => [
      step(
        1,
        'contain',
        'CONTAIN',
        `Recommended action: Isolate Node on ${asset}. Containment is intended to stop abnormal bulk file-transfer behaviour from the origin${
          metricHint ? ` (${metricHint})` : ''
        }.`,
        'Contain the confirmed exfiltration origin only. Do not automatically isolate every propagated or peer-exposed node.'
      ),
      step(
        2,
        'protect',
        'PROTECT',
        protectText
          ? `Protect data-bearing and sensitive downstream dependencies: ${protectText}. Monitor mapped services without treating them as confirmed compromised.`
          : `Increase monitoring on data-bearing neighbours of ${asset}.`,
        'Focus on data and sensitive dependency impact. Exposure ≠ confirmed compromise.'
      ),
      step(
        3,
        'verify',
        'VERIFY',
        [
          metricHint
            ? `Re-validate ${metricHint} / file-transfer Level-1 evidence on the origin.`
            : 'Re-validate file-transfer evidence on the origin.',
          'Advisory only: preserve forensic evidence and review transfer destinations — the simulator does not run DLP.',
          verifyPeers,
          'Validate trust recovery after containment.',
          financeVerify,
        ]
          .filter(Boolean)
          .join(' '),
        'Verify transfer behaviour normalizes; forensic steps remain advisory.'
      ),
      step(
        4,
        'recover',
        'RECOVER',
        `Restore connectivity only after the originating anomaly has cleared and the endpoint is ready for operator-led recovery.`,
        'Recovery is operator-led via Restore Connectivity when policy conditions are met. The response plan itself is not executable.'
      ),
    ],

    [RESPONSE_PROFILES.SERVICE_API_ABUSE]: () => [
      step(
        1,
        'contain',
        'CONTAIN',
        `Recommended action: Isolate Node on ${asset}. Containment is intended to stop abnormal HTTP/API request volume from the origin${
          metricHint ? ` (${metricHint})` : ''
        }.`,
        'Contain the confirmed API-abuse origin only. Do not automatically isolate every propagated or peer-exposed node.'
      ),
      step(
        2,
        'protect',
        'PROTECT',
        protectText
          ? `Protect API-facing and service dependencies: ${protectText}. Monitor without treating them as confirmed compromised.`
          : `Increase monitoring on API-facing neighbours of ${asset}.`,
        'Focus on service/API dependency impact. Exposure ≠ confirmed compromise.'
      ),
      step(
        3,
        'verify',
        'VERIFY',
        [
          metricHint
            ? `Re-validate ${metricHint} and HTTP/API Level-1 evidence on the origin.`
            : 'Re-validate HTTP/API request-rate evidence on the origin.',
          'Distinguish abnormal request volume from a legitimate traffic spike before final disposition.',
          verifyPeers,
          'Validate trust recovery after containment.',
          financeVerify,
        ]
          .filter(Boolean)
          .join(' '),
        'Verify HTTP behaviour normalizes relative to expected load.'
      ),
      step(
        4,
        'recover',
        'RECOVER',
        `Restore connectivity only after the originating anomaly has cleared and the endpoint is ready for operator-led recovery.`,
        'Recovery is operator-led via Restore Connectivity when policy conditions are met. The response plan itself is not executable.'
      ),
    ],

    [RESPONSE_PROFILES.FINANCIAL_SERVICE_COMPROMISE]: () => [
      step(
        1,
        'contain',
        'CONTAIN',
        `Recommended action: Isolate Node on ${asset}. Contain the finance-related seed. Cyber residual risk is distinct from any simulated financial exposure figure — simulated exposure is not an actual loss.`,
        'Contain the confirmed finance-context origin only. Do not automatically isolate every propagated or peer-exposed node.'
      ),
      step(
        2,
        'protect',
        'PROTECT',
        protectText
          ? `Protect financial dependencies and path nodes: ${protectText}. Monitor mapped finance services without treating them as confirmed compromised.`
          : `Increase monitoring on finance-related neighbours of ${asset}.`,
        'Focus on financial dependency impact. Exposure ≠ confirmed compromise.'
      ),
      step(
        3,
        'verify',
        'VERIFY',
        [
          evidencePresent
            ? 'Re-validate Level-1 residual and metric evidence on the finance seed.'
            : 'Inspect origin telemetry and residual evidence on the finance seed.',
          'Validate trust recovery after containment.',
          financeAvailable
            ? `Confirm simulated financial exposure${
                context?.financialExposure?.exposureLabel
                  ? ` (${context.financialExposure.exposureLabel})`
                  : ''
              } remains scenario-based demo mapping — not predicted or actual loss.`
            : 'No simulated financial exposure label is attached; do not invent a loss figure.',
          verifyPeers,
        ]
          .filter(Boolean)
          .join(' '),
        'Keep cyber evidence and simulated exposure conceptually separate.'
      ),
      step(
        4,
        'recover',
        'RECOVER',
        `Restore connectivity only after the originating anomaly has cleared and the endpoint is ready for operator-led recovery.`,
        'Recovery is operator-led via Restore Connectivity when policy conditions are met. The response plan itself is not executable.'
      ),
    ],

    [RESPONSE_PROFILES.OT_INFRASTRUCTURE_ANOMALY]: () => [
      step(
        1,
        'contain',
        'CONTAIN',
        `Recommended action: Isolate Node on ${asset} as a cyber network containment of the affected OT/ICS endpoint/segment while preserving monitoring and operational safety. Do not shut down the plant, power off physical equipment, or perform physical process intervention.`,
        'OT-safe cyber containment only. Do not automatically isolate every propagated or peer-exposed node. Physical process control is out of scope for Commander.'
      ),
      step(
        2,
        'protect',
        'PROTECT',
        protectText
          ? `Protect adjacent OT dependencies and IT/OT bridge nodes: ${protectText}. Monitor without treating them as confirmed compromised.`
          : `Increase monitoring on adjacent OT and IT/OT bridge neighbours of ${asset}.`,
        'Focus on OT adjacency and bridges. Exposure ≠ confirmed compromise.'
      ),
      step(
        3,
        'verify',
        'VERIFY',
        [
          evidencePresent
            ? 'Re-validate Level-1 residual/metric evidence on the cyber endpoint.'
            : 'Inspect cyber telemetry against expected load on the OT-associated endpoint.',
          'Advisory: coordinate with the responsible plant/operator team and validate process conditions before any physical intervention — Commander does not observe or control physical process state unless supplied in context.',
          verifyPeers,
          'Validate trust recovery after cyber containment.',
          financeVerify,
        ]
          .filter(Boolean)
          .join(' '),
        'Verification emphasizes cyber evidence plus operator validation — not invented process telemetry.'
      ),
      step(
        4,
        'recover',
        'RECOVER',
        `Restore connectivity only after the originating anomaly has cleared and the endpoint is ready for operator-led recovery.`,
        'Recovery is operator-led via Restore Connectivity when policy conditions are met. Physical process intervention remains out of scope.'
      ),
    ],

    [RESPONSE_PROFILES.GENERAL_RESIDUAL_ANOMALY]: () => [
      step(
        1,
        'contain',
        'CONTAIN',
        `Recommended action: Isolate Node on ${asset}. Classification confidence is ${confidence} (general residual) — contain the confirmed origin while re-checking evidence. Do not treat propagated nodes as compromised without independent confirmation.`,
        'Contain the detected origin only. Do not automatically isolate every propagated or peer-exposed node.'
      ),
      step(
        2,
        'protect',
        'PROTECT',
        protectGeneric,
        'Propagated and peer-exposed nodes are potentially affected — protect and watch, do not treat as confirmed compromised.'
      ),
      step(
        3,
        'verify',
        'VERIFY',
        [
          evidencePresent
            ? 'Re-validate Level-1 detection evidence on the origin endpoint.'
            : 'Inspect origin telemetry against expected load — signature strength is limited.',
          verifyPeers,
          'Validate trust recovery after containment.',
          financeVerify,
        ]
          .filter(Boolean)
          .join(' '),
        'Only recommend checks grounded in supplied incident context.'
      ),
      step(
        4,
        'recover',
        'RECOVER',
        `Restore connectivity only after the originating anomaly has cleared and the endpoint is ready for operator-led recovery.`,
        'Recovery is operator-led via Restore Connectivity when policy conditions are met. The response plan itself is not executable.'
      ),
    ],
  }

  const build = builders[profile] || builders[RESPONSE_PROFILES.GENERAL_RESIDUAL_ANOMALY]
  return build()
}

/** Human label for Response Console profile chip. */
export const RESPONSE_PROFILE_LABELS = Object.freeze({
  [RESPONSE_PROFILES.NETWORK_TRAFFIC_FLOOD]: 'NETWORK TRAFFIC FLOOD',
  [RESPONSE_PROFILES.IDENTITY_CREDENTIAL_ATTACK]: 'CREDENTIAL ATTACK',
  [RESPONSE_PROFILES.DATA_EXFILTRATION]: 'DATA EXFILTRATION',
  [RESPONSE_PROFILES.SERVICE_API_ABUSE]: 'API ABUSE',
  [RESPONSE_PROFILES.FINANCIAL_SERVICE_COMPROMISE]: 'FINANCIAL SERVICE COMPROMISE',
  [RESPONSE_PROFILES.OT_INFRASTRUCTURE_ANOMALY]: 'OT INFRASTRUCTURE',
  [RESPONSE_PROFILES.GENERAL_RESIDUAL_ANOMALY]: 'GENERAL RESIDUAL',
  [RESPONSE_PROFILES.PROPAGATED_EXPOSURE]: 'PROPAGATED EXPOSURE',
})

function isolateRationaleFor(profile) {
  switch (profile) {
    case RESPONSE_PROFILES.NETWORK_TRAFFIC_FLOOD:
      return 'Contain the packet-rate anomaly at the confirmed origin and clear the simulated flood override via existing cyber quarantine.'
    case RESPONSE_PROFILES.IDENTITY_CREDENTIAL_ATTACK:
      return 'Contain the endpoint generating abnormal failed-login / authentication activity — not DDoS/flood containment.'
    case RESPONSE_PROFILES.DATA_EXFILTRATION:
      return 'Stop abnormal bulk file-transfer behaviour at the confirmed origin.'
    case RESPONSE_PROFILES.SERVICE_API_ABUSE:
      return 'Contain the origin of abnormal HTTP/API request volume.'
    case RESPONSE_PROFILES.FINANCIAL_SERVICE_COMPROMISE:
      return 'Contain the finance-related anomalous seed. Simulated financial exposure is scenario-based — not an actual loss prevented by this action.'
    case RESPONSE_PROFILES.OT_INFRASTRUCTURE_ANOMALY:
      return 'Cyber/network containment of the affected OT endpoint/segment only. Preserve physical process safety — do not shut down plant equipment.'
    case RESPONSE_PROFILES.GENERAL_RESIDUAL_ANOMALY:
      return 'Contain the confirmed residual anomaly origin based on available evidence; re-verify before treating peers as compromised.'
    default:
      return 'Contain the confirmed anomalous origin via cyber isolation.'
  }
}

const RESTORE_RATIONALE =
  'Restore connectivity after containment and telemetry recovery. The attack override remains cleared; a new attack would require a new attacker action.'

/**
 * Stage 3/4 — deterministic response policy for plan + executable availability.
 * recommendedActions may list registry actionIds; availability intersects the registry.
 * Advisory-only ideas must not invent actionIds that are not registered.
 *
 * restore-connectivity only when: confirmed seed, currently quarantined,
 * and Commander previously recorded isolate-node for this target.
 */
export function buildResponsePolicy(context) {
  const classification = classificationOf(context)
  const profile =
    classification.responseProfile || RESPONSE_PROFILES.GENERAL_RESIDUAL_ANOMALY
  const exposureOnly =
    classification.isExposureOnly === true ||
    profile === RESPONSE_PROFILES.PROPAGATED_EXPOSURE ||
    isExposureIncidentContext(context)
  const nodeId = affectedNodeIdFromContext(context)
  /** Executable containment only for confirmed seeds — never peers/propagated-only. */
  const seedEligible = Boolean(nodeId) && !exposureOnly
  const quarantined = isAffectedNodeQuarantined(context)
  const priorIsolate = hasPriorCommanderIsolate(context, nodeId)
  const restoreEligible = seedEligible && quarantined && priorIsolate

  const recommendedActions = []
  if (seedEligible) {
    recommendedActions.push({
      actionId: 'isolate-node',
      rationale: isolateRationaleFor(profile),
      priority: 1,
      profileLabel: RESPONSE_PROFILE_LABELS[profile] || profile,
    })
  }
  if (restoreEligible) {
    recommendedActions.push({
      actionId: 'restore-connectivity',
      rationale: RESTORE_RATIONALE,
      priority: 2,
      profileLabel: RESPONSE_PROFILE_LABELS[profile] || profile,
    })
  }

  return Object.freeze({
    responseProfile: profile,
    classificationConfidence:
      classification.classificationConfidence || CLASSIFICATION_CONFIDENCE.LOW,
    reasons: Object.freeze([...(classification.reasons || [])]),
    dominantMetric: classification.dominantMetric ?? null,
    recommendedActions: Object.freeze(recommendedActions.map((a) => Object.freeze({ ...a }))),
    executionConstraints: Object.freeze({
      seedOnly: true,
      exposureOnly,
      otSafety: classification.otSafety === true,
      confirmedSeedRequired: true,
      restoreRequiresPriorIsolate: true,
      restoreRequiresQuarantined: true,
    }),
  })
}
