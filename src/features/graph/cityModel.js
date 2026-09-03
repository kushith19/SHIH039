import { MarkerType } from '@xyflow/react'
import { getAssetByType } from './assetCatalog'
import { DISTRICT_ANCHORS } from './cityMap'
import { INFRASTRUCTURE_NODE_TYPE, dataFromAsset } from './infrastructureNode'
import { getCityModelOverlay } from '@shared/cityContext.js'
import { catalogTypeForYaml } from '@shared/cityModel/endpointMap.js'
import { LIVE_CITY_GRAPH_TYPES } from '@shared/cityModel/liveGraphTypes.js'

const NODE_TYPE = INFRASTRUCTURE_NODE_TYPE
const EDGE_TYPE = 'directedLabeled'

const DOMAIN_TO_DISTRICT = {
  Energy: 'energy',
  Water: 'water',
  Transportation: 'transport',
  Telecommunications: 'telecom',
  Government: 'government',
  Education: 'education',
  Healthcare: 'healthcare',
  'Emergency Services': 'emergency',
  'Public Safety': 'safety',
  Environment: 'environment',
  Finance: 'finance',
  'Urban Infrastructure': 'urban',
}

const GRID_COLS = {
  energy: 2,
  water: 2,
  transport: 3,
  telecom: 3,
  government: 2,
  education: 1,
  healthcare: 2,
  emergency: 2,
  safety: 2,
  environment: 2,
  finance: 2,
  urban: 1,
}

const CELL = { x: 168, y: 128 }

/**
 * Directed city dependencies: provider (source) → dependent (target).
 * Every catalog endpoint has at least one incident edge.
 */
