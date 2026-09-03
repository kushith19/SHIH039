export default function StoryStatusStrip({
  severity = 'LOW',
  residualPct = null,
  trust = null,
  source = 'live',
}) {
  const items = [
    { label: 'Severity', value: severity },
    { label: 'Residual', value: residualPct == null ? '—' : `${residualPct}%` },
    { label: 'Trust', value: trust == null ? '—' : `${trust} / 100` },
  ]
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-[var(--tn-line)] pt-4">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="tn-label">{item.label}</dt>
          <dd className="mt-0.5 font-mono text-sm tabular-nums">
            {item.value}
            {item.label === 'Severity' && source === 'illustrative' ? (
              <span className="ml-2 text-[var(--tn-muted)]">sample</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}
