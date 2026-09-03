import SafetyStatus from './SafetyStatus'

export default function ResponseStep({ step }) {
  return (
    <li className="flex gap-4 border-t border-[var(--tn-line)] py-4 first:border-t-0">
      <div className="w-10 shrink-0 font-mono text-sm">{step.priority}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium capitalize">{step.phase}</span>
          <SafetyStatus status={step.safetyStatus || step.safety_status} />
        </div>
        <p className="mt-1.5 text-sm leading-relaxed">{step.action}</p>
        {step.rationale ? (
          <p className="tn-meta mt-1.5">{step.rationale}</p>
        ) : null}
      </div>
    </li>
  )
}
