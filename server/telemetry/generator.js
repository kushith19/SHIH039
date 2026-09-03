import {
  buildCitySnapshot,
  overlaySnapshotFromIngested,
} from './citySnapshot.js'
import {
  adaptCitySnapshot,
  attachLookback,
  attachNeighborLookback,
  pushNeighborSnapshot,
} from '../detection/adapter.js'
import { runDetection } from '../detection/engine.js'
import {
  LOOKBACK_TICKS,
  appendDetectionInput,
  deleteRoomLookbackSamples,
  deleteRoomMetrics,
  getLookback,
  saveDetectionRun,
} from '../metrics/store.js'
import { clearPersistedIncidentHistory, persistDetectionIncidents } from '../metrics/incidents.js'
import { emptyDetectionResult } from '../detection/types.js'
import { advanceRiskMomentum, resetRiskHistory } from '../detection/riskMomentum.js'
import { deleteTgnnCalibrator } from '../detection/calibrator.js'
import {
  attachExplanations,
  enqueueIncidentExplanations,
  clearExplanationCache,
} from '../commander/client.js'
import {
  ensureRoomInfrastructure,
  liveTelemetryByNodeId as mapLiveTelemetryByNodeId,
  postSnapshot,
  refreshRoomIngestion,
  toIngestSnapshot,
} from './ingestionClient.js'

const TICK_MS = 1000
/** @type {Map<string, ReturnType<typeof setInterval>>} */
const intervals = new Map()
/** Prevent overlapping ticks while Timescale ingest is still running. */
const inFlight = new Set()

async function forwardSnapshot(room, produced) {
  await ensureRoomInfrastructure(room, produced)
  const payload = toIngestSnapshot(produced)
  let posted = await postSnapshot(payload)
  if (!posted.ok && posted.unknownEndpoints) {
    if (room) room.infraRegistered = false
    await ensureRoomInfrastructure(room, produced)
    posted = await postSnapshot(payload)
  }
  return posted
}

/**
 * Produce live snapshot, POST to tele-ingestion, detect from GET overlay.
 * @param {object} room
 * @returns {object} detection result
 */
export async function ingestCitySnapshot(room, onAfter) {
  const produced = buildCitySnapshot(room)
  const posted = await forwardSnapshot(room, produced)
  const refreshed = await refreshRoomIngestion(room)
  if (!posted.ok && refreshed.status !== 'ok') {
    room.ingestionStatus = 'down'
  }
  room.liveTelemetryByNodeId = mapLiveTelemetryByNodeId(
    room.nodes,
    room.ingestedByEndpoint,
    produced.simulationTick
  )

  const snapshot = overlaySnapshotFromIngested(produced, room.ingestedByEndpoint)
  const input = adaptCitySnapshot(snapshot)
  appendDetectionInput(input)
  const withMetrics = attachLookback(input, getLookback(room.id, LOOKBACK_TICKS, input.simulationTick))
  const withWindow = attachNeighborLookback(withMetrics, room.neighborHistory)
  let detection = runDetection(withWindow)
  detection = advanceRiskMomentum(room, detection)
  room.neighborHistory = pushNeighborSnapshot(room.neighborHistory, withWindow, LOOKBACK_TICKS)
  attachExplanations(room, detection.incidents)
  try {
    persistDetectionIncidents(room, detection)
  } catch (err) {
    console.error('[incidents] persist failed', err)
  }
  saveDetectionRun(room.id, input.simulationTick, input.tsMs, detection)
  room.detection = detection
  enqueueIncidentExplanations(room, onAfter)
  return detection
}

function bumpTick(room) {
  room.simulationTick = (Number(room.simulationTick) || 0) + 1
}

/**
 * @param {object} room
 * @param {(room: object) => void} [onAfter]
 */
export async function emitTelemetryNow(room, onAfter) {
  if (!room || room.phase !== 'playing') return
  const roomId = String(room.id ?? '')
  if (inFlight.has(roomId)) return
  inFlight.add(roomId)
  try {
    bumpTick(room)
    await ingestCitySnapshot(room, onAfter)
    onAfter?.(room)
  } catch (err) {
    console.error('[telemetry] tick failed', err)
    try {
      onAfter?.(room)
    } catch {
      // ignore broadcast failures after a dropped ingest
    }
  } finally {
    inFlight.delete(roomId)
  }
}

export function startTelemetryLoop(room, onTick) {
  if (!room?.id) return
  stopTelemetryLoop(room.id)
  room.simulationTick = 0
  room.detection = emptyDetectionResult()
  room.campaigns = []
  room.incidentLedger = []
  try {
    deleteRoomLookbackSamples(room.id)
  } catch {
    // store may not be initialized yet
  }
  try {
    clearPersistedIncidentHistory(room.id)
  } catch {
    // store may not be initialized yet
  }
  resetRiskHistory(room)
  room.neighborHistory = []
  room.ingestionStatus = room.ingestionStatus ?? 'empty'
  room.ingestedByEndpoint = room.ingestedByEndpoint ?? {}
  room.liveTelemetryByNodeId = room.liveTelemetryByNodeId ?? {}
  room.infraRegistered = false
  clearExplanationCache(room.id)
  void emitTelemetryNow(room, onTick)
  const handle = setInterval(() => {
    void emitTelemetryNow(room, onTick)
  }, TICK_MS)
  intervals.set(room.id, handle)
}

export function stopTelemetryLoop(roomId) {
  const handle = intervals.get(roomId)
  if (handle) {
    clearInterval(handle)
    intervals.delete(roomId)
  }
}

export function teardownRoomTelemetry(roomId) {
  stopTelemetryLoop(roomId)
  clearExplanationCache(roomId)
  deleteTgnnCalibrator(roomId)
  try {
    deleteRoomMetrics(roomId)
  } catch {
    // store may not be initialized yet
  }
}
