import { useState } from 'react'
import StatusBadge from '../../../ui/StatusBadge'

/**
 * Agent Workflow Trace (STEP 16).
 * Shows the real agentic loop: Commander → Approval → Response → Continuation → Recovered.
 * Verification appears only as observational evidence entries.
 */
export default function AgentWorkflowTraceView({
  trace = null,
  workflowTrace = [],
}) {
  const [open, setOpen] = useState(true)
  const agentLoop = (workflowTrace || []).filter((t) => t?.kind === 'agent_loop')
  const evidence = (workflowTrace || []).filter(
    (t) => t?.kind === 'observational_verification'
  )
  const transitions = (workflowTrace || []).filter(
    (t) => t?.kind === 'status_transition'
  )
  const latest =
    trace ||
    [...(workflowTrace || [])].reverse().find((t) => t?.kind === 'iteration') ||
    null

  return (
    <section className="border-t border-[var(--tn-line)] pt-3">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <h3 className="tn-section-title tracking-wide">Agent Workflow Trace</h3>
        <span className="tn-meta text-[11px]">{open ? 'Hide' : 'Show'}</span>
      </button>
      <p className="tn-meta mt-1">
        Commander → Approval → Response → Commander continuation → Recovered.
        Verification is observational evidence only.
      </p>

      {open ? (
        <div className="mt-3 space-y-3">
          {agentLoop.length === 0 && !latest ? (
            <p className="text-sm text-[var(--tn-muted)]">
              No agent loop events yet. Appears after Commander plans and Response
              executes.
            </p>
          ) : (
            <ol className="space-y-2 text-sm text-[var(--tn-text)]">
              {agentLoop.map((ev, i) => (
                <li key={`${ev.phase}-${ev.atMs ?? i}-${i}`}>
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <span>{ev.phase || 'EVENT'}</span>
                    {ev.result ? (
                      <StatusBadge tone={ev.result === 'ok' ? 'ok' : 'crit'}>
                        {ev.result}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <div className="tn-meta">
                    {ev.atMs
                      ? new Date(ev.atMs).toLocaleTimeString()
                      : '—'}
                    {ev.planId ? ` · plan ${ev.planId}` : ''}
                    {ev.primaryIncidentId
                      ? ` · incident ${ev.primaryIncidentId}`
                      : ''}
                    {ev.target ? ` · target ${ev.target}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {evidence.length > 0 ? (
            <div className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-surface)]/40 p-2">
              <div className="text-xs font-medium text-[var(--tn-muted)]">
                Evidence / Verification (read-only)
              </div>
              <ul className="mt-1 space-y-1 text-xs text-[var(--tn-text)]">
                {evidence.slice(-5).map((ev, i) => (
                  <li key={`ev-${ev.atMs ?? i}`}>
                    {ev.verified === true ? 'pass' : 'fail'} · controlFlow=
                    {ev.controlFlow || 'ignored'}
                    {ev.planId ? ` · ${ev.planId}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {transitions.length > 0 ? (
            <div className="tn-meta text-[11px]">
              Status transitions: {transitions.length} recorded
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
