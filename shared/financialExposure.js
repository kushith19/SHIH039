/**
 * Simulated INR exposure for flagged finance services.
 * Downstream of residual detection — not a second risk engine or loss forecast.
 *
 * Amounts are demo lakhs, keyed by catalog type and YAML endpoint id.
 * Canonicalize to YAML id so type + yaml aliases of the same service do not double-count.
 */

export const RESIDUAL_BAND = Object.freeze({
  HIGH: 'HIGH',
  ELEVATED: 'ELEVATED',
  NOMINAL: 'NOMINAL',
})

/** Simulated lakhs INR per finance service (demo only). */
const SERVICE_LAKHS = Object.freeze({
  'core-banking-system': 120,
  'payment-processing-system': 80,
  'bank-gateway': 30,
  'digital-banking-platform': 50,
  'atm-network-gateway': 20,
  'customer-identity-service': 25,
  'card-processing-system': 70,
  'fraud-detection-system': 15,
  'transaction-monitoring-system': 100,
  'interbank-payment-gateway': 80,
  'atm-switching-system': 25,
  'financial-data-platform': 40,
  'core-banking-backup': 40,
})

const TYPE_TO_SERVICE = Object.freeze({
  banking_financial: 'core-banking-system',
  payment_processing_system: 'payment-processing-system',
  bank_gateway: 'bank-gateway',
  digital_banking_platform: 'digital-banking-platform',
  atm_network_gateway: 'atm-network-gateway',
  customer_identity_service: 'customer-identity-service',
  card_processing_system: 'card-processing-system',
  fraud_detection_system: 'fraud-detection-system',
  transaction_monitoring_system: 'transaction-monitoring-system',
  interbank_payment_gateway: 'interbank-payment-gateway',
  atm_switching_system: 'atm-switching-system',
  financial_data_platform: 'financial-data-platform',
  core_banking_backup: 'core-banking-backup',
})

