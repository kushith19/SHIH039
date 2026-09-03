import ResponseStep from './ResponseStep'

export default function ResponsePlan({ steps = [] }) {
  const rows = Array.isArray(steps) ? steps : []
  return (
    <section className="tn-surface overflow-hidden px-5 py-5">
      <h2 className="tn-section-title">Response plan</h2>
      <p className="tn-meta mt-1">
        Advisory only. Every step passed OT/ICS safety checks. Commander does not actuate infrastructure.
      </p>
      {rows.length === 0 ? (
        <p className="tn-meta mt-4">No response plan yet.</p>
      ) : (
        <ul className="mt-2">
          {rows.map((step, i) => (
            <ResponseStep key={`${step.phase}-${i}`} step={step} />
          ))}
        </ul>
      )}
    </section>
  )
}
