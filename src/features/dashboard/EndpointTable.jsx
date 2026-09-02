import { fmt, fmtSignedPct, METRIC_KEYS } from './metrics'

function Sparkline({ data = [], color = 'var(--tn-text)', yDomain = [-10, 20] }) {
  if (!data.length) return <span className="font-mono text-xs text-[var(--tn-muted)]">—</span>
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
      <polyline fill="none" stroke={color} strokeWidth="1.25" points={pts} />
    </svg>
  )
}

function StatusBadge({ quarantined, anomaly }) {
  if (quarantined) {
    return <span className="tn-badge">Hold</span>
  }
  if (anomaly) {
    return (
      <span className="tn-badge" style={{ color: 'var(--tn-crit)', borderColor: 'var(--tn-crit)' }}>
        Flag
      </span>
    )
  }
  return (
    <span className="tn-badge" style={{ color: 'var(--tn-ok)', borderColor: 'var(--tn-ok)' }}>
      Ok
    </span>
  )
}

function railClass({ quarantined, anomaly }) {
  if (quarantined) return 'bg-[var(--tn-muted)]'
  if (anomaly) return 'bg-[var(--tn-crit)]'
  return 'bg-[var(--tn-ok)]'
}

export default function EndpointTable({ rows = [], sparkDomain = [-10, 20], filterId, onSelect }) {
  const ordered = [...rows].sort((a, b) => {
    const rank = (r) => (r.quarantined ? 2 : r.anomaly ? 1 : 0)
    return rank(b) - rank(a)
  })

  return (
    <section className="tn-surface overflow-hidden">
      <div className="flex items-end justify-between gap-2 border-b border-[var(--tn-line)] px-4 py-2.5">
        <div>
          <div className="tn-label">Endpoint fleet</div>
          <p className="mt-0.5 text-xs text-[var(--tn-muted)]">
            PPS is idle city load for this hour. Trend is change vs that expected load.
          </p>
        </div>
        <span className="font-mono text-sm tabular-nums text-[var(--tn-muted)]">{rows.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left font-mono text-xs font-medium uppercase tracking-wide text-[var(--tn-muted)]">
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
                <td colSpan={8} className="px-4 py-8 text-center font-mono text-xs text-[var(--tn-muted)]">
                  No infrastructure nodes in this room yet
                </td>
              </tr>
            ) : (
              ordered.map((row) => {
                const selected = filterId === row.id
                const sparkColor = row.anomaly ? 'var(--tn-crit)' : 'var(--tn-text)'
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-[var(--tn-line)]"
                    style={
                      selected
                        ? { background: 'var(--tn-select-bg)' }
                        : row.anomaly
                          ? { background: 'rgba(220, 38, 38, 0.05)' }
                          : undefined
                    }
                    onClick={() => onSelect?.(row.id)}
                  >
                    <td className="relative px-3 py-2 pl-4 font-medium">
                      <span className={`absolute inset-y-0 left-0 w-0.5 ${railClass(row)}`} />
                      {row.label}
                    </td>
                    <td className="px-3 py-2">
                      <span className="tn-badge">{row.type}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                      {fmt(row.pps)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                      {fmt(row.http)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                      {fmt(row.files)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                      {fmt(row.logins)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Sparkline data={row.spark} color={sparkColor} yDomain={sparkDomain} />
                        <span
                          className="font-mono text-xs tabular-nums"
                          style={{
                            color:
                              row.ppsVsExpected == null || Math.round(row.ppsVsExpected) === 0
                                ? 'var(--tn-muted)'
                                : row.ppsVsExpected > 0
                                  ? 'var(--tn-crit)'
                                  : 'var(--tn-muted)',
                          }}
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
