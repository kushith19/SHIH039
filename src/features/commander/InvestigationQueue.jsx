export default function InvestigationQueue({ steps = [] }) {
  const rows = Array.isArray(steps) ? steps : []
  return (
    <section className="soc-zone px-5 py-4">
      <h2 className="soc-zone-title">Investigation queue</h2>
      {rows.length === 0 ? (
        <p className="tn-meta mt-2">No investigation steps in this briefing.</p>
      ) : (
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">
          {rows.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </section>
  )
}
