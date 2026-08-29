import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
} from '@xyflow/react'
import { useHackSimulator } from '../hackSimulatorContext'
import { hasScenarioDrift, getEdgeExpectedPps, getEdgeEffectivePps } from '../peerTrust'

function DirectedLabeledEdge(edgeProps) {
  const { id, data, selected, ...rest } = edgeProps
  const [edgePath, labelX, labelY] = getBezierPath(rest)
  const hack = useHackSimulator()
  const attackOn = hack != null && hack.active === true

  const label = data?.label ?? ''
  const sim = {
    active: attackOn,
    edgeOverrides: hack?.edgeOverrides ?? {},
    edgeScenarioBaselines: hack?.edgeScenarioBaselines,
    simulationTick: hack?.simulationTick ?? 0,
    cityContext: hack?.cityContext,
  }
  const expected = getEdgeExpectedPps({ id, data }, sim)
  const displayPps = getEdgeEffectivePps({ id, data }, sim)
  const ppsLine =
    displayPps > 0 ? `${displayPps.toLocaleString()} pkt/s` : null

  const drift = hasScenarioDrift({ baselinePps: expected, effectivePps: displayPps })
  const onPrimarySpreadPath =
    attackOn && hack?.primarySpreadEdgeId != null && hack.primarySpreadEdgeId === id
  const onAtRiskPath =
    attackOn && !onPrimarySpreadPath && (hack?.atRiskEdgeIds ?? []).includes(id)

  const chipClass = onPrimarySpreadPath
    ? 'bg-rose-500/20 dark:bg-rose-500/15 text-rose-950 dark:text-rose-200 border-rose-600/45 dark:border-rose-500/45'
    : onAtRiskPath
      ? 'bg-violet-500/20 dark:bg-violet-500/15 text-violet-950 dark:text-violet-200 border-violet-600/45 dark:border-violet-500/45'
      : attackOn
      ? !drift
        ? 'bg-slate-200/90 dark:bg-slate-700/80 text-slate-800 dark:text-slate-100 border-slate-300/90 dark:border-slate-600/80'
        : 'bg-amber-500/20 dark:bg-amber-500/15 text-amber-950 dark:text-amber-200 border-amber-600/45 dark:border-amber-500/45'
      : 'bg-emerald-500/15 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 border-emerald-600/35 dark:border-emerald-500/35'

  const edgeStyle = onPrimarySpreadPath
    ? { stroke: '#dc2626', strokeWidth: 2.5 }
    : onAtRiskPath
      ? { stroke: '#9333ea', strokeWidth: 2.5 }
      : undefined

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={edgeStyle} {...rest} />

      {label || ppsLine ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div
              className={[
                'select-none rounded-lg border px-2 py-1 text-xs font-medium text-center leading-tight',
                selected
                  ? 'bg-slate-900 text-white border-slate-900'
                  : chipClass
                    ? chipClass
                    : 'bg-white/80 dark:bg-slate-950/70 text-slate-900 dark:text-slate-50 border-slate-200/80 dark:border-slate-800/80',
              ].join(' ')}
            >
              {label ? <div>{label}</div> : null}
              {ppsLine ? (
                <div className={label ? 'mt-0.5 text-[10px] font-semibold tabular-nums opacity-90' : ''}>
                  {ppsLine}
                </div>
              ) : null}
            </div>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export default memo(DirectedLabeledEdge)
