export default function StoryBriefing({ briefing, commanderStatus, source }) {
  if (!briefing) return null
  return (
    <section className="border-t border-[var(--tn-line)] pt-6">
      <div className="tn-label">AI Commander</div>
      <h2 className="tn-section-title mt-1">Security assessment</h2>
      <p className="tn-meta mt-1">
        {source === 'illustrative'
          ? 'Illustrative briefing · not live telemetry'
          : commanderStatus === 'pending'
            ? 'Generating narrative… · ungrounded restatement · no RAG'
            : 'Assessment · no RAG on the live explain path'}
      </p>
      <div className="mt-5 grid gap-6 md:grid-cols-3">
        <div>
          <h3 className="text-sm font-medium">What happened</h3>
          <p className="mt-2 text-sm leading-relaxed">{briefing.what}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium">Why it matters</h3>
          <p className="mt-2 text-sm leading-relaxed">{briefing.why}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium">Recommended action</h3>
          <p className="mt-2 text-sm leading-relaxed">{briefing.action}</p>
        </div>
      </div>
    </section>
  )
}
