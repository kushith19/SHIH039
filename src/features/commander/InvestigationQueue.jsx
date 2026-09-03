export default function InvestigationQueue({ steps = [] }) {
  const rows = Array.isArray(steps) ? steps : []
  return (
    <section className="tn-surface px-5 py-5">
      <h2 className="tn-section-title">Investigation queue</h2>
      {rows.length === 0 ? (
        <p className="tn-meta mt-3">No investigation steps in this briefing.</p>
      ) : (
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          {rows.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </section>
  )
}
