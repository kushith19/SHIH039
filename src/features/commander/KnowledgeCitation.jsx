export default function KnowledgeCitation({ citations = [], knowledgeStatus }) {
  const rows = Array.isArray(citations) ? citations : []
  const ok = String(knowledgeStatus).toLowerCase() === 'success'
  return (
    <section className="soc-zone px-5 py-4">
      <h2 className="soc-zone-title">Sources</h2>
      {!ok ? (
        <p className="tn-meta mt-2 leading-relaxed">
          Knowledge retrieval: degraded. Assessment continues using observed telemetry and graph
          evidence. Optional corpus ingest is required for NIST / MITRE / CERT-In citations.
        </p>
      ) : rows.length === 0 ? (
        <p className="tn-meta mt-2">No citations attached.</p>
      ) : (
        <ul className="tn-meta mt-2 space-y-1.5 text-[12px]">
          {rows.map((c, i) => (
            <li key={i}>
              {c.document || c.source || 'Retrieved guidance'}
              {c.section ? ` · ${c.section}` : ''}
              {c.page != null ? ` · p.${c.page}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
