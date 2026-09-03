/** Catalog of defender-side pattern matches. Not attacker playbooks. MITRE ids are candidates only. */

export const CAMPAIGN_SCORE_WEIGHTS = Object.freeze({
  temporal: 0.2,
  topology: 0.25,
  incidentPattern: 0.2,
  sectorPattern: 0.15,
  criticality: 0.1,
  trustPropagation: 0.1,
})

export const CAMPAIGN_MATCH_THRESHOLD = 0.72
export const CAMPAIGN_CORRELATED_SCORE = 0.8
export const INCIDENT_LEDGER_TICKS = 30
export const TRUST_BASELINE = 70

export const CAMPAIGN_CATALOG = Object.freeze([
  {
    id: 'financial-service-disruption',
    title: 'Financial service disruption',
    temporalWindow: 12,
    maxTopologyHops: 2,
    minimumIncidentCount: 2,
    requiredDetectionAny: ['communication_anomaly', 'behavioural_anomaly', 'behavioral_anomaly'],
    requiredSectors: ['finance'],
    preferredSectors: ['telecom', 'municipal_it', 'finance'],
    allowDisconnected: false,
    mitreCandidates: ['T1498', 'T1499'],
  },
  {
    id: 'lateral-toward-finance',
    title: 'Lateral movement toward finance',
    temporalWindow: 12,
    maxTopologyHops: 2,
    minimumIncidentCount: 2,
    requiredDetectionAny: ['dependency_anomaly', 'behavioural_anomaly', 'behavioral_anomaly'],
    requiredSectors: ['finance'],
    preferredSectors: ['finance'],
    allowDisconnected: false,
    mitreCandidates: ['T1570', 'T1021'],
  },
  {
    id: 'distributed-service-disruption',
    title: 'Distributed service disruption',
    temporalWindow: 8,
    maxTopologyHops: 2,
    minimumIncidentCount: 3,
    requiredDetectionAny: [],
    requiredSectors: [],
    preferredSectors: [],
    allowDisconnected: false,
    mitreCandidates: ['T1498'],
  },
  {
    id: 'cross-sector-cascade',
    title: 'Cross-sector cascade',
    temporalWindow: 12,
    maxTopologyHops: 3,
    minimumIncidentCount: 2,
    requiredDetectionAny: [],
    requiredSectors: [],
    minDistinctSectors: 2,
    requireHighCriticality: true,
    allowDisconnected: false,
    mitreCandidates: ['T0888'],
  },
])

export function catalogEntry(id) {
  return CAMPAIGN_CATALOG.find((e) => e.id === id) ?? null
}

export function catalogTitle(id) {
  return catalogEntry(id)?.title ?? 'Recognized pattern'
}

export function patternMatchCopy(title) {
  return `Correlated campaign: ${title}`
}

/** Higher = more constrained catalog entry. Used to keep one match per overlapping cluster. */
export function catalogSpecificity(entry) {
  if (!entry) return 0
  let n = 0
  n += entry.requiredDetectionAny?.length ?? 0
  n += (entry.requiredSectors?.length ?? 0) * 3
  n += (entry.preferredSectors?.length ?? 0) * 0.25
  n += Number(entry.minDistinctSectors) || 0
  if (entry.requireHighCriticality) n += 1
  if (entry.id === 'lateral-toward-finance') n += 2
  return n
}

export function sectorKey(sector, type) {
  const s = `${sector ?? ''} ${type ?? ''}`.toLowerCase()
  if (s.includes('finance') || s.includes('bank') || s.includes('payment')) return 'finance'
  if (s.includes('telecom') || s.includes('network operations')) return 'telecom'
  if (s.includes('government') || s.includes('municipal') || s.includes('civic')) return 'municipal_it'
  if (s.includes('energy') || s.includes('power')) return 'energy'
  if (s.includes('water')) return 'water'
  if (s.includes('transport') || s.includes('traffic')) return 'transport'
  if (s.includes('health')) return 'healthcare'
  const first = String(sector ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  return first || 'unknown'
}

export function isFinanceSector(sector, type) {
  return sectorKey(sector, type) === 'finance'
}

export function normalizeDetectionType(type) {
  const t = String(type ?? '')
  if (t === 'behavioral_anomaly') return 'behavioural_anomaly'
  return t
}

export function detectionTypeMatches(observed, required) {
  const o = normalizeDetectionType(observed)
  const r = normalizeDetectionType(required)
  return o === r
}
