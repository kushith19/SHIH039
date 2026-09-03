import { nanoid } from 'nanoid'
import {
  CAMPAIGN_CATALOG,
  CAMPAIGN_CORRELATED_SCORE,
  CAMPAIGN_MATCH_THRESHOLD,
  CAMPAIGN_SCORE_WEIGHTS,
  INCIDENT_LEDGER_TICKS,
  TRUST_BASELINE,
  detectionTypeMatches,
  isFinanceSector,
  normalizeDetectionType,
  catalogSpecificity,
  patternMatchCopy,
  sectorKey,
} from '../../../shared/campaignCatalog.js'
import { isLiveCampaignStatus } from '../../../shared/campaigns.js'
import { isSensitiveExposure } from '../../../shared/attackStory.js'
import { linkCampaignIncident, upsertAttackPattern, upsertCampaign } from '../../metrics/store.js'

export { CAMPAIGN_SCORE_WEIGHTS, CAMPAIGN_MATCH_THRESHOLD }

function adjacency(edges) {
  const adj = new Map()
  for (const e of edges ?? []) {
    if (!e?.source || !e?.target) continue
    if (!adj.has(e.source)) adj.set(e.source, [])
    if (!adj.has(e.target)) adj.set(e.target, [])
    adj.get(e.source).push(e.target)
    adj.get(e.target).push(e.source)
  }
  return adj
}

export function hopDistance(edges, a, b) {
  if (!a || !b) return Infinity
  if (a === b) return 0
  const adj = adjacency(edges)
  const q = [[a, 0]]
  const seen = new Set([a])
  while (q.length) {
    const [id, d] = q.shift()
    for (const n of adj.get(id) ?? []) {
      if (seen.has(n)) continue
      if (n === b) return d + 1
      seen.add(n)
      q.push([n, d + 1])
    }
  }
  return Infinity
}

function pairs(items) {
  const out = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      out.push([items[i], items[j]])
    }
  }
  return out
}

function uniqueEndpoints(rows) {
  const byId = new Map()
  for (const row of rows) {
    const prev = byId.get(row.endpointId)
    if (!prev || Number(row.tick) >= Number(prev.tick)) byId.set(row.endpointId, row)
  }
  return [...byId.values()]
}

function incidentTypes(row) {
  const types = [row.detectionType, ...(row.detectionTypes ?? [])].filter(Boolean)
  return [...new Set(types.map(normalizeDetectionType))]
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function round4(n) {
  return Math.round(clamp01(n) * 10000) / 10000
}

export function appendIncidentLedger(room, detection) {
  const tick = Number(detection?.simulationTick ?? room?.simulationTick) || 0
  if (!Array.isArray(room.incidentLedger)) room.incidentLedger = []
  for (const inc of detection?.incidents ?? []) {
    if (!inc?.endpointId) continue
    room.incidentLedger.push({
      occurrenceId: `${inc.id}@${tick}`,
      incidentId: inc.id,
      tick,
      endpointId: inc.endpointId,
      endpointLabel: inc.endpointLabel ?? inc.endpointId,
      detectionType: inc.detectionType,
      detectionTypes: inc.detectionTypes ?? [],
      sector: inc.sector ?? '',
      type: inc.type ?? '',
      criticality: inc.criticality ?? '',
      trustScore: inc.trustScore,
      severity: inc.severity,
      evidence: inc.evidence ?? [],
      timestamp: inc.timestamp,
      cityEndpointId: inc.cityEndpointId,
      cityContext: inc.cityContext,
      affectedDependencies: inc.affectedDependencies ?? [],
      confidence: inc.confidence,
      anomalyScore: inc.anomalyScore,
    })
  }
  const cutoff = tick - INCIDENT_LEDGER_TICKS
  room.incidentLedger = room.incidentLedger.filter((r) => Number(r.tick) >= cutoff)
  return room.incidentLedger
}

function windowRows(ledger, now, window) {
  return (ledger ?? []).filter((r) => Number(r.tick) >= now - window && Number(r.tick) <= now)
}

function connectedComponent(members, edges, maxHops) {
  if (members.length === 0) return []
  const ids = members.map((m) => m.endpointId)
  const start = ids[0]
  const seen = new Set([start])
  const q = [start]
  while (q.length) {
    const id = q.shift()
    for (const other of ids) {
      if (seen.has(other)) continue
      const hops = hopDistance(edges, id, other)
      if (hops <= maxHops) {
        seen.add(other)
        q.push(other)
      }
    }
  }
  return members.filter((m) => seen.has(m.endpointId))
}

function largestConnected(members, edges, maxHops) {
  const remaining = [...members]
  let best = []
  while (remaining.length) {
    const seed = remaining[0]
    const cluster = connectedComponent(remaining, edges, maxHops)
    if (cluster.length > best.length) best = cluster
    const ids = new Set(cluster.map((m) => m.endpointId))
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (ids.has(remaining[i].endpointId)) remaining.splice(i, 1)
    }
    if (cluster.length === 0) remaining.shift()
  }
  return best
}

