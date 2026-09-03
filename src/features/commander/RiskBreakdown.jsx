function Row({ label, value, note }) {
  return (
    <div className="px-5 py-4">
      <div className="tn-label">{label}</div>
      <div className="mt-1 font-mono text-lg tabular-nums">{value == null ? '—' : value}</div>
      {note ? <p className="tn-meta mt-1">{note}</p> : null}
    </div>
  )
}

export default function RiskBreakdown({ risk }) {
  const r = risk ?? {}
  return (
    <section className="tn-surface overflow-hidden">
      <div className="px-5 pt-5">
        <h2 className="tn-section-title">Risk decomposition</h2>
        <p className="tn-meta mt-1">
          Composed from residual, trust, and criticality — not an LLM score.
        </p>
      </div>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3">
        <Row label="Overall" value={r.overall != null ? `${r.overall}/100` : null} />
        <Row label="Behavioral" value={r.behavioral} note="Max |deviationPct| or residual" />
        <Row label="Graph residual" value={r.graph} />
        <Row label="Peer trust" value={r.trust} note="Observed trust (low is worse)" />
        <Row label="Criticality" value={r.criticality} />
      </div>
    </section>
  )
}
