import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'
import { fmt, paddedDomainFromSeries } from './metrics'
import Stat from '../../ui/Stat'
import {
  formatMomentumLine,
  trajectoryLabel,
} from '@shared/riskMomentum.js'

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

const POSTURE_PIP = {
  calm: 'var(--tn-ok)',
  watch: 'var(--tn-warn)',
  critical: 'var(--tn-crit)',
}

export default function KpiStrip({
  posture,
  tick = 0,
  sampleTicks = 0,
  pps = 0,
  ppsSeries = [],
  incidentCount = 0,
  anomalyCount = 0,
  quarantinedCount = 0,
  tgnnCalibrating = false,
  tgnnWarmupCollected = 0,
  tgnnWarmupTicks = 15,
  riskMomentum = null,
}) {
  const pip = POSTURE_PIP[posture?.key] ?? POSTURE_PIP.calm
  const rm = riskMomentum ?? {}
  const traj = rm.available ? trajectoryLabel(rm.trajectory) : 'Stable'

  return (
    <div className="space-y-4">
      <section className="tn-surface grid grid-cols-2 sm:grid-cols-4">
        <Stat
          label="Posture"
          value={posture?.label ?? 'Nominal'}
          hint={posture?.blurb}
          pip={pip}
        />
        <Stat label="Incidents" value={incidentCount} hot={incidentCount > 0} />
        <Stat
          label={tgnnCalibrating ? 'Idle window' : 'Residual flags'}
          value={
            tgnnCalibrating
              ? `${tgnnWarmupCollected}/${tgnnWarmupTicks}`
              : anomalyCount
          }
          hot={!tgnnCalibrating && anomalyCount > 0}
        />
        <Stat
          label="Trajectory"
          value={traj}
          hint={
            rm.available
              ? formatMomentumLine(rm.delta, Number(rm.windowTicks) || 10)
              : 'Waiting for residual samples'
          }
          hot={String(rm.trajectory).toLowerCase() === 'escalating' || String(rm.trajectory).toLowerCase() === 'critical'}
        />
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="tn-surface flex items-end justify-between gap-4 px-5 py-5 sm:col-span-2">
          <div>
            <div className="tn-label">Packets / s</div>
            <div className="mt-2 font-mono text-[1.375rem] font-medium tabular-nums">{fmt(pps)}</div>
          </div>
          <div className="w-40 shrink-0">
            <MiniSpark data={ppsSeries.slice(-40)} />
          </div>
        </div>
        <div className="tn-surface px-5 py-5">
          <div className="tn-label">Session</div>
          <div className="mt-2 font-mono text-[1.375rem] font-medium tabular-nums">{tick}</div>
          <p className="tn-meta mt-1">
            {sampleTicks} stored ticks · {quarantinedCount} quarantined
          </p>
        </div>
      </section>
    </div>
  )
}
