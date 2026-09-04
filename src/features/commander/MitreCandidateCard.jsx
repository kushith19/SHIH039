export default function MitreCandidateCard({ candidates = [] }) {
  const rows = Array.isArray(candidates) ? candidates : []
  return (
    <section className="soc-zone overflow-hidden px-5 py-4">
      <h2 className="soc-zone-title">Candidate techniques</h2>
      <p className="tn-meta mt-1 text-[11px]">
        MITRE ATT&CK ids from the catalog or retrieved guidance — not proof of execution
      </p>
      {rows.length === 0 ? (
        <p className="tn-meta mt-3">No technique candidates on this briefing.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--tn-line)]">
          {rows.map((c, i) => (
            <li key={`${c.techniqueId || c.technique_id}-${i}`} className="py-3 first:pt-0 last:pb-0">
              <div className="font-mono text-sm">{c.techniqueId || c.technique_id}</div>
              {c.tactic ? <div className="tn-meta mt-0.5 text-[11px]">{c.tactic}</div> : null}
              <p className="tn-meta mt-1.5 text-[12px]">
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