export const CITY_DEPENDENCIES = [
  { source: 'renewable_energy', target: 'power_grid', label: 'Generation', packetsPerSecond: 11_000 },
  { source: 'natural_gas', target: 'power_grid', label: 'Peaker fuel', packetsPerSecond: 4_800 },
  { source: 'fuel_energy_distribution', target: 'power_grid', label: 'Fuel supply', packetsPerSecond: 3_600 },
  { source: 'time_sync', target: 'power_grid', label: 'Grid sync', packetsPerSecond: 900 },
  { source: 'power_grid', target: 'power_substation', label: 'Grid feed', packetsPerSecond: 22_000 },

  { source: 'power_substation', target: 'telecom_gateway', label: 'Substation feed', packetsPerSecond: 12_000 },
  { source: 'power_substation', target: 'water_supply', label: 'Pumping power', packetsPerSecond: 8_000 },
  { source: 'power_substation', target: 'metro_rail', label: 'Traction power', packetsPerSecond: 9_500 },
  { source: 'power_substation', target: 'healthcare', label: 'Hospital feed', packetsPerSecond: 7_200 },
  { source: 'power_substation', target: 'government_services', label: 'Civic feed', packetsPerSecond: 6_400 },
  { source: 'power_substation', target: 'data_centers', label: 'Facility power', packetsPerSecond: 10_500 },
  { source: 'power_substation', target: 'airport_infrastructure', label: 'Airfield power', packetsPerSecond: 8_800 },
  { source: 'power_substation', target: 'plc_controller', label: 'SCADA', packetsPerSecond: 6_800 },
  { source: 'power_substation', target: 'ev_infrastructure', label: 'Depot power', packetsPerSecond: 5_400 },
  { source: 'power_substation', target: 'street_lighting', label: 'Civic lighting', packetsPerSecond: 3_100 },

  { source: 'water_supply', target: 'wastewater_sewage', label: 'Collection', packetsPerSecond: 4_200 },
  { source: 'water_supply', target: 'flood_management', label: 'Quality / drainage', packetsPerSecond: 2_400 },
  { source: 'water_supply', target: 'healthcare', label: 'Potable supply', packetsPerSecond: 3_200 },
  { source: 'water_supply', target: 'food_supply', label: 'Process water', packetsPerSecond: 2_400 },
  { source: 'water_supply', target: 'public_housing', label: 'Mains', packetsPerSecond: 2_800 },
  { source: 'stormwater_management', target: 'flood_management', label: 'Drainage', packetsPerSecond: 2_100 },
  { source: 'wastewater_sewage', target: 'urban_infrastructure', label: 'Treatment', packetsPerSecond: 1_900 },
  { source: 'waste_management', target: 'urban_infrastructure', label: 'Sanitation ops', packetsPerSecond: 1_700 },

  { source: 'weather_services', target: 'flood_management', label: 'Forecast', packetsPerSecond: 1_800 },
  { source: 'weather_services', target: 'airport_infrastructure', label: 'METAR', packetsPerSecond: 2_200 },
  { source: 'weather_services', target: 'traffic_management', label: 'Road weather', packetsPerSecond: 1_600 },
  { source: 'weather_services', target: 'disaster_management', label: 'Hazards', packetsPerSecond: 1_400 },
  { source: 'air_quality', target: 'healthcare', label: 'AQI alerts', packetsPerSecond: 900 },
  { source: 'air_quality', target: 'environmental_monitoring', label: 'Sensor net', packetsPerSecond: 700 },
  { source: 'environmental_monitoring', target: 'disaster_management', label: 'Field reports', packetsPerSecond: 800 },

  { source: 'telecommunications', target: 'telecom_gateway', label: 'Core to gateway', packetsPerSecond: 16_000 },
  { source: 'telecommunications', target: 'internet_infrastructure', label: 'Peering', packetsPerSecond: 18_000 },
  { source: 'telecommunications', target: 'public_wifi', label: 'Backhaul', packetsPerSecond: 6_200 },
  { source: 'telecommunications', target: 'emergency_services', label: '911 trunk', packetsPerSecond: 5_500 },
  { source: 'telecommunications', target: 'government_services', label: 'Civic backbone', packetsPerSecond: 14_000 },
  { source: 'telecommunications', target: 'data_centers', label: 'Carrier backhaul', packetsPerSecond: 18_000 },
  { source: 'time_sync', target: 'telecommunications', label: 'PTP / NTP', packetsPerSecond: 1_100 },
  { source: 'internet_infrastructure', target: 'cloud_digital', label: 'Transit', packetsPerSecond: 15_000 },
  { source: 'internet_infrastructure', target: 'public_wifi', label: 'ISP', packetsPerSecond: 4_400 },
  { source: 'data_centers', target: 'cloud_digital', label: 'Cloud interconnect', packetsPerSecond: 16_000 },
  { source: 'data_centers', target: 'identity_access', label: 'IdP hosting', packetsPerSecond: 7_200 },
  { source: 'identity_access', target: 'government_services', label: 'Citizen IAM', packetsPerSecond: 8_800 },
  { source: 'identity_access', target: 'banking_financial', label: 'Auth federation', packetsPerSecond: 7_400 },
  { source: 'identity_access', target: 'hospital_auth', label: 'Hospital IAM', packetsPerSecond: 4_600 },
  { source: 'identity_access', target: 'education', label: 'Campus SSO', packetsPerSecond: 3_200 },

  { source: 'telecom_gateway', target: 'hospital_gateway', label: 'Hospital WAN', packetsPerSecond: 9_800 },
  { source: 'mqtt_broker', target: 'hospital_gateway', label: 'Clinical IoT', packetsPerSecond: 4_100 },
  { source: 'object_storage', target: 'hospital_emr', label: 'Pharmacy records', packetsPerSecond: 2_600 },
  { source: 'hospital_gateway', target: 'hospital_auth', label: 'Hospital LAN', packetsPerSecond: 6_400 },
  { source: 'hospital_auth', target: 'hospital_emr', label: 'EMR session', packetsPerSecond: 5_200 },
  { source: 'hospital_gateway', target: 'healthcare', label: 'Clinical network', packetsPerSecond: 7_800 },

  { source: 'government_services', target: 'citizen_services', label: 'Service portal', packetsPerSecond: 6_100 },
  { source: 'government_services', target: 'education', label: 'School district', packetsPerSecond: 3_400 },
  { source: 'education', target: 'campus_network', label: 'Campus WAN', packetsPerSecond: 3_800 },
  { source: 'telecom_gateway', target: 'campus_network', label: 'Campus backhaul', packetsPerSecond: 4_400 },
  { source: 'government_services', target: 'municipal_operations', label: 'Civic ops', packetsPerSecond: 4_100 },
  { source: 'government_services', target: 'public_housing', label: 'Housing authority', packetsPerSecond: 2_600 },
  { source: 'government_services', target: 'libraries_cultural', label: 'Civic programs', packetsPerSecond: 1_800 },
  { source: 'urban_infrastructure', target: 'government_services', label: 'Asset register', packetsPerSecond: 2_600 },
  { source: 'municipal_operations', target: 'street_lighting', label: 'Lighting ops', packetsPerSecond: 1_500 },

  { source: 'traffic_management', target: 'smart_actuator', label: 'Field sensors', packetsPerSecond: 3_200 },
  { source: 'road_infrastructure', target: 'traffic_management', label: 'Signals', packetsPerSecond: 3_800 },
  { source: 'traffic_management', target: 'metro_rail', label: 'ITS / SCADA', packetsPerSecond: 4_200 },
  { source: 'traffic_management', target: 'airport_infrastructure', label: 'Landside flow', packetsPerSecond: 3_100 },
  { source: 'traffic_management', target: 'public_transport', label: 'AVL', packetsPerSecond: 3_600 },
  { source: 'traffic_management', target: 'parking_management', label: 'Curb', packetsPerSecond: 1_900 },
  { source: 'rail_infrastructure', target: 'metro_rail', label: 'Track systems', packetsPerSecond: 4_800 },
  { source: 'public_transport', target: 'metro_rail', label: 'Interchange', packetsPerSecond: 3_300 },
  { source: 'port_maritime', target: 'food_supply', label: 'Cold chain', packetsPerSecond: 4_600 },
  { source: 'port_maritime', target: 'retail_infrastructure', label: 'Import freight', packetsPerSecond: 5_200 },
  { source: 'port_maritime', target: 'logistics_freight', label: 'Stevedore', packetsPerSecond: 5_800 },
  { source: 'airport_infrastructure', target: 'logistics_freight', label: 'Air cargo', packetsPerSecond: 4_400 },
  { source: 'logistics_freight', target: 'supply_chain', label: 'Freight', packetsPerSecond: 6_100 },
  { source: 'logistics_freight', target: 'postal_delivery', label: 'Parcels', packetsPerSecond: 3_200 },

  { source: 'surveillance_cctv', target: 'police_services', label: 'Video uplink', packetsPerSecond: 9_800 },
  { source: 'surveillance_cctv', target: 'emergency_services', label: 'CAD overlay', packetsPerSecond: 3_300 },
  { source: 'emergency_services', target: 'healthcare', label: 'Ambulance routing', packetsPerSecond: 2_800 },
  { source: 'emergency_services', target: 'fire_rescue', label: 'Dispatch', packetsPerSecond: 2_400 },
  { source: 'police_services', target: 'government_services', label: 'Records', packetsPerSecond: 2_100 },
  { source: 'public_safety_gateway', target: 'telecom_gateway', label: 'Safety WAN', packetsPerSecond: 5_200 },
  { source: 'public_safety_systems', target: 'public_safety_gateway', label: 'Safety core', packetsPerSecond: 3_600 },
  { source: 'public_safety_systems', target: 'emergency_alert', label: 'CAP', packetsPerSecond: 2_200 },
  { source: 'public_safety_systems', target: 'police_services', label: 'CAD', packetsPerSecond: 3_400 },
  { source: 'disaster_management', target: 'emergency_alert', label: 'Warnings', packetsPerSecond: 1_700 },
  { source: 'fire_rescue', target: 'disaster_management', label: 'Incident', packetsPerSecond: 1_500 },

  { source: 'cloud_digital', target: 'banking_financial', label: 'Core banking', packetsPerSecond: 11_000 },
  { source: 'digital_banking_platform', target: 'customer_identity_service', label: 'Customer IAM', packetsPerSecond: 6_800 },
  { source: 'digital_banking_platform', target: 'bank_gateway', label: 'Banking channel', packetsPerSecond: 9_200 },
  { source: 'digital_banking_platform', target: 'telecom_gateway', label: 'Banking WAN', packetsPerSecond: 5_400 },
  { source: 'bank_gateway', target: 'banking_financial', label: 'Core posting', packetsPerSecond: 10_500 },
  { source: 'bank_gateway', target: 'telecom_gateway', label: 'Bank WAN', packetsPerSecond: 4_800 },
  { source: 'card_processing_system', target: 'banking_financial', label: 'Card settlement', packetsPerSecond: 7_600 },
  { source: 'card_processing_system', target: 'payment_processing_system', label: 'Card rails', packetsPerSecond: 6_400 },
  { source: 'payment_processing_system', target: 'banking_financial', label: 'Payment posting', packetsPerSecond: 8_800 },
  { source: 'payment_processing_system', target: 'fraud_detection_system', label: 'Fraud screen', packetsPerSecond: 4_200 },
  { source: 'payment_processing_system', target: 'transaction_monitoring_system', label: 'TMS feed', packetsPerSecond: 3_800 },
  { source: 'fraud_detection_system', target: 'transaction_monitoring_system', label: 'Alert correlation', packetsPerSecond: 2_400 },
  { source: 'fraud_detection_system', target: 'financial_data_platform', label: 'Case data', packetsPerSecond: 2_800 },
  { source: 'transaction_monitoring_system', target: 'financial_data_platform', label: 'Ledger analytics', packetsPerSecond: 3_200 },
  { source: 'interbank_payment_gateway', target: 'payment_processing_system', label: 'RTGS / ACH', packetsPerSecond: 7_100 },
  { source: 'interbank_payment_gateway', target: 'telecom_gateway', label: 'Interbank WAN', packetsPerSecond: 4_600 },
  { source: 'atm_switching_system', target: 'atm_network_gateway', label: 'ATM switch', packetsPerSecond: 6_200 },
  { source: 'atm_switching_system', target: 'banking_financial', label: 'ATM posting', packetsPerSecond: 5_800 },
  { source: 'atm_network_gateway', target: 'telecom_gateway', label: 'ATM WAN', packetsPerSecond: 4_400 },
  { source: 'financial_data_platform', target: 'banking_financial', label: 'Core extracts', packetsPerSecond: 5_100 },
  { source: 'customer_identity_service', target: 'banking_financial', label: 'Account binding', packetsPerSecond: 3_600 },
  { source: 'customer_identity_service', target: 'identity_access', label: 'Civic federation', packetsPerSecond: 2_900 },
  { source: 'citizen_services', target: 'payment_processing_system', label: 'Municipal payments', packetsPerSecond: 3_400 },
  { source: 'payment_processing_system', target: 'citizen_services', label: 'Receipts', packetsPerSecond: 2_200 },
  { source: 'payment_processing_system', target: 'hospital_gateway', label: 'Clinical billing', packetsPerSecond: 1_800 },
  { source: 'payment_processing_system', target: 'public_transport', label: 'Fare payments', packetsPerSecond: 2_100 },
  { source: 'supply_chain', target: 'retail_infrastructure', label: 'Replenishment', packetsPerSecond: 4_800 },
  { source: 'supply_chain', target: 'food_supply', label: 'Wholesale', packetsPerSecond: 3_700 },
  { source: 'postal_delivery', target: 'citizen_services', label: 'Last mile', packetsPerSecond: 2_200 },
]

