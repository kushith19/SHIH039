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
  const chipClass = attackOn
    ? !drift
      ? 'border-[var(--tn-line)] text-[var(--tn-muted)]'
      : 'border-[var(--tn-warn)] text-[var(--tn-warn)]'
    : 'border-[var(--tn-line)]'

  const edgeStyle = undefined

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
                'select-none border bg-[var(--tn-surface)] px-2 py-1 text-center text-xs font-medium leading-tight',
                selected ? 'border-[var(--tn-text)]' : chipClass,
              ].join(' ')}
            >
              {label ? <div>{label}</div> : null}
              {ppsLine ? (
                <div className={label ? 'mt-0.5 text-xs font-semibold tabular-nums opacity-90' : ''}>
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
