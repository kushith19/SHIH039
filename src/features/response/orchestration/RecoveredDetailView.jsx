/**
 * Recovered step — compact agent workflow trace only.
 */
const WORKFLOW_STEPS = [
  {
    id: 'planner',
    title: 'Planner',
    detail: 'Reviewed incident and generated response plan',
  },
  {
    id: 'approval',
    title: 'Human approval',
    detail: 'Plan approved',
  },
  {
    id: 'response',
    title: 'Response Agent',
    detail: 'Response actions executed',
  },
  {
    id: 'recovered',
    title: 'Recovered',
    detail: 'Incident verified as recovered',
  },
]

export default function RecoveredDetailView({
  incidentId = null,
} = {}) {
  return (
    <div className="space-y-4">
      <header>
        <h3 className="tn-section-title tracking-wide">Recovered</h3>
        <p className="mt-1 text-sm font-medium text-[var(--tn-text)]">
          ✓ Incident recovered
        </p>
        <p className="tn-meta mt-1">
          Incident: {incidentId || '—'}
        </p>
        <p className="tn-meta">Response: Completed</p>
      </header>

      <ol className="space-y-2">
        {WORKFLOW_STEPS.map((step) => (
          <li
            key={step.id}
            className="rounded-md border border-[var(--tn-line)] px-3 py-3"
          >
            <p className="text-sm font-medium text-[var(--tn-text)]">
              <span className="text-[var(--tn-ok)]" aria-hidden>
                ✓
              </span>{' '}
              {step.title}
            </p>
            <p className="tn-meta mt-0.5">{step.detail}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
