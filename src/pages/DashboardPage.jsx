import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Crosshair, Radio } from 'lucide-react'
import trustNetLogo from '../../logo/logo.png'
import { cityContextAt, cityContextLabel, expectedTelemetry } from '@shared/cityContext.js'
import EndpointTable from '../features/dashboard/EndpointTable'
import IncidentsPanel from '../features/dashboard/IncidentsPanel'
import PatternsPanel from '../features/dashboard/PatternsPanel'
import AttackStoryPanel from '../features/story/AttackStoryPanel'
import KpiStrip from '../features/dashboard/KpiStrip'
import {
  derivePosture,
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
  detection = null,
  cityContext = null,
  cityContextLocked = false,
  simHour = null,
  connected = false,
  ingestionStatus = null,
  hackSimulator = null,
  campaigns = [],
  attackStory = null,
}) {
  const [samples, setSamples] = useState([])
  const [fetchError, setFetchError] = useState(null)
  const [feedStatus, setFeedStatus] = useState(ingestionStatus)
  const [filterId, setFilterId] = useState(null)
  const [patterns, setPatterns] = useState([])
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
        try {
          const pRes = await fetch(`/rooms/${encodeURIComponent(roomId)}/patterns`)
          const pJson = await pRes.json()
          if (!cancelled && pRes.ok && pJson.ok !== false) {
            setPatterns(Array.isArray(pJson.patterns) ? pJson.patterns : [])
          }
        } catch {
          // patterns are optional for the live feed
        }
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
      const pps = lastPpsMap.get(n.id)?.value ?? baseline.packetsPerSecond
      const http = lastHttpMap.get(n.id)?.value ?? baseline.httpRequestsPerMin
      const files = lastFilesMap.get(n.id)?.value ?? baseline.filesDownloaded
      const logins = lastLoginsMap.get(n.id)?.value ?? baseline.failedLoginsPerMin
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
  const hourLabel =
    simHour != null ? `${String(Math.floor(Number(simHour))).padStart(2, '0')}:00` : null
  const cityLabel = cityContextLabel(cityContext)
  const quarantinedCount = rows.filter((r) => r.quarantined).length
  const posture = derivePosture(
    incidents,
    anomalyIds.size,
    detection?.tgnnCalibrating === true
  )

  if (!roomId) {
    return (
      <div className="soc-dashboard flex min-h-[100svh] flex-col">
        <header className="flex h-14 items-center justify-between border-b border-[var(--tn-line)] bg-[var(--tn-surface)] px-4">
          <div className="flex items-center gap-2">
            <img src={trustNetLogo} alt="" className="h-5 w-5 object-contain" />
            <div className="tn-label">City telemetry</div>
          </div>
          <Link to="/" className="tn-btn">
            Back to session
          </Link>
        </header>
        <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center p-8 text-center">
          <Radio className="h-8 w-8 text-[var(--tn-muted)]" strokeWidth={1.4} />
          <p className="mt-4 text-sm text-[var(--tn-muted)]">
            Telemetry is per match. Open as defender, then switch to{' '}
            <span className="font-medium text-[var(--tn-text)]">Dashboard</span> in
            the header for the live city feed.
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="soc-dashboard min-h-0 flex-1 overflow-auto p-4 md:p-6">
      <div className="mx-auto max-w-[96rem] space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="tn-label">TrustNetAI · SOC</div>
            <div className="mt-0.5 text-xl font-medium tracking-tight">City mesh telemetry</div>
            <p className="mt-0.5 font-mono text-xs text-[var(--tn-muted)]">
              {phase === 'playing' ? `tick ${tick}` : 'waiting'}
              {cityLabel ? ` · ${cityLabel}` : ''}
              {hourLabel ? ` · ${hourLabel}` : ''}
              {' · TGNN'}
              {detection?.tgnnCalibrating ? ' · calibrating live baseline' : ''}
            </p>
          </div>
          {filterId ? (
            <button type="button" className="tn-btn font-mono text-xs" onClick={() => setFilterId(null)}>
              <Crosshair className="h-3.5 w-3.5" />
              Scoped · {filterLabel}
              <span className="text-[var(--tn-muted)]">clear</span>
            </button>
          ) : (
            <p className="text-sm text-[var(--tn-muted)]">Select a fleet row or incident to isolate a node</p>
          )}
        </header>

        {fetchError ? (
          <div className="tn-surface px-3 py-2 font-mono text-sm text-[var(--tn-crit)]">{fetchError}</div>
        ) : null}

        {phase === 'playing' && (feedStatus === 'down' || feedStatus === 'empty') ? (
          <div className="tn-surface px-4 py-2.5 text-sm">
            {feedStatus === 'down'
              ? 'Waiting for tele-ingestion. Start the Timescale service on port 3000 (see README).'
              : 'tele-ingestion is up but has no recent snapshots. Run the telemetry generator against POST /ingest/snapshot.'}
          </div>
        ) : null}

        {phase !== 'playing' ? (
          <div className="tn-surface px-4 py-2.5 text-sm">
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
          tgnnCalibrating={detection?.tgnnCalibrating === true}
          tgnnWarmupCollected={detection?.tgnnWarmupCollected ?? 0}
          tgnnWarmupTicks={detection?.tgnnWarmupTicks ?? 15}
        />

        <AttackStoryPanel story={attackStory} onSelectEndpoint={setFilterId} />

        <EndpointTable
          rows={rows}
          sparkDomain={sparkDomain}
          filterId={filterId}
          onSelect={(id) => setFilterId((cur) => (cur === id ? null : id))}
        />

        <IncidentsPanel
          incidents={incidents}
          campaigns={campaigns}
          onSelectEndpoint={setFilterId}
          demoted={Array.isArray(attackStory?.chapters) && attackStory.chapters.length > 0}
        />

        <PatternsPanel patterns={patterns} />
      </div>
    </div>
  )
}
