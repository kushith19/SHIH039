/**
 * Replan handoff — same workflow rail; Commander becomes active again.
 */
export default function ReplanDetailView({
  handoff = null,
  evolution = null,
  replanEnabled = false,
  busy = null,
  onReplan = null,
}) {
  return (
    <div className="space-y-4">
      <header>
        <h3 className="tn-section-title tracking-wide">Replan handoff</h3>
        <p className="tn-meta mt-1">
          Verification failed. The workflow returns to Commander on the same
          rail — not a second tree. A new plan still requires human approval.
        </p>
      </header>

      <div className="rounded-md border border-[var(--tn-crit)]/40 bg-[var(--tn-surface)] px-3 py-3">
        <p className="text-sm text-[var(--tn-text)]">Verification ✕</p>
        <p className="tn-meta mt-1">
          Reason: {handoff?.failureReason || 'Verification failed'}
        </p>
        <div className="my-2 text-[var(--tn-muted)]" aria-hidden>
          ↓
        </div>
        <p className="text-sm font-medium text-[var(--tn-text)]">
          Commander Agent · re-analysis available
        </p>
        {handoff?.commanderMessage ? (
          <p className="tn-meta mt-1">{handoff.commanderMessage}</p>
        ) : null}
        {handoff?.previousPlanId ? (
          <p className="tn-meta mt-2">
            Previous plan: {handoff.previousPlanId}
            {evolution?.planNumber
              ? ` → next plan #${evolution.planNumber}`
              : ''}
          </p>
        ) : null}
        <button
          type="button"
          className="tn-btn-primary mt-3"
          disabled={!replanEnabled}
          onClick={() => onReplan?.()}
        >
          {busy === 'replan' ? 'Re-planning…' : 'Run Commander Re-analysis'}
        </button>
      </div>

      {!evolution?.empty ? (
        <div>
          <div className="tn-label">Response journey</div>
          <p className="tn-meta mt-1 mb-2">
            Adaptive plan history · re-plan count {evolution.replanCount}
          </p>
          <ol className="space-y-3">
            {(evolution.entries || []).map((entry) => (
              <li key={`${entry.planId}-${entry.index}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--tn-text)]">
                  <span className="font-medium">Plan #{entry.index}</span>
                  {entry.isCurrent ? (
                    <span className="tn-meta">current</span>
                  ) : null}
                </div>
                <p className="tn-meta text-[11px]">
                  {(entry.executableActionIds || []).join(', ') || '—'}
                  {entry.targets?.length ? ` · ${entry.targets.join(', ')}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}
