/**
 * Attack preset registry — Attacker Mode metric injectors.
 *
 * Presets only produce telemetry overrides (four game metric keys).
 * Detection / incidents remain downstream of the existing snapshot pipeline.
 * Multi-stage presets change the metric profile by hop depth (seed = stage 0).
 */

import { LIVE_CITY_GRAPH_TYPES } from './cityModel/liveGraphTypes.js'

/**
 * @typedef {'traffic_flood' | 'data_exfiltration' | 'api_abuse' | 'credential_spray' |
 *   'iot_lateral' | 'internet_facing_compromise' | 'credential_compromise' |
 *   'botnet_flood' | 'malicious_peer' | 'service_disruption' |
 *   'coordinated_multi_node' | 'cascade_propagation'} AttackPresetId
 */

/**
 * @typedef {{
 *   id: string
 *   name: string
 *   description?: string
 *   profile: string
 * }} AttackPresetStage
 */

/**
 * @typedef {{
 *   id: AttackPresetId | string
 *   title: string
 *   name?: string
 *   description: string
 *   attackType: string
 *   preferredSeedTypes: string[]
 *   stages: AttackPresetStage[]
 *   expectedBehavior: string
 *   composable?: boolean
 * }} AttackPresetDefinition
 */

/** @type {Map<string, AttackPresetDefinition>} */
const presetsById = new Map()

const LIVE_TYPE_SET = new Set(LIVE_CITY_GRAPH_TYPES)

/**
 * Metric profile formulas vs baseline. Legacy profiles must stay bit-stable
 * when variation === 1 so existing demos/tests do not regress.
 * @type {Record<string, (b: { pps: number, http: number, files: number, logins: number }) => Record<string, number>>}
 */
const METRIC_PROFILES = Object.freeze({
  traffic_flood: ({ pps, http }) => ({
    packetsPerSecond: Math.max(pps * 15, pps + 50_000, 80_000),
    httpRequestsPerMin: Math.max(http * 3, http + 120, 500),
  }),
  data_exfiltration: ({ pps, http, files }) => ({
    filesDownloaded: Math.max(files + 500, 800),
    packetsPerSecond: Math.max(pps * 4, pps + 8_000, 25_000),
    httpRequestsPerMin: Math.max(http * 2, http + 40, 200),
  }),
  api_abuse: ({ pps, http }) => ({
    httpRequestsPerMin: Math.max(http * 40, http + 2_000, 5_000),
    packetsPerSecond: Math.max(pps * 3, pps + 5_000, 18_000),
  }),
  credential_spray: ({ http, logins }) => ({
    failedLoginsPerMin: Math.max(logins * 50, logins + 200, 350),
    httpRequestsPerMin: Math.max(http * 8, http + 300, 800),
  }),
  // IoT probe: elevated PPS / modest HTTP (CCTV, MQTT, actuators).
  iot_probe: ({ pps, http }) => ({
    packetsPerSecond: Math.max(pps * 8, pps + 18_000, 35_000),
    httpRequestsPerMin: Math.max(http * 2, http + 60, 180),
  }),
  // Post-compromise peer chatter toward adjacent services.
  peer_c2: ({ pps, http }) => ({
    packetsPerSecond: Math.max(pps * 6, pps + 12_000, 28_000),
    httpRequestsPerMin: Math.max(http * 12, http + 400, 1_200),
  }),
  // Stolen-session / account takeover: HTTP + light auth noise (not spray-scale).
  account_takeover: ({ pps, http, logins }) => ({
    failedLoginsPerMin: Math.max(logins * 8, logins + 40, 80),
    httpRequestsPerMin: Math.max(http * 25, http + 900, 2_500),
    packetsPerSecond: Math.max(pps * 3, pps + 6_000, 20_000),
  }),
  // Botnet-style volumetric flood (harder than traffic_flood).
  botnet_pps: ({ pps, http }) => ({
    packetsPerSecond: Math.max(pps * 25, pps + 90_000, 140_000),
    httpRequestsPerMin: Math.max(http * 6, http + 400, 1_500),
  }),
  // Directed malicious peer / C2 link signature.
  malicious_peer_link: ({ pps, http, files }) => ({
    packetsPerSecond: Math.max(pps * 10, pps + 22_000, 45_000),
    httpRequestsPerMin: Math.max(http * 15, http + 500, 1_800),
    filesDownloaded: Math.max(files + 40, 60),
  }),
  // Service crush / availability hit.
  service_crush: ({ pps, http }) => ({
    packetsPerSecond: Math.max(pps * 18, pps + 60_000, 100_000),
    httpRequestsPerMin: Math.max(http * 30, http + 1_500, 4_000),
  }),
  // Coordinated mixed signature (flood + auth + file pull).
  coordinated_mix: ({ pps, http, files, logins }) => ({
    packetsPerSecond: Math.max(pps * 12, pps + 40_000, 70_000),
    httpRequestsPerMin: Math.max(http * 18, http + 700, 2_000),
    failedLoginsPerMin: Math.max(logins * 12, logins + 60, 120),
    filesDownloaded: Math.max(files + 120, 200),
  }),
  // Cascade early / mid / late intensification.
  cascade_early: ({ pps, http }) => ({
    packetsPerSecond: Math.max(pps * 5, pps + 10_000, 22_000),
    httpRequestsPerMin: Math.max(http * 4, http + 100, 350),
  }),
  cascade_mid: ({ pps, http, logins }) => ({
    packetsPerSecond: Math.max(pps * 9, pps + 25_000, 50_000),
    httpRequestsPerMin: Math.max(http * 10, http + 350, 1_000),
    failedLoginsPerMin: Math.max(logins * 15, logins + 80, 150),
  }),
  cascade_late: ({ pps, http, files }) => ({
    packetsPerSecond: Math.max(pps * 14, pps + 45_000, 85_000),
    httpRequestsPerMin: Math.max(http * 20, http + 800, 2_800),
    filesDownloaded: Math.max(files + 300, 500),
  }),
  internet_probe: ({ pps, http }) => ({
    packetsPerSecond: Math.max(pps * 7, pps + 15_000, 32_000),
    httpRequestsPerMin: Math.max(http * 22, http + 800, 2_200),
  }),
})

