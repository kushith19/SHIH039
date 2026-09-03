const CATALOG_TYPE_TO_ENDPOINT = {
  power_substation: 'power-substation-controller',
  power_grid: 'distribution-management-system',
  water_supply: 'water-distribution-management',
  wastewater_sewage: 'water-treatment-control',
  flood_management: 'water-quality-monitoring',
  stormwater_management: 'water-quality-monitoring',
  traffic_management: 'traffic-management-controller',
  public_transport: 'public-transport-management',
  road_infrastructure: 'traffic-camera',
  telecommunications: 'mobile-network-core',
  telecom_gateway: 'telecom-network-gateway',
  internet_infrastructure: 'dns-dhcp-services',
  data_centers: 'network-management-system',
  identity_access: 'government-identity-service',
  government_services: 'government-network-gateway',
  citizen_services: 'citizen-services-portal',
  municipal_operations: 'municipal-management-system',
  education: 'education-management-system',
  healthcare: 'hospital-database',
  hospital_gateway: 'hospital-api-gateway',
  hospital_auth: 'hospital-auth',
  hospital_emr: 'hospital-emr',
  emergency_services: 'emergency-dispatch-system',
  police_services: 'police-management-system',
  fire_rescue: 'fire-services-management-system',
  surveillance_cctv: 'surveillance-management-system',
  public_safety_systems: 'public-safety-incident-system',
  disaster_management: 'emergency-communications-gateway',
  emergency_alert: 'ambulance-management-system',
  public_safety_gateway: 'public-safety-network-gateway',
  banking_financial: 'core-banking-system',
  bank_gateway: 'bank-gateway',
  atm_network_gateway: 'atm-network-gateway',
  payment_processing_system: 'payment-processing-system',
  digital_banking_platform: 'digital-banking-platform',
  customer_identity_service: 'customer-identity-service',
  card_processing_system: 'card-processing-system',
  fraud_detection_system: 'fraud-detection-system',
  transaction_monitoring_system: 'transaction-monitoring-system',
  interbank_payment_gateway: 'interbank-payment-gateway',
  atm_switching_system: 'atm-switching-system',
  financial_data_platform: 'financial-data-platform',
  plc_controller: 'scada-control-server',
  ev_infrastructure: 'smart-meter-gateway',
  smart_actuator: 'traffic-sensor-gateway',
  mqtt_broker: 'medical-iot-gateway',
  object_storage: 'hospital-pharmacy',
  app_server: 'bank-gateway',
  load_balancer: 'atm-network-gateway',
  retail_infrastructure: 'payment-processing-system',
  campus_network: 'campus-network-gateway',
}

const YAML_TO_CATALOG = {}
for (const [type, id] of Object.entries(CATALOG_TYPE_TO_ENDPOINT)) {
  if (!YAML_TO_CATALOG[id]) YAML_TO_CATALOG[id] = type
}

function kebab(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
}

function snake(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function stripEpPrefix(id) {
  const raw = String(id ?? '').trim()
  return raw.startsWith('ep-') ? raw.slice(3) : raw
}

/**
 * @param {{ id?: string, type?: string, assetType?: string, cityEndpointId?: string }} meta
 * @param {Record<string, { id: string, type?: string }>} endpoints
 */
export function resolveCityEndpoint(meta = {}, endpoints = {}) {
  if (!endpoints || typeof endpoints !== 'object') return null
  const hinted = String(meta.cityEndpointId ?? meta.endpointId ?? '').trim()
  if (hinted && endpoints[hinted]) return endpoints[hinted]

  const type = String(meta.type ?? meta.assetType ?? '').trim()
  const mapped = CATALOG_TYPE_TO_ENDPOINT[type] ?? CATALOG_TYPE_TO_ENDPOINT[snake(type)]
  if (mapped && endpoints[mapped]) return endpoints[mapped]

  const nodeKey = kebab(stripEpPrefix(meta.id ?? meta.nodeId ?? ''))
  if (nodeKey && endpoints[nodeKey]) return endpoints[nodeKey]
  if (type && endpoints[kebab(type)]) return endpoints[kebab(type)]

  const wantType = snake(type)
  if (wantType) {
    for (const ep of Object.values(endpoints)) {
      if (snake(ep?.type) === wantType) return ep
    }
  }
  return null
}

export function yamlIdForCatalogType(type) {
  const key = String(type ?? '').trim()
  return CATALOG_TYPE_TO_ENDPOINT[key] ?? CATALOG_TYPE_TO_ENDPOINT[snake(key)] ?? null
}

export function catalogTypeForYaml(endpointId) {
  const id = String(endpointId ?? '').trim()
  return YAML_TO_CATALOG[id] ?? null
}

export { CATALOG_TYPE_TO_ENDPOINT, YAML_TO_CATALOG }
