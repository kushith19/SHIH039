export default function ThreatSummary({ assessment, knowledgeStatus, campaignId }) {
  const sev = String(assessment?.severity ?? 'low')
  const conf = assessment?.confidence
  const confPct = conf == null ? '—' : `${Math.round(Number(conf) * 100)}%`
  return (
    <section className="tn-surface px-5 py-5">
      <div className="tn-label">Threat assessment</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <span className="text-xl font-medium capitalize">{sev} risk</span>
        <span className="text-sm text-[var(--tn-muted)]">Confidence {confPct}</span>
      </div>
      <p className="mt-3 text-sm leading-relaxed">
        {assessment?.summary || 'Waiting for a promoted detection.'}
      </p>
      <p className="tn-meta mt-3">
        {campaignId ? `History campaign: ${campaignId}` : 'No history campaign link'}
        {' · '}
        {String(knowledgeStatus ?? 'unavailable') === 'success'
          ? 'Knowledge retrieval: available'
          : 'Knowledge retrieval: degraded'}
      </p>
    </section>
  )
}
