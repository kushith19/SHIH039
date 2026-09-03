import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import {
  DEMO_ROOM_ID,
  deleteRoomIfEmpty,
  getOrCreateRoom,
  getRoom,
  publicRoomState,
  DEFAULT_HACK_SIMULATOR,
  buildAttackLayerFromGraph,
} from './roomStore.js'
import {
  sanitizeNode,
  sanitizeEdge,
  sanitizeHackSimulator,
  isDefender,
  isAttacker,
  canEditTopology,
  canAddNode,
  canDeleteNode,
  canConnect,
  canEditSim,
  canDefenderSetBaseline,
  canQuarantine,
  canDeleteEdge,
} from './validators.js'
import {
  applyDefenderNodeBaseline,
  applyDefenderEdgeBaseline,
  isNodeMetricPatch,
  NODE_METRIC_KEYS,
  normalizeMetricPatch,
} from './nodeMetrics.js'
import { runtimeStateOf, telemetryOf } from './infrastructureNode.js'
import { applyCityModelOverlay, parseCityContextOverride } from '../shared/cityContext.js'
import '../shared/tgnnCore.js'
import { CITY_MODEL_DIR, loadCityModelFromDisk } from './loadCityModel.js'
import {
  emitTelemetryNow,
  startTelemetryLoop,
  teardownRoomTelemetry,
} from './telemetry/generator.js'
import { getLatestDetection } from './metrics/store.js'
import { resetTgnnCalibrator } from './detection/calibrator.js'
import {
  getRecentTelemetry,
  nodeIdsByCityEndpoint,
  samplesFromIngestedRows,
} from './telemetry/ingestionClient.js'

const PORT = Number(process.env.PORT) || 3001
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

const cityModel = loadCityModelFromDisk()
if (cityModel && applyCityModelOverlay(cityModel)) {
  console.log(`City model contexts: ${cityModel.contexts.join(', ')} (${CITY_MODEL_DIR})`)
} else {
  console.warn('City model YAML not loaded; using TRUST_CONFIG city context tables')
}

const app = express()
app.use(cors({ origin: [CLIENT_ORIGIN, 'http://127.0.0.1:5173'], credentials: true }))
app.get('/health', (_req, res) => res.json({ ok: true }))

app.get('/rooms/:id/metrics', async (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const result = await getRecentTelemetry(5)
  const nodeMap = nodeIdsByCityEndpoint(room.nodes)
  let samples = samplesFromIngestedRows(result.rows, nodeMap)
  const endpoint = req.query.endpoint ? String(req.query.endpoint) : ''
  if (endpoint) samples = samples.filter((s) => s.endpointId === endpoint)
  const fromTick = Number(req.query.fromTick)
  const toTick = Number(req.query.toTick)
  if (Number.isFinite(fromTick)) samples = samples.filter((s) => s.tick >= fromTick)
  if (Number.isFinite(toTick)) samples = samples.filter((s) => s.tick <= toTick)
  res.json({
    ok: true,
    roomId: id,
    source: 'ingestion',
    ingestionStatus: result.status,
    samples,
  })
})

app.get('/rooms/:id/detection', (req, res) => {
  const id = String(req.params.id ?? '').toUpperCase()
  const room = getRoom(id)
  if (!room) {
    return res.status(404).json({ ok: false, message: 'Room not found' })
  }
  const latest = getLatestDetection(id)
  res.json({
    ok: true,
    roomId: id,
    tick: latest?.tick ?? room.simulationTick ?? 0,
    tsMs: latest?.tsMs ?? null,
    detection: latest?.detection ?? room.detection ?? null,
  })
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: [CLIENT_ORIGIN, 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 5e6,
  pingTimeout: 20000,
  pingInterval: 25000,
})

const socketRoom = new Map()

function emitError(socket, message) {
  socket.emit('error', { message })
}

function broadcastState(room) {
  io.to(room.id).emit('state:sync', publicRoomState(room))
}

function syncWithTelemetry(room) {
  if (room.phase === 'playing') {
    void emitTelemetryNow(room, broadcastState)
    return
  }
  broadcastState(room)
}

function getSocketRoom(socket) {
  const roomId = socketRoom.get(socket.id)
  if (!roomId) return null
  return getRoom(roomId)
}

/** Socket.IO may pass the ack as the only arg when the client omits payload. */
function resolveAck(args) {
  for (let i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === 'function') return args[i]
  }
  return () => {}
}

