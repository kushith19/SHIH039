export default function Toolbar({ children, trailing = null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  )
}

export function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      className="rounded-md px-3 py-1.5 text-sm font-medium"
      style={
        active
          ? { background: 'var(--tn-ink)', color: 'var(--tn-ink-fg)' }
          : { background: 'var(--tn-elevated)', color: 'var(--tn-muted)' }
      }
      onClick={onClick}
    >
      {children}
    </button>
  )
}
