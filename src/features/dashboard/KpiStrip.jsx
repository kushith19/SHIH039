import { Activity, Radio, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { fmt, paddedDomainFromSeries } from './metrics'

function MiniSpark({ data = [], color = '#22d3ee' }) {
  if (!data.length) {
    return <div className="h-10 w-full rounded bg-slate-200/40 dark:bg-white/5" />
  }
  const yDomain = paddedDomainFromSeries(data)
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <YAxis domain={yDomain} allowDataOverflow hide />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            fill={color}
            fillOpacity={0.14}
            baseValue={yDomain[0]}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

const POSTURE_THEME = {
  calm: {
    ring: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    glow: 'shadow-[0_0_40px_-8px_rgba(16,185,129,0.45)]',
    Icon: ShieldCheck,
  },
  watch: {
    ring: 'border-amber-400/60 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    glow: 'shadow-[0_0_40px_-8px_rgba(245,158,11,0.45)]',
    Icon: ShieldAlert,
  },
  critical: {
    ring: 'border-rose-400/70 bg-rose-500/15 text-rose-800 dark:text-rose-200',
    glow: 'shadow-[0_0_48px_-6px_rgba(244,63,94,0.55)]',
    Icon: ShieldAlert,
  },
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
  const theme = POSTURE_THEME[posture?.key] ?? POSTURE_THEME.calm
  const Icon = theme.Icon

  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div
        className={`relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white/70 p-5 dark:border-white/10 dark:bg-slate-950/50 ${theme.glow}`}
      >
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/15" />
        <div className="relative flex items-start gap-4">
          <div
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border ${theme.ring}`}
          >
            <Icon className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
              Mesh posture
            </div>
            <div className="mt-1 font-mono text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {posture?.label ?? 'Nominal'}
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{posture?.blurb}</p>
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-3 gap-2 border-t border-slate-200/60 pt-4 dark:border-white/10">
          <Stat label="Incidents" value={incidentCount} hot={incidentCount > 0} />
          <Stat label="TGNN flags" value={anomalyCount} hot={anomalyCount > 0} />
          <Stat label="Quarantine" value={quarantinedCount} muted />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/50">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              City packets / s · idle load
            </div>
            <Activity className="h-3.5 w-3.5 text-cyan-500" />
          </div>
          <div className="mt-1 flex items-end justify-between gap-3">
            <div className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-cyan-100">
              {fmt(pps)}
            </div>
            <div className="w-28 shrink-0">
              <MiniSpark data={ppsSeries.slice(-40)} />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/50">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <Radio className="h-3 w-3" />
            Link
          </div>
          <div
            className={`mt-1 font-mono text-lg font-semibold ${
              connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {connected ? 'Live' : 'Offline'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">Telemetry poll 1s</div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/50">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Clock
          </div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {tick}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">{sampleTicks} ticks stored</div>
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value, hot, muted }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div
        className={[
          'mt-0.5 font-mono text-xl font-semibold tabular-nums',
          hot
            ? 'text-rose-600 dark:text-rose-300'
            : muted
              ? 'text-slate-500'
              : 'text-slate-900 dark:text-slate-100',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  )
}
