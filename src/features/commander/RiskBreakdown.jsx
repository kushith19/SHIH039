function Row({ label, value, note }) {
  return (
    <div className="px-4 py-3">
      <div className="tn-label">{label}</div>
      <div className="mt-0.5 font-mono text-base tabular-nums">{value == null ? '—' : value}</div>
      {note ? <p className="tn-meta mt-0.5 text-[11px]">{note}</p> : null}
    </div>
  )
}

export default function RiskBreakdown({ risk, compact = false }) {
  const r = risk ?? {}
  return (
    <section className="soc-zone overflow-hidden">
      <div className={compact ? 'px-4 pt-3' : 'px-5 pt-4'}>
        <h2 className="soc-zone-title">Risk decomposition</h2>
        <p className="tn-meta mt-1 text-[11px]">
          Residual, trust, and criticality — not an LLM score.
        </p>
      </div>
      <div className="mt-1 grid grid-cols-2 sm:grid-cols-3">
        <Row label="Overall" value={r.overall != null ? `${r.overall}/100` : null} />
        <Row label="Behavioral" value={r.behavioral} note="Max |deviationPct| or residual" />
        <Row label="Graph residual" value={r.graph} />
        <Row label="Peer trust" value={r.trust} note="Observed trust (low is worse)" />
        <Row label="Criticality" value={r.criticality} />
      </div>
    </section>
  )
}
