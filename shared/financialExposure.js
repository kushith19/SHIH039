/**
 * Simulated economic / financial exposure for flagged Smart City infrastructure.
 * Downstream of residual detection — not a second risk engine or loss forecast.
 *
 * Amounts are demo lakhs, keyed by canonical service ids (YAML endpoint ids where
 * the city model defines them). Catalog type + yaml aliases of the same service
 * do not double-count.
 */

export const RESIDUAL_BAND = Object.freeze({
  HIGH: 'HIGH',
  ELEVATED: 'ELEVATED',
  NOMINAL: 'NOMINAL',
})

/**
 * Simulated lakhs INR per economically consequential service (demo only).
 * Finance mappings preserved; city CI mappings added for Smart Horizon.
 */
const SERVICE_LAKHS = Object.freeze({
  // —— Finance / payments (preserved) ——
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
  // —— Energy ——
  'distribution-management-system': 150,
  'power-substation-controller': 60,
  'scada-control-server': 65,
  'smart-meter-gateway': 25,
  // —— Water ——
  'water-distribution-management': 90,
  'water-treatment-control': 50,
  'water-quality-monitoring': 40,
  // —— Transport ——
  'traffic-management-controller': 70,
  'public-transport-management': 55,
  'traffic-camera': 35,
  'traffic-sensor-gateway': 20,
  // —— Telecom / digital ——
  'mobile-network-core': 45,
  'telecom-network-gateway': 50,
  'dns-dhcp-services': 40,
  'network-management-system': 100,
  // —— Government / citizen ——
  'government-identity-service': 35,
  'government-network-gateway': 60,
  'citizen-services-portal': 45,
  'municipal-management-system': 40,
  'education-management-system': 30,
  'campus-network-gateway': 25,
  // —— Healthcare ——
  'hospital-database': 100,
  'hospital-api-gateway': 120,
  'hospital-auth': 40,
  'hospital-emr': 80,
  'medical-iot-gateway': 30,
  'hospital-pharmacy': 25,
  // —— Emergency / public safety ——
  'emergency-dispatch-system': 70,
  'fire-services-management-system': 55,
  'emergency-communications-gateway': 50,
  'ambulance-management-system': 45,
  'police-management-system': 55,
  'surveillance-management-system': 30,
  'public-safety-incident-system': 50,
  'public-safety-network-gateway': 45,
})

/** Catalog type → canonical service key (must exist in SERVICE_LAKHS). */
const TYPE_TO_SERVICE = Object.freeze({
  // Finance
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
  // Energy
  power_grid: 'distribution-management-system',
  power_substation: 'power-substation-controller',
  plc_controller: 'scada-control-server',
  ev_infrastructure: 'smart-meter-gateway',
  // Water
  water_supply: 'water-distribution-management',
  wastewater_sewage: 'water-treatment-control',
  flood_management: 'water-quality-monitoring',
  stormwater_management: 'water-quality-monitoring',
  // Transport
  traffic_management: 'traffic-management-controller',
  public_transport: 'public-transport-management',
  road_infrastructure: 'traffic-camera',
  smart_actuator: 'traffic-sensor-gateway',
  // Telecom / digital
  telecommunications: 'mobile-network-core',
  telecom_gateway: 'telecom-network-gateway',
  internet_infrastructure: 'dns-dhcp-services',
  data_centers: 'network-management-system',
  // Government / citizen
  identity_access: 'government-identity-service',
  government_services: 'government-network-gateway',
  citizen_services: 'citizen-services-portal',
  municipal_operations: 'municipal-management-system',
  education: 'education-management-system',
  campus_network: 'campus-network-gateway',
  // Healthcare
  healthcare: 'hospital-database',
  hospital_gateway: 'hospital-api-gateway',
  hospital_auth: 'hospital-auth',
  hospital_emr: 'hospital-emr',
  mqtt_broker: 'medical-iot-gateway',
  object_storage: 'hospital-pharmacy',
  // Emergency / safety
  emergency_services: 'emergency-dispatch-system',
  fire_rescue: 'fire-services-management-system',
  disaster_management: 'emergency-communications-gateway',
  emergency_alert: 'ambulance-management-system',
  police_services: 'police-management-system',
  surveillance_cctv: 'surveillance-management-system',
  public_safety_systems: 'public-safety-incident-system',
  public_safety_gateway: 'public-safety-network-gateway',
})

