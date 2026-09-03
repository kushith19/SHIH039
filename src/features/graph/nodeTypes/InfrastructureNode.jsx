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

const HACK_DRIFT = {
  base: '#d97706',
  border: '#b45309',
  bg: 'color-mix(in srgb, #f59e0b 18%, transparent)',
}

// Highest-risk next target based on peer trust + propagation risk
const HACK_NEXT_TARGET = {
  base: '#a855f7',
  border: '#9333ea',
  bg: 'color-mix(in srgb, #a855f7 18%, transparent)',
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
  const peerExposed = attackOn && !flaggedByScan && (hack?.atRiskNodeIds ?? []).includes(id)
  const isPrimarySpread = attackOn && !flaggedByScan && hack?.primarySpreadNodeId === id
  const anomaly = {
    isAnomaly: flaggedByScan,
    trustAnomaly: flaggedByScan,
  }

  const isAnomalySeed = attackOn && anomaly.isAnomaly
  const isCriticalRed = isAnomalySeed

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
      : isPrimarySpread
        ? HACK_NEXT_TARGET
        : peerExposed || drift
          ? HACK_DRIFT
          : HACK_MUTED

  const ppsLabel = ppsFormatter.format(displayPps)
  const trustLabel = trustFormatter.format(trustScore)
  const peerLabel =
    attackOn && Number.isFinite(Number(trustModel?.peerTrust))
      ? trustFormatter.format(trustModel.peerTrust)
      : null
  const showAnomalyDetectedBadge = attackOn && isAnomalyDetected(anomaly)
  const runtime = runtimeStateOf(data)
  const isInjected = runtime.provenance === 'injected'
  const isQuarantined = runtime.quarantined

  return (
    <div
      className={[
        'relative w-[148px] rounded-lg transition',
        selected ? 'ring-2 ring-[var(--tn-select)]' : '',
      ].join(' ')}
      style={{
        background: bg,
        boxShadow: `inset 3px 0 0 ${border}`,
      }}
    >
      {showAnomalyDetectedBadge || isPrimarySpread || peerExposed || isInjected ? (
        <div className="pointer-events-none absolute -top-2 left-1 right-1 z-10 text-center text-[11px] font-medium leading-tight">
          <span className="inline-block rounded bg-[var(--tn-surface)] px-1.5 py-0.5 text-[var(--tn-text)] shadow-[var(--tn-shadow-sm)]">
            {showAnomalyDetectedBadge
              ? 'Anomaly'
              : isPrimarySpread
                ? 'Next target'
                : peerExposed
                  ? 'Peer exposed'
                  : 'Unknown node'}
          </span>
        </div>
      ) : null}
      {isQuarantined ? (
        <div className="pointer-events-none absolute inset-0 z-[5] rounded-lg bg-black/25" />
      ) : null}

      <div className="flex items-start gap-2 p-2">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--tn-surface)]"
          style={{ color: base }}
          aria-hidden="true"
        >
          {Icon ? <Icon size={14} /> : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-medium leading-tight">
            {label}
          </div>
          {sector ? (
            <div className="mt-0.5 truncate text-[11px] text-[var(--tn-muted)]">
              {sector}
            </div>
          ) : null}
          <div className="mt-1 flex items-center justify-between gap-1 text-[11px] tabular-nums">
            <span className="text-[var(--tn-muted)]">pps</span>
            <span style={{ color: base }}>{ppsLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-1 text-[11px] tabular-nums">
            <span className="text-[var(--tn-muted)]">trust</span>
            <span style={{ color: base }}>{trustLabel}%</span>
          </div>
          {peerLabel != null ? (
            <div className="flex items-center justify-between gap-1 text-[11px] tabular-nums">
              <span className="text-[var(--tn-muted)]">peer</span>
              <span style={{ color: base }}>{peerLabel}%</span>
            </div>
          ) : null}
          {metricDriftHint ? (
            <div className="mt-0.5 truncate text-[11px] font-medium text-[var(--tn-warn)]">
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
