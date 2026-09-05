/**
 * Orchestration grouping — city-model sectors by default.
 *
 * Modes (env ORCHESTRATION_GROUP_MODE or room.orchestrationGroupMode):
 *   sector  — same city-model sector → one sequential group; different sectors run in parallel (DEFAULT)
 *   none    — every incident is its own parallel group
 *   link    — couple only on same node / direct edge / peer-prop / campaign / related
 *
 * ORCHESTRATION_GROUP_COUPLING=0 is an alias for mode=none.
 */

import { filterActiveResponseIncidents } from '../incidentStatus.js'
import { rankIncidentsByRecoveryPriority } from '../recovery/priorityRank.js'
import { sectorKey } from '../campaignCatalog.js'
import { isExecutableResponseIncident } from './approvalScope.js'

export const ORCHESTRATION_GROUP_MODES = Object.freeze({
  SECTOR: 'sector',
  NONE: 'none',
  LINK: 'link',
})

function incidentKey(inc) {
  if (!inc || typeof inc !== 'object') return null
  const id = inc.persistentId || inc.id
  return id != null && String(id).trim() ? String(id) : null
}

function labelOf(inc) {
  return String(inc?.endpointLabel || inc?.endpointId || incidentKey(inc) || 'unknown')
}

function endpointOf(inc) {
  return inc?.endpointId != null ? String(inc.endpointId) : null
}

function relatedIdsOf(inc) {
  const out = new Set()
  for (const r of Array.isArray(inc?.relatedIncidents) ? inc.relatedIncidents : []) {
    if (r == null) continue
    if (typeof r === 'string' || typeof r === 'number') {
      const s = String(r).trim()
      if (s) out.add(s)
      continue
    }
    const id = r.persistentId || r.id
    if (id != null && String(id).trim()) out.add(String(id))
  }
  return out
}

export function conflictNodeIdsForIncident(inc) {
  const nodes = new Set()
  const ep = endpointOf(inc)
  if (ep) nodes.add(ep)
  for (const id of Array.isArray(inc?.peerExposedNodeIds) ? inc.peerExposedNodeIds : []) {
    if (id != null && String(id).trim()) nodes.add(String(id))
  }
  for (const id of Array.isArray(inc?.propagatedNodeIds) ? inc.propagatedNodeIds : []) {
    if (id != null && String(id).trim()) nodes.add(String(id))
  }
  return nodes
}

function buildUndirectedAdjacency(edges = []) {
  const adj = new Map()
  const add = (a, b) => {
    if (!a || !b || a === b) return
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a).add(b)
    adj.get(b).add(a)
  }
  for (const e of Array.isArray(edges) ? edges : []) {
    const a = e?.source ?? e?.from ?? e?.a
    const b = e?.target ?? e?.to ?? e?.b
    if (a == null || b == null) continue
    add(String(a), String(b))
  }
  return adj
}

function endpointsAdjacent(adj, a, b) {
  if (!a || !b) return false
  return adj.get(a)?.has(b) === true
}

function setsIntersect(a, b) {
  for (const x of a) {
    if (b.has(x)) return true
  }
  return false
}

/**
 * Normalize group mode from env / room override.
 * @returns {'sector'|'none'|'link'}
 */
export function resolveOrchestrationGroupMode(raw = null) {
  const couplingOff = (() => {
    const c = process.env.ORCHESTRATION_GROUP_COUPLING
    if (c == null || c === '') return false
    const v = String(c).trim().toLowerCase()
    return v === '0' || v === 'false' || v === 'off' || v === 'no'
  })()
  if (couplingOff) return ORCHESTRATION_GROUP_MODES.NONE

  const fromEnv = String(process.env.ORCHESTRATION_GROUP_MODE ?? '')
    .trim()
    .toLowerCase()
  const fromArg = raw != null ? String(raw).trim().toLowerCase() : ''
  const pick = fromArg || fromEnv || ORCHESTRATION_GROUP_MODES.SECTOR

  if (pick === 'none' || pick === 'off' || pick === 'parallel' || pick === '0') {
    return ORCHESTRATION_GROUP_MODES.NONE
  }
  if (pick === 'link' || pick === 'coupled' || pick === 'rules' || pick === '1') {
    return ORCHESTRATION_GROUP_MODES.LINK
  }
  return ORCHESTRATION_GROUP_MODES.SECTOR
}

/** City-model sector key for an incident (Energy, Water, …). */
export function cityModelSectorOf(inc, nodes = []) {
  if (!inc || typeof inc !== 'object') return 'unknown'
  const type =
    inc.type ||
    inc.assetType ||
    inc.endpointType ||
    null
  if (inc.sector) return sectorKey(inc.sector, type)

  const ep = endpointOf(inc)
  const node = (Array.isArray(nodes) ? nodes : []).find(
    (n) => String(n?.id ?? '') === ep
  )
  const data = node?.data && typeof node.data === 'object' ? node.data : {}
  const sector =
    data.sector ||
    data.domain ||
    data.family ||
    data.citySector ||
    null
  if (sector) return sectorKey(sector, data.type || type)

  // Don't dump all unknowns into one bag — keep them parallel by asset
  return ep ? `asset:${ep}` : 'unknown'
}

