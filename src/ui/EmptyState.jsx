export default function EmptyState({ icon = null, title, body, action = null }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon ? <div className="mb-4 text-[var(--tn-muted)]">{icon}</div> : null}
      {title ? <p className="tn-section-title">{title}</p> : null}
      {body ? <p className="tn-meta mt-2 max-w-md">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
