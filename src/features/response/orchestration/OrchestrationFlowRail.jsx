import StatusBadge from '../../../ui/StatusBadge'

/**
 * Persistent left workflow rail — presentation only.
 * Step phases come from orchestrationFlowRailView (server status derived).
 */
export default function OrchestrationFlowRail({
  rail = null,
  selectedStepId = 'commander',
  onSelectStep = null,
}) {
  const steps = rail?.steps ?? []

  return (
    <nav
      className="flex w-full shrink-0 flex-col md:w-[13.5rem] lg:w-[15rem]"
      aria-label="Orchestration workflow"
    >
      <ol className="space-y-0">
        {steps.map((step, index) => {
          const selected = selectedStepId === step.id
          const connectorTone =
            step.phase === 'completed'
              ? 'bg-[var(--tn-ok)]/50'
              : step.phase === 'failed'
                ? 'bg-[var(--tn-crit)]/40'
                : 'bg-[var(--tn-line)]'

          return (
            <li key={step.id} className="relative">
              {index > 0 ? (
                <div
                  className={`mx-[1.15rem] h-3 w-px ${connectorTone}`}
                  aria-hidden
                />
              ) : null}
              <button
                type="button"
                onClick={() => onSelectStep?.(step.id)}
                aria-current={selected ? 'step' : undefined}
                className={[
                  'flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors',
                  selected
                    ? 'border-[var(--tn-select)] bg-[var(--tn-surface)]'
                    : step.ownsFocus
                      ? 'border-[var(--tn-select)]/50 bg-[var(--tn-surface)]/90'
                      : 'border-[var(--tn-line)] bg-[var(--tn-surface)]/50 hover:border-[var(--tn-muted)]',
                ].join(' ')}
              >
                <span
                  className={[
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                    step.phase === 'active' || step.ownsFocus
                      ? 'bg-[var(--tn-select)] text-[var(--tn-ink-fg)]'
                      : step.phase === 'completed'
                        ? 'bg-[var(--tn-ok)]/20 text-[var(--tn-ok)]'
                        : step.phase === 'failed'
                          ? 'bg-[var(--tn-crit)]/15 text-[var(--tn-crit)]'
                          : 'bg-[var(--tn-elevated)] text-[var(--tn-muted)]',
                  ].join(' ')}
                  aria-hidden
                >
                  {step.phase === 'completed'
                    ? '✓'
                    : step.phase === 'failed'
                      ? '!'
                      : step.index}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--tn-text)]">
                    {step.label}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={step.tone}>{step.statusLabel}</StatusBadge>
                    {step.ownsFocus ? (
                      <StatusBadge tone="warn">Now</StatusBadge>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
