import { formatEvidenceItem } from '@shared/incidents.js'
import EmptyState from '../../ui/EmptyState'

export default function EvidenceCards({ incidents = [], compact = false }) {
  const cards = (incidents ?? []).slice(0, 6).flatMap((inc) =>
    (inc.evidence ?? []).slice(0, 2).map((ev, i) => ({
      key: `${inc.id}-${i}`,
      title: inc.endpointLabel || inc.endpointId,
      line: formatEvidenceItem(ev),
    }))
  )
  const shown = cards.slice(0, compact ? 4 : 3)
  return (
    <section className="soc-zone overflow-hidden">
      <div className="border-b border-[var(--tn-line)] px-4 py-3">
        <h2 className="soc-zone-title">Level-1 evidence</h2>
        <p className="tn-meta mt-1 text-[11px]">Observed facts from promoted detections</p>
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No Level-1 evidence cards yet." />
      ) : (
        <ul className="divide-y divide-[var(--tn-line)]">
          {shown.map((c) => (
            <li key={c.key} className="px-4 py-3">
              <div className="text-sm font-medium">{c.title}</div>
              <p className="tn-meta mt-1 leading-relaxed text-[12px]">{c.line}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
