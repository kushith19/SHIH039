import StatusBadge from '../../../ui/StatusBadge'

/**
 * Human approval detail — authorizes a bounded response mission (STEP 17).
 * Approves only — does not execute.
 */
export default function ApprovalDetailView({
  approval = null,
  approvalScope = null,
  pausedForApprovalReason = null,
  approveEnabled = false,
  busy = null,
  onApprove = null,
  planView = null,
}) {
  if (!approval?.required && !approval?.approved) {
    return (
      <div className="space-y-3">
        <header>
          <h3 className="tn-section-title tracking-wide">Human Approval</h3>
          <p className="tn-meta mt-1">
            Review the Planner output for the selected incident. Nothing
            executes until you click Approve Plan.
          </p>
        </header>
        <p className="text-sm text-[var(--tn-muted)]">
          Waiting for a Planner plan. No approval decision is pending.
        </p>
      </div>
    )
  }

  if (approval.approved && !approval.required) {
    return (
      <div className="space-y-3">
        <header>
          <h3 className="tn-section-title tracking-wide">Human Approval</h3>
          <p className="tn-meta mt-1">
            Plan approved. Response Agent executes this approved plan only.
          </p>
        </header>
        <p className="text-sm text-[var(--tn-text)]" aria-live="polite">
          ✓ Approved. Response Agent is next.
        </p>
        {approvalScope ? <ScopeSummary scope={approvalScope} approval={approval} /> : null}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header>
        <h3 className="tn-section-title tracking-wide">Human Approval</h3>
        <p className="tn-meta mt-1">
          Approving authorizes the Planner response for the selected incident
          only. The Response Agent does not run until you click Approve Plan.
        </p>
      </header>

      <div
        className="rounded-md border-2 border-[var(--tn-warn)] bg-[var(--tn-surface)] px-3 py-3"
        aria-labelledby="orch-approval-detail"
      >
        <h4 id="orch-approval-detail" className="text-sm font-medium text-[var(--tn-text)]">
          {approval.missionTitle || 'Response Mission'}
          {pausedForApprovalReason ? ' · expansion required' : ''}
        </h4>
        {Number(approval.planNumber) > 1 ? (
          <p className="tn-meta mt-1">Plan {approval.planNumber}</p>
        ) : null}

        {planView?.summary ? (
          <div className="mt-3">
            <div className="tn-label">Planner assessment</div>
            <p className="mt-1 text-sm text-[var(--tn-text)]">{planView.summary}</p>
          </div>
        ) : null}
        {planView?.attackInterpretation ? (
          <div className="mt-3">
            <div className="tn-label">What happened</div>
            <p className="mt-1 text-sm text-[var(--tn-text)]">
              {planView.attackInterpretation}
            </p>
          </div>
        ) : null}
        {planView?.review ? (
          <div className="mt-3">
            <div className="tn-label">Evidence review</div>
            <p className="mt-1 text-sm text-[var(--tn-text)]">{planView.review}</p>
          </div>
        ) : null}
        {planView?.strategy ? (
          <div className="mt-3">
            <div className="tn-label">Recommended approach</div>
            <p className="mt-1 text-sm text-[var(--tn-text)]">{planView.strategy}</p>
          </div>
        ) : null}

        {pausedForApprovalReason ? (
          <p className="mt-2 text-sm text-[var(--tn-warn)]" role="status">
            Additional authorization required: {pausedForApprovalReason}
          </p>
        ) : null}

        {approvalScope ? (
          <ScopeSummary scope={approvalScope} approval={approval} />
        ) : (
          <div className="mt-3">
            <div className="tn-label">Planned actions</div>
            <ul className="mt-1 space-y-1 text-sm text-[var(--tn-text)]">
              {(approval.actionSummaries || []).map((a) => (
                <li key={a.actionId}>
                  <div>
                    {a.label}
                    {a.target ? ` · ${a.target}` : ''}
                  </div>
                  {a.rationale ? (
                    <p className="tn-meta">Why: {a.rationale}</p>
                  ) : null}
                  {a.expectedImpact ? (
                    <p className="tn-meta">Expected outcome: {a.expectedImpact}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <StatusBadge tone="warn">Execution waits for Approve Plan</StatusBadge>
        </div>

        <button
          type="button"
          className="tn-btn-primary mt-4"
          disabled={!approveEnabled}
          onClick={() => onApprove?.()}
        >
            {busy === 'approve'
            ? 'Approving…'
            : busy === 'execute'
              ? 'Executing…'
              : approval.buttonLabel || 'Approve Plan'}
        </button>
        <p className="tn-meta mt-2 text-[11px]">
          Approval is required. Nothing executes until you click Approve Plan.
        </p>
      </div>
    </div>
  )
}

function ScopeSummary({ scope, approval = null }) {
  const caps = approval?.capabilities || scope.missionCapabilities || scope.actionTypes || []
  return (
    <div className="mt-3 space-y-1">
      <div className="tn-label">Approved mission scope</div>
      {(scope.incidentIds || []).length > 0 ? (
        <p className="tn-meta">
          Incidents: {(scope.incidentIds || []).join(', ')}
        </p>
      ) : null}
      {(scope.targetNodeIds || []).length > 0 ? (
        <p className="text-sm text-[var(--tn-text)]">
          Affected devices: {scope.targetNodeIds.join(', ')}
        </p>
      ) : null}
      {caps.length > 0 ? (
        <p className="text-sm text-[var(--tn-text)]">
          Allowed capabilities: {caps.slice(0, 8).join(', ')}
          {caps.length > 8 ? ` (+${caps.length - 8})` : ''}
        </p>
      ) : null}
    </div>
  )
}
