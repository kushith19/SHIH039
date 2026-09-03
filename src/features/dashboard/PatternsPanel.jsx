function timeAgo(ms) {
  const t = Number(ms)
  if (!Number.isFinite(t) || t <= 0) return '—'
  const delta = Math.max(0, Date.now() - t)
  const sec = Math.round(delta / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  return `${hr}h ago`
}

export default function PatternsPanel({ patterns = [] }) {
  return (
    <section className="tn-surface overflow-hidden">
      <div className="border-b border-[var(--tn-line)] px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="tn-label">Attack patterns</div>
            <p className="mt-0.5 text-xs text-[var(--tn-muted)]">
              Stored when a campaign repeats a signature
            </p>
          </div>
          <span className="font-mono text-lg tabular-nums">{patterns.length}</span>
        </div>
      </div>
      <div>
        {patterns.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--tn-muted)]">
            No patterns in the database yet. Complete two campaign stages with detections.
          </p>
        ) : (
          <ul>
            {patterns.map((p) => (
              <li key={p.fingerprint} className="border-b border-[var(--tn-line)] px-4 py-3 last:border-b-0">
                <div className="text-sm font-medium">{p.title || p.fingerprint}</div>
                <p className="mt-0.5 font-mono text-xs text-[var(--tn-muted)]">
                  hits {p.hitCount ?? 1} · {timeAgo(p.lastSeenMs)}
                </p>
                {Array.isArray(p.signature?.stages) && p.signature.stages.length > 0 ? (
                  <p className="mt-0.5 text-sm text-[var(--tn-muted)]">
                    {p.signature.stages.join(' → ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