function hasRequiredType(members, requiredAny) {
  if (!requiredAny?.length) return true
  const types = members.flatMap(incidentTypes)
  return requiredAny.some((req) => types.some((t) => detectionTypeMatches(t, req)))
}

function extrasPass(entry, members) {
  if (members.length < (entry.minimumIncidentCount ?? 2)) return false
  if (entry.requiredDetectionAny?.length && !hasRequiredType(members, entry.requiredDetectionAny)) {
    return false
  }
  if (entry.requiredSectors?.length) {
    const keys = new Set(members.map((m) => sectorKey(m.sector, m.type)))
    if (!entry.requiredSectors.every((s) => keys.has(s))) return false
  }
  if (entry.minDistinctSectors) {
    const keys = new Set(members.map((m) => sectorKey(m.sector, m.type)))
    if (keys.size < entry.minDistinctSectors) return false
  }
  if (entry.requireHighCriticality) {
    const high = members.some((m) => {
      const c = String(m.criticality ?? '').toLowerCase()
      return c === 'high' || c === 'critical'
    })
    if (!high) return false
  }
  if (entry.id === 'lateral-toward-finance') {
    const originish = members.some((m) => {
      const t = normalizeDetectionType(m.detectionType)
      return t !== 'dependency_anomaly'
    })
    const hop = members.some((m) => {
      const t = normalizeDetectionType(m.detectionType)
      return t === 'dependency_anomaly'
    })
    if (!(originish && hop)) return false
  }
  return true
}

export function scoreCampaignCluster(entry, members, room, _detection) {
  const weights = CAMPAIGN_SCORE_WEIGHTS
  const window = entry.temporalWindow
  const maxHops = entry.maxTopologyHops
  const prs = pairs(members)
  const pairCount = Math.max(1, prs.length)

  let temporalHits = 0
  let topoHits = 0
  let topoZero = false
  for (const [a, b] of prs) {
    if (Math.abs(Number(a.tick) - Number(b.tick)) <= window) temporalHits += 1
    const hops = hopDistance(room?.edges, a.endpointId, b.endpointId)
    if (!Number.isFinite(hops) || hops > maxHops) topoZero = true
    else topoHits += 1
  }
  const temporal = prs.length === 0 ? 1 : temporalHits / pairCount
  const topology = entry.allowDisconnected === true ? topoHits / pairCount : topoZero ? 0 : topoHits / pairCount

  let incidentPattern = 1
  if (entry.requiredDetectionAny?.length) {
    incidentPattern = hasRequiredType(members, entry.requiredDetectionAny) ? 1 : 0
  }

  const keys = new Set(members.map((m) => sectorKey(m.sector, m.type)))
  let sectorPattern = 1
  if (entry.requiredSectors?.length) {
    const hit = entry.requiredSectors.filter((s) => keys.has(s)).length
    sectorPattern = hit / entry.requiredSectors.length
  } else if (entry.preferredSectors?.length) {
    const hit = entry.preferredSectors.filter((s) => keys.has(s)).length
    sectorPattern = hit / entry.preferredSectors.length
  }

  const criticality = members.some((m) => {
    const c = String(m.criticality ?? '').toLowerCase()
    return c === 'high' || c === 'critical'
  })
    ? 1
    : 0

  const drops = members.map((m) => {
    const trust = Number(m.trustScore)
    if (!Number.isFinite(trust)) return 0
    return clamp01((TRUST_BASELINE - trust) / TRUST_BASELINE)
  })
  const meanDrop = drops.length ? drops.reduce((s, n) => s + n, 0) / drops.length : 0
  const trustPropagation = clamp01(meanDrop)

  const campaignMatchScore = round4(
    weights.temporal * temporal +
      weights.topology * topology +
      weights.incidentPattern * incidentPattern +
      weights.sectorPattern * sectorPattern +
      weights.criticality * criticality +
      weights.trustPropagation * trustPropagation
  )

  return {
    temporal: round4(temporal),
    topology: round4(topology),
    incidentPattern: round4(incidentPattern),
    sectorPattern: round4(sectorPattern),
    criticality: round4(criticality),
    trustPropagation: round4(trustPropagation),
    campaignMatchScore,
  }
}

