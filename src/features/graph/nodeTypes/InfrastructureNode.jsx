import { memo, useMemo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { getAssetByType } from '../assetCatalog'
import { runtimeStateOf } from '../infrastructureNode'
import { useHackSimulator } from '../hackSimulatorContext'
import {
  getNodeBaselineMetrics,
  getNodeEffectiveMetrics,
  getNodeExpectedMetrics,
  hasScenarioDrift,
  isAnomalyDetected,
} from '../peerTrust'

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

const NORMAL_NODE_STYLE = {
  base: '#22c55e',
  border: '#16a34a',
  bg: 'color-mix(in srgb, #22c55e 16%, transparent)',
}

const HACK_MUTED = {
  base: '#64748b',
  border: '#475569',
  bg: 'color-mix(in srgb, #64748b 18%, transparent)',
}

const HACK_TAMPERED = {
  base: '#ef4444',
  border: '#dc2626',
  bg: 'color-mix(in srgb, #ef4444 22%, transparent)',
}

const HACK_ATTACK_ORIGIN = {
  base: '#a855f7',
  border: '#9333ea',
  bg: 'color-mix(in srgb, #a855f7 22%, transparent)',
}

const HACK_DRIFT = {
  base: '#d97706',
  border: '#b45309',
  bg: 'color-mix(in srgb, #f59e0b 18%, transparent)',
}

const ppsFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
})

const trustFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
})