function baselineParts(baseline) {
  return {
    pps: baseline?.packetsPerSecond ?? 0,
    http: baseline?.httpRequestsPerMin ?? 0,
    files: baseline?.filesDownloaded ?? 0,
    logins: baseline?.failedLoginsPerMin ?? 0,
  }
}

/**
 * Stable per-key variation in [min, max] for demo diversity without run-to-run drift
 * for the same node+preset pair.
 */
export function stableVariationFactor(key, { min = 0.94, max = 1.06 } = {}) {
  const s = String(key ?? '')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const u = (h >>> 0) / 0xffffffff
  return min + u * (max - min)
}

function applyVariation(overrides, variation) {
  const factor = Number(variation)
  if (!Number.isFinite(factor) || factor === 1) return { ...overrides }
  const out = {}
  for (const [k, v] of Object.entries(overrides)) {
    const n = Number(v)
    out[k] = Number.isFinite(n) ? Math.max(0, Math.round(n * factor)) : v
  }
  return out
}

function computeProfileOverrides(profileId, baseline, variation = 1) {
  const fn = METRIC_PROFILES[profileId]
  if (!fn) return {}
  return applyVariation(fn(baselineParts(baseline)), variation)
}

function assertLiveTypes(types, presetId) {
  for (const t of types ?? []) {
    if (!LIVE_TYPE_SET.has(t)) {
      throw new Error(`Attack preset "${presetId}" preferredSeedType "${t}" is not a live city graph type`)
    }
  }
}

function normalizePreset(def) {
  const id = String(def?.id ?? '').trim()
  if (!id) throw new Error('Attack preset requires id')
  if (!def?.title && !def?.name) throw new Error(`Attack preset "${id}" requires title`)
  if (!def?.description) throw new Error(`Attack preset "${id}" requires description`)
  if (!def?.attackType) throw new Error(`Attack preset "${id}" requires attackType`)
  if (!Array.isArray(def.stages) || def.stages.length === 0) {
    throw new Error(`Attack preset "${id}" requires at least one stage`)
  }
  for (const stage of def.stages) {
    if (!stage?.id || !stage?.name || !stage?.profile) {
      throw new Error(`Attack preset "${id}" has an incomplete stage`)
    }
    if (!METRIC_PROFILES[stage.profile]) {
      throw new Error(`Attack preset "${id}" stage "${stage.id}" unknown profile "${stage.profile}"`)
    }
  }
  const preferredSeedTypes = Object.freeze([...(def.preferredSeedTypes ?? [])].map(String))
  assertLiveTypes(preferredSeedTypes, id)

  return Object.freeze({
    id,
    title: String(def.title ?? def.name),
    name: String(def.name ?? def.title),
    description: String(def.description),
    attackType: String(def.attackType),
    preferredSeedTypes,
    stages: Object.freeze(
      def.stages.map((s) =>
        Object.freeze({
          id: String(s.id),
          name: String(s.name),
          description: s.description ? String(s.description) : undefined,
          profile: String(s.profile),
        })
      )
    ),
    expectedBehavior: String(def.expectedBehavior ?? def.description),
    composable: def.composable !== false,
  })
}

