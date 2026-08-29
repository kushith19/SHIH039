import { fmt, fmtSignedPct, METRIC_KEYS } from './metrics'

function Sparkline({ data = [], color = '#22d3ee', yDomain = [-10, 20] }) {
  if (!data.length) return <span className="font-mono text-[10px] text-slate-400">—</span>
  const w = 88
  const h = 28
  const y0 = yDomain[0]
  const y1 = yDomain[1]
  const span = y1 - y0 || 1
  const pts = data
    .map((p, i) => {
      const x = data.length === 1 ? w / 2 : (i / (data.length - 1)) * w
      const y = h - ((Number(p.value) - y0) / span) * h
      return `${x},${Number.isFinite(y) ? y : h / 2}`
    })
    .join(' ')
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="h-7 w-[5.5rem]"
      aria-hidden="true"
    >
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  )
}

function StatusBadge({ quarantined, anomaly }) {
  if (quarantined) {
    return (
      <span className="rounded bg-slate-700 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-slate-100">
        Hold
      </span>
    )
  }
  if (anomaly) {
    return (
      <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300">
        Flag
      </span>
    )
  }
  return (
    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
      Ok
    </span>
  )
}

function railClass({ quarantined, anomaly }) {
  if (quarantined) return 'bg-slate-500'
  if (anomaly) return 'bg-rose-500'
  return 'bg-emerald-500/80'
}

export default function EndpointTable({ rows = [], sparkDomain = [-10, 20], filterId, onSelect }) {
  const ordered = [...rows].sort((a, b) => {
    const rank = (r) => (r.quarantined ? 2 : r.anomaly ? 1 : 0)
    return rank(b) - rank(a)
  })

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/70 dark:border-white/10 dark:bg-slate-950/50">
      <div className="flex items-end justify-between gap-2 border-b border-slate-200/60 px-4 py-3 dark:border-white/10">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Endpoint fleet
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            PPS is idle city load for this hour. Trend is change vs that expected load.
          </p>
        </div>
        <span className="font-mono text-sm tabular-nums text-slate-500">{rows.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              <th className="px-3 py-2 pl-4">Node</th>
              <th className="px-3 py-2">Type</th>
              {METRIC_KEYS.map((m) => (
                <th key={m.key} className="px-3 py-2 text-right">
                  {m.short}
                </th>
              ))}
              <th className="px-3 py-2">Trend vs expected</th>
              <th className="px-3 py-2 pr-4">State</th>
            </tr>
          </thead>
          <tbody>
            {ordered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center font-mono text-xs text-slate-400">
                  No infrastructure nodes in this room yet
                </td>
              </tr>
            ) : (
              ordered.map((row) => {
                const selected = filterId === row.id
                const sparkColor = row.anomaly ? '#fb7185' : '#22d3ee'
                return (
                  <tr
                    key={row.id}
                    className={[
                      'cursor-pointer border-t border-slate-200/40 dark:border-white/5',
                      selected
                        ? 'bg-cyan-500/10'
                        : row.anomaly
                          ? 'bg-rose-500/[0.06]'
                          : 'hover:bg-slate-50/80 dark:hover:bg-white/[0.03]',
                    ].join(' ')}
                    onClick={() => onSelect?.(row.id)}
                  >
                    <td className="relative px-3 py-2 pl-4 font-medium text-slate-900 dark:text-slate-100">
                      <span
                        className={`absolute inset-y-0 left-0 w-0.5 ${railClass(row)}`}
                      />
                      {row.label}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded border border-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-500 dark:border-white/10">
                        {row.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {fmt(row.pps)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {fmt(row.http)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {fmt(row.files)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {fmt(row.logins)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Sparkline data={row.spark} color={sparkColor} yDomain={sparkDomain} />
                        <span
                          className={[
                            'font-mono text-[10px] tabular-nums',
                            row.ppsVsExpected == null || Math.round(row.ppsVsExpected) === 0
                              ? 'text-slate-500'
                              : row.ppsVsExpected > 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-500',
                          ].join(' ')}
                        >
                          {fmtSignedPct(row.ppsVsExpected)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 pr-4">
                      <StatusBadge quarantined={row.quarantined} anomaly={row.anomaly} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