function startMatch(room) {
  if (room.phase !== 'lobby') return false
  if (!room.players.defender || !room.players.attacker) return false
  room.phase = 'playing'
  room.matchNodeIds = room.nodes.map((n) => n.id)
  room.matchEdgeIds = room.edges.map((e) => e.id)
  room.hackSimulator = buildAttackLayerFromGraph(room.nodes, room.edges)
  resetTgnnCalibrator(room.id)
  startTelemetryLoop(room, broadcastState)
  return true
}

function tryAutoStartMatch(room) {
  return startMatch(room)
}

io.on('connection', (socket) => {
  socket.on('room:setCityContext', (...args) => {
    const ack = resolveAck(args)
    const payload =
      typeof args[0] === 'object' && args[0] !== null && typeof args[0] !== 'function'
        ? args[0]
        : {}
    const room = getSocketRoom(socket)
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not in a room' })
      return emitError(socket, 'Not in a room')
    }
    const parsed = parseCityContextOverride(payload.cityContext)
    if (parsed === undefined) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Unknown city context' })
      return emitError(socket, 'Unknown city context')
    }
    room.cityContextOverride = parsed
    const state = publicRoomState(room)
    if (typeof ack === 'function') {
      ack({
        ok: true,
        cityContext: state.cityContext,
        cityContextLocked: state.cityContextLocked,
      })
    }
    syncWithTelemetry(room)
  })

  socket.on('room:join', (...args) => {
    const ack = resolveAck(args)
    const room = getOrCreateRoom(DEMO_ROOM_ID)

    const existingRole =
      room.players.defender === socket.id
        ? 'defender'
        : room.players.attacker === socket.id
          ? 'attacker'
          : null

    if (existingRole) {
      socket.join(room.id)
      socketRoom.set(socket.id, room.id)
      ack({ ok: true, role: existingRole, ...publicRoomState(room) })
      return
    }

    const r = !room.players.defender
      ? 'defender'
      : !room.players.attacker
        ? 'attacker'
        : null

    if (!r) {
      ack({ ok: false, message: 'Session full' })
      return emitError(socket, 'Session is full — two players are already connected')
    }

    room.players[r] = socket.id
    socket.join(room.id)
    socketRoom.set(socket.id, room.id)
    ack({ ok: true, role: r, ...publicRoomState(room) })
    tryAutoStartMatch(room)
    broadcastState(room)
  })

  socket.on('game:start', (...args) => {
    const ack = resolveAck(args)
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!isDefender(socket.id, room)) {
      return emitError(socket, 'Only defender can start the match')
    }
    if (!startMatch(room)) {
      if (room.phase !== 'lobby') {
        return emitError(socket, 'Match already started')
      }
      return emitError(socket, 'Waiting for attacker to join')
    }
    ack({ ok: true })
    broadcastState(room)
  })

  socket.on('graph:load', ({ nodes, edges, viewport }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canEditTopology(socket.id, room)) {
      return emitError(socket, 'Cannot load topology now')
    }
    const nextNodes = (Array.isArray(nodes) ? nodes : [])
      .map(sanitizeNode)
      .filter(Boolean)
    const nextEdges = (Array.isArray(edges) ? edges : [])
      .map(sanitizeEdge)
      .filter(Boolean)
    room.nodes = nextNodes
    room.edges = nextEdges
    if (room.phase === 'playing') {
      room.matchNodeIds = room.nodes.map((n) => n.id)
      room.matchEdgeIds = room.edges.map((e) => e.id)
      room.hackSimulator = buildAttackLayerFromGraph(room.nodes, room.edges)
    }
    if (viewport && typeof viewport === 'object') {
      room.viewport = {
        x: Number(viewport.x ?? 0),
        y: Number(viewport.y ?? 0),
        zoom: Number(viewport.zoom ?? 1),
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:addNode', ({ node }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    const n = sanitizeNode(node)
    if (!n) return emitError(socket, 'Invalid node')
    if (!canAddNode(socket.id, room, n)) {
      return emitError(socket, 'Cannot add this node')
    }
    if (room.nodes.some((x) => x.id === n.id)) {
      return emitError(socket, 'Node already exists')
    }
    room.nodes.push(n)
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:updateNode', ({ nodeId, patch, position }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    const idx = room.nodes.findIndex((n) => n.id === nodeId)
    if (idx < 0) return emitError(socket, 'Node not found')

    const node = room.nodes[idx]
    const isInjected = runtimeStateOf(node.data).provenance === 'injected'

    if (room.phase === 'lobby') {
      if (!isDefender(socket.id, room)) {
        return emitError(socket, 'Defender edits topology in lobby')
      }
    } else if (room.phase === 'playing') {
      const p = patch ?? {}
      const labelOnly =
        Object.keys(p).length <= 2 &&
        (p.label !== undefined || p.quarantined !== undefined)
      if (isDefender(socket.id, room)) {
        if (canDefenderSetBaseline(socket.id, room) && isNodeMetricPatch(p)) {
          applyDefenderNodeBaseline(room, nodeId, p)
          if (typeof ack === 'function') ack({ ok: true })
          syncWithTelemetry(room)
          return
        }
        if (!labelOnly && !p.quarantined) {
          return emitError(socket, 'Defender can only quarantine during play')
        }
      } else if (isAttacker(socket.id, room)) {
        if (!isInjected && (p.label !== undefined || position)) {
          return emitError(socket, 'Attacker cannot edit defender nodes')
        }
        if (!isInjected && !canEditSim(socket.id, room)) {
          const hasDataPatch = Object.keys(p).some(
            (k) => k !== 'quarantined' && k !== 'provenance'
          )
          if (hasDataPatch && position) {
            return emitError(socket, 'Cannot edit this node')
          }
        }
      } else {
        return emitError(socket, 'Not allowed')
      }
    }

    if (position) {
      room.nodes[idx] = {
        ...room.nodes[idx],
        position: {
          x: Number(position.x ?? room.nodes[idx].position.x),
          y: Number(position.y ?? room.nodes[idx].position.y),
        },
      }
    }
    if (patch && typeof patch === 'object') {
      const prev = room.nodes[idx].data ?? {}
      let data = { ...prev, ...patch }
      const metricPatch = normalizeMetricPatch(patch)
      if (Object.keys(metricPatch).length > 0) {
        data.telemetry = { ...telemetryOf(prev), ...metricPatch }
        for (const k of NODE_METRIC_KEYS) delete data[k]
      }
      if (patch.quarantined !== undefined || patch.provenance !== undefined || patch.runtimeState) {
        data.runtimeState = {
          ...runtimeStateOf(prev),
          ...(patch.runtimeState && typeof patch.runtimeState === 'object'
            ? patch.runtimeState
            : {}),
          ...(patch.quarantined !== undefined
            ? { quarantined: patch.quarantined === true }
            : {}),
          ...(patch.provenance !== undefined
            ? {
                provenance:
                  patch.provenance === 'injected' ? 'injected' : 'legitimate',
              }
            : {}),
        }
        delete data.quarantined
        delete data.provenance
      }
      room.nodes[idx] = {
        ...room.nodes[idx],
        data,
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:deleteNode', ({ nodeId }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canDeleteNode(socket.id, room, nodeId)) {
      return emitError(socket, 'Cannot delete this node')
    }
    room.nodes = room.nodes.filter((n) => n.id !== nodeId)
    room.edges = room.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId
    )
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:addEdge', ({ edge }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canConnect(socket.id, room)) {
      return emitError(socket, 'Cannot add connection')
    }
    const e = sanitizeEdge(edge)
    if (!e) return emitError(socket, 'Invalid edge')
    if (!room.nodes.some((n) => n.id === e.source)) {
      return emitError(socket, 'Unknown source node')
    }
    if (!room.nodes.some((n) => n.id === e.target)) {
      return emitError(socket, 'Unknown target node')
    }
    if (room.edges.some((x) => x.id === e.id)) {
      return emitError(socket, 'Edge already exists')
    }
    room.edges.push(e)
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:updateEdge', ({ edgeId, patch }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    const idx = room.edges.findIndex((e) => e.id === edgeId)
    if (idx < 0) return emitError(socket, 'Edge not found')

    if (room.phase === 'lobby') {
      if (!isDefender(socket.id, room)) {
        return emitError(socket, 'Defender edits topology in lobby')
      }
    } else if (room.phase === 'playing') {
      if (isDefender(socket.id, room)) {
        if (patch?.packetsPerSecond !== undefined) {
          applyDefenderEdgeBaseline(room, edgeId, patch.packetsPerSecond)
          if (typeof ack === 'function') ack({ ok: true })
          syncWithTelemetry(room)
          return
        }
        return emitError(socket, 'Defender can only update link telemetry during play')
      }
      if (!isAttacker(socket.id, room)) {
        return emitError(socket, 'Attacker edits links during play')
      }
    }

    if (patch && typeof patch === 'object') {
      const dataPatch = {}
      if (patch.label !== undefined) dataPatch.label = String(patch.label)
      if (patch.packetsPerSecond !== undefined) {
        dataPatch.packetsPerSecond = Math.max(0, Number(patch.packetsPerSecond) || 0)
      }
      room.edges[idx] = {
        ...room.edges[idx],
        data: { ...room.edges[idx].data, ...dataPatch },
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:deleteEdge', ({ edgeId }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canDeleteEdge(socket.id, room)) {
      return emitError(socket, 'Cannot remove this link')
    }
    room.edges = room.edges.filter((e) => e.id !== edgeId)
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('graph:nodeChanges', ({ changes }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!isDefender(socket.id, room)) {
      if (typeof ack === 'function') ack({ ok: false })
      return
    }
    for (const ch of Array.isArray(changes) ? changes : []) {
      if (ch.type === 'position' && ch.id) {
        const idx = room.nodes.findIndex((n) => n.id === ch.id)
        if (idx >= 0 && ch.position) {
          room.nodes[idx] = {
            ...room.nodes[idx],
            position: {
              x: Number(ch.position.x ?? 0),
              y: Number(ch.position.y ?? 0),
            },
          }
        }
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    broadcastState(room)
  })

  socket.on('graph:setViewport', ({ viewport }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return
    if (viewport) {
      room.viewport = {
        x: Number(viewport.x ?? 0),
        y: Number(viewport.y ?? 0),
        zoom: Number(viewport.zoom ?? 1),
      }
    }
    if (typeof ack === 'function') ack({ ok: true })
    broadcastState(room)
  })

  socket.on('sim:patch', ({ hackSimulator }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canEditSim(socket.id, room)) {
      return emitError(socket, 'Scenario edits not allowed for your role now')
    }
    const sanitized = sanitizeHackSimulator(hackSimulator)
    if (isDefender(socket.id, room)) {
      room.hackSimulator = {
        ...room.hackSimulator,
        active: sanitized.active,
        nodeScenarioBaselines:
          sanitized.nodeScenarioBaselines ?? room.hackSimulator.nodeScenarioBaselines,
        edgeScenarioBaselines:
          sanitized.edgeScenarioBaselines ?? room.hackSimulator.edgeScenarioBaselines,
      }
    } else {
      room.hackSimulator = sanitized
    }
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('defender:quarantine', ({ nodeId }, ack) => {
    const room = getSocketRoom(socket)
    if (!room) return emitError(socket, 'Not in a room')
    if (!canQuarantine(socket.id, room)) {
      return emitError(socket, 'Cannot quarantine')
    }
    const idx = room.nodes.findIndex((n) => n.id === nodeId)
    if (idx < 0) return emitError(socket, 'Node not found')
    const prev = room.nodes[idx].data ?? {}
    room.nodes[idx] = {
      ...room.nodes[idx],
      data: {
        ...prev,
        runtimeState: { ...runtimeStateOf(prev), quarantined: true },
      },
    }
    if (typeof ack === 'function') ack({ ok: true })
    syncWithTelemetry(room)
  })

  socket.on('disconnect', () => {
    const roomId = socketRoom.get(socket.id)
    socketRoom.delete(socket.id)
    if (!roomId) return
    const room = getRoom(roomId)
    if (!room) return
    if (room.players.defender === socket.id) room.players.defender = null
    if (room.players.attacker === socket.id) room.players.attacker = null
    const deleted = deleteRoomIfEmpty(roomId)
    if (deleted) {
      teardownRoomTelemetry(roomId)
      return
    }
    broadcastState(room)
  })
})

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the other server: lsof -i :${PORT} then kill <pid>`
    )
    process.exit(1)
  }
  throw err
})

httpServer.listen(PORT, () => {
  console.log(`TrustNetAI game server on http://localhost:${PORT}`)
})
