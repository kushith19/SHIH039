import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Crosshair, Radio } from 'lucide-react'
import PageHeader from '../ui/PageHeader'
import Banner from '../ui/Banner'
import EmptyState from '../ui/EmptyState'
import { cityContextAt, expectedTelemetry } from '@shared/cityContext.js'
import DashboardNav from '../features/dashboard/DashboardNav'
import {
  dashboardPanelMeta,
  isIncidentFocusPanel,
  resolveDashboardPanel,
} from '../features/dashboard/dashboardPanels.js'
import EndpointTable from '../features/dashboard/EndpointTable'
import IncidentsPanel from '../features/dashboard/IncidentsPanel'
import OverviewPanel from '../features/dashboard/OverviewPanel'
import CommanderPanel from '../features/commander/CommanderPanel'
import ResponseConsolePanel from '../features/response/ResponseConsolePanel'
import ResponseOrchestrationPanel from '../features/response/ResponseOrchestrationPanel'
import {
  holdAlignedPct,
  lastValue,
  latestByEndpoint,
  sampleTickAligned,
  samplesForMatch,
  seriesByTick,
  sharedSparkPctDomain,
  vsExpectedPct,
} from '../features/dashboard/metrics'
import { getNodeBaselineMetrics } from '../features/graph/peerTrust'

/**
 * Live room telemetry dashboard. When used as `/dashboard` with no room, shows an empty state.
 */