function jaccard(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  const union = A.size + B.size - inter
  return union === 0 ? 0 : inter / union
}

function sharesEndpoint(a, b) {
  const B = new Set(b)
  return a.some((id) => B.has(id))
}

function earliestMember(members) {
  return [...members].sort((a, b) => Number(a.tick) - Number(b.tick) || String(a.endpointId).localeCompare(b.endpointId))[0]
}

function pickClusterOrigin(members, detection) {
  if (!members.length) return null
  const anomalies = Array.isArray(detection?.anomalyNodeIds) ? detection.anomalyNodeIds : []
  const residual = anomalies.find((id) => members.some((m) => m.endpointId === id))
  if (residual) return members.find((m) => m.endpointId === residual) ?? earliestMember(members)
  const primary = detection?.primarySpreadNodeId
  if (primary && members.some((m) => m.endpointId === primary)) {
    return members.find((m) => m.endpointId === primary)
  }
  return earliestMember(members)
}

export function propagationPath(edges, members, originId = null) {
  if (!members.length) return []
  const origin =
    (originId && members.find((m) => m.endpointId === originId)) || earliestMember(members)
  const memberIds = new Set(members.map((m) => m.endpointId))
  const path = [origin.endpointId]
  const seen = new Set([origin.endpointId])
  const q = [origin.endpointId]
  while (q.length) {
    const id = q.shift()
    const neighbors = []
    for (const e of edges ?? []) {
      let n = null
      if (e.source === id && memberIds.has(e.target)) n = e.target
      else if (e.target === id && memberIds.has(e.source)) n = e.source
      if (n && !seen.has(n)) neighbors.push(n)
    }
    neighbors.sort()
    for (const n of neighbors) {
      seen.add(n)
      path.push(n)
      q.push(n)
    }
  }
  return path
}

function financialExposure(members) {
  if (!members.length) return 0
  const fin = members.filter((m) => isFinanceSector(m.sector, m.type) || isSensitiveExposure(m.sector, m.type)).length
  if (fin === 0) return 0
  return round4(Math.min(1, 0.35 + fin / members.length))
}

function signalChecklist(entry, members, scores) {
  return [
    { id: 'temporal', label: 'Incidents inside temporal window', ok: scores.temporal > 0 },
    { id: 'topology', label: 'Connected within hop limit', ok: scores.topology > 0 },
    { id: 'types', label: 'Required detection types', ok: scores.incidentPattern >= 1 || !entry.requiredDetectionAny?.length },
    { id: 'sectors', label: 'Required sectors', ok: scores.sectorPattern >= 1 || !entry.requiredSectors?.length },
    { id: 'criticality', label: 'High/critical asset in set', ok: scores.criticality >= 1 },
  ]
}

function newCampaignId() {
  return `cmp-${nanoid(10)}`
}

function rememberCampaign(room, campaign) {
  if (!Array.isArray(room.campaigns)) room.campaigns = []
  const idx = room.campaigns.findIndex((c) => c.id === campaign.id)
  if (idx >= 0) room.campaigns[idx] = campaign
  else room.campaigns.unshift(campaign)
  if (room.campaigns.length > 24) room.campaigns.length = 24
}

