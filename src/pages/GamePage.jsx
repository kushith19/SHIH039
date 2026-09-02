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
    'tn-btn h-8 w-8 p-0',
    active ? 'border-[var(--tn-text)]' : '',
  ].join(' ')

const leftPanelClass = (open) => {
  const base =
    'shrink-0 overflow-auto border-r border-[var(--tn-line)] bg-[var(--tn-surface)] transition-[width] duration-150 ease-out max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:left-0 max-lg:z-40 max-lg:max-w-[85vw]'
  return open
    ? `${base} w-56 p-2 max-lg:translate-x-0 max-lg:w-56 max-lg:p-2`
    : `${base} w-0 overflow-hidden border-r-0 p-0 max-lg:-translate-x-full max-lg:w-60`
}

const rightPanelClass = (open) => {
  const base =
    'shrink-0 overflow-auto border-l border-[var(--tn-line)] bg-[var(--tn-surface)] transition-[width] duration-150 ease-out max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:right-0 max-lg:z-40 max-lg:max-w-[90vw]'
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
      simulationTick: room.simulationTick ?? 0,
      cityContext: room.cityContext,
      liveTelemetryByNodeId: room.liveTelemetryByNodeId ?? {},
    }),
    [
      activeHackSimulator,
      room.detection,
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
    <div className="tn-app flex h-[100svh] flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--tn-line)] bg-[var(--tn-surface)] px-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <img
            src={trustNetLogo}
            alt="TrustNetAI"
            className="h-5 w-5 shrink-0 object-contain"
          />
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-medium">TrustNetAI</span>
              {role ? (
                <span className="hidden capitalize text-sm text-[var(--tn-muted)] sm:inline">
                  {role}
                </span>
              ) : null}
            </div>
            <div className="truncate font-mono text-xs text-[var(--tn-muted)]">
              {role ? (
                <>
                  {waitingForOpponent
                    ? waitingCopy
                    : room.phase === 'playing'
                      ? `tick ${room.simulationTick ?? 0} · ${room.cityContext ?? 'normal_day'}`
                      : 'lobby'}
                  {' · '}
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="tn-pip"
                      style={{ background: connected ? 'var(--tn-ok)' : 'var(--tn-warn)' }}
                    />
                    {connected ? 'LIVE' : 'OFF'}
                  </span>
                </>
              ) : (
                'joining…'
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {role === 'defender' ? (
            <div className="flex items-stretch gap-0">
              <button
                type="button"
                className={[
                  'inline-flex h-14 items-center gap-1 border-b-2 px-2 text-sm font-medium sm:px-2.5',
                  !isDashboardView
                    ? 'border-[var(--tn-text)] text-[var(--tn-text)]'
                    : 'border-transparent text-[var(--tn-muted)]',
                ].join(' ')}
                onClick={() => setMatchView('map')}
              >
                <Map className="h-3.5 w-3.5" />
                Map
              </button>
              <button
                type="button"
                className={[
                  'inline-flex h-14 items-center gap-1 border-b-2 px-2 text-sm font-medium sm:px-2.5',
                  isDashboardView
                    ? 'border-[var(--tn-text)] text-[var(--tn-text)]'
                    : 'border-transparent text-[var(--tn-muted)]',
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
        <div className="shrink-0 border-b border-[var(--tn-line)] bg-[var(--tn-surface)] px-4 py-1.5 font-mono text-xs text-[var(--tn-warn)]">
          {connectError}
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 border-b border-[var(--tn-line)] bg-[var(--tn-surface)] px-4 py-1.5 font-mono text-xs text-[var(--tn-crit)]">
          {error}
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
          connected={connected}
          ingestionStatus={room.ingestionStatus}
        />
      ) : null}

      <main className={isDashboardView ? 'hidden' : 'relative flex min-h-0 flex-1'}>
        {(assetsOpen || inspectorOpen) && (
          <button
            type="button"
            aria-label="Close panel"
            className="fixed inset-0 top-14 z-30 bg-black/40 lg:hidden"
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

        <section className="relative min-h-0 min-w-0 flex-1 bg-[var(--tn-canvas)]">
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