export default function DashboardPage({
  roomId = '',
  phase = 'lobby',
  tick = 0,
  nodes = [],
  edges = [],
  detection = null,
  cityContext = null,
  cityContextLocked = false,
  simHour = null,
  connected = false,
  ingestionStatus = null,
  hackSimulator = null,
  commanderBriefing = null,
  cityPosture = null,
  responseOrchestration = null,
}) {
  const [searchParams] = useSearchParams()
  const panel = resolveDashboardPanel(searchParams.get('panel'))
  const panelMeta = dashboardPanelMeta(panel)
  const [samples, setSamples] = useState([])
  const [fetchError, setFetchError] = useState(null)
  const [feedStatus, setFeedStatus] = useState(ingestionStatus)
  const [filterId, setFilterId] = useState(null)
  const heldPctRef = useRef(new Map())
  const tickRef = useRef(tick)
  tickRef.current = tick

  useEffect(() => {
    if (!roomId) return undefined
    let cancelled = false
    const load = async () => {
      try {
        const cap = Number(tickRef.current)
        const qs = Number.isFinite(cap)
          ? `?fromTick=0&toTick=${encodeURIComponent(String(cap))}`
          : ''
        const res = await fetch(`/rooms/${encodeURIComponent(roomId)}/metrics${qs}`)
        const json = await res.json()
        if (cancelled) return
        if (!res.ok || json.ok === false) {
          setFetchError(json.message ?? `HTTP ${res.status}`)
          return
        }
        setFetchError(null)
        setFeedStatus(json.ingestionStatus ?? ingestionStatus)
        const raw = Array.isArray(json.samples) ? json.samples : []
        setSamples(samplesForMatch(raw, tickRef.current))
      } catch (err) {
        if (!cancelled) setFetchError(err?.message ?? 'Fetch failed')
      }
    }
    void load()
    const id = window.setInterval(() => void load(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [roomId])

  const anomalyIds = useMemo(
    () => new Set(detection?.anomalyNodeIds ?? []),
    [detection]
  )
  const incidents = useMemo(
    () => (Array.isArray(detection?.incidents) ? detection.incidents : []),
    [detection]
  )

  const matchSamples = useMemo(() => samplesForMatch(samples, tick), [samples, tick])

  const ppsSeries = useMemo(
    () => seriesByTick(matchSamples, 'packetsPerSecond', filterId, { sum: !filterId }).slice(-120),
    [matchSamples, filterId]
  )

  const sampleTicks = useMemo(() => new Set(matchSamples.map((s) => s.tick)).size, [matchSamples])
  const lastPpsMap = useMemo(() => latestByEndpoint(matchSamples, 'packetsPerSecond'), [matchSamples])
  const lastHttpMap = useMemo(() => latestByEndpoint(matchSamples, 'httpRequestsPerMin'), [matchSamples])
  const lastFilesMap = useMemo(() => latestByEndpoint(matchSamples, 'filesDownloaded'), [matchSamples])
  const lastLoginsMap = useMemo(() => latestByEndpoint(matchSamples, 'failedLoginsPerMin'), [matchSamples])

  const rows = useMemo(() => {
    const hourNow = Number(simHour)
    const sim = {
      ...(hackSimulator ?? {}),
      active: hackSimulator?.active === true || phase === 'playing',
      simulationTick: tick,
      cityContext,
    }
    const held = heldPctRef.current
    const seen = new Set()
    const nextRows = (nodes ?? []).map((n) => {
      const baseline = getNodeBaselineMetrics(n, sim)
      const hasLivePps = lastPpsMap.has(n.id)
      const pps = hasLivePps ? lastPpsMap.get(n.id)?.value : null
      const http = lastHttpMap.has(n.id) ? lastHttpMap.get(n.id)?.value : null
      const files = lastFilesMap.has(n.id) ? lastFilesMap.get(n.id)?.value : null
      const logins = lastLoginsMap.has(n.id) ? lastLoginsMap.get(n.id)?.value : null
      const catalogBaseline = !hasLivePps
      const quarantined = n.data?.runtimeState?.quarantined === true || n.data?.quarantined === true
      const meta = {
        id: n.id,
        sector: n.data?.sector,
        type: n.data?.type ?? n.data?.assetType,
        cityEndpointId: n.data?.cityEndpointId,
      }
      const nowTick = lastPpsMap.get(n.id)?.tick ?? 0
      const ctxForNow =
        cityContextLocked && cityContext ? cityContext : cityContextAt(nowTick)
      const expectedNow = expectedTelemetry(baseline, ctxForNow || cityContext, {
        ...meta,
        tick: nowTick,
        ...(Number.isFinite(hourNow) && nowTick === tick ? { simHour: hourNow } : {}),
      })
      const ppsSeries = seriesByTick(matchSamples, 'packetsPerSecond', n.id).slice(-24)
      const spark = ppsSeries.map((p) => {
        const ctx =
          cityContextLocked && cityContext ? cityContext : cityContextAt(p.tick)
        const expectedPps = expectedTelemetry(baseline, ctx, {
          ...meta,
          tick: p.tick,
          ...(Number.isFinite(hourNow) && p.tick === tick ? { simHour: hourNow } : {}),
        }).packetsPerSecond
        return { tick: p.tick, value: vsExpectedPct(p.value, expectedPps) ?? 0 }
      })
      const aligned =
        Boolean(cityContext) &&
        lastPpsMap.has(n.id) &&
        sampleTickAligned(nowTick, tick)
      const nextPct = aligned ? vsExpectedPct(pps, expectedNow.packetsPerSecond) : null
      const ppsVsExpected = holdAlignedPct({
        aligned,
        nextPct,
        heldPct: held.get(n.id) ?? null,
      })
      seen.add(n.id)
      if (aligned) held.set(n.id, ppsVsExpected)
      return {
        id: n.id,
        label: n.data?.label ?? n.id,
        type: n.data?.type ?? n.data?.assetType ?? '—',
        pps: pps ?? baseline.packetsPerSecond,
        http: http ?? baseline.httpRequestsPerMin,
        files: files ?? baseline.filesDownloaded,
        logins: logins ?? baseline.failedLoginsPerMin,
        catalogBaseline,
        spark,
        ppsVsExpected,
        anomaly: anomalyIds.has(n.id),
        quarantined,
      }
    })
    for (const id of [...held.keys()]) {
      if (!seen.has(id)) held.delete(id)
    }
    return nextRows
  }, [
    nodes,
    lastPpsMap,
    lastHttpMap,
    lastFilesMap,
    lastLoginsMap,
    matchSamples,
    anomalyIds,
    cityContext,
    cityContextLocked,
    simHour,
    tick,
    phase,
    hackSimulator,
  ])

  const sparkDomain = useMemo(
    () => sharedSparkPctDomain(rows.map((r) => r.spark)),
    [rows]
  )

  const filterLabel = rows.find((r) => r.id === filterId)?.label

  const onToggleFilter = (id) => {
    if (id == null) {
      setFilterId(null)
      return
    }
    setFilterId((cur) => (cur === id ? null : id))
  }

  const criticalFeed =
    Boolean(fetchError) ||
    (phase === 'playing' && (feedStatus === 'down' || feedStatus === 'empty'))

  const statusBanners = (
    <div className="space-y-2">
      {fetchError ? <Banner tone="crit">{fetchError}</Banner> : null}
      {phase === 'playing' && feedStatus === 'down' ? (
        <Banner tone="warn">
          Waiting for tele-ingestion. Start the Timescale service on port 3000 (see README).
        </Banner>
      ) : null}
      {phase === 'playing' && feedStatus === 'empty' ? (
        <Banner tone="info">
          tele-ingestion is up but has no recent snapshots. Run the telemetry generator against
          POST /ingest/snapshot.
        </Banner>
      ) : null}
      {!criticalFeed && phase === 'playing' && feedStatus === 'ok' && sampleTicks === 0 ? (
        <div className="soc-feed-strip" role="status">
          Ingest is up but this match has no tick-aligned Timescale samples. Fleet rows show
          catalog baseline, not live PPS.
        </div>
      ) : null}
      {!criticalFeed && phase !== 'playing' ? (
        <div className="soc-feed-strip" role="status">
          Time-series samples start when both players are in and the match is live.
        </div>
      ) : null}
    </div>
  )

  const focusIncidentId = searchParams.get('incident')
  const focusIncident =
    focusIncidentId &&
    incidents.find(
      (inc) =>
        String(inc.persistentId || '') === String(focusIncidentId) ||
        String(inc.id || '') === String(focusIncidentId)
    )
  const focusLabel =
    focusIncident?.endpointLabel ||
    focusIncident?.endpointId ||
    (focusIncidentId ? String(focusIncidentId) : null)

  if (!roomId) {
    return (
      <div className="soc-dashboard flex min-h-[100svh] flex-col">
        <PageHeader
          title="City telemetry"
          subtitle="Telemetry is scoped to a live match."
          actions={
            <Link to="/" className="tn-btn">
              Back to session
            </Link>
          }
        />
        <EmptyState
          icon={<Radio className="h-8 w-8" strokeWidth={1.4} />}
          title="Open as defender"
          body="Open a session as defender, then switch to Dashboard in the header for the live city feed."
        />
      </div>
    )
  }

  let pageBody = null
  if (panel === 'overview') {
    pageBody = (
      <OverviewPanel
        detection={detection}
        nodes={nodes}
        edges={edges}
        incidents={incidents}
        rows={rows}
        feedStatus={feedStatus}
        phase={phase}
        sampleTicks={sampleTicks}
        fetchError={fetchError}
        pps={lastValue(ppsSeries)}
        onSelectEndpoint={setFilterId}
      />
    )
  } else if (panel === 'fleet') {
    pageBody = (
      <EndpointTable
        hideHeader
        rows={rows}
        sparkDomain={sparkDomain}
        filterId={filterId}
        onSelect={onToggleFilter}
      />
    )
  } else if (panel === 'incidents') {
    pageBody = (
      <IncidentsPanel
        hideHeader
        roomId={roomId}
        incidents={incidents}
        nodes={nodes}
        edges={edges}
        liveCorrelation={detection?.liveCorrelation ?? null}
        primarySpreadNodeId={detection?.primarySpreadNodeId ?? null}
        onSelectEndpoint={setFilterId}
      />
    )
  } else if (panel === 'commander') {
    pageBody = (
      <CommanderPanel
        roomId={roomId}
        briefing={commanderBriefing}
        posture={cityPosture}
        incidents={incidents}
        focusIncidentId={searchParams.get('incident')}
        simulationTick={tick}
        detection={detection}
      />
    )
  } else if (panel === 'orchestrate') {
    pageBody = (
      <ResponseOrchestrationPanel
        roomId={roomId}
        detection={detection}
        nodes={nodes}
        edges={edges}
        incidents={incidents}
        focusIncidentId={searchParams.get('incident')}
        orchestrationState={responseOrchestration}
      />
    )
  } else if (panel === 'response') {
    pageBody = (
      <ResponseConsolePanel
        roomId={roomId}
        focusIncidentId={searchParams.get('incident')}
      />
    )
  } else {
    pageBody = (
      <OverviewPanel
        detection={detection}
        nodes={nodes}
        edges={edges}
        incidents={incidents}
        rows={rows}
        feedStatus={feedStatus}
        phase={phase}
        sampleTicks={sampleTicks}
        fetchError={fetchError}
        pps={lastValue(ppsSeries)}
        onSelectEndpoint={setFilterId}
      />
    )
  }

  return (
    <div className="soc-dashboard flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <DashboardNav
        panel={panel}
        incidentCount={incidents.length}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageHeader
          title={panelMeta.label}
          subtitle={panelMeta.blurb}
          actions={
            filterId || (isIncidentFocusPanel(panel) && focusLabel) ? (
              <div className="flex flex-wrap items-center gap-2">
                {isIncidentFocusPanel(panel) && focusLabel ? (
                  <span className="tn-badge" title="Incident focus kept on Commander, Orchestrate, and Response">
                    Focused · {focusLabel}
                  </span>
                ) : null}
                {filterId ? (
                  <button type="button" className="tn-btn" onClick={() => setFilterId(null)}>
                    <Crosshair className="h-4 w-4" />
                    {filterLabel}
                    <span className="text-[var(--tn-muted)]">Clear</span>
                  </button>
                ) : null}
              </div>
            ) : null
          }
        />
        <main
          className={
            panel === 'commander' ||
            panel === 'incidents' ||
            panel === 'orchestrate' ||
            panel === 'response'
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:px-6 md:py-5'
              : 'min-h-0 flex-1 overflow-auto p-4 md:px-6 md:py-5'
          }
        >
          <div
            className={
              panel === 'commander' ||
              panel === 'incidents' ||
              panel === 'orchestrate' ||
              panel === 'response'
                ? 'flex min-h-0 flex-1 flex-col gap-4'
                : panel === 'overview'
                  ? 'mx-auto w-full max-w-[80rem] space-y-4'
                  : 'mx-auto w-full max-w-6xl space-y-4'
            }
          >
            {panel === 'overview' ? statusBanners : null}
            {pageBody}
          </div>
        </main>
      </div>
    </div>
  )
}
