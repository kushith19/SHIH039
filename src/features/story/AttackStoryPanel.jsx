import { chapterOf } from '@shared/attackStory.js'

function NodeLink({ node, onSelect }) {
  if (!node?.id) return <span>{node?.label || '—'}</span>
  return (
    <button
      type="button"
      className="text-left font-medium hover:underline"
      onClick={() => onSelect?.(node.id)}
    >
      {node.label || node.id}
    </button>
  )
}

function PathChain({ path = [], onSelect }) {
  const nodes = Array.isArray(path) ? path : []
  if (nodes.length === 0) return null
  return (
    <div className="mt-3 font-mono text-sm leading-relaxed">
      {nodes.map((n, i) => (
        <div key={n.id || `${n.label}-${i}`}>
          <NodeLink node={n} onSelect={onSelect} />
          {i < nodes.length - 1 ? (
            <div className="py-1 pl-4 text-[var(--tn-muted)]" aria-hidden>
              ↓
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ChapterFrame({ chapter, children }) {
  return (
    <article className="tn-surface flex min-h-[12rem] flex-col p-4">
      <div className="tn-label">{chapter.title}</div>
      <div className="mt-1 font-mono text-sm tabular-nums text-[var(--tn-muted)]">
        {chapter.clock}
      </div>
      <div className="mt-1 min-h-0 flex-1">{children}</div>
    </article>
  )
}

function OriginBody({ chapter, onSelect }) {
  return (
    <>
      <PathChain path={chapter.path} onSelect={onSelect} />
      {chapter.caption ? (
        <p className="mt-3 text-sm text-[var(--tn-muted)]">{chapter.caption}</p>
      ) : null}
    </>
  )
}

function DetectBody({ chapter }) {
  const tgnn =
    chapter.tgnn == null || !Number.isFinite(Number(chapter.tgnn))
      ? '—'
      : Number(chapter.tgnn).toFixed(2)
  const trust =
    chapter.trust == null || !Number.isFinite(Number(chapter.trust))
      ? '—'
      : String(Math.round(Number(chapter.trust)))
  return (
    <div className="mt-3 space-y-1.5 font-mono text-sm tabular-nums">
      <div>{chapter.detectionLabel || 'Behavioural anomaly'}</div>
      <div>TGNN: {tgnn}</div>
      <div>Trust: {trust}</div>
    </div>
  )
}

function RiskBody({ chapter }) {
  return (
    <div className="mt-3 space-y-1.5 font-mono text-sm tabular-nums">
      <div>Risk Momentum: {chapter.momentum || '→'}</div>
      <div>Potential Impact: {chapter.impact || 'LOW'}</div>
      <div>Financial systems exposed: {chapter.financialExposed ?? 0}</div>
    </div>
  )
}

function CommanderBody({ chapter }) {
  const pending = chapter.status === 'pending'
  return (
    <blockquote className="mt-3 border-l-2 border-[var(--tn-line)] pl-3 text-sm leading-relaxed">
      {pending && !chapter.text ? (
        <span className="text-[var(--tn-muted)]">Generating narrative…</span>
      ) : (
        chapter.text || 'No narrative yet.'
      )}
    </blockquote>
  )
}

export default function AttackStoryPanel({ story, onSelectEndpoint }) {
  const chapters = Array.isArray(story?.chapters) ? story.chapters : []
  const clock = chapters[chapters.length - 1]?.clock
  const detect = chapterOf(story, 'detect')

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="tn-label">Attack story</div>
          <div className="mt-0.5 text-lg font-medium">{story?.title || 'Live detection'}</div>
          <p className="mt-0.5 font-mono text-sm text-[var(--tn-muted)]">
            {chapters.length === 0
              ? 'No active story — waiting for a detection'
              : `${clock ? `last beat ${clock}` : 'unfolding'}${
                  detect?.detectionLabel ? ` · ${detect.detectionLabel}` : ''
                }`}
          </p>
        </div>
        {chapters.length > 0 ? (
          <span className="shrink-0 font-mono text-xs uppercase tabular-nums text-[var(--tn-muted)]">
            {story?.status || 'live'}
          </span>
        ) : null}
      </div>
      {chapters.length === 0 ? (
        <div className="tn-surface px-5 py-10 text-center text-sm text-[var(--tn-muted)]">
          The timeline appears here when TGNN flags a node or a campaign is correlated.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {chapters.map((ch) => (
            <ChapterFrame key={ch.id} chapter={ch}>
              {ch.kind === 'origin' ? (
                <OriginBody chapter={ch} onSelect={onSelectEndpoint} />
              ) : null}
              {ch.kind === 'detect' ? <DetectBody chapter={ch} /> : null}
              {ch.kind === 'lateral' ? (
                <PathChain path={ch.path} onSelect={onSelectEndpoint} />
              ) : null}
              {ch.kind === 'risk' ? <RiskBody chapter={ch} /> : null}
              {ch.kind === 'commander' ? <CommanderBody chapter={ch} /> : null}
            </ChapterFrame>
          ))}
        </div>
      )}
    </section>
  )
}
