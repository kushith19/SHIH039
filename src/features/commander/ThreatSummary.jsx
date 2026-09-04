export default function ThreatSummary({
  assessment,
  knowledgeStatus,
  campaignId,
  embedded = false,
}) {
  const sev = String(assessment?.severity ?? 'low')
  const conf = assessment?.confidence
  const confPct = conf == null ? '—' : `${Math.round(Number(conf) * 100)}%`
  const body = (
    <>
      <div className="soc-zone-title">Threat assessment</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <span className="text-xl font-medium capitalize">{sev} risk</span>
        <span className="text-sm text-[var(--tn-muted)]">Confidence {confPct}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">
        {assessment?.summary || 'Waiting for a promoted detection.'}
      </p>
      <p className="tn-meta mt-2 text-[11px]">
        {campaignId ? `History campaign: ${campaignId}` : 'No history campaign link'}
        {' · '}
        {String(knowledgeStatus ?? 'unavailable') === 'success'
          ? 'Knowledge retrieval: available'
          : 'Knowledge retrieval: degraded'}
      </p>
    </>
  )
  if (embedded) {
    return <div className="px-5 py-4">{body}</div>
  }
  return <section className="soc-zone px-5 py-4">{body}</section>
}