function refreshLegacyExports() {
  ATTACK_PRESET_IDS = Object.freeze([...presetsById.keys()])
  ATTACK_PRESETS = Object.freeze(listAttackPresets())
}

/**
 * Register (or replace) a preset in the registry.
 * @param {Partial<AttackPresetDefinition> & { id: string, title?: string, name?: string, description: string, attackType: string, stages: AttackPresetStage[] }} def
 * @param {{ replace?: boolean }} [opts]
 */
export function registerAttackPreset(def, { replace = false } = {}) {
  const normalized = normalizePreset(def)
  if (presetsById.has(normalized.id) && !replace) {
    throw new Error(`Attack preset already registered: ${normalized.id}`)
  }
  presetsById.set(normalized.id, normalized)
  refreshLegacyExports()
  return normalized
}

export function listAttackPresets() {
  return [...presetsById.values()]
}

export function getAttackPreset(presetId) {
  const id = String(presetId ?? '')
  return presetsById.get(id) ?? null
}

export function isAttackPresetId(id) {
  return presetsById.has(String(id ?? ''))
}

export function attackPresetTitle(presetId) {
  return getAttackPreset(presetId)?.title ?? String(presetId ?? '')
}

export function catalogTypeToNodeId(assetType) {
  return `ep-${String(assetType ?? '')}`
}

/**
 * Preferred seed node ids for a preset, optionally filtered to nodes present in the room.
 * @param {string} presetId
 * @param {Iterable<string> | null} [availableNodeIds]
 */
export function preferredNodeIdsForPreset(presetId, availableNodeIds = null) {
  const preset = getAttackPreset(presetId)
  if (!preset) return []
  const preferred = preset.preferredSeedTypes.map(catalogTypeToNodeId)
  if (availableNodeIds == null) return preferred
  const available = new Set([...availableNodeIds].map(String))
  return preferred.filter((id) => available.has(id))
}

/**
 * Resolve stage index for hop depth (seed = 0, first spread = 1, …).
 * @param {string} presetId
 * @param {number} stageIndex
 */
export function resolvePresetStage(presetId, stageIndex = 0) {
  const preset = getAttackPreset(presetId)
  if (!preset) return null
  const idx = Math.max(0, Math.min(Number(stageIndex) || 0, preset.stages.length - 1))
  return { index: idx, stage: preset.stages[idx] }
}

/**
 * @param {string} presetId
 * @param {Record<string, number>} baseline
 * @param {{ stageIndex?: number, variation?: number }} [opts]
 */
export function computePresetOverrides(presetId, baseline, opts = {}) {
  const preset = getAttackPreset(presetId)
  const variation = opts.variation ?? 1
  if (!preset) return {}
  const resolved = resolvePresetStage(presetId, opts.stageIndex ?? 0)
  if (!resolved) return {}
  return computeProfileOverrides(resolved.stage.profile, baseline, variation)
}

/** Live binding snapshots for back-compat importers (SidebarAssets, tests). */
export let ATTACK_PRESET_IDS = Object.freeze(/** @type {string[]} */ ([]))
export let ATTACK_PRESETS = Object.freeze(/** @type {AttackPresetDefinition[]} */ ([]))

// ── Built-in presets (legacy first — formulas unchanged at variation=1) ─────

registerAttackPreset({
  id: 'traffic_flood',
  title: 'Traffic flood',
  description: 'Spike packet rate and modest HTTP noise',
  attackType: 'volumetric_flood',
  preferredSeedTypes: ['internet_infrastructure', 'telecom_gateway', 'traffic_management'],
  stages: [
    {
      id: 'flood',
      name: 'Volumetric flood',
      description: 'Saturate PPS on the seed endpoint',
      profile: 'traffic_flood',
    },
  ],
  expectedBehavior: 'Large PPS deviation; modest HTTP lift; seed anomaly then peer/propagation exposure.',
})

