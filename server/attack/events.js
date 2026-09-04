/**
 * Match-scoped confirmed attack sequences (room memory).
 * Only server-confirmed attack actions append events — never detection.
 * Used for current-path tip/preset resolution (e.g. auto-spread), not learning.
 */

import { randomUUID } from 'node:crypto'

export function ensureActiveAttackSequences(room) {
  if (!room) return {}
  if (!room.activeAttackSequences || typeof room.activeAttackSequences !== 'object') {
    room.activeAttackSequences = {}
  }
  return room.activeAttackSequences
}

export function clearActiveAttackSequences(room) {
  if (!room) return
  room.activeAttackSequences = {}
}

function hopKey(kind, sourceNodeId, targetNodeId) {
  return `${kind}|${sourceNodeId ?? ''}|${targetNodeId}`
}

function sequenceHasHop(seq, key) {
  return (seq.events ?? []).some((e) => e.hopKey === key)
}

function anySequenceHasHop(store, key) {
  for (const seq of Object.values(store)) {
    if (sequenceHasHop(seq, key)) return true
  }
  return false
}

/**
 * @returns {{ sequence: object, event: object, created: boolean, duplicate: boolean }}
 */
export function recordSeedAttackEvent(room, { targetNodeId, presetId = null }) {
  const store = ensureActiveAttackSequences(room)
  const target = String(targetNodeId ?? '')
  if (!target) {
    return { sequence: null, event: null, created: false, duplicate: false }
  }

  const key = hopKey('seed', null, target)
  if (anySequenceHasHop(store, key)) {
    const existing = Object.values(store).find((s) => sequenceHasHop(s, key))
    return { sequence: existing ?? null, event: null, created: false, duplicate: true }
  }

  // Re-applying a preset on a node that is already tip of an active path is not a new seed.
  const tipSeq = Object.values(store).find(
    (s) => s.status === 'active' && s.nodePath?.[s.nodePath.length - 1] === target
  )
  if (tipSeq) {
    return { sequence: tipSeq, event: null, created: false, duplicate: true }
  }

  const sequenceId = randomUUID()
  const eventId = randomUUID()
  const tick = Number(room.simulationTick) || 0
  const event = {
    eventId,
    sequenceId,
    roomId: String(room.id ?? ''),
    tick,
    tsMs: Date.now(),
    kind: 'seed',
    sourceNodeId: null,
    targetNodeId: target,
    edgeId: null,
    presetId: presetId ?? null,
    hopKey: key,
  }
  const sequence = {
    sequenceId,
    rootNodeId: target,
    nodePath: [target],
    events: [event],
    status: 'active',
    lastTick: tick,
    lastEventId: eventId,
  }
  store[sequenceId] = sequence
  return { sequence, event, created: true, duplicate: false }
}

/**
 * Extend the active sequence whose tip is sourceNodeId.
 * @returns {{ sequence: object | null, event: object | null, created: boolean, duplicate: boolean }}
 */
export function recordSpreadAttackEvent(room, {
  sourceNodeId,
  targetNodeId,
  edgeId = null,
  presetId = null,
}) {
  const store = ensureActiveAttackSequences(room)
  const source = String(sourceNodeId ?? '')
  const target = String(targetNodeId ?? '')
  if (!source || !target) {
    return { sequence: null, event: null, created: false, duplicate: false }
  }

  const key = hopKey('spread', source, target)
  if (anySequenceHasHop(store, key)) {
    const existing = Object.values(store).find((s) => sequenceHasHop(s, key))
    return { sequence: existing ?? null, event: null, created: false, duplicate: true }
  }

  let sequence = Object.values(store)
    .filter((s) => s.status === 'active' && s.nodePath?.[s.nodePath.length - 1] === source)
    .sort((a, b) => (Number(b.lastTick) || 0) - (Number(a.lastTick) || 0))[0]

  // If source was attacked but sequence missing (e.g. mid-match hot-reload), start from source.
  if (!sequence) {
    const seeded = recordSeedAttackEvent(room, { targetNodeId: source, presetId: null })
    sequence = seeded.sequence
  }
  if (!sequence) {
    return { sequence: null, event: null, created: false, duplicate: false }
  }

  const eventId = randomUUID()
  const tick = Number(room.simulationTick) || 0
  const event = {
    eventId,
    sequenceId: sequence.sequenceId,
    roomId: String(room.id ?? ''),
    tick,
    tsMs: Date.now(),
    kind: 'spread',
    sourceNodeId: source,
    targetNodeId: target,
    edgeId: edgeId ?? null,
    presetId: presetId ?? null,
    hopKey: key,
  }
  sequence.events = [...(sequence.events ?? []), event]
  sequence.nodePath = [...(sequence.nodePath ?? []), target]
  sequence.lastTick = tick
  sequence.lastEventId = eventId
  store[sequence.sequenceId] = sequence
  return { sequence, event, created: true, duplicate: false }
}

export function listActiveSequences(room) {
  return Object.values(ensureActiveAttackSequences(room))
}
