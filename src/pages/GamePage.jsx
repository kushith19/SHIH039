import trustNetLogo from '../../logo/logo.png'
import SidebarAssets from '../features/assets/SidebarAssets'
import GraphCanvas from '../features/graph/GraphCanvas'
import InspectorPanel from '../features/inspector/InspectorPanel'
import CityContextMenu from '../features/graph/CityContextMenu'
import DashboardPage from './DashboardPage'
import { DEMO_ROOM_ID, useGameRoom } from '../multiplayer/useGameRoom'
import { LayoutDashboard, Map, PanelLeft, PanelRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

function defaultPanelsForRole(role) {
  if (role === 'attacker' || role === 'defender') {
    return { assetsOpen: true, inspectorOpen: false }
  }
  return { assetsOpen: true, inspectorOpen: false }
}

const panelToggleBtn = (active) =>
  [
    'rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/40 p-2 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition',
    active ? 'ring-2 ring-indigo-500/40 dark:ring-indigo-400/30' : '',
  ].join(' ')

const leftPanelClass = (open) => {
  const base =
    'shrink-0 overflow-auto border-r border-slate-200/60 bg-slate-50/40 transition-all duration-200 ease-out dark:border-slate-800/60 dark:bg-slate-950/40 max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:left-0 max-lg:z-40 max-lg:max-w-[85vw]'
  return open
    ? `${base} w-56 p-2 max-lg:translate-x-0 max-lg:w-56 max-lg:p-2`
    : `${base} w-0 overflow-hidden border-r-0 p-0 max-lg:-translate-x-full max-lg:w-60`
}

const rightPanelClass = (open) => {
  const base =
    'shrink-0 overflow-auto border-l border-slate-200/60 bg-slate-50/40 transition-all duration-200 ease-out dark:border-slate-800/60 dark:bg-slate-950/40 max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:right-0 max-lg:z-40 max-lg:max-w-[90vw]'
  return open
    ? `${base} w-[17.5rem] p-2.5 max-lg:translate-x-0 max-lg:w-[17.5rem] max-lg:p-2.5`
    : `${base} w-0 overflow-hidden border-l-0 p-0 max-lg:translate-x-full max-lg:w-[17.5rem]`
}

export default function GamePage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const forceDefaultOnMount =
    searchParams.get('loadDefault') === '1' ||
    location.state?.loadDefault === true

  const {
    room,
    role,
    connected,
    connectError,
    error,
    actions,
    joinRoom,
    setDetectionMode,
    setCityContext,
  } = useGameRoom()

  useEffect(() => {
    if (!connected) return
    void joinRoom()
  }, [connected, joinRoom])

  const graphRef = useRef(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [selectedEdge, setSelectedEdge] = useState(null)
  const [hackModeActive, setHackModeActive] = useState(false)
  const [hackSimulator, setHackSimulator] = useState(null)
  const [assetsOpen, setAssetsOpen] = useState(() => defaultPanelsForRole(role).assetsOpen)
  const [inspectorOpen, setInspectorOpen] = useState(
    () => defaultPanelsForRole(role).inspectorOpen
  )

  const prevRoleRef = useRef(null)
  useEffect(() => {
    if (!role || role === prevRoleRef.current) return
    prevRoleRef.current = role
    const next = defaultPanelsForRole(role)
    setAssetsOpen(next.assetsOpen)
    setInspectorOpen(next.inspectorOpen)
  }, [role])

  useEffect(() => {
    if (!assetsOpen && !inspectorOpen) return
    const mq = window.matchMedia('(max-width: 1023px)')
    if (!mq.matches) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [assetsOpen, inspectorOpen])

  const activeHackSimulator = hackSimulator ?? room.hackSimulator
  const activeHackMode = hackModeActive || activeHackSimulator?.active === true
  const inspectorSim = useMemo(
    () => ({
      ...(activeHackSimulator ?? {}),
      ...(room.detection ?? {}),
      detectionMode: room.detectionMode ?? room.detection?.detectionMode ?? 'fusion',
      simulationTick: room.simulationTick ?? 0,
      cityContext: room.cityContext,
      liveTelemetryByNodeId: room.liveTelemetryByNodeId ?? {},
    }),
    [
      activeHackSimulator,
      room.detection,
      room.detectionMode,
      room.simulationTick,
      room.cityContext,
      room.liveTelemetryByNodeId,
    ]
  )

  const onSelectionChange = useCallback(({ selectedNode, selectedEdge }) => {
    setSelectedNode(selectedNode)
    setSelectedEdge(selectedEdge)
    if (selectedNode || selectedEdge) setInspectorOpen(true)
  }, [])

  const multiplayer = useMemo(
    () => ({
      enabled: true,
      role,
      phase: room.phase,
      nodes: room.nodes,
      edges: room.edges,
      hackSimulator: room.hackSimulator,
      viewport: room.viewport,
      detection: room.detection ?? null,
      simulationTick: room.simulationTick ?? 0,
      cityContext: room.cityContext,
      liveTelemetryByNodeId: room.liveTelemetryByNodeId ?? {},
      actions,
    }),
    [
      role,
      room.phase,
      room.nodes,
      room.edges,
      room.hackSimulator,
      room.viewport,
      room.detection,
      room.simulationTick,
      room.cityContext,
      room.liveTelemetryByNodeId,
      actions,
    ]
  )

  const canDefenderManageNodes = role === 'defender'
  const canUseAttackTools = role === 'attacker' && room.phase === 'playing'
  const readOnlyInspector = room.phase === 'playing' && role === 'defender'
  const canEditScenarioTelemetry =
    room.phase === 'playing' && (role === 'defender' || role === 'attacker')
  const canDeleteTopology =
    (role === 'defender') ||
    (role === 'attacker' && room.phase === 'playing')

  const onUpdateNodeData = useCallback(
    (nodeId, patch) => {
      graphRef.current?.updateNodeData?.(nodeId, patch)
    },
    []
  )

  const onUpdateEdgeData = useCallback(
    (edgeId, patch) => {
      graphRef.current?.updateEdgeData?.(edgeId, patch)
    },
    []
  )

  const onDeleteNodeById = useCallback((nodeId) => {
    graphRef.current?.deleteNodeById?.(nodeId)
  }, [])

  const onDeleteEdgeById = useCallback((edgeId) => {
    graphRef.current?.deleteEdgeById?.(edgeId)
  }, [])

  const onQuarantine = useCallback(
    (nodeId) => {
      actions.quarantine(nodeId)
    },
    [actions]
  )

  const onApplyAttackPreset = useCallback(
    (presetId, patch) => {
      if (!selectedNode?.id || !patch) return
      graphRef.current?.updateNodeData?.(selectedNode.id, patch)
    },
    [selectedNode]
  )

  const waitingForOpponent =
    room.phase === 'lobby' &&
    role &&
    ((role === 'defender' && !room.players.attacker) ||
      (role === 'attacker' && !room.players.defender))
  const waitingCopy =
    role === 'defender'
      ? 'Waiting for the other player'
      : 'Waiting for the explainer to reconnect'

  const isDashboardView = role === 'defender' && searchParams.get('view') === 'dashboard'

  const setMatchView = useCallback(
    (next) => {
      const nextParams = new URLSearchParams(searchParams)
      if (next === 'dashboard') nextParams.set('view', 'dashboard')
      else nextParams.delete('view')
      setSearchParams(nextParams, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200/60 px-3 dark:border-slate-800/60 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <img
            src={trustNetLogo}
            alt="TrustNetAI"
            className="h-8 w-8 shrink-0 rounded-xl object-contain shadow-sm"
          />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-semibold text-sm sm:text-base">
              TrustNetAI
            </div>
            <div className="truncate text-xs text-slate-500 dark:text-slate-400">
              {role ? (
                <>
                  <span className="capitalize">{role}</span>
                  {' · '}
                  {waitingForOpponent
                    ? waitingCopy
                    : room.phase === 'playing'
                      ? `Match live · tick ${room.simulationTick ?? 0} · ${room.cityContext ?? 'normal_day'}`
                      : 'Lobby'}
                  {' · '}
                  {room.detectionMode === 'tgnn' ? 'TGNN only' : 'Telemetry + TGNN'}
                  {' · '}
                  <span className={connected ? 'text-emerald-600' : 'text-amber-600'}>
                    {connected ? 'Online' : 'Offline'}
                  </span>
                </>
              ) : (
                'Joining…'
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {role === 'defender' ? (
            <div className="flex rounded-lg border border-slate-200/80 p-0.5 dark:border-slate-700/80">
              <button
                type="button"
                className={[
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium sm:px-2.5',
                  !isDashboardView
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-300',
                ].join(' ')}
                onClick={() => setMatchView('map')}
              >
                <Map className="h-3.5 w-3.5" />
                Map
              </button>
              <button
                type="button"
                className={[
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium sm:px-2.5',
                  isDashboardView
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-300',
                ].join(' ')}
                onClick={() => setMatchView('dashboard')}
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Dashboard
              </button>
            </div>
          ) : null}
          <CityContextMenu
            cityContext={room.cityContext ?? 'normal_day'}
            locked={room.cityContextLocked === true}
            onSelect={(id) => void setCityContext(id)}
            disabled={!role}
          />
          {!isDashboardView ? (
            <>
          <button
            type="button"
            className={panelToggleBtn(assetsOpen)}
            aria-label={assetsOpen ? 'Hide assets panel' : 'Show assets panel'}
            aria-expanded={assetsOpen}
            onClick={() => setAssetsOpen((o) => !o)}
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={panelToggleBtn(inspectorOpen)}
            aria-label={inspectorOpen ? 'Hide inspector panel' : 'Show inspector panel'}
            aria-expanded={inspectorOpen}
            onClick={() => setInspectorOpen((o) => !o)}
          >
            <PanelRight className="h-4 w-4" />
          </button>
            </>
          ) : null}
        </div>
      </header>

      {connectError && !connected ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {connectError}
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {role === 'defender' && room.phase === 'lobby' ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200/60 bg-slate-50/80 px-3 py-2 text-xs dark:border-slate-800/60 dark:bg-slate-900/40 sm:px-4">
          <span className="font-medium text-slate-600 dark:text-slate-300">Detection model</span>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="liveDetectionMode"
              checked={(room.detectionMode ?? 'fusion') === 'fusion'}
              onChange={() => void setDetectionMode('fusion')}
            />
            Telemetry + TGNN
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="liveDetectionMode"
              checked={room.detectionMode === 'tgnn'}
              onChange={() => void setDetectionMode('tgnn')}
            />
            TGNN only
          </label>
          <span className="text-slate-400">Locks when the match starts</span>
        </div>
      ) : null}

      {isDashboardView ? (
        <DashboardPage
          roomId={room.id || DEMO_ROOM_ID}
          phase={room.phase}
          tick={room.simulationTick ?? 0}
          nodes={room.nodes}
          detection={room.detection}
          cityContext={room.cityContext}
          cityContextLocked={room.cityContextLocked === true}
          simHour={room.simHour}
          detectionMode={room.detectionMode}
          connected={connected}
          ingestionStatus={room.ingestionStatus}
        />
      ) : null}

      <main className={isDashboardView ? 'hidden' : 'relative flex min-h-0 flex-1'}>
        {(assetsOpen || inspectorOpen) && (
          <button
            type="button"
            aria-label="Close panel"
            className="fixed inset-0 top-14 z-30 bg-slate-950/40 lg:hidden"
            onClick={() => {
              setAssetsOpen(false)
              setInspectorOpen(false)
            }}
          />
        )}

        <aside className={leftPanelClass(assetsOpen)}>
          <SidebarAssets
            role={role}
            phase={room.phase}
            showDevices={canDefenderManageNodes}
            showAttackTools={canUseAttackTools}
            selectedNodeId={selectedNode?.id ?? null}
            selectedNodeBaselineMetrics={selectedNode?.inspectorBaselineMetrics ?? null}
            onApplyAttackPreset={
              role === 'attacker' && room.phase === 'playing'
                ? onApplyAttackPreset
                : undefined
            }
          />
        </aside>

        <section className="relative min-h-0 min-w-0 flex-1 bg-slate-200 dark:bg-slate-900">
          <GraphCanvas
            ref={graphRef}
            multiplayer={multiplayer}
            paused={isDashboardView}
            forceDefaultOnMount={forceDefaultOnMount}
            onSelectionChange={onSelectionChange}
            onHackModeChange={setHackModeActive}
            onHackSimulatorChange={setHackSimulator}
          />
        </section>

        <aside className={rightPanelClass(inspectorOpen)}>
          <InspectorPanel
            hackModeActive={activeHackMode}
            hackSimulator={inspectorSim}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            onUpdateNodeData={
              canEditScenarioTelemetry || !readOnlyInspector
                ? onUpdateNodeData
                : undefined
            }
            onUpdateEdgeData={
              canEditScenarioTelemetry || !readOnlyInspector
                ? onUpdateEdgeData
                : undefined
            }
            onDeleteNodeById={canDeleteTopology ? onDeleteNodeById : undefined}
            onDeleteEdgeById={canDeleteTopology ? onDeleteEdgeById : undefined}
            readOnly={readOnlyInspector}
            gameRole={role}
            gamePhase={room.phase}
            onQuarantine={
              role === 'defender' && room.phase === 'playing' ? onQuarantine : undefined
            }
          />
        </aside>
      </main>
    </div>
  )
}
