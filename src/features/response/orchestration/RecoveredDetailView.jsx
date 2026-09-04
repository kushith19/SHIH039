/**
 * Episode recovered — only when server status is RECOVERED.
 */
export default function RecoveredDetailView({
  newCycleEnabled = false,
  busy = null,
  onNewCycle = null,
  verifyView = null,
}) {
  return (
    <div className="space-y-4">
      <header>
        <h3 className="tn-section-title tracking-wide">Episode complete</h3>
        <p className="tn-meta mt-1">
          The response episode is recovered only when the server reports
          RECOVERED — no active non-quarantined response incidents remain.
        </p>
      </header>

      <div className="rounded-md border border-[var(--tn-ok)]/40 bg-[var(--tn-surface)] px-3 py-3">
        <p className="text-sm text-[var(--tn-text)]">
          ✓ Episode recovered. Quarantine held ≠ auto-restored. Start a new
          cycle only for a completely new response episode.
        </p>
        {verifyView?.title ? (
          <p className="tn-meta mt-2">Last verification: {verifyView.title}</p>
        ) : null}
        <button
          type="button"
          className="tn-btn-primary mt-3"
          disabled={!newCycleEnabled}
          onClick={() => onNewCycle?.()}
        >
          {busy === 'new-cycle' ? 'Starting…' : 'Start New Response Cycle'}
        </button>
      </div>
    </div>
  )
}
