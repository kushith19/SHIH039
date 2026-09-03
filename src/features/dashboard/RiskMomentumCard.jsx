import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'
import {
  formatMomentumLine,
  formatScoreOver100,
  isPlateauAtCeiling,
  trajectoryLabel,
} from '@shared/riskMomentum.js'
import { paddedDomainFromSeries } from './metrics'

function trajectoryColor(key) {
  const k = String(key ?? '').toLowerCase()
  if (k === 'critical' || k === 'escalating') return 'var(--tn-crit)'
  if (k === 'rising') return 'var(--tn-warn)'
  return 'var(--tn-text)'
}

function MiniSpark({ data = [] }) {
  if (!data.length) {
    return <div className="h-10 w-full rounded bg-[var(--tn-elevated)]" />
  }
  const yDomain = paddedDomainFromSeries(data)
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <YAxis domain={yDomain} allowDataOverflow hide />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--tn-text)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function RiskMomentumReadout({
  riskMomentum = null,
  scoreCaption = 'Peak graph residual × 100',
  compact = false,
}) {
  const rm = riskMomentum ?? {}
  const available = rm.available === true && rm.score != null
  const windowTicks = Number(rm.windowTicks) || 10
  const color = trajectoryColor(rm.trajectory)
  const scoreClass = compact
    ? 'mt-1 font-mono text-base font-medium tabular-nums'
    : 'mt-1 font-mono text-lg font-medium tabular-nums'

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div>
        <div className="tn-label">Risk score</div>
        <div className={scoreClass}>{available ? formatScoreOver100(rm.score) : '— / 100'}</div>
        {scoreCaption ? <p className="tn-meta mt-1">{scoreCaption}</p> : null}
      </div>
      <div>
        <div className="tn-label">Momentum</div>
        <div className="mt-1 font-mono text-sm tabular-nums">
          {formatMomentumLine(available ? rm.delta : null, windowTicks)}
        </div>
      </div>
      <div>
        <div className="tn-label">Trajectory</div>
        <div className="mt-1 font-mono text-sm font-medium" style={{ color }}>
          {available ? trajectoryLabel(rm.trajectory) : 'Stable'}
        </div>
      </div>
    </div>
  )
}

export default function RiskMomentumCard({ riskMomentum = null }) {
  const rm = riskMomentum ?? {}
  const series = Array.isArray(rm.series) ? rm.series : []
  const available = rm.available === true && rm.score != null
  const windowTicks = Number(rm.windowTicks) || 10
  const color = trajectoryColor(rm.trajectory)

  return (
    <section className="tn-surface px-5 py-6">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-xl flex-1">
          <h2 className="tn-section-title">Why this score</h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--tn-text)]">
            Peak graph residual × 100. Momentum is the 10-tick (~10 s) change — falling can be
            manageable; rapidly rising is urgent. Assessment, not a confirmed kill-chain.
            {isPlateauAtCeiling(rm) ? ' Score is plateaued at the residual ceiling.' : ''}
          </p>
          <dl className="mt-5 grid grid-cols-3 gap-4">
            <div>
              <dt className="tn-label">Score</dt>
              <dd className="mt-1 font-mono text-lg font-medium tabular-nums">
                {available ? formatScoreOver100(rm.score) : '— / 100'}
              </dd>
            </div>
            <div>
              <dt className="tn-label">Momentum</dt>
              <dd className="mt-1 font-mono text-lg font-medium tabular-nums">
                {formatMomentumLine(available ? rm.delta : null, windowTicks)}
              </dd>
            </div>
            <div>
              <dt className="tn-label">Trajectory</dt>
              <dd className="mt-1 font-mono text-lg font-medium" style={{ color }}>
                {available ? trajectoryLabel(rm.trajectory) : 'Stable'}
              </dd>
            </div>
          </dl>
        </div>
        <div className="w-full max-w-xs shrink-0 sm:w-56">
          <MiniSpark data={series} />
        </div>
      </div>
    </section>
  )
}