registerAttackPreset({
  id: 'data_exfiltration',
  title: 'Data exfiltration',
  description: 'Bulk file pulls with elevated throughput',
  attackType: 'exfiltration',
  preferredSeedTypes: ['object_storage', 'hospital_emr', 'data_centers', 'banking_financial'],
  stages: [
    {
      id: 'exfil',
      name: 'Bulk pull',
      description: 'Spike filesDownloaded with elevated throughput',
      profile: 'data_exfiltration',
    },
  ],
  expectedBehavior: 'filesDownloaded and PPS/HTTP rise on the seed; suitable for finance/health data nodes.',
})

registerAttackPreset({
  id: 'api_abuse',
  title: 'API abuse',
  description: 'Hammer HTTP/API request rate',
  attackType: 'api_abuse',
  preferredSeedTypes: ['citizen_services', 'digital_banking_platform', 'bank_gateway', 'government_services'],
  stages: [
    {
      id: 'hammer',
      name: 'API hammer',
      description: 'Extreme HTTP request rate',
      profile: 'api_abuse',
    },
  ],
  expectedBehavior: 'HTTP-dominant residual; good on internet-facing civic/finance gateways.',
})

registerAttackPreset({
  id: 'credential_spray',
  title: 'Credential spray',
  description: 'Failed login burst',
  attackType: 'credential_attack',
  preferredSeedTypes: ['identity_access', 'hospital_auth', 'bank_gateway', 'government_services'],
  stages: [
    {
      id: 'spray',
      name: 'Login spray',
      description: 'Burst failedLoginsPerMin',
      profile: 'credential_spray',
    },
  ],
  expectedBehavior: 'failedLogins spike with elevated HTTP; classic auth-plane seed.',
})

registerAttackPreset({
  id: 'iot_lateral',
  title: 'Compromised IoT → lateral',
  description: 'IoT endpoint compromise that pivots toward safety and civic peers',
  attackType: 'iot_lateral_movement',
  preferredSeedTypes: ['surveillance_cctv', 'mqtt_broker', 'smart_actuator'],
  stages: [
    {
      id: 'compromise',
      name: 'IoT compromise',
      description: 'Probe noise on camera / MQTT / actuator',
      profile: 'iot_probe',
    },
    {
      id: 'lateral',
      name: 'Lateral pivot',
      description: 'Peer C2 chatter after spread to adjacent services',
      profile: 'peer_c2',
    },
    {
      id: 'objective',
      name: 'Data access',
      description: 'Exfiltration-style pull on deeper hops',
      profile: 'data_exfiltration',
    },
  ],
  expectedBehavior:
    'Seed CCTV/MQTT/actuator → spread along live edges (e.g. CCTV→police/emergency, MQTT→hospital_gateway) with intensifying signatures.',
})

registerAttackPreset({
  id: 'internet_facing_compromise',
  title: 'Internet-facing compromise',
  description: 'Edge service breach progressing toward core banking / hospital WAN',
  attackType: 'internet_facing_compromise',
  preferredSeedTypes: ['internet_infrastructure', 'telecom_gateway', 'bank_gateway', 'digital_banking_platform'],
  stages: [
    {
      id: 'edge',
      name: 'Edge probe',
      description: 'Internet/WAN-facing HTTP+PPS probe',
      profile: 'internet_probe',
    },
    {
      id: 'abuse',
      name: 'API abuse',
      description: 'Abuse authenticated HTTP surface after foothold',
      profile: 'api_abuse',
    },
    {
      id: 'exfil',
      name: 'Exfiltration',
      description: 'Bulk pull once deeper in the graph',
      profile: 'data_exfiltration',
    },
  ],
  expectedBehavior:
    'Seed edge WAN/bank channel → hop toward hospital_gateway / banking_financial / campus with API then exfil profiles.',
})

registerAttackPreset({
  id: 'credential_compromise',
  title: 'Credential compromise',
  description: 'Stolen credentials: takeover traffic then lateral toward federated apps',
  attackType: 'credential_compromise',
  preferredSeedTypes: ['identity_access', 'hospital_auth', 'bank_gateway'],
  stages: [
    {
      id: 'takeover',
      name: 'Account takeover',
      description: 'Elevated HTTP with light auth noise (post-theft use)',
      profile: 'account_takeover',
    },
    {
      id: 'federation',
      name: 'Federated abuse',
      description: 'Peer C2 toward federated dependents',
      profile: 'peer_c2',
    },
    {
      id: 'exfil',
      name: 'Session exfil',
      description: 'Data pull from reached application tier',
      profile: 'data_exfiltration',
    },
  ],
  expectedBehavior:
    'Distinct from credential spray: lower failed-login floors, higher session HTTP; spread IdP → gov/banking/hospital.',
})

