const TONE = {
  ok: 'tn-badge tn-badge-ok',
  warn: 'tn-badge tn-badge-warn',
  crit: 'tn-badge tn-badge-crit',
  muted: 'tn-badge',
}

export default function StatusBadge({ tone = 'muted', children }) {
  return <span className={TONE[tone] || TONE.muted}>{children}</span>
}