function endpointId(assetType) {
  return `ep-${assetType}`
}

function layoutPosition(district, index) {
  const anchor = DISTRICT_ANCHORS[district] ?? DISTRICT_ANCHORS.urban
  const cols = GRID_COLS[district] ?? 2
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    x: anchor.x + col * CELL.x,
    y: anchor.y + row * CELL.y,
  }
}

function overlayYamlDependencies(edges, knownTypes) {
  const overlay = getCityModelOverlay()
  const deps = overlay?.dependencies
  if (!Array.isArray(deps) || deps.length === 0) return

  const pairKey = (source, target) => `${source}|${target}`
  const existing = new Set(edges.map((e) => pairKey(e.source, e.target)))

  for (const dep of deps) {
    const srcType = catalogTypeForYaml(dep.source)
    const tgtType = catalogTypeForYaml(dep.target)
    if (!srcType || !tgtType) continue
    if (!knownTypes.has(srcType) || !knownTypes.has(tgtType)) continue
    const source = endpointId(srcType)
    const target = endpointId(tgtType)
    if (source === target) continue
    const key = pairKey(source, target)
    const reverse = pairKey(target, source)
    if (existing.has(key) || existing.has(reverse)) {
      const hit = edges.find(
        (e) =>
          (e.source === source && e.target === target) ||
          (e.source === target && e.target === source)
      )
      if (hit) {
        hit.data = {
          ...hit.data,
          yamlType: dep.type,
          yamlWeight: dep.weight,
        }
      }
      continue
    }
    existing.add(key)
    const weight = Number(dep.weight)
    edges.push({
      id: `dep-yaml-${dep.source}-${dep.target}`,
      type: EDGE_TYPE,
      source,
      target,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        label: dep.type || 'dependency',
        packetsPerSecond: Math.round(4000 * (Number.isFinite(weight) && weight > 0 ? weight : 0.5)),
        yamlType: dep.type,
        yamlWeight: dep.weight,
      },
    })
  }
}