/** Operator-facing labels for breakdown rows. */
const SERVICE_LABELS = Object.freeze({
  'core-banking-system': 'Core Banking',
  'payment-processing-system': 'Payment Processing',
  'bank-gateway': 'Bank Gateway',
  'digital-banking-platform': 'Digital Banking Platform',
  'atm-network-gateway': 'ATM Network Gateway',
  'customer-identity-service': 'Customer Identity Service',
  'card-processing-system': 'Card Processing',
  'fraud-detection-system': 'Fraud Detection',
  'transaction-monitoring-system': 'Transaction Monitoring',
  'interbank-payment-gateway': 'Interbank Payment Gateway',
  'atm-switching-system': 'ATM Switching',
  'financial-data-platform': 'Financial Data Platform',
  'core-banking-backup': 'Core Banking Backup',
  'distribution-management-system': 'Power Grid',
  'power-substation-controller': 'Power Substation',
  'scada-control-server': 'SCADA / PLC Control',
  'smart-meter-gateway': 'EV / Smart Meter Gateway',
  'water-distribution-management': 'Water Infrastructure',
  'water-treatment-control': 'Wastewater Treatment',
  'water-quality-monitoring': 'Flood / Water Quality',
  'traffic-management-controller': 'Traffic Management',
  'public-transport-management': 'Public Transport',
  'traffic-camera': 'Road Infrastructure',
  'traffic-sensor-gateway': 'Smart Actuator / Sensors',
  'mobile-network-core': 'Telecommunications',
  'telecom-network-gateway': 'Telecom Gateway',
  'dns-dhcp-services': 'Internet Infrastructure',
  'network-management-system': 'Data Center',
  'government-identity-service': 'Identity & Access',
  'government-network-gateway': 'Government Services',
  'citizen-services-portal': 'Citizen Services',
  'municipal-management-system': 'Municipal Operations',
  'education-management-system': 'Education',
  'campus-network-gateway': 'Campus Network',
  'hospital-database': 'Healthcare',
  'hospital-api-gateway': 'Hospital Gateway',
  'hospital-auth': 'Hospital Auth',
  'hospital-emr': 'Hospital EMR',
  'medical-iot-gateway': 'Medical IoT Gateway',
  'hospital-pharmacy': 'Hospital Pharmacy / Storage',
  'emergency-dispatch-system': 'Emergency Services',
  'fire-services-management-system': 'Fire & Rescue',
  'emergency-communications-gateway': 'Disaster Management',
  'ambulance-management-system': 'Emergency Alert / Ambulance',
  'police-management-system': 'Police Services',
  'surveillance-management-system': 'Surveillance / CCTV',
  'public-safety-incident-system': 'Public Safety Systems',
  'public-safety-network-gateway': 'Public Safety Gateway',
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

export function serviceDisplayLabel(serviceId) {
  const key = String(serviceId ?? '')
  return SERVICE_LABELS[key] || key
}

/**
 * Canonical economic-service key for a node, or null if unmapped.
 * Sector alone never qualifies — type / yaml / id must map.
 */
export function economicServiceKey(meta = {}) {
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

/** @deprecated Use economicServiceKey — kept for callers/tests. */
export function financeServiceKey(meta = {}) {
  return economicServiceKey(meta)
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
      return 'No flagged residual nodes or incidents in the current set. Simulated economic exposure stays at ₹0 until mapped Smart City infrastructure is flagged.'
    }
    return 'Cyber residual is flagging infrastructure, but no mapped economically consequential services are in that set. Simulated exposure stays at ₹0 — not a finding that cyber risk is absent.'
  }
  const money = formatInrLakhs(lakhs)
  const dep =
    criticalDependencies > 0
      ? ` Existing graph edges also reach ${criticalDependencies} high- or critical-criticality neighbor${criticalDependencies === 1 ? '' : 's'}.`
      : ''
  if (band === RESIDUAL_BAND.HIGH) {
    return `High cyber residual is flagging ${affectedCount} economically consequential service${affectedCount === 1 ? '' : 's'} (${money} simulated). Exposure is the sum of those service mappings, not a loss forecast.${dep}`
  }
  if (band === RESIDUAL_BAND.ELEVATED) {
    return `Elevated cyber residual includes ${affectedCount} economically consequential service${affectedCount === 1 ? '' : 's'} (${money} simulated). Simulated exposure is a demo mapping, not a monetary prediction.${dep}`
  }
  return `Mapped Smart City infrastructure is in the flagged set (${money} simulated). Residual is still in the nominal band; treat exposure as illustrative only.${dep}`
}

function buildBreakdown(services) {
  return [...services.entries()]
    .map(([id, lakhs]) => ({
      id,
      label: serviceDisplayLabel(id),
      lakhs,
      exposureLabel: formatInrLakhs(lakhs),
    }))
    .sort((a, b) => b.lakhs - a.lakhs || a.label.localeCompare(b.label))
}

/** Empty / cleared current exposure view (simulated demo zero). */
export function zeroFinancialExposure(overrides = {}) {
  return {
    cyberScore: null,
    cyberScoreAvailable: false,
    residualBand: RESIDUAL_BAND.NOMINAL,
    lakhs: 0,
    exposureLabel: '₹0',
    affectedServices: 0,
    affectedServiceIds: [],
    breakdown: [],
    criticalDependencies: 0,
    blastRadius: 0,
    explanation:
      'No currently flagged economically consequential infrastructure. Simulated exposure is ₹0.',
    simulated: true,
    ...overrides,
  }
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
    const key = economicServiceKey(node)
    if (!key || SERVICE_LAKHS[key] == null) continue
    if (!services.has(key)) services.set(key, SERVICE_LAKHS[key])
  }

  const lakhs = [...services.values()].reduce((sum, n) => sum + n, 0)
  const affectedServices = services.size
  const blastRadius = flagged.size
  const criticalDependencies = criticalDependencyCount(flagged, nodes, edges)
  const breakdown = buildBreakdown(services)

  return {
    cyberScore: score,
    cyberScoreAvailable: scoreAvailable,
    residualBand: band,
    lakhs,
    exposureLabel: formatInrLakhs(lakhs),
    affectedServices,
    affectedServiceIds: [...services.keys()],
    breakdown,
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

/**
 * Current exposure for Commander: live recompute while open, ₹0 when cleared.
 * Preserves optional historical snapshot separately for timelines.
 * When no live room/detection is supplied, falls back to the persisted snapshot
 * (unit fixtures / history readers that do not attach room state).
 */
export function currentExposureForIncident(incident, room = null) {
  const status = String(incident?.status ?? incident?.currentStatus ?? '').toLowerCase()
  const stored = incident?.financialContext ?? null
  const historical =
    stored?.simulated === true && Number(stored.lakhs) > 0
      ? {
          lakhs: Number(stored.lakhs),
          exposureLabel: stored.exposureLabel || formatInrLakhs(stored.lakhs),
          affectedServiceIds: Array.isArray(stored.affectedServiceIds)
            ? stored.affectedServiceIds
            : [],
          breakdown: Array.isArray(stored.breakdown) ? stored.breakdown : [],
        }
      : null

  if (status === 'cleared') {
    return zeroFinancialExposure({
      historicalExposure: historical,
      peakLakhs: historical?.lakhs ?? 0,
      peakExposureLabel: historical?.exposureLabel ?? '₹0',
    })
  }

  const hasLiveDetection = room != null && room.detection != null
  if (!hasLiveDetection) {
    if (stored?.simulated === true) {
      return {
        ...stored,
        breakdown: Array.isArray(stored.breakdown) ? stored.breakdown : [],
        historicalExposure: historical,
        peakLakhs: Math.max(Number(stored.lakhs) || 0, historical?.lakhs || 0),
        peakExposureLabel: formatInrLakhs(
          Math.max(Number(stored.lakhs) || 0, historical?.lakhs || 0)
        ),
      }
    }
    return zeroFinancialExposure()
  }

  const detection = room.detection
  const nodes = room?.nodes ?? []
  const edges = room?.edges ?? []
  const seed = String(incident?.affectedNodeId ?? incident?.endpointId ?? '').trim()
  const liveInc = Array.isArray(detection?.incidents)
    ? detection.incidents.find(
        (inc) =>
          String(inc.persistentId ?? '') === String(incident?.incidentId ?? '') ||
          String(inc.id ?? '') === String(incident?.liveIncidentId ?? '') ||
          String(inc.endpointId ?? '') === seed
      )
    : null

  const anomaly = new Set((detection?.anomalyNodeIds ?? []).map(String))
  const stillSeed = seed && anomaly.has(seed)
  // Prefer live incident graph sets. Do not fall back to persisted peer/propagated
  // (those freeze promotion-time blast and keep exposure high after containment).
  const peer = liveInc?.peerExposedNodeIds ?? []
  const propagated = liveInc?.propagatedNodeIds ?? []

  // When the seed is no longer anomalous and no live incident remains, current = ₹0.
  if (!liveInc && !stillSeed) {
    return zeroFinancialExposure({
      historicalExposure: historical,
      peakLakhs: historical?.lakhs ?? 0,
      peakExposureLabel: historical?.exposureLabel ?? '₹0',
    })
  }

  const view = computeFinancialExposure({
    detection: {
      anomalyNodeIds: seed ? [seed] : [],
      peerExposedNodeIds: peer,
      propagatedNodeIds: propagated,
      compromisedNodeIds:
        seed && (detection?.compromisedNodeIds ?? []).map(String).includes(seed) ? [seed] : [],
      atRiskNodeIds: [],
      incidents: liveInc
        ? [liveInc]
        : seed
          ? [{ endpointId: seed }]
          : [],
      riskMomentum: detection?.riskMomentum ?? null,
    },
    nodes,
    edges,
  })

  const peakLakhs = Math.max(Number(historical?.lakhs) || 0, view.lakhs)
  return {
    ...view,
    historicalExposure: historical,
    peakLakhs,
    peakExposureLabel: formatInrLakhs(peakLakhs),
  }
}

export { SERVICE_LAKHS, TYPE_TO_SERVICE, SERVICE_LABELS }
