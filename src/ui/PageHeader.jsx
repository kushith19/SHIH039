export default function PageHeader({ title, subtitle, actions = null, children }) {
  return (
    <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-[var(--tn-line)] bg-[var(--tn-surface)] px-4 py-3.5 md:px-6">
      <div className="min-w-0 max-w-3xl">
        <h1 className="tn-page-title text-[1.25rem] leading-7">{title}</h1>
        {subtitle ? <p className="tn-meta mt-1 max-w-2xl text-[13px]">{subtitle}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
