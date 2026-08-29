import { parse as parseYaml } from 'yaml'
import { yamlMetricNamesFromModel } from '../telemetryKeys.js'

export const METRIC_KEYS = [
  'packetsPerSecond',
  'httpRequestsPerMin',
  'filesDownloaded',
  'failedLoginsPerMin',
]

export const DEFAULT_CITY_CONTEXTS = Object.freeze([
  'normal_day',
  'rush_hour',
  'night',
  'weekend',
  'heavy_rain',
  'major_event',
])

export const DEFAULT_CITY_CONTEXT_LABELS = Object.freeze({
  normal_day: 'Normal day',
  rush_hour: 'Rush hour',
  night: 'Night',
  weekend: 'Weekend',
  heavy_rain: 'Heavy rain',
  major_event: 'Major event',
})

const SECTOR_TO_FAMILY = {
  transportation: 'transport',
  healthcare: 'healthcare',
  water: 'weatherWater',
  'emergency-services': 'emergency',
  'public-safety': 'emergency',
  government: 'civic',
  education: 'civic',
  energy: 'energy',
  telecommunications: 'telecom',
  finance: 'finance',
}

export const LEVEL_SCALE = {
  peak: 1.45,
  very_high: 1.45,
  veryhigh: 1.45,
  critical: 1.45,
  compromised: 1.6,
  abnormal: 1.45,
  high: 1.2,
  heavy: 1.2,
  elevated: 1.1,
  normal: 1,
  moderate: 1,
  low: 0.4,
  light: 0.4,
}

