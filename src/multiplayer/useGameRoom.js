import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_HACK_SIMULATOR } from '../features/graph/graphIO'
import { getGameSocket } from './socket'

const emptyRoom = {
  id: '',
  phase: 'lobby',
  players: { defender: false, attacker: false },
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  hackSimulator: DEFAULT_HACK_SIMULATOR,
  matchNodeIds: [],
  matchEdgeIds: [],
  simulationTick: 0,
  cityContext: 'normal_day',
  cityContextLocked: false,
  simHour: 10,
  detectionMode: 'tgnn',
  detection: null,
  autoSpreadSafety: null,
  campaigns: [],
  commanderBriefing: null,
  cityPosture: null,
  responseOrchestration: null,
  ingestionStatus: 'empty',
  liveTelemetryByNodeId: {},
}

function roomFromState(state) {
  return {
    id: state.id ?? '',
    phase: state.phase ?? 'lobby',
    players: state.players ?? { defender: false, attacker: false },
    nodes: state.nodes ?? [],
    edges: state.edges ?? [],
    viewport: state.viewport ?? { x: 0, y: 0, zoom: 1 },
    hackSimulator: state.hackSimulator ?? DEFAULT_HACK_SIMULATOR,
    matchNodeIds: state.matchNodeIds ?? [],
    matchEdgeIds: state.matchEdgeIds ?? [],
    simulationTick: state.simulationTick ?? 0,
    cityContext: state.cityContext ?? 'normal_day',
    cityContextLocked: state.cityContextLocked === true,
    simHour: state.simHour ?? 10,
    detectionMode: 'tgnn',
    detection: state.detection ?? null,
    autoSpreadSafety:
      state.autoSpreadSafety && typeof state.autoSpreadSafety === 'object'
        ? {
            count: Number(state.autoSpreadSafety.count) || 0,
            cap: Number(state.autoSpreadSafety.cap) || 0,
          }
        : null,
    campaigns: Array.isArray(state.campaigns) ? state.campaigns : [],
    commanderBriefing: state.commanderBriefing ?? null,
    cityPosture: state.cityPosture ?? null,
    responseOrchestration: state.responseOrchestration ?? null,
    ingestionStatus: state.ingestionStatus ?? 'empty',
    liveTelemetryByNodeId: state.liveTelemetryByNodeId ?? {},
  }
}

export const DEMO_ROOM_ID = 'DEMO'

export function useGameRoom() {
  const [room, setRoom] = useState(emptyRoom)
  const [role, setRole] = useState(null)
  const [connected, setConnected] = useState(() => getGameSocket().connected)
  const [error, setError] = useState(null)
  const [connectError, setConnectError] = useState(null)

  useEffect(() => {
    const socket = getGameSocket()

    const onConnect = () => {
      setConnected(true)
      setConnectError(null)
    }
    const onDisconnect = () => setConnected(false)
    const onConnectError = (err) => {
      setConnected(false)
      const raw = String(err?.message ?? '')
      const unreachable =
        raw === 'websocket error' ||
        raw === 'xhr poll error' ||
        raw === 'timeout' ||
        raw.includes('ECONNREFUSED')
      setConnectError(
        unreachable
          ? 'Cannot reach the game server on port 3001. Start it with npm run dev:server, or run both with npm run dev:all.'
          : raw ||
              'Cannot reach game server. Run npm run dev:server (or npm run dev:all).'
      )
    }
    const onSync = (state) => {
      setRoom(roomFromState(state))
    }
    const onErr = ({ message }) => setError(message ?? 'Unknown error')

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('state:sync', onSync)
    socket.on('error', onErr)

    if (!socket.connected) {
      socket.connect()
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('state:sync', onSync)
      socket.off('error', onErr)
    }
  }, [])

  const emitAck = useCallback((event, payload) => {
    const socket = getGameSocket()
    return new Promise((resolve) => {
      const finish = (res) => {
        if (res?.ok === true || res?.id) {
          resolve({ ok: true, ...res })
          return
        }
        resolve(res ?? { ok: false, message: 'No response from server' })
      }

      const timer = window.setTimeout(() => {
        finish({
          ok: false,
          message:
            'Server timed out. Start the API: npm run dev:server (port 3001).',
        })
      }, 12_000)

      const onResponse = (res) => {
        window.clearTimeout(timer)
        finish(res)
      }

      const run = () => {
        if (payload === undefined) {
          socket.emit(event, onResponse)
        } else {
          socket.emit(event, payload, onResponse)
        }
      }

      if (socket.connected) {
        run()
      } else {
        socket.once('connect', run)
        socket.connect()
      }
    })
  }, [])

  const joinRoom = useCallback(async () => {
    setError(null)
    const res = await emitAck('room:join', { roomId: DEMO_ROOM_ID })
    if (!res.ok) {
      setError(res.message ?? 'Failed to join')
      return false
    }
    setRole(res.role ?? null)
    setRoom(roomFromState(res))
    return true
  }, [emitAck])


  const setCityContext = useCallback(async (cityContext) => {
    const res = await emitAck('room:setCityContext', { cityContext })
    if (!res.ok) setError(res.message ?? 'Cannot change city context')
    return res.ok
  }, [emitAck])

  const startGame = useCallback(async () => {
    const res = await emitAck('game:start')
    if (!res.ok) setError(res.message ?? 'Cannot start match')
    return res.ok
  }, [emitAck])

  const actions = useMemo(
    () => ({
      loadTopology: (payload) => emitAck('graph:load', payload),
      addNode: (node) => emitAck('graph:addNode', { node }),
      updateNode: (nodeId, patch, position) =>
        emitAck('graph:updateNode', { nodeId, patch, position }),
      deleteNode: (nodeId) => emitAck('graph:deleteNode', { nodeId }),
      addEdge: (edge) => emitAck('graph:addEdge', { edge }),
      updateEdge: (edgeId, patch) => emitAck('graph:updateEdge', { edgeId, patch }),
      deleteEdge: (edgeId) => emitAck('graph:deleteEdge', { edgeId }),
      nodeChanges: (changes) => emitAck('graph:nodeChanges', { changes }),
      setViewport: (viewport) => emitAck('graph:setViewport', { viewport }),
      patchSim: (hackSimulator) => emitAck('sim:patch', { hackSimulator }),
      quarantine: (nodeId, quarantined = true) =>
        emitAck('defender:quarantine', { nodeId, quarantined }),
      resetMatch: () => emitAck('game:reset'),
      applyCampaignPreset: (nodeId, presetId) =>
        emitAck('campaign:manual', { nodeId, presetId }),
      spreadAttack: (sourceNodeId, targetNodeId, presetId) =>
        emitAck('attack:spread', { sourceNodeId, targetNodeId, presetId }),
      abortCampaigns: () => emitAck('campaign:abort'),
      setAttackSpreadMode: (mode) => emitAck('attack:setSpreadMode', { mode }),
    }),
    [emitAck]
  )

  const resetMatch = useCallback(async () => {
    const res = await emitAck('game:reset')
    if (!res.ok) setError(res.message ?? 'Cannot reset match')
    return res.ok
  }, [emitAck])

  return {
    room,
    role,
    connected,
    connectError,
    error,
    setError,
    joinRoom,
    startGame,
    resetMatch,
    setCityContext,
    actions,
  }
}