function InfrastructureNode({ id, data, selected }) {
  const asset = getAssetByType(data.type)
  const hack = useHackSimulator()
  const attackOn = hack != null && hack.active === true

  const sim = useMemo(
    () => ({
      active: hack?.active === true,
      nodeOverrides: hack?.nodeOverrides ?? {},
      edgeOverrides: hack?.edgeOverrides ?? {},
      nodeScenarioBaselines: hack?.nodeScenarioBaselines,
      edgeScenarioBaselines: hack?.edgeScenarioBaselines,
      simulationTick: hack?.simulationTick ?? 0,
      cityContext: hack?.cityContext,
    }),
    [
      hack?.active,
      hack?.nodeOverrides,
      hack?.edgeOverrides,
      hack?.nodeScenarioBaselines,
      hack?.edgeScenarioBaselines,
      hack?.simulationTick,
      hack?.cityContext,
    ]
  )

  const selfNode = useMemo(() => ({ id, data }), [id, data])

  const baselineMetrics = useMemo(
    () => getNodeBaselineMetrics(selfNode, sim),
    [selfNode, sim]
  )
  const expectedMetrics = useMemo(
    () => getNodeExpectedMetrics(selfNode, sim),
    [selfNode, sim]
  )
  const effectiveMetrics = useMemo(
    () => getNodeEffectiveMetrics(selfNode, sim),
    [selfNode, sim]
  )

  const baselinePps = clamp(baselineMetrics.packetsPerSecond, 0, Number.MAX_SAFE_INTEGER)
  const displayPps = attackOn
    ? clamp(effectiveMetrics.packetsPerSecond, 0, Number.MAX_SAFE_INTEGER)
    : baselinePps

  const trustModel = hack?.trustByNodeId?.[id]
  const trustScore = trustModel?.trustScore ?? 100

  const flaggedByScan = attackOn && (hack?.anomalyNodeIds ?? []).includes(id)
  const anomaly = {
    isAnomaly: flaggedByScan,
    trustAnomaly: flaggedByScan,
  }

  const isPrimarySpreadTarget =
    attackOn && hack?.primarySpreadNodeId != null && hack.primarySpreadNodeId === id
  const isAnomalySeed = attackOn && anomaly.isAnomaly
  const isCriticalRed = isPrimarySpreadTarget || isAnomalySeed
  const atRiskNodeIds = hack?.atRiskNodeIds ?? []
  const isAtRisk =
    attackOn && !isCriticalRed && atRiskNodeIds.includes(id)

  const label = data.label ?? asset?.title ?? 'Untitled system'
  const Icon = asset?.Icon
  const sector = data.sector || asset?.domain

  const drift = hasScenarioDrift({ baselineMetrics: expectedMetrics, effectiveMetrics })

  const metricDriftHint = useMemo(() => {
    if (!attackOn || !drift) return null
    if (effectiveMetrics.httpRequestsPerMin > expectedMetrics.httpRequestsPerMin * 1.2) {
      return `↑ ${ppsFormatter.format(effectiveMetrics.httpRequestsPerMin)} req/min`
    }
    if (effectiveMetrics.filesDownloaded > expectedMetrics.filesDownloaded + 1) {
      return `↑ ${ppsFormatter.format(effectiveMetrics.filesDownloaded)} files`
    }
    if (effectiveMetrics.failedLoginsPerMin > expectedMetrics.failedLoginsPerMin + 2) {
      return `↑ ${ppsFormatter.format(effectiveMetrics.failedLoginsPerMin)} failed logins/min`
    }
    return null
  }, [attackOn, drift, expectedMetrics, effectiveMetrics])

  const { base, border, bg } = !attackOn
    ? NORMAL_NODE_STYLE
    : isCriticalRed
      ? HACK_TAMPERED
      : isAtRisk
        ? HACK_ATTACK_ORIGIN
        : !drift
          ? HACK_MUTED
          : HACK_DRIFT

  const ppsLabel = ppsFormatter.format(displayPps)
  const trustLabel = trustFormatter.format(trustScore)
  const showAnomalyDetectedBadge = attackOn && isAnomalyDetected(anomaly)
  const showSpreadBadge = isPrimarySpreadTarget
  const showAtRiskBadge = isAtRisk
  const runtime = runtimeStateOf(data)
  const isInjected = runtime.provenance === 'injected'
  const isQuarantined = runtime.quarantined

  return (
    <div
      className={[
        'relative rounded-lg border shadow-md transition w-[128px]',
        selected
          ? 'ring-2 ring-slate-900/70 dark:ring-slate-100/80'
          : 'hover:shadow-lg',
      ].join(' ')}
      style={{
        background: bg,
        borderColor: border,
      }}
    >
      {showAnomalyDetectedBadge ? (
        <div className="pointer-events-none absolute -top-2 -right-2 z-10 max-w-[140px] rounded-md bg-amber-500 px-2 py-1 text-[10px] font-bold leading-tight text-amber-950 shadow text-center">
          Anomaly detected
        </div>
      ) : null}
      {showSpreadBadge ? (
        <div className="pointer-events-none absolute -top-2 left-2 z-10 max-w-[140px] rounded-md bg-rose-600 px-2 py-1 text-[10px] font-bold leading-tight text-white shadow text-center">
          Highest spread risk
        </div>
      ) : null}
      {showAtRiskBadge ? (
        <div className="pointer-events-none absolute -top-2 left-2 z-10 max-w-[120px] rounded-md bg-violet-600 px-2 py-1 text-[10px] font-bold leading-tight text-white shadow text-center">
          May be attacked
        </div>
      ) : null}
      {isInjected ? (
        <div className="pointer-events-none absolute -bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-md bg-rose-700 px-2 py-0.5 text-[10px] font-bold text-white shadow">
          Unknown node
        </div>
      ) : null}
      {isQuarantined ? (
        <div className="pointer-events-none absolute inset-0 z-[5] rounded-lg bg-slate-900/25 dark:bg-slate-950/40" />
      ) : null}

      <div className="p-1.5 flex items-start gap-1.5">
        <div
          className="h-7 w-7 rounded-md bg-white/70 dark:bg-slate-950/40 border border-white/60 dark:border-slate-800/70 flex items-center justify-center shrink-0"
          style={{ color: base }}
          aria-hidden="true"
        >
          {Icon ? <Icon size={14} /> : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold text-slate-900 dark:text-slate-50 leading-tight line-clamp-2">
            {label}
          </div>
          {sector ? (
            <div className="mt-0.5 text-[8px] text-slate-500 dark:text-slate-400 truncate">
              {sector}
            </div>
          ) : null}
          <div className="mt-0.5 flex items-center justify-between gap-1">
            <div className="text-[8px] text-slate-600 dark:text-slate-300">pps</div>
            <div
              className="text-[9px] font-semibold px-1 py-px rounded border tabular-nums"
              style={{
                background: `color-mix(in srgb, ${base} 12%, transparent)`,
                borderColor: `color-mix(in srgb, ${base} 35%, transparent)`,
                color: base,
              }}
            >
              {ppsLabel}
            </div>
          </div>
          <div className="mt-px flex items-center justify-between gap-1">
            <div className="text-[8px] text-slate-600 dark:text-slate-300">trust</div>
            <div
              className="text-[9px] font-semibold px-1 py-px rounded border tabular-nums"
              style={{
                background: `color-mix(in srgb, ${base} 12%, transparent)`,
                borderColor: `color-mix(in srgb, ${base} 35%, transparent)`,
                color: base,
              }}
            >
              {trustLabel}%
            </div>
          </div>
          {metricDriftHint ? (
            <div className="mt-0.5 text-[8px] font-medium text-amber-800 dark:text-amber-300 truncate">
              {metricDriftHint}
            </div>
          ) : null}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Top}
        id="top-in"
        isConnectable
        style={{ background: border, border: `2px solid ${bg}` }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top-out"
        isConnectable
        style={{ background: base, border: `2px solid ${bg}` }}
      />

      <Handle
        type="target"
        position={Position.Right}
        id="right-in"
        isConnectable
        style={{ background: border, border: `2px solid ${bg}` }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right-out"
        isConnectable
        style={{ background: base, border: `2px solid ${bg}` }}
      />

      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-in"
        isConnectable
        style={{ background: border, border: `2px solid ${bg}` }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-out"
        isConnectable
        style={{ background: base, border: `2px solid ${bg}` }}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="left-in"
        isConnectable
        style={{ background: border, border: `2px solid ${bg}` }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left-out"
        isConnectable
        style={{ background: base, border: `2px solid ${bg}` }}
      />
    </div>
  )
}

export default memo(InfrastructureNode)