export function aliasedModelPaths(rel) {
  const n = String(rel ?? '')
    .trim()
    .replace(/^\.\//, '')
  if (!n) return []
  const out = [n]
  if (n.startsWith('infrastructure/')) {
    out.push(`infrastructue/${n.slice('infrastructure/'.length)}`)
  }
  if (n === 'actors/city-actors.yaml') out.push('actors/city_actors.yaml')
  if (n.endsWith('/hospital-pharmacy.yaml')) {
    out.push(n.replace(/hospital-pharmacy\.yaml$/, 'pharmacy-management.yaml'))
    out.push(
      n
        .replace(/^infrastructure\//, 'infrastructue/')
        .replace(/hospital-pharmacy\.yaml$/, 'pharmacy-management.yaml')
    )
  }
  return [...new Set(out)]
}

export function lookupYaml(files, rel) {
  const map = files && typeof files === 'object' ? files : {}
  for (const key of aliasedModelPaths(rel)) {
    if (map[key] != null && map[key] !== '') return map[key]
    const stripped = key.replace(/^\.\//, '')
    if (map[stripped] != null && map[stripped] !== '') return map[stripped]
  }
  return null
}

export function levelScale(value) {
  if (value == null || value === '') return undefined
  const key = String(value).toLowerCase().replace(/-/g, '_')
  return LEVEL_SCALE[key]
}

const UNIT_METRICS = Object.freeze({
  packetsPerSecond: 1,
  httpRequestsPerMin: 1,
  filesDownloaded: 1,
  failedLoginsPerMin: 1,
})

function firstScale(mod, keys) {
  for (const key of keys) {
    const n = levelScale(mod?.[key])
    if (n != null) return n
  }
  return 1
}

function round4(n) {
  return Math.round(n * 10000) / 10000
}

function metricsFromModifier(mod) {
  const src = mod && typeof mod === 'object' ? mod : {}
  const activity = firstScale(src, ['activityLevel', 'workload', 'networkActivity'])
  const pps = firstScale(src, ['networkActivity', 'activityLevel', 'workload'])
  const http = firstScale(src, ['expectedUsers', 'activityLevel', 'networkActivity', 'workload'])
  const files = (activity + firstScale(src, ['workload', 'activityLevel'])) / 2
  let failed = 1 + (activity - 1) * 0.15
  if (String(src.healthStatus ?? '').toLowerCase() === 'degraded') {
    failed *= 1.08
  }
  return {
    packetsPerSecond: round4(pps),
    httpRequestsPerMin: round4(http),
    filesDownloaded: round4(files),
    failedLoginsPerMin: round4(Math.max(0.5, failed)),
  }
}

function maxMetrics(a, b) {
  const out = { ...UNIT_METRICS }
  for (const key of METRIC_KEYS) {
    out[key] = Math.max(Number(a?.[key]) || 1, Number(b?.[key]) || 1)
  }
  return out
}

function labelFromId(id) {
  if (DEFAULT_CITY_CONTEXT_LABELS[id]) return DEFAULT_CITY_CONTEXT_LABELS[id]
  return String(id)
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function listedPaths(cityDoc, ...keys) {
  const city = cityDoc?.city && typeof cityDoc.city === 'object' ? cityDoc.city : {}
  for (const key of keys) {
    const listed = city[key] ?? cityDoc?.[key]
    if (Array.isArray(listed)) {
      return listed.map((item) => String(item).trim()).filter(Boolean)
    }
  }
  return []
}

function parseMetricList(doc) {
  const list = doc?.telemetry?.metrics
  if (!Array.isArray(list)) return []
  const out = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const name = String(raw.name ?? '').trim()
    if (!name) continue
    const min = Number(raw.min)
    const max = Number(raw.max)
    out.push({
      name,
      unit: String(raw.unit ?? '').trim(),
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
    })
  }
  return out
}

function parseEndpointDoc(doc) {
  if (!doc || typeof doc !== 'object') return null
  const id = String(doc.id ?? '').trim()
  if (!id) return null
  return {
    id,
    name: String(doc.name ?? id).trim(),
    category: String(doc.category ?? '').trim(),
    type: String(doc.type ?? '').trim(),
    criticality: String(doc.criticality ?? '').trim(),
    operatingSchedule:
      doc.operating_schedule && typeof doc.operating_schedule === 'object'
        ? doc.operating_schedule
        : null,
    behaviour: doc.behaviour && typeof doc.behaviour === 'object' ? doc.behaviour : {},
    states: doc.states && typeof doc.states === 'object' ? doc.states : {},
    metrics: parseMetricList(doc),
    actors: Array.isArray(doc.actors) ? doc.actors.map((a) => String(a).trim()).filter(Boolean) : [],
    dependencies: Array.isArray(doc.dependencies) ? doc.dependencies : [],
  }
}

function depKey(edge) {
  return `${edge.source}\0${edge.target}`
}

function normalizeDep(raw, fallbackSource) {
  if (!raw || typeof raw !== 'object') return null
  const source = String(raw.source ?? fallbackSource ?? '').trim()
  const target = String(raw.target ?? raw.endpoint ?? '').trim()
  if (!source || !target || source === target) return null
  const weight = Number(raw.weight)
  return {
    source,
    target,
    type: String(raw.type ?? 'supporting').trim() || 'supporting',
    weight: Number.isFinite(weight) ? weight : 0,
  }
}

function parseGlobalDependencies(doc) {
  const list = Array.isArray(doc?.dependencies) ? doc.dependencies : Array.isArray(doc) ? doc : []
  const out = []
  for (const raw of list) {
    const edge = normalizeDep(raw, '')
    if (edge) out.push(edge)
  }
  return out
}

function parseActorList(doc) {
  const list = Array.isArray(doc?.actors) ? doc.actors : Array.isArray(doc) ? doc : []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const id = String(raw.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const activity = raw.activity && typeof raw.activity === 'object' ? { ...raw.activity } : {}
    const interacts = Array.isArray(raw.interacts_with)
      ? raw.interacts_with.map((x) => String(x).trim()).filter(Boolean)
      : []
    out.push({
      id,
      name: String(raw.name ?? id).trim(),
      interactsWith: interacts,
      activity,
    })
  }
  return out
}

function mergeFamilyTables(modifiers) {
  const byFamily = {}
  const src = modifiers && typeof modifiers === 'object' ? modifiers : {}
  for (const [sector, mod] of Object.entries(src)) {
    const family = SECTOR_TO_FAMILY[sector] ?? SECTOR_TO_FAMILY[String(sector).toLowerCase()]
    if (!family) continue
    const metrics = metricsFromModifier(mod)
    byFamily[family] = byFamily[family] ? maxMetrics(byFamily[family], metrics) : metrics
  }
  if (!byFamily.default) byFamily.default = { ...UNIT_METRICS }
  return byFamily
}

/**
 * @param {{
 *   cityYaml: string
 *   contextYamls: Record<string, string>
 *   infrastructureYamls?: Record<string, string>
 *   actorYamls?: Record<string, string>
 *   dependencyYamls?: Record<string, string>
 *   sourcePath?: string
 * }} input
 */
export function parseCityModelDocuments({
  cityYaml,
  contextYamls,
  infrastructureYamls,
  actorYamls,
  dependencyYamls,
  sourcePath = '',
}) {
  const cityDoc = parseYaml(cityYaml) ?? {}
  const listed = listedPaths(cityDoc, 'contexts')
  const files = contextYamls && typeof contextYamls === 'object' ? contextYamls : {}

  const entries = []
  const seen = new Set()

  const paths = listed.length ? listed : Object.keys(files)
  for (const rel of paths) {
    const raw = lookupYaml(files, rel)
    if (raw == null || raw === '') continue
    const doc = parseYaml(raw)
    if (!doc || typeof doc !== 'object') continue
    const id = String(doc.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    entries.push({
      id,
      priority: Number(doc.priority),
      description: String(doc.description ?? '').trim(),
      modifiers: doc.modifiers && typeof doc.modifiers === 'object' ? doc.modifiers : {},
    })
  }

  const contexts = entries.map((e) => e.id)
  const labels = {}
  const priorities = {}
  const multipliers = {}

  for (const entry of entries) {
    labels[entry.id] = labelFromId(entry.id)
    priorities[entry.id] = Number.isFinite(entry.priority) ? entry.priority : 0
    multipliers[entry.id] = mergeFamilyTables(entry.modifiers)
  }

  if (!contexts.length) return null

  const fallback = contexts.includes('normal_day') ? 'normal_day' : contexts[0]

  const infraFiles = infrastructureYamls && typeof infrastructureYamls === 'object' ? infrastructureYamls : {}
  const infraListed = listedPaths(cityDoc, 'infrastructure')
  const infraPaths = infraListed.length ? infraListed : Object.keys(infraFiles)
  const endpoints = {}
  for (const rel of infraPaths) {
    const raw = lookupYaml(infraFiles, rel)
    if (raw == null || raw === '') continue
    const parsed = parseEndpointDoc(parseYaml(raw))
    if (!parsed || endpoints[parsed.id]) continue
    endpoints[parsed.id] = parsed
  }

  const actorFiles = actorYamls && typeof actorYamls === 'object' ? actorYamls : {}
  const actorListed = listedPaths(cityDoc, 'actors')
  const actorPaths = actorListed.length ? actorListed : Object.keys(actorFiles)
  const actors = []
  const actorSeen = new Set()
  for (const rel of actorPaths) {
    const raw = lookupYaml(actorFiles, rel)
    if (raw == null || raw === '') continue
    for (const actor of parseActorList(parseYaml(raw))) {
      if (actorSeen.has(actor.id)) continue
      actorSeen.add(actor.id)
      actors.push(actor)
    }
  }

  const depFiles = dependencyYamls && typeof dependencyYamls === 'object' ? dependencyYamls : {}
  const depListed = listedPaths(cityDoc, 'dependencies')
  const depPaths = depListed.length ? depListed : Object.keys(depFiles)
  const merged = new Map()
  for (const rel of depPaths) {
    const raw = lookupYaml(depFiles, rel)
    if (raw == null || raw === '') continue
    for (const edge of parseGlobalDependencies(parseYaml(raw))) {
      merged.set(depKey(edge), edge)
    }
  }
  for (const ep of Object.values(endpoints)) {
    for (const raw of ep.dependencies ?? []) {
      const edge = normalizeDep(raw, ep.id)
      if (!edge) continue
      const key = depKey(edge)
      if (!merged.has(key)) merged.set(key, edge)
    }
  }
  const knownIds = new Set(Object.keys(endpoints))
  const dependencies = [...merged.values()].filter(
    (edge) => knownIds.has(edge.source) && knownIds.has(edge.target)
  )

  return {
    contexts: Object.freeze([...contexts]),
    labels: Object.freeze(labels),
    priorities: Object.freeze(priorities),
    multipliers,
    fallback,
    endpoints,
    actors: Object.freeze(actors),
    dependencies: Object.freeze(dependencies),
    yamlMetricNames: Object.freeze(yamlMetricNamesFromModel({ endpoints })),
    sourcePath,
  }
}
