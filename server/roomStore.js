import { buildAttackLayerFromGraph } from './nodeMetrics.js'
import { emptyDetectionResult } from './detection/types.js'
import { DETECTION_MODE_TGNN } from './detection/modes.js'
import { parseCityContextOverride, resolveRoomCityContext, simHourAt } from '../shared/cityContext.js'

export { buildAttackLayerFromGraph }

export const DEMO_ROOM_ID = 'DEMO'

export const DEFAULT_HACK_SIMULATOR = {
  active: false,
  nodeOverrides: {},
  edgeOverrides: {},
  nodeScenarioBaselines: undefined,
  edgeScenarioBaselines: undefined,
}

export function createEmptyRoom(id = DEMO_ROOM_ID) {
  return {
    id: String(id).toUpperCase(),
    phase: 'lobby',
    players: { defender: null, attacker: null },
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    hackSimulator: { ...DEFAULT_HACK_SIMULATOR },
    matchNodeIds: [],
    matchEdgeIds: [],
    simulationTick: 0,
    cityContextOverride: null,
    detectionMode: DETECTION_MODE_TGNN,
    detection: emptyDetectionResult(),
    neighborHistory: [],
    ingestionStatus: 'empty',
    ingestedByEndpoint: {},
    ingestedRows: [],
    liveTelemetryByNodeId: {},
  }
}

const rooms = new Map()

export function getRoom(roomId) {
  return rooms.get(String(roomId ?? '').toUpperCase()) ?? null
}

export function getOrCreateRoom(roomId = DEMO_ROOM_ID) {
  const id = String(roomId ?? DEMO_ROOM_ID).toUpperCase() || DEMO_ROOM_ID
  const existing = rooms.get(id)
  if (existing) return existing
  const room = createEmptyRoom(id)
  rooms.set(room.id, room)
  return room
}

export function deleteRoomIfEmpty(roomId) {
  const room = getRoom(roomId)
  if (!room) return false
  if (!room.players.defender && !room.players.attacker) {
    rooms.delete(room.id)
    return true
  }
  return false
}

export function publicRoomState(room) {
  return {
    id: room.id,
    phase: room.phase,
    players: {
      defender: Boolean(room.players.defender),
      attacker: Boolean(room.players.attacker),
    },
    nodes: room.nodes,
    edges: room.edges,
    viewport: room.viewport,
    hackSimulator: room.hackSimulator,
    matchNodeIds: room.matchNodeIds,
    matchEdgeIds: room.matchEdgeIds,
    simulationTick: room.simulationTick ?? 0,
    cityContext: resolveRoomCityContext(room),
    cityContextLocked: parseCityContextOverride(room.cityContextOverride) != null,
    simHour: simHourAt(room.simulationTick ?? 0),
    detectionMode: DETECTION_MODE_TGNN,
    detection: room.detection ?? emptyDetectionResult(),
    ingestionStatus: room.ingestionStatus ?? 'empty',
    liveTelemetryByNodeId: room.liveTelemetryByNodeId ?? {},
  }
}