function persistRecognized(campaign, room) {
  try {
    upsertCampaign({
      ...campaign,
      playbookId: campaign.campaignType,
      seedNodeId: campaign.originEndpointId || '',
    })
    upsertAttackPattern({
      fingerprint: campaign.fingerprint,
      title: campaign.title,
      roomId: room.id,
      campaignId: campaign.id,
      signature: {
        campaignType: campaign.campaignType,
        endpointIds: campaign.endpointIds,
        scores: campaign.scores,
      },
    })
  } catch (err) {
    console.error('[campaign] persist failed', err)
  }
}

function lifecycleStatus(prev, score, members, now) {
  const endpoints = new Set(members.map((m) => m.endpointId))
  let status = prev?.status && isLiveCampaignStatus(prev.status) ? prev.status : 'suspected'
  if (score >= CAMPAIGN_CORRELATED_SCORE || endpoints.size >= 3) {
    if (status === 'suspected') status = 'correlated'
  }
  const prevEndpoints = new Set(prev?.endpointIds ?? [])
  const newHop = [...endpoints].some((id) => !prevEndpoints.has(id))
  const newFinance = members.some(
    (m) =>
      (isFinanceSector(m.sector, m.type) || isSensitiveExposure(m.sector, m.type)) &&
      !prevEndpoints.has(m.endpointId)
  )
  if ((newHop || newFinance) && (status === 'correlated' || status === 'escalating') && prevEndpoints.size > 0) {
    status = 'escalating'
  }
  return status
}

function findDedupe(room, campaignType, endpointIds) {
  return (room.campaigns ?? []).find((c) => {
    if (c.campaignType !== campaignType) return false
    if (!isLiveCampaignStatus(c.status)) return false
    const prev = c.endpointIds ?? []
    return sharesEndpoint(endpointIds, prev) || jaccard(endpointIds, prev) >= 0.5
  })
}

function compareCatalogCandidates(a, b) {
  const spec = catalogSpecificity(b.entry) - catalogSpecificity(a.entry)
  if (spec !== 0) return spec
  return (b.scores.campaignMatchScore ?? 0) - (a.scores.campaignMatchScore ?? 0)
}

function pickNonOverlappingCandidates(candidates) {
  const ranked = [...candidates].sort(compareCatalogCandidates)
  const kept = []
  for (const c of ranked) {
    const clash = kept.some(
      (k) =>
        sharesEndpoint(c.endpointIds, k.endpointIds) || jaccard(c.endpointIds, k.endpointIds) >= 0.5
    )
    if (clash) continue
    kept.push(c)
  }
  return kept
}

