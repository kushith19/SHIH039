const TONE = {
  info: { color: 'var(--tn-text)', bar: 'var(--tn-info)' },
  warn: { color: 'var(--tn-text)', bar: 'var(--tn-warn)' },
  crit: { color: 'var(--tn-crit)', bar: 'var(--tn-crit)' },
}

export default function Banner({ tone = 'info', children }) {
  const t = TONE[tone] || TONE.info
  return (
    <div
      className="flex overflow-hidden rounded-lg bg-[var(--tn-surface)]"
      style={{ boxShadow: 'inset 3px 0 0 ' + t.bar }}
    >
      <p className="px-4 py-3 text-sm leading-relaxed" style={{ color: t.color }}>
        {children}
      </p>
    </div>
  )
}
