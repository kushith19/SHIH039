import ResponseStep from './ResponseStep'

export default function ResponsePlan({ steps = [] }) {
  const rows = Array.isArray(steps) ? steps : []
  return (
    <section className="soc-zone overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--tn-line)] px-5 py-3">
        <div>
          <h2 className="soc-zone-title">Response plan</h2>
          <p className="tn-meta mt-1 text-[11px]">
            Advisory only. OT/ICS safety-checked. Does not actuate infrastructure.
          </p>
        </div>
        <span className="soc-role-chip soc-role-advisory">Advisory</span>
      </div>
      {rows.length === 0 ? (
        <p className="tn-meta px-5 py-4">No response plan yet.</p>
      ) : (
        <ul className="px-5">
          {rows.map((step, i) => (
            <ResponseStep key={`${step.phase}-${i}`} step={step} />
          ))}
        </ul>
      )}
    </section>
  )
}
