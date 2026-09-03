import { STORY_ACT_META } from '@shared/storyExperience.js'

export default function StoryActView({ act, onSelectEndpoint }) {
  if (!act) return null
  const meta = STORY_ACT_META[act.id] || {}

  return (
    <div>
      <div className="font-mono text-sm tabular-nums text-[var(--tn-muted)]">
        {meta.n} · {act.clock}
      </div>
      <h2 className="mt-2 text-2xl font-medium tracking-tight">{act.title}</h2>
      <p className="tn-meta mt-1">{act.kicker}</p>
      <p className="mt-4 max-w-xl text-sm leading-relaxed">{act.body}</p>

      {act.id === 'origin' && act.entity ? (
        <button
          type="button"
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-[var(--tn-elevated)] px-3 py-2 text-left text-sm font-medium"
          onClick={() => act.pathIds?.[0] && onSelectEndpoint?.(act.pathIds[0])}
        >
          <span className="tn-pip" style={{ background: 'var(--tn-crit)' }} />
          {act.entity}
          {act.caption ? (
            <span className="font-normal text-[var(--tn-muted)]">{act.caption}</span>
          ) : null}
        </button>
      ) : null}

      {act.id === 'detect' ? (
        <ol className="mt-5 space-y-2 text-sm">
          <li className="text-[var(--tn-muted)]">Expected idle-window context</li>
          <li className="pl-4 text-[var(--tn-muted)]">↓ Deviation from baseline</li>
          <li className="pl-4 font-medium">
            Residual flag
            {act.residualPct != null ? ` · ${act.residualPct}%` : ''}
            {act.trust != null ? ` · trust ${act.trust}` : ''}
          </li>
        </ol>
      ) : null}

      {act.id === 'risk' ? (
        <ol className="mt-5 space-y-2 text-sm">
          <li className="text-[var(--tn-muted)]">Isolated residual</li>
          <li className="pl-4 font-medium">
            Impact {act.impact}
            {act.financialExposed ? ` · ${act.financialExposed} finance-tagged (illustrative)` : ''}
          </li>
        </ol>
      ) : null}
    </div>
  )
}
