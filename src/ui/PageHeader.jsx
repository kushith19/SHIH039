export default function PageHeader({ title, subtitle, actions = null, children }) {
  return (
    <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b border-[var(--tn-line)] bg-[var(--tn-surface)] px-5 py-5 md:px-8">
      <div className="min-w-0 max-w-3xl">
        <h1 className="tn-page-title">{title}</h1>
        {subtitle ? <p className="tn-meta mt-1.5 max-w-2xl">{subtitle}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
