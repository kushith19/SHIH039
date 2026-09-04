/**
 * In-memory response runtime state on the room (demo-safe mutations).
 * Used by executeResponseAction for peer blocks, segments, diagnostics.
 * Does not replace quarantine — quarantine remains setNodeQuarantined.
 */

export function ensureResponseRuntime(room) {
  if (!room || typeof room !== 'object') return null
  if (!room.responseRuntime || typeof room.responseRuntime !== 'object') {
    room.responseRuntime = {
      peerBlocks: [],
      externalBlocks: [],
      segments: {},
      revokedPeers: [],
      enforcedPolicies: {},
      diagnostics: [],
    }
  }
  const rt = room.responseRuntime
  if (!Array.isArray(rt.peerBlocks)) rt.peerBlocks = []
  if (!Array.isArray(rt.externalBlocks)) rt.externalBlocks = []
  if (!rt.segments || typeof rt.segments !== 'object') rt.segments = {}
  if (!Array.isArray(rt.revokedPeers)) rt.revokedPeers = []
  if (!rt.enforcedPolicies || typeof rt.enforcedPolicies !== 'object') {
    rt.enforcedPolicies = {}
  }
  if (!Array.isArray(rt.diagnostics)) rt.diagnostics = []
  return rt
}

export function hasPeerBlock(room, sourceId, targetId) {
  const rt = ensureResponseRuntime(room)
  const s = String(sourceId)
  const t = String(targetId)
  return (rt.peerBlocks ?? []).some(
    (b) => String(b.sourceId) === s && String(b.targetId) === t
  )
}

export function addPeerBlock(room, sourceId, targetId, meta = {}) {
  const rt = ensureResponseRuntime(room)
  if (hasPeerBlock(room, sourceId, targetId)) {
    return { ok: true, already: true, runtime: rt }
  }
  rt.peerBlocks.push({
    sourceId: String(sourceId),
    targetId: String(targetId),
    atMs: Date.now(),
    ...meta,
  })
  return { ok: true, already: false, runtime: rt }
}

export function removePeerBlock(room, sourceId, targetId) {
  const rt = ensureResponseRuntime(room)
  const s = String(sourceId)
  const t = String(targetId)
  const before = rt.peerBlocks.length
  rt.peerBlocks = rt.peerBlocks.filter(
    (b) => !(String(b.sourceId) === s && String(b.targetId) === t)
  )
  return { ok: true, already: before === rt.peerBlocks.length, runtime: rt }
}

export function addExternalBlock(room, nodeId, meta = {}) {
  const rt = ensureResponseRuntime(room)
  const id = String(nodeId)
  if ((rt.externalBlocks ?? []).some((b) => String(b.nodeId) === id)) {
    return { ok: true, already: true, runtime: rt }
  }
  rt.externalBlocks.push({ nodeId: id, atMs: Date.now(), ...meta })
  return { ok: true, already: false, runtime: rt }
}

export function setDeviceSegment(room, nodeId, segment) {
  const rt = ensureResponseRuntime(room)
  const id = String(nodeId)
  const prev = rt.segments[id] || 'normal'
  const next = segment === 'restricted' ? 'restricted' : 'normal'
  if (prev === next) return { ok: true, already: true, segment: next, runtime: rt }
  rt.segments[id] = next
  return { ok: true, already: false, segment: next, runtime: rt }
}

export function addRevokedPeer(room, sourceId, targetId, meta = {}) {
  const rt = ensureResponseRuntime(room)
  const s = String(sourceId)
  const t = String(targetId)
  if ((rt.revokedPeers ?? []).some((b) => String(b.sourceId) === s && String(b.targetId) === t)) {
    return { ok: true, already: true, runtime: rt }
  }
  rt.revokedPeers.push({
    sourceId: s,
    targetId: t,
    atMs: Date.now(),
    ...meta,
  })
  return { ok: true, already: false, runtime: rt }
}

export function restoreRevokedPeer(room, sourceId, targetId) {
  const rt = ensureResponseRuntime(room)
  const s = String(sourceId)
  const t = String(targetId)
  const before = rt.revokedPeers.length
  rt.revokedPeers = rt.revokedPeers.filter(
    (b) => !(String(b.sourceId) === s && String(b.targetId) === t)
  )
  return { ok: true, already: before === rt.revokedPeers.length, runtime: rt }
}

export function enforceNodePolicy(room, nodeId, allowedTargets = [], meta = {}) {
  const rt = ensureResponseRuntime(room)
  const id = String(nodeId)
  rt.enforcedPolicies[id] = {
    allowedTargets: [...new Set((allowedTargets ?? []).map(String))],
    atMs: Date.now(),
    ...meta,
  }
  return { ok: true, already: false, runtime: rt }
}

export function recordDiagnostic(room, entry) {
  const rt = ensureResponseRuntime(room)
  rt.diagnostics.push({
    ...entry,
    atMs: entry?.atMs ?? Date.now(),
  })
  // Cap history
  while (rt.diagnostics.length > 40) rt.diagnostics.shift()
  return { ok: true, runtime: rt, entry: rt.diagnostics[rt.diagnostics.length - 1] }
}

export function publicResponseRuntime(room) {
  const rt = ensureResponseRuntime(room)
  if (!rt) return null
  return {
    peerBlocks: [...(rt.peerBlocks ?? [])],
    externalBlocks: [...(rt.externalBlocks ?? [])],
    segments: { ...(rt.segments ?? {}) },
    revokedPeers: [...(rt.revokedPeers ?? [])],
    enforcedPolicies: { ...(rt.enforcedPolicies ?? {}) },
    diagnosticCount: (rt.diagnostics ?? []).length,
    latestDiagnostics: (rt.diagnostics ?? []).slice(-5),
  }
}
