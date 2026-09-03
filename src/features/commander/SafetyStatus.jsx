export default function SafetyStatus({ status }) {
  const s = String(status ?? 'approved')
  return (
    <span className="tn-badge">
      {s === 'dropped' ? 'dropped unsafe' : s === 'corrected' ? 'safety corrected' : 'safety approved'}
    </span>
  )
}