export function sectorDisplayLabel(sectorKeyValue) {
  const k = String(sectorKeyValue ?? 'unknown')
  if (k.startsWith('asset:')) return k.slice(6).toUpperCase()
  return k
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Link-mode coupling (legacy simple rules). */
export function couplingReasonBetween(a, b, { adjacency = null } = {}) {
  if (!a || !b) return null
  const keyA = incidentKey(a)
  const keyB = incidentKey(b)
  if (keyA && keyB && keyA === keyB) return 'same incident'

  const epA = endpointOf(a)
  const epB = endpointOf(b)
  if (epA && epB && epA === epB) return 'same affected node'

  if (adjacency && epA && epB && endpointsAdjacent(adjacency, epA, epB)) {
    return 'direct dependency edge'
  }

  const peerPropA = new Set(
    [
      ...(Array.isArray(a.peerExposedNodeIds) ? a.peerExposedNodeIds : []),
      ...(Array.isArray(a.propagatedNodeIds) ? a.propagatedNodeIds : []),
    ].map(String)
  )
  const peerPropB = new Set(
    [
      ...(Array.isArray(b.peerExposedNodeIds) ? b.peerExposedNodeIds : []),
      ...(Array.isArray(b.propagatedNodeIds) ? b.propagatedNodeIds : []),
    ].map(String)
  )
  if (epA && peerPropB.has(epA)) return 'peer/propagation link'
  if (epB && peerPropA.has(epB)) return 'peer/propagation link'

  const campA = a.campaignId != null ? String(a.campaignId).trim() : ''
  const campB = b.campaignId != null ? String(b.campaignId).trim() : ''
  if (campA && campB && campA === campB) return 'same campaign'

  const relA = relatedIdsOf(a)
  const relB = relatedIdsOf(b)
  if (keyA && relB.has(keyA)) return 'related incidents'
  if (keyB && relA.has(keyB)) return 'related incidents'
  if (setsIntersect(relA, relB)) return 'related incidents'

  return null
}

function createUnionFind(keys) {
  const parent = new Map()
  const reason = new Map()
  for (const k of keys) parent.set(k, k)

  function find(x) {
    let p = parent.get(x)
    if (p !== x) {
      p = find(p)
      parent.set(x, p)
    }
    return p
  }

  function union(a, b, why) {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    parent.set(rb, ra)
    const prev = reason.get(ra)
    if (!prev) reason.set(ra, why)
    else if (why && !prev.includes(why)) reason.set(ra, `${prev} + ${why}`)
  }

  return { find, union, reason, parent }
}

function focusFirst(orderedKeys, focusIncidentId, byKey) {
  if (!focusIncidentId) return orderedKeys
  const want = String(focusIncidentId)
  const focusInc =
    byKey.get(want) ||
    [...byKey.values()].find(
      (inc) =>
        String(inc.id ?? '') === want || String(inc.persistentId ?? '') === want
    )
  const focusKey = focusInc ? incidentKey(focusInc) : null
  if (!focusKey || !orderedKeys.includes(focusKey)) return orderedKeys
  return [focusKey, ...orderedKeys.filter((k) => k !== focusKey)]
}

function componentsFromBuckets(buckets, uf, byKey, focusIncidentId, adjacency, mode) {
  const focusKey = (() => {
    if (!focusIncidentId) return null
    const want = String(focusIncidentId)
    for (const [k, inc] of byKey) {
      if (
        k === want ||
        String(inc.id ?? '') === want ||
        String(inc.persistentId ?? '') === want
      ) {
        return k
      }
    }
    return null
  })()

  return [...buckets.entries()].map(([root, incs]) => {
    const ranked = rankIncidentsByRecoveryPriority(incs)
    const orderedKeys = focusFirst(
      ranked.map(incidentKey).filter(Boolean),
      focusIncidentId,
      byKey
    )
    let reason = 'independent incident'
    if (mode === ORCHESTRATION_GROUP_MODES.NONE) {
      reason = 'parallel (no coupling)'
    } else if (mode === ORCHESTRATION_GROUP_MODES.SECTOR) {
      const sector = root.startsWith('sector:')
        ? root.slice('sector:'.length)
        : String(root)
      reason =
        orderedKeys.length > 1
          ? `city-model sector: ${sectorDisplayLabel(sector)}`
          : `city-model sector: ${sectorDisplayLabel(sector)}`
    } else if (orderedKeys.length > 1) {
      const reasons = new Set()
      const rootReason = uf?.reason?.get(root)
      if (rootReason) reasons.add(rootReason)
      for (let i = 0; i < orderedKeys.length; i++) {
        for (let j = i + 1; j < orderedKeys.length; j++) {
          const why = couplingReasonBetween(
            byKey.get(orderedKeys[i]),
            byKey.get(orderedKeys[j]),
            { adjacency }
          )
          if (why) reasons.add(why)
        }
      }
      reason = [...reasons].join(' + ') || 'coupled'
    }
    const labels = orderedKeys.map((k) => labelOf(byKey.get(k)))
    return {
      root,
      incidentIds: orderedKeys,
      labels,
      reason,
      containsFocus: focusKey ? orderedKeys.includes(focusKey) : false,
      topPriority:
        Number(ranked[0]?.recoveryPriority ?? ranked[0]?.recoveryImpact?.score) || 0,
      sectorKey:
        mode === ORCHESTRATION_GROUP_MODES.SECTOR && String(root).startsWith('sector:')
          ? String(root).slice('sector:'.length)
          : null,
    }
  })
}

/**
 * Partition active executable incidents into orchestration groups.
 */
export function buildOrchestrationGroups({
  detection = null,
  edges = [],
  nodes = [],
  focusIncidentId = null,
  groupMode = null,
} = {}) {
  const mode = resolveOrchestrationGroupMode(groupMode)
  const active = filterActiveResponseIncidents(detection?.incidents ?? []).filter(
    isExecutableResponseIncident
  )
  const incidentCount = active.length
  if (!incidentCount) {
    return { groups: [], incidentCount: 0, groupMode: mode, couplingEnabled: mode !== 'none' }
  }

  const byKey = new Map()
  for (const inc of active) {
    const key = incidentKey(inc)
    if (!key || byKey.has(key)) continue
    byKey.set(key, inc)
  }
  const keys = [...byKey.keys()]
  const adjacency = buildUndirectedAdjacency(edges)

  let buckets = new Map()
  let uf = null

  if (mode === ORCHESTRATION_GROUP_MODES.NONE) {
    for (const key of keys) {
      buckets.set(key, [byKey.get(key)])
    }
  } else if (mode === ORCHESTRATION_GROUP_MODES.SECTOR) {
    for (const key of keys) {
      const inc = byKey.get(key)
      const sector = cityModelSectorOf(inc, nodes)
      const root = `sector:${sector}`
      if (!buckets.has(root)) buckets.set(root, [])
      buckets.get(root).push(inc)
    }
  } else {
    uf = createUnionFind(keys)
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const why = couplingReasonBetween(byKey.get(keys[i]), byKey.get(keys[j]), {
          adjacency,
        })
        if (why) uf.union(keys[i], keys[j], why)
      }
    }
    for (const key of keys) {
      const root = uf.find(key)
      if (!buckets.has(root)) buckets.set(root, [])
      buckets.get(root).push(byKey.get(key))
    }
  }

  const components = componentsFromBuckets(
    buckets,
    uf,
    byKey,
    focusIncidentId,
    adjacency,
    mode
  )

  components.sort((a, b) => {
    if (a.containsFocus !== b.containsFocus) return a.containsFocus ? -1 : 1
    if (b.topPriority !== a.topPriority) return b.topPriority - a.topPriority
    return String(a.incidentIds[0] ?? '').localeCompare(String(b.incidentIds[0] ?? ''))
  })

  const groups = components.map((c, index) => {
    const sectorLabel =
      c.sectorKey != null ? sectorDisplayLabel(c.sectorKey) : null
    return {
      groupId: `g${index + 1}`,
      index: index + 1,
      incidentIds: c.incidentIds,
      labels: c.labels,
      reason: c.reason,
      label: sectorLabel
        ? `${sectorLabel}${c.labels.length > 1 ? ` (${c.labels.join(' + ')})` : ` · ${c.labels[0]}`}`
        : c.labels.join(' + '),
      sectorKey: c.sectorKey,
    }
  })

  return {
    groups,
    incidentCount,
    groupMode: mode,
    couplingEnabled: mode !== ORCHESTRATION_GROUP_MODES.NONE,
  }
}

export function logOrchestrationGroups(groupsResult) {
  const {
    groups = [],
    incidentCount = 0,
    groupMode = 'sector',
  } = groupsResult ?? {}
  console.log(`[ORCHESTRATION] detected ${incidentCount} incidents`)
  console.log(
    `[ORCHESTRATION] created ${groups.length} execution groups (mode=${groupMode})`
  )
  for (const g of groups) {
    console.log(`[GROUP ${g.index}] ${g.label}`)
    console.log(`reason: ${g.reason}`)
  }
}

export function logOrchestrationGroupStarting(group) {
  if (!group) return
  console.log(`[ORCHESTRATION] starting Group ${group.index ?? group.groupId}`)
}

export function logOrchestrationGroupCompleted(group) {
  if (!group) return
  console.log(`[ORCHESTRATION] Group ${group.index ?? group.groupId} completed`)
}

/** @deprecated use resolveOrchestrationGroupMode */
export function orchestrationCouplingEnabled() {
  return resolveOrchestrationGroupMode() !== ORCHESTRATION_GROUP_MODES.NONE
}
