import { formatEvidenceItem } from '@shared/incidents.js'
import EmptyState from '../../ui/EmptyState'

export default function EvidenceCards({ incidents = [] }) {
  const cards = (incidents ?? []).slice(0, 6).flatMap((inc) =>
    (inc.evidence ?? []).slice(0, 2).map((ev, i) => ({
      key: `${inc.id}-${i}`,
      title: inc.endpointLabel || inc.endpointId,
      line: formatEvidenceItem(ev),
    }))
  )
  return (
    <section>
      <h2 className="tn-section-title mb-4">Why this matters</h2>
      {cards.length === 0 ? (
        <div className="tn-surface">
          <EmptyState title="No Level-1 evidence cards yet." />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {cards.slice(0, 3).map((c) => (
            <article key={c.key} className="tn-surface px-5 py-5">
              <div className="text-sm font-medium">{c.title}</div>
              <p className="tn-meta mt-2 leading-relaxed">{c.line}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