registerAttackPreset({
  id: 'botnet_flood',
  title: 'Botnet device flood',
  description: 'Coordinated volumetric flood from compromised edge devices',
  attackType: 'botnet_flood',
  preferredSeedTypes: ['surveillance_cctv', 'mqtt_broker', 'telecom_gateway', 'internet_infrastructure'],
  stages: [
    {
      id: 'rally',
      name: 'Botnet flood',
      description: 'Extreme PPS saturation',
      profile: 'botnet_pps',
    },
    {
      id: 'amplify',
      name: 'Amplify hop',
      description: 'Continue volumetric pressure on spread targets',
      profile: 'botnet_pps',
    },
  ],
  expectedBehavior: 'Harder PPS floors than traffic_flood; use auto/manual spread to light up adjacent peers.',
})

registerAttackPreset({
  id: 'malicious_peer',
  title: 'Malicious peer communication',
  description: 'Suspicious peer-to-peer / C2-style traffic along dependency edges',
  attackType: 'malicious_peer_communication',
  preferredSeedTypes: ['telecom_gateway', 'identity_access', 'public_safety_gateway', 'mqtt_broker'],
  stages: [
    {
      id: 'beacon',
      name: 'Peer beacon',
      description: 'Directed PPS+HTTP+light file chatter',
      profile: 'malicious_peer_link',
    },
    {
      id: 'command',
      name: 'Peer command',
      description: 'Heavier C2 after lateral hop',
      profile: 'peer_c2',
    },
  ],
  expectedBehavior: 'Peer-link signature on gateway/IdP seeds; spread along live WAN/federation edges.',
})

registerAttackPreset({
  id: 'service_disruption',
  title: 'Service disruption',
  description: 'Availability attack against civic, transport, or payment services',
  attackType: 'service_disruption',
  preferredSeedTypes: [
    'payment_processing_system',
    'traffic_management',
    'citizen_services',
    'banking_financial',
  ],
  stages: [
    {
      id: 'crush',
      name: 'Service crush',
      description: 'Simultaneous PPS and HTTP saturation',
      profile: 'service_crush',
    },
  ],
  expectedBehavior: 'Availability-shaped residuals on payment/traffic/civic nodes without inventing topology.',
})

registerAttackPreset({
  id: 'coordinated_multi_node',
  title: 'Coordinated multi-node',
  description: 'Same mixed signature across several seeds — apply to multiple preferred nodes',
  attackType: 'coordinated_multi_node',
  preferredSeedTypes: [
    'surveillance_cctv',
    'mqtt_broker',
    'telecom_gateway',
    'identity_access',
    'payment_processing_system',
  ],
  stages: [
    {
      id: 'wave',
      name: 'Coordinated wave',
      description: 'Mixed flood + auth + file signature',
      profile: 'coordinated_mix',
    },
    {
      id: 'reinforce',
      name: 'Reinforce hop',
      description: 'Keep mixed pressure after spread',
      profile: 'coordinated_mix',
    },
  ],
  expectedBehavior:
    'Composable: seed several preferred live nodes with the same preset, then spread; graph shows multi-seed exposure.',
})

registerAttackPreset({
  id: 'cascade_propagation',
  title: 'Cascading propagation',
  description: 'Intensifying multi-hop cascade from power/telecom hubs',
  attackType: 'cascade_propagation',
  preferredSeedTypes: ['power_substation', 'telecom_gateway', 'data_centers', 'plc_controller'],
  stages: [
    {
      id: 'ignite',
      name: 'Ignite',
      description: 'Early cascade residual',
      profile: 'cascade_early',
    },
    {
      id: 'expand',
      name: 'Expand',
      description: 'Mid-hop auth+throughput pressure',
      profile: 'cascade_mid',
    },
    {
      id: 'deepen',
      name: 'Deepen',
      description: 'Late-hop exfil-shaped intensification',
      profile: 'cascade_late',
    },
  ],
  expectedBehavior:
    'Seed hub (substation/telecom/DC) → each spread hop advances stage metrics so the graph residual visibly escalates.',
})
