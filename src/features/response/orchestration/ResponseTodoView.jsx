import StatusBadge from '../../../ui/StatusBadge'

/**
 * Live Response Agent TODO — ticks only from real execution.results / derived workflow markers.
 */
export default function ResponseTodoView({
  todo = null,
  ownership = null,
  liveProgress = false,
  liveMessage = null,
}) {
  const items = todo?.items ?? []

  return (
    <div className="space-y-4">
      <header>
        <h3 className="tn-section-title tracking-wide">Response Agent</h3>
        <p className="tn-meta mt-1">
          Executes the approved plan for the selected incident. During dummy
          execution, each approved action is shown as it completes.
        </p>
      </header>

      {ownership?.headline ? (
        <div className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-surface)] px-3 py-2">
          <p className="text-sm font-medium text-[var(--tn-text)]">{ownership.headline}</p>
          {ownership.detail ? (
            <p className="tn-meta mt-0.5">{ownership.detail}</p>
          ) : null}
        </div>
      ) : null}

      {liveProgress ? (
        <p className="text-sm text-[var(--tn-text)]" aria-live="polite">
          {liveMessage || 'Executing approved response...'}
        </p>
      ) : null}

      {todo?.empty ? (
        <p className="text-sm text-[var(--tn-muted)]">
          No execution checklist yet. Approve a plan to start Response Agent work.
        </p>
      ) : (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {todo.title ? (
              <StatusBadge
                tone={
                  todo.failedSteps
                    ? 'crit'
                    : todo.complete
                      ? 'ok'
                      : 'warn'
                }
              >
                {todo.title}
              </StatusBadge>
            ) : null}
            {todo.totalSteps > 0 ? (
              <span className="tn-meta">
                Step {todo.currentStep} / {todo.totalSteps}
              </span>
            ) : null}
          </div>
          <ol className="space-y-2" aria-label="Response task checklist">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-start gap-2 text-sm text-[var(--tn-text)]"
              >
                <span className="w-12 shrink-0 font-medium text-[var(--tn-muted)]" aria-hidden>
                  {item.mark}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mr-2">
                    {item.label}
                    {item.target ? (
                      <span className="text-[var(--tn-muted)]"> · {item.target}</span>
                    ) : null}
                  </span>
                  <StatusBadge
                    tone={
                      item.status === 'completed'
                        ? 'ok'
                        : item.status === 'failed'
                          ? 'crit'
                          : item.status === 'executing'
                            ? 'warn'
                            : item.status === 'blocked'
                              ? 'crit'
                              : 'muted'
                    }
                  >
                    {item.status}
                  </StatusBadge>
                  {item.error ? (
                    <p className="tn-meta mt-0.5 text-[var(--tn-crit)]">{item.error}</p>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