function cityNode(assetType, position) {
  const asset = getAssetByType(assetType)
  return {
    id: endpointId(assetType),
    type: NODE_TYPE,
    position,
    data: dataFromAsset(asset ?? { type: assetType, title: assetType }),
  }
}

/**
 * One node per YAML-backed city-model endpoint (~40).
 */
export function buildCityDependencyGraph() {
  const indices = {}
  const nodes = LIVE_CITY_GRAPH_TYPES.map((assetType) => {
    const asset = getAssetByType(assetType)
    const district = DOMAIN_TO_DISTRICT[asset?.domain] ?? 'urban'
    const index = indices[district] ?? 0
    indices[district] = index + 1
    return cityNode(assetType, layoutPosition(district, index))
  })

  const known = new Set(nodes.map((n) => n.data.type))
  const edges = CITY_DEPENDENCIES.filter(
    (d) => known.has(d.source) && known.has(d.target)
  ).map((d) => ({
    id: `dep-${d.source}-${d.target}`,
    type: EDGE_TYPE,
    source: endpointId(d.source),
    target: endpointId(d.target),
    markerEnd: { type: MarkerType.ArrowClosed },
    data: {
      label: d.label,
      packetsPerSecond: d.packetsPerSecond,
    },
  }))

  overlayYamlDependencies(edges, known)

  return {
    nodes,
    edges,
    viewport: { x: -380, y: -140, zoom: 0.4 },
  }
}

