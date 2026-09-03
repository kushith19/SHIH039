export default function Stat({
  label,
  value,
  hint,
  hot = false,
  muted = false,
  pip = null,
  extra = null,
}) {
  return (
    <div className="min-w-0 px-5 py-5">
      <div className="tn-label">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        {pip ? <span className="tn-pip" style={{ background: pip }} /> : null}
        <div
          className="truncate font-mono text-[1.375rem] font-medium leading-7 tabular-nums"
          style={{
            color: hot ? 'var(--tn-crit)' : muted ? 'var(--tn-muted)' : 'var(--tn-text)',
          }}
        >
          {value}
        </div>
      </div>
      {hint ? <p className="tn-meta mt-1 truncate">{hint}</p> : null}
      {extra}
    </div>
  )
}