function snake(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function kebab(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
}

function stripEpPrefix(id) {
  const raw = String(id ?? '').trim()
  return raw.startsWith('ep-') ? raw.slice(3) : raw
}

function nodePayload(node) {
  if (!node || typeof node !== 'object') return null
  const data = node.data && typeof node.data === 'object' ? node.data : node
  const id = String(node.id ?? data.id ?? '').trim()
  return { id, ...data, id: id || String(data.id ?? '').trim() }
}

export function residualBand(score) {
  if (score == null || !Number.isFinite(Number(score))) return RESIDUAL_BAND.NOMINAL
  const n = Number(score)
  if (n >= 70) return RESIDUAL_BAND.HIGH
  if (n >= 45) return RESIDUAL_BAND.ELEVATED
  return RESIDUAL_BAND.NOMINAL
}

export function formatInrLakhs(lakhs) {
  const n = Number(lakhs)
  if (!Number.isFinite(n) || n <= 0) return '₹0'
  if (n >= 100) {
    const cr = n / 100
    const text = Number.isInteger(cr) ? String(cr) : cr.toFixed(1)
    return `₹${text} Cr`
  }
  return `₹${Math.round(n)} L`
}

export function financeServiceKey(meta = {}) {
  const type = snake(meta.type ?? meta.assetType ?? '')
  if (type) {
    if (TYPE_TO_SERVICE[type]) return TYPE_TO_SERVICE[type]
    return null
  }

  const yaml = kebab(meta.cityEndpointId ?? meta.yamlId ?? '')
  if (yaml && SERVICE_LAKHS[yaml] != null) return yaml

  const fromId = snake(stripEpPrefix(meta.id ?? meta.endpointId ?? ''))
  if (fromId && TYPE_TO_SERVICE[fromId]) return TYPE_TO_SERVICE[fromId]

  const kebabId = kebab(stripEpPrefix(meta.id ?? meta.endpointId ?? ''))
  if (kebabId && SERVICE_LAKHS[kebabId] != null) return kebabId

  return null
}

export function flaggedNodeIds(detection) {
  const ids = new Set()
  for (const list of [
    detection?.anomalyNodeIds,
    detection?.compromisedNodeIds,
    detection?.atRiskNodeIds,
    detection?.peerExposedNodeIds,
    detection?.propagatedNodeIds,
  ]) {
    for (const id of list ?? []) {
      if (id) ids.add(String(id))
    }
  }
  for (const inc of detection?.incidents ?? []) {
    const id = inc?.endpointId
    if (id) ids.add(String(id))
  }
  return ids
}

function nodeIndex(nodes) {
  const byId = new Map()
  for (const raw of nodes ?? []) {
    const n = nodePayload(raw)
    if (n?.id) byId.set(String(n.id), n)
  }
  return byId
}

function isHighOrCritical(criticality) {
  const c = String(criticality ?? '').toLowerCase()
  return c === 'high' || c === 'critical'
}

export function criticalDependencyCount(flaggedIds, nodes, edges) {
  const byId = nodeIndex(nodes)
  const neighbors = new Set()
  const flagged = flaggedIds instanceof Set ? flaggedIds : new Set(flaggedIds ?? [])
  for (const edge of edges ?? []) {
    const source = String(edge?.source ?? '')
    const target = String(edge?.target ?? '')
    if (!source || !target || source === target) continue
    if (flagged.has(source) && isHighOrCritical(byId.get(target)?.criticality)) {
      neighbors.add(target)
    }
    if (flagged.has(target) && isHighOrCritical(byId.get(source)?.criticality)) {
      neighbors.add(source)
    }
  }
  return neighbors.size
}

function explanation({ band, affectedCount, lakhs, criticalDependencies, blastRadius }) {
  if (affectedCount === 0) {
    if (blastRadius === 0) {
      return 'No flagged residual nodes or incidents in the current set. Simulated financial exposure stays at ₹0 until mapped financial services are flagged.'
    }
    return 'Cyber residual is flagging infrastructure, but no mapped financial services are in that set. Simulated exposure stays at ₹0 — not a finding that cyber risk is absent.'
  }
  const money = formatInrLakhs(lakhs)
  const dep =
    criticalDependencies > 0
      ? ` Existing graph edges also reach ${criticalDependencies} high- or critical-criticality neighbor${criticalDependencies === 1 ? '' : 's'}.`
      : ''
  if (band === RESIDUAL_BAND.HIGH) {
    return `High cyber residual is flagging ${affectedCount} mapped financial service${affectedCount === 1 ? '' : 's'} (${money} simulated). Exposure is the sum of those service mappings, not a loss forecast.${dep}`
  }
  if (band === RESIDUAL_BAND.ELEVATED) {
    return `Elevated cyber residual includes ${affectedCount} mapped financial service${affectedCount === 1 ? '' : 's'} (${money} simulated). Simulated exposure is a demo mapping, not a monetary prediction.${dep}`
  }
  return `Mapped financial services are in the flagged set (${money} simulated). Residual is still in the nominal band; treat exposure as illustrative only.${dep}`
}

/**
 * @param {{ detection?: object, nodes?: object[], edges?: object[] }} input
 */
export function computeFinancialExposure({ detection = null, nodes = [], edges = [] } = {}) {
  const rm = detection?.riskMomentum ?? {}
  const scoreAvailable = rm.available === true && rm.score != null && Number.isFinite(Number(rm.score))
  const score = scoreAvailable ? Number(rm.score) : null
  const band = residualBand(score)

  const flagged = flaggedNodeIds(detection)
  const byId = nodeIndex(nodes)
  const services = new Map()

  for (const id of flagged) {
    const node = byId.get(id) ?? { id }
    const key = financeServiceKey(node)
    if (!key || SERVICE_LAKHS[key] == null) continue
    if (!services.has(key)) services.set(key, SERVICE_LAKHS[key])
  }

  const lakhs = [...services.values()].reduce((sum, n) => sum + n, 0)
  const affectedServices = services.size
  const blastRadius = flagged.size
  const criticalDependencies = criticalDependencyCount(flagged, nodes, edges)

  return {
    cyberScore: score,
    cyberScoreAvailable: scoreAvailable,
    residualBand: band,
    lakhs,
    exposureLabel: formatInrLakhs(lakhs),
    affectedServices,
    affectedServiceIds: [...services.keys()],
    criticalDependencies,
    blastRadius,
    explanation: explanation({
      band,
      affectedCount: affectedServices,
      lakhs,
      criticalDependencies,
      blastRadius,
    }),
    simulated: true,
  }
}

export { SERVICE_LAKHS, TYPE_TO_SERVICE }
