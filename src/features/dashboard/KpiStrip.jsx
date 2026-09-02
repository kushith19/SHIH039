import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'
import { fmt, paddedDomainFromSeries } from './metrics'

function MiniSpark({ data = [] }) {
  if (!data.length) {
    return <div className="h-8 w-full bg-[var(--tn-elevated)]" />
  }
  const yDomain = paddedDomainFromSeries(data)
  return (
    <div className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <YAxis domain={yDomain} allowDataOverflow hide />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--tn-text)"
            strokeWidth={1.25}
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
  connected = false,
}) {
  const pip = POSTURE_PIP[posture?.key] ?? POSTURE_PIP.calm

  return (
    <section className="tn-surface grid grid-cols-2 divide-x divide-[var(--tn-line)] overflow-hidden md:grid-cols-6">
      <div className="px-4 py-3">
        <div className="tn-label">Posture</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="tn-pip" style={{ background: pip }} />
          <span className="font-mono text-lg font-medium">{posture?.label ?? 'Nominal'}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-[var(--tn-muted)]">{posture?.blurb}</p>
      </div>
      <Stat label="Incidents" value={incidentCount} hot={incidentCount > 0} />
      <Stat label="TGNN flags" value={anomalyCount} hot={anomalyCount > 0} />
      <Stat label="Quarantine" value={quarantinedCount} muted />
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="tn-label">Packets / s</div>
            <div className="mt-1 font-mono text-lg font-medium tabular-nums">{fmt(pps)}</div>
          </div>
          <div className="w-20 shrink-0">
            <MiniSpark data={ppsSeries.slice(-40)} />
          </div>
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="tn-label">Tick</div>
        <div className="mt-1 font-mono text-lg font-medium tabular-nums">{tick}</div>
        <div className="mt-0.5 font-mono text-xs text-[var(--tn-muted)]">
          {sampleTicks} stored · {connected ? 'LIVE' : 'OFF'}
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value, hot, muted }) {
  return (
    <div className="px-4 py-3">
      <div className="tn-label">{label}</div>
      <div
        className="mt-1 font-mono text-lg font-medium tabular-nums"
        style={{
          color: hot ? 'var(--tn-crit)' : muted ? 'var(--tn-muted)' : 'var(--tn-text)',
        }}
      >
        {value}
      </div>
    </div>
  )
}
