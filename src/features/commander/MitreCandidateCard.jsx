export default function MitreCandidateCard({ candidates = [] }) {
  const rows = Array.isArray(candidates) ? candidates : []
  return (
    <section className="tn-surface overflow-hidden px-5 py-5">
      <h2 className="tn-section-title">Candidate techniques</h2>
      <p className="tn-meta mt-1">
        MITRE ATT&CK ids from the catalog or retrieved guidance — not proof of execution
      </p>
      {rows.length === 0 ? (
        <p className="tn-meta mt-4">No technique candidates on this briefing.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--tn-line)]">
          {rows.map((c, i) => (
            <li key={`${c.techniqueId || c.technique_id}-${i}`} className="py-4 first:pt-0 last:pb-0">
              <div className="font-mono text-sm">{c.techniqueId || c.technique_id}</div>
              {c.tactic ? <div className="tn-meta mt-0.5">{c.tactic}</div> : null}
              <p className="tn-meta mt-2">
                {c.reason || 'Candidate — requires verification'}
                {c.confidence != null ? ` · conf ${Math.round(Number(c.confidence) * 100)}%` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