export function correlateRecognizedCampaigns(room, detection) {
  if (!room || !detection) return detection
  const now = Number(detection.simulationTick ?? room.simulationTick) || 0
  appendIncidentLedger(room, detection)

  if (!Array.isArray(room.campaigns)) room.campaigns = []
  for (const inc of detection.incidents ?? []) {
    if (inc.campaignId == null) inc.campaignId = null
  }

  const pendingAnalyze = []
  const matchedIds = new Set()
  const rawCandidates = []

  for (const entry of CAMPAIGN_CATALOG) {
    const rows = uniqueEndpoints(windowRows(room.incidentLedger, now, entry.temporalWindow))
    if (rows.length < entry.minimumIncidentCount) continue
    const cluster = largestConnected(rows, room.edges, entry.maxTopologyHops)
    if (cluster.length < entry.minimumIncidentCount) continue
    if (!extrasPass(entry, cluster)) continue
    const scores = scoreCampaignCluster(entry, cluster, room, detection)
    if (scores.campaignMatchScore < CAMPAIGN_MATCH_THRESHOLD) continue
    if (scores.topology <= 0 && entry.allowDisconnected !== true) continue

    const endpointIds = cluster.map((m) => m.endpointId).sort()
    rawCandidates.push({ entry, cluster, scores, endpointIds })
  }

  for (const { entry, cluster, scores, endpointIds } of pickNonOverlappingCandidates(rawCandidates)) {
    const origin = pickClusterOrigin(cluster, detection)
    const incidentIds = [...new Set(cluster.map((m) => m.incidentId))]
    let campaign = findDedupe(room, entry.id, endpointIds)
    const prev = campaign ? { ...campaign, endpointIds: [...(campaign.endpointIds ?? [])] } : null
    const status = lifecycleStatus(prev, scores.campaignMatchScore, cluster, now)
    const becameCorrelated = status === 'correlated' && prev?.status !== 'correlated' && prev?.status !== 'escalating'

    if (!campaign) {
      campaign = {
        id: newCampaignId(),
        roomId: room.id,
        campaignType: entry.id,
        title: entry.title,
        status,
        originEndpointId: origin.endpointId,
        startedTick: origin.tick,
        lastSeenTick: now,
        completedTick: null,
        incidentIds,
        endpointIds,
        fingerprint: `${entry.id}|${endpointIds.join(',')}`,
        scores,
        campaignMatchScore: scores.campaignMatchScore,
        financialExposure: financialExposure(cluster),
        propagationPath: [],
        signals: signalChecklist(entry, cluster, scores),
        sectors: [...new Set(cluster.map((m) => m.sector).filter(Boolean))],
        mitreCandidates: entry.mitreCandidates ?? [],
        commanderAssessment: null,
        commanderEnqueued: false,
      }
    } else {
      campaign.status = status
      campaign.lastSeenTick = now
      campaign.incidentIds = [...new Set([...(campaign.incidentIds ?? []), ...incidentIds])]
      campaign.endpointIds = [...new Set([...(campaign.endpointIds ?? []), ...endpointIds])]
      campaign.fingerprint = `${entry.id}|${[...campaign.endpointIds].sort().join(',')}`
      campaign.scores = scores
      campaign.campaignMatchScore = scores.campaignMatchScore
      campaign.financialExposure = financialExposure(cluster)
      campaign.propagationPath = []
      campaign.signals = signalChecklist(entry, cluster, scores)
      campaign.sectors = [...new Set(cluster.map((m) => m.sector).filter(Boolean))]
      campaign.originEndpointId = origin.endpointId || campaign.originEndpointId
    }

    rememberCampaign(room, campaign)
    matchedIds.add(campaign.id)
    persistRecognized(campaign, room)

    for (const row of cluster) {
      for (const inc of detection.incidents ?? []) {
        if (inc.endpointId !== row.endpointId) continue
        inc.campaignId = campaign.id
        linkCampaignIncident(campaign.id, inc.id, inc.endpointId, now)
      }
    }

    if (becameCorrelated && !campaign.commanderEnqueued) {
      campaign.commanderEnqueued = true
      pendingAnalyze.push(campaign)
    }
  }

  for (const campaign of room.campaigns) {
    if (!isLiveCampaignStatus(campaign.status)) continue
    if (matchedIds.has(campaign.id)) continue
    const subsumed = [...matchedIds].some((id) => {
      const winner = room.campaigns.find((c) => c.id === id)
      return (
        winner &&
        (sharesEndpoint(campaign.endpointIds ?? [], winner.endpointIds ?? []) ||
          jaccard(campaign.endpointIds ?? [], winner.endpointIds ?? []) >= 0.5)
      )
    })
    const entry = CAMPAIGN_CATALOG.find((e) => e.id === campaign.campaignType)
    const idleFor = now - Number(campaign.lastSeenTick || campaign.startedTick || 0)
    const window = entry?.temporalWindow ?? 12
    if (subsumed || idleFor >= window) {
      campaign.status = 'expired'
      campaign.completedTick = now
      persistRecognized(campaign, room)
    }
  }

  room._pendingCampaignAnalyze = pendingAnalyze
  detection.campaigns = room.campaigns.map((c) => ({
    id: c.id,
    campaignType: c.campaignType,
    title: c.title,
    status: c.status,
    fingerprint: c.fingerprint,
    incidentIds: c.incidentIds ?? [],
    campaignMatchScore: c.campaignMatchScore,
  }))
  return detection
}

export function correlateCampaigns(room, detection) {
  return correlateRecognizedCampaigns(room, detection)
}
