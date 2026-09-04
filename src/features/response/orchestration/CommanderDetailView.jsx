import { Link } from 'react-router-dom'
import StatusBadge from '../../../ui/StatusBadge'
import EmptyState from '../../../ui/EmptyState'
import { dashboardPanelHref } from '../../dashboard/dashboardPanels.js'
import { ORCHESTRATION_STATUS } from '../../../../shared/response/orchestration.js'

/**
 * Commander step detail — plan / prioritization / correlation from view helpers only.
 */
export default function CommanderDetailView({
  status,
  planView,
  actionDetails,
  whyFirst,
  focused,
  correlation,
  handoff = null,
  needsReplan = false,
  primaryLabel = '—',
  analyzeEnabled = false,
  replanEnabled = false,
  busy = null,
  hasIncidents = false,
  searchParams = null,
  onAnalyze = null,
  onReplan = null,
}) {
  const showReplan = needsReplan || handoff?.active
  const analyzingNow =
    status === ORCHESTRATION_STATUS.ANALYZING || busy === 'analyze'
  const llmPlan = planView?.plan?.planSource === 'llm'
  const planActions = analyzingNow || !llmPlan ? [] : actionDetails?.actions || []

  return (
    <div className="space-y-4">
      <header>
        <h3 className="tn-section-title tracking-wide">Commander Agent</h3>
        <p className="tn-meta mt-1">
          Builds a policy-approved response plan from live recovery priority.
          Does not execute actions.
        </p>
      </header>

      {showReplan ? (
        <div
          className="rounded-md border border-[var(--tn-crit)]/40 bg-[var(--tn-surface)] px-3 py-3"
          role="status"
        >
          <div className="tn-label">Re-analysis required</div>
          <p className="mt-1 text-sm text-[var(--tn-text)]">
            {handoff?.failureReason || 'Verification failed — replan required.'}
          </p>
          {handoff?.commanderMessage ? (
            <p className="tn-meta mt-1">{handoff.commanderMessage}</p>
          ) : null}
          {handoff?.previousTargets?.length ? (
            <p className="tn-meta mt-2">
              Previous: {(handoff.previousActions || []).join(', ') || 'contain'} ·{' '}
              {handoff.previousTargets.join(', ')}
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
      ) : null}

      {status === ORCHESTRATION_STATUS.ANALYZING ? (
        <p className="text-sm text-[var(--tn-text)]" aria-live="polite">
          {actionDetails?.isContinuation
            ? 'Continuing approved response…'
            : 'Generating response plan with Qwen…'}
        </p>
      ) : null}

      {planView?.empty ? (
        <EmptyState
          title="No active plan"
          body="Press Response on an incident to generate a Qwen response plan."
          action={
            hasIncidents ? (
              <button
                type="button"
                className="tn-btn-primary inline-flex"
                disabled={!analyzeEnabled}
                onClick={() => onAnalyze?.()}
              >
                {busy === 'analyze' ? 'Analyzing…' : 'Run Commander Analysis'}
              </button>
            ) : (
              <Link
                to={dashboardPanelHref(searchParams, 'incidents')}
                replace
                className="tn-btn inline-flex"
              >
                Open Incidents
              </Link>
            )
          }
        />
      ) : (
        <div className="space-y-4">
          <div>
            <div className="tn-label">Primary incident</div>
            <p className="mt-1 text-sm text-[var(--tn-text)]">{primaryLabel}</p>
            {whyFirst?.prioritization ? (
              <p className="tn-meta mt-0.5">
                Reason for prioritization: {whyFirst.prioritization}
              </p>
            ) : null}
            {focused?.primary?.criticality ? (
              <p className="tn-meta">
                Criticality: {String(focused.primary.criticality)}
              </p>
            ) : null}
          </div>

          {!whyFirst?.empty ? (
            <div>
              <div className="tn-label">Why resolve this first?</div>
              {whyFirst.headline ? (
                <p className="mt-1 text-sm text-[var(--tn-text)]">{whyFirst.headline}</p>
              ) : null}
              <ul className="mt-2 space-y-1 text-sm text-[var(--tn-text)]">
                {(whyFirst.bullets || []).map((b) => (
                  <li key={b.key}>
                    <span className="text-[var(--tn-muted)]">{b.mark}</span> {b.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!correlation?.empty ? (
            <div>
              <div className="tn-label">Correlated incident group</div>
              <p className="tn-meta mt-1">
                {correlation.relatedCount} related · {correlation.terminology}
              </p>
              <p className="mt-1 text-sm text-[var(--tn-text)]">
                Primary: {correlation.primary?.label || '—'}
              </p>
              {(correlation.related || []).length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-sm text-[var(--tn-text)]">
                  {correlation.related.map((r) => (
                    <li key={r.id}>{r.label}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="tn-label">
              {actionDetails?.previousPlanId
                ? `Response plan #${actionDetails.planNumber}`
                : `Response plan #${actionDetails?.planNumber ?? 1}`}
            </div>
            {actionDetails?.previousPlanId ? (
              <p className="tn-meta mt-1">
                {actionDetails.lineageLabel || 'Previous plan'}:{' '}
                {actionDetails.previousPlanId}
              </p>
            ) : null}
            {planView?.summary ? (
              <p className="tn-meta mt-1">{planView.summary}</p>
            ) : null}
            {planView?.attackInterpretation ? (
              <div className="mt-3">
                <div className="tn-label">Attack interpretation</div>
                <p className="mt-1 text-sm text-[var(--tn-text)]">
                  {planView.attackInterpretation}
                </p>
              </div>
            ) : null}
            {planView?.strategy ? (
              <div className="mt-3">
                <div className="tn-label">Strategy</div>
                <p className="mt-1 text-sm text-[var(--tn-text)]">
                  {planView.strategy}
                </p>
              </div>
            ) : null}
            {planView?.riskAssessment ? (
              <div className="mt-3">
                <div className="tn-label">Risk assessment</div>
                <p className="mt-1 text-sm text-[var(--tn-text)]">
                  {planView.riskAssessment}
                </p>
              </div>
            ) : null}
            {planView?.uncertainty ? (
              <p className="tn-meta mt-2">
                Uncertainty: {planView.uncertainty}
              </p>
            ) : null}
            {(planActions || []).length === 0 ? (
              <p className="tn-meta mt-2">
                {analyzingNow
                  ? 'Generating response plan with Qwen…'
                  : planView?.plan?.planSource &&
                      planView.plan.planSource !== 'llm'
                    ? 'LLM Response Plan unavailable'
                    : 'No executable actions in the LLM response plan'}
              </p>
            ) : (
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                {planActions.map((action) => (
                  <li key={action.actionId} className="text-sm">
                    <div className="font-medium text-[var(--tn-text)]">
                      {action.label}
                      {action.target ? (
                        <span className="font-normal text-[var(--tn-muted)]">
                          {' '}
                          · {action.target}
                          {action.targetPeer ? ` → ${action.targetPeer}` : ''}
                        </span>
                      ) : null}
                    </div>
                    <p className="tn-meta mt-0.5">Reason: {action.reason || '—'}</p>
                    {action.expectedImpact ? (
                      <p className="tn-meta mt-0.5">
                        Expected impact: {action.expectedImpact}
                      </p>
                    ) : null}
                    {action.dependencies?.length ? (
                      <p className="tn-meta mt-0.5">
                        Depends on: {action.dependencies.join(', ')}
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {action.confidence != null ? (
                        <StatusBadge tone="muted">
                          Confidence: {Math.round(Number(action.confidence) * 100)}%
                        </StatusBadge>
                      ) : null}
                      <StatusBadge tone="muted">Risk: {action.risk || '—'}</StatusBadge>
                      <StatusBadge tone="muted">
                        Reversible: {action.reversibleLabel}
                      </StatusBadge>
                      <StatusBadge
                        tone={action.policyStatus === 'ALLOWED' ? 'ok' : 'warn'}
                      >
                        Policy: {action.policyStatus || '—'}
                      </StatusBadge>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {planView?.expectedImpact ? (
            <div>
              <div className="tn-label">Expected impact</div>
              {planView.expectedImpact.whyFirst ? (
                <p className="mt-1 text-sm text-[var(--tn-text)]">
                  {planView.expectedImpact.whyFirst}
                </p>
              ) : null}
              {(planView.expectedImpact.summaryLines || []).map((line) => (
                <p key={line} className="tn-meta mt-0.5">
                  {line}
                </p>
              ))}
              {Number(planView.expectedImpact.mayReduceExposureCount) > 0 ? (
                <p className="tn-meta mt-1">
                  May reduce exposure on{' '}
                  {planView.expectedImpact.mayReduceExposureCount} downstream
                  node
                  {planView.expectedImpact.mayReduceExposureCount === 1 ? '' : 's'}
                </p>
              ) : null}
            </div>
          ) : null}

          {!needsReplan &&
          (status === ORCHESTRATION_STATUS.IDLE ||
            status === ORCHESTRATION_STATUS.ANALYZING ||
            status === ORCHESTRATION_STATUS.PLAN_READY ||
            status === ORCHESTRATION_STATUS.AWAITING_APPROVAL) ? (
            <button
              type="button"
              className="tn-btn"
              disabled={!analyzeEnabled}
              onClick={() => onAnalyze?.()}
            >
              {busy === 'analyze' ? 'Analyzing…' : 'Run Commander Analysis'}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
