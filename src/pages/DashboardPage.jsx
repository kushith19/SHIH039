import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Crosshair, Radio } from 'lucide-react'
import trustNetLogo from '../../logo/logo.png'
import { cityContextAt, cityContextLabel, expectedTelemetry } from '@shared/cityContext.js'
import { telemetryOf } from '../features/graph/infrastructureNode'
import EndpointTable from '../features/dashboard/EndpointTable'
import IncidentsPanel from '../features/dashboard/IncidentsPanel'
import KpiStrip from '../features/dashboard/KpiStrip'
import {
  derivePosture,
  lastValue,
  latestByEndpoint,
  seriesByTick,
  sharedSparkPctDomain,
  vsExpectedPct,
} from '../features/dashboard/metrics'

/**
 * Live room telemetry dashboard. When used as `/dashboard` with no room, shows an empty state.
 */
export default function DashboardPage({
  roomId = '',
  phase = 'lobby',
  tick = 0,
  nodes = [],
  detection = null,
  cityContext = null,
  cityContextLocked = false,
  simHour = null,
  detectionMode = 'fusion',
  connected = false,
  ingestionStatus = null,
}) {
  const [samples, setSamples] = useState([])
  const [fetchError, setFetchError] = useState(null)
  const [feedStatus, setFeedStatus] = useState(ingestionStatus)
  const [filterId, setFilterId] = useState(null)

  useEffect(() => {
    if (!roomId) return undefined
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/rooms/${encodeURIComponent(roomId)}/metrics`)
        const json = await res.json()
        if (cancelled) return
        if (!res.ok || json.ok === false) {
          setFetchError(json.message ?? `HTTP ${res.status}`)
          return
        }
        setFetchError(null)
        setFeedStatus(json.ingestionStatus ?? ingestionStatus)
        setSamples(Array.isArray(json.samples) ? json.samples : [])
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

  const ppsSeries = useMemo(
    () => seriesByTick(samples, 'packetsPerSecond', filterId, { sum: !filterId }).slice(-120),
    [samples, filterId]
  )

  const sampleTicks = useMemo(() => new Set(samples.map((s) => s.tick)).size, [samples])
  const lastPpsMap = useMemo(() => latestByEndpoint(samples, 'packetsPerSecond'), [samples])
  const lastHttpMap = useMemo(() => latestByEndpoint(samples, 'httpRequestsPerMin'), [samples])
  const lastFilesMap = useMemo(() => latestByEndpoint(samples, 'filesDownloaded'), [samples])
  const lastLoginsMap = useMemo(() => latestByEndpoint(samples, 'failedLoginsPerMin'), [samples])

  const rows = useMemo(() => {
    return (nodes ?? []).map((n) => {
      const live = telemetryOf(n.data)
      const pps = lastPpsMap.get(n.id)?.value ?? live.packetsPerSecond
      const http = lastHttpMap.get(n.id)?.value ?? live.httpRequestsPerMin
      const files = lastFilesMap.get(n.id)?.value ?? live.filesDownloaded
      const logins = lastLoginsMap.get(n.id)?.value ?? live.failedLoginsPerMin
      const quarantined = n.data?.runtimeState?.quarantined === true || n.data?.quarantined === true
      const meta = {
        id: n.id,
        sector: n.data?.sector,
        type: n.data?.type ?? n.data?.assetType,
        cityEndpointId: n.data?.cityEndpointId,
      }
      const nowTick = lastPpsMap.get(n.id)?.tick ?? 0
      const expectedNow = expectedTelemetry(live, cityContext, { ...meta, tick: nowTick })
      const ppsSeries = seriesByTick(samples, 'packetsPerSecond', n.id).slice(-24)
      const spark = ppsSeries.map((p) => {
        const ctx =
          cityContextLocked && cityContext ? cityContext : cityContextAt(p.tick)
        const expectedPps = expectedTelemetry(live, ctx, { ...meta, tick: p.tick }).packetsPerSecond
        return { tick: p.tick, value: vsExpectedPct(p.value, expectedPps) ?? 0 }
      })
      const ppsVsExpected = lastPpsMap.has(n.id)
        ? vsExpectedPct(pps, expectedNow.packetsPerSecond)
        : null
      return {
        id: n.id,
        label: n.data?.label ?? n.id,
        type: n.data?.type ?? n.data?.assetType ?? '—',
        pps,
        http,
        files,
        logins,
        spark,
        ppsVsExpected,
        anomaly: anomalyIds.has(n.id),
        quarantined,
      }
    })
  }, [
    nodes,
    lastPpsMap,
    lastHttpMap,
    lastFilesMap,
    lastLoginsMap,
    samples,
    anomalyIds,
    cityContext,
    cityContextLocked,
  ])

  const sparkDomain = useMemo(
    () => sharedSparkPctDomain(rows.map((r) => r.spark)),
    [rows]
  )

  const filterLabel = rows.find((r) => r.id === filterId)?.label
  const hourLabel =
    simHour != null ? `${String(Math.floor(Number(simHour))).padStart(2, '0')}:00` : null
  const cityLabel = cityContextLabel(cityContext)
  const quarantinedCount = rows.filter((r) => r.quarantined).length
  const posture = derivePosture(incidents, anomalyIds.size)

  if (!roomId) {
    return (
      <div className="soc-dashboard flex min-h-[100svh] flex-col text-slate-900 dark:text-slate-50">
        <header className="flex h-14 items-center justify-between border-b border-slate-200/60 px-4 dark:border-white/10">
          <div className="flex items-center gap-2">
            <img src={trustNetLogo} alt="" className="h-8 w-8 rounded-xl object-contain" />
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
              City telemetry
            </div>
          </div>
          <Link
            to="/"
            className="rounded-lg border border-slate-200/80 px-3 py-1.5 text-sm dark:border-white/15"
          >
            Back to session
          </Link>
        </header>
        <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center p-8 text-center">
          <Radio className="h-10 w-10 text-cyan-500" strokeWidth={1.4} />
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
            Telemetry is per match. Open as defender, then switch to{' '}
            <span className="font-medium text-slate-800 dark:text-slate-200">Dashboard</span> in
            the header for the live city feed.
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="soc-dashboard min-h-0 flex-1 overflow-auto p-3 text-slate-900 md:p-5 dark:text-slate-50">
      <div className="mx-auto max-w-[88rem] space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-cyan-700 dark:text-cyan-400">
              TrustNetAI · SOC
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              City mesh telemetry
            </div>
            <p className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {phase === 'playing' ? `tick ${tick}` : 'waiting'}
              {cityLabel ? ` · ${cityLabel}` : ''}
              {hourLabel ? ` · ${hourLabel}` : ''}
              {' · '}
              {detectionMode === 'tgnn' ? 'TGNN only' : 'Telemetry + TGNN'}
            </p>
          </div>
          {filterId ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 font-mono text-xs text-cyan-800 dark:text-cyan-200"
              onClick={() => setFilterId(null)}
            >
              <Crosshair className="h-3.5 w-3.5" />
              Scoped · {filterLabel}
              <span className="text-cyan-600/70">clear</span>
            </button>
          ) : (
            <p className="text-xs text-slate-400">Select a fleet row or incident to isolate a node</p>
          )}
        </header>

        {fetchError ? (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 font-mono text-sm text-rose-800 dark:text-rose-200">
            {fetchError}
          </div>
        ) : null}

        {phase === 'playing' && (feedStatus === 'down' || feedStatus === 'empty') ? (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
            {feedStatus === 'down'
              ? 'Waiting for tele-ingestion. Start the Timescale service on port 3000 (see README).'
              : 'tele-ingestion is up but has no recent snapshots. Run the telemetry generator against POST /ingest/snapshot.'}
          </div>
        ) : null}

        {phase !== 'playing' ? (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
            Time-series samples start when both players are in and the match is live.
          </div>
        ) : null}

        <KpiStrip
          posture={posture}
          tick={tick}
          sampleTicks={sampleTicks}
          pps={lastValue(ppsSeries)}
          ppsSeries={ppsSeries}
          incidentCount={incidents.length}
          anomalyCount={anomalyIds.size}
          quarantinedCount={quarantinedCount}
          connected={connected}
        />

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20.5rem]">
          <div className="space-y-4">
            <EndpointTable
              rows={rows}
              sparkDomain={sparkDomain}
              filterId={filterId}
              onSelect={(id) => setFilterId((cur) => (cur === id ? null : id))}
            />
          </div>
          <IncidentsPanel incidents={incidents} onSelectEndpoint={setFilterId} />
        </div>
      </div>
    </div>
  )
}
