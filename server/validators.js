import { clampNonNegative, normalizeMetricPatch } from './nodeMetrics.js'
import {
  INFRASTRUCTURE_NODE_TYPE,
  normalizeInfrastructureData,
  runtimeStateOf,
} from './infrastructureNode.js'

const NODE_TYPE = INFRASTRUCTURE_NODE_TYPE
const EDGE_TYPE = 'directedLabeled'

function isRecord(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

export function sanitizeNode(raw) {
  if (!isRecord(raw)) return null
  const data = isRecord(raw.data) ? raw.data : {}
  return {
    id: String(raw.id),
    type: NODE_TYPE,
    position: {
      x: Number(raw.position?.x ?? 0),
      y: Number(raw.position?.y ?? 0),
    },
    data: normalizeInfrastructureData(data),
  }
}

export function sanitizeEdge(raw) {
  if (!isRecord(raw)) return null
  const data = isRecord(raw.data) ? raw.data : {}
  return {
    id: String(raw.id),
    type: EDGE_TYPE,
    source: String(raw.source),
    target: String(raw.target),
    markerEnd: raw.markerEnd ?? { type: 'arrowclosed' },
    data: {
      label: String(data.label ?? 'API'),
      packetsPerSecond: clampNonNegative(data.packetsPerSecond),
    },
  }
}

export function sanitizeHackSimulator(raw) {
  if (!isRecord(raw)) {
    return {
      active: false,
      nodeOverrides: {},
      edgeOverrides: {},
    }
  }
  const nodeOverrides = {}
  const edgeOverrides = {}
  if (isRecord(raw.nodeOverrides)) {
    for (const [k, v] of Object.entries(raw.nodeOverrides)) {
      const patch = normalizeMetricPatch(v)
      if (Object.keys(patch).length > 0) nodeOverrides[k] = patch
    }
  }
  if (isRecord(raw.edgeOverrides)) {
    for (const [k, v] of Object.entries(raw.edgeOverrides)) {
      edgeOverrides[k] = clampNonNegative(v)
    }
  }
  const out = {
    active: raw.active === true,
    nodeOverrides,
    edgeOverrides,
  }
  if (isRecord(raw.nodeScenarioBaselines)) {
    out.nodeScenarioBaselines = {}
    for (const [k, v] of Object.entries(raw.nodeScenarioBaselines)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.nodeScenarioBaselines[k] = { packetsPerSecond: clampNonNegative(v) }
      } else if (isRecord(v)) {
        const patch = normalizeMetricPatch(v)
        if (Object.keys(patch).length > 0) out.nodeScenarioBaselines[k] = patch
      }
    }
  }
  if (isRecord(raw.edgeScenarioBaselines)) {
    out.edgeScenarioBaselines = {}
    for (const [k, v] of Object.entries(raw.edgeScenarioBaselines)) {
      out.edgeScenarioBaselines[k] = clampNonNegative(v)
    }
  }
  return out
}

export function isDefender(socketId, room) {
  return room.players.defender === socketId
}

export function isAttacker(socketId, room) {
  return room.players.attacker === socketId
}

export function canEditTopology(socketId, room) {
  return isDefender(socketId, room)
}

export function canAddNode(socketId, room, node) {
  if (room.phase === 'lobby') return isDefender(socketId, room)
  if (room.phase === 'playing') {
    if (isDefender(socketId, room)) {
      return runtimeStateOf(node?.data).provenance !== 'injected'
    }
    if (isAttacker(socketId, room)) {
      return runtimeStateOf(node?.data).provenance === 'injected'
    }
  }
  return false
}

export function canDeleteNode(socketId, room, nodeId) {
  const node = room.nodes.find((n) => n.id === nodeId)
  if (!node) return false
  if (room.phase === 'lobby') return isDefender(socketId, room)
  if (room.phase === 'playing') {
    if (isDefender(socketId, room)) {
      return runtimeStateOf(node.data).provenance !== 'injected'
    }
    if (isAttacker(socketId, room)) {
      return runtimeStateOf(node.data).provenance === 'injected'
    }
  }
  return false
}

export function canConnect(socketId, room) {
  if (room.phase === 'lobby') return isDefender(socketId, room)
  if (room.phase === 'playing') {
    return isDefender(socketId, room) || isAttacker(socketId, room)
  }
  return false
}

export function canDeleteEdge(socketId, room) {
  if (room.phase === 'lobby') return isDefender(socketId, room)
  if (room.phase === 'playing') {
    return isDefender(socketId, room) || isAttacker(socketId, room)
  }
  return false
}

export function canEditSim(socketId, room) {
  if (isAttacker(socketId, room)) return room.phase === 'playing'
  if (isDefender(socketId, room)) {
    return room.phase === 'lobby' || room.phase === 'playing'
  }
  return false
}

export function canDefenderSetBaseline(socketId, room) {
  return isDefender(socketId, room) && (room.phase === 'lobby' || room.phase === 'playing')
}

export function canQuarantine(socketId, room) {
  return room.phase === 'playing' && isDefender(socketId, room)
}
