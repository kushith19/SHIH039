import { Link } from 'react-router-dom'
import StatusBadge from '../../../ui/StatusBadge'
import { dashboardResponseIncidentHref } from '../../dashboard/dashboardPanels.js'
import { ORCHESTRATION_STATUS } from '../../../../shared/response/orchestration.js'
import CommanderDetailView from './CommanderDetailView.jsx'
import ApprovalDetailView from './ApprovalDetailView.jsx'
import ResponseTodoView from './ResponseTodoView.jsx'
import RecoveryDetailView from './RecoveryDetailView.jsx'
import ReplanDetailView from './ReplanDetailView.jsx'
import RecoveredDetailView from './RecoveredDetailView.jsx'
import AgentWorkflowTraceView from './AgentWorkflowTraceView.jsx'

/**
 * Right-side detail panel — content switches by selectedStepId only (UI state).
 */
export default function OrchestrationDetailPanel({
  selectedStepId = 'commander',
  status,
  ownership,
  planView,
  actionDetails,
  whyFirst,
  focused,
  correlation,
  approval,
  approvalScope,
  pausedForApprovalReason,
  todo,
  verifyView,
  verification,
  handoff,
  evolution,
  registry,
  workflowTrace = [],
  latestIterationTrace = null,
  primaryAction,
  primaryLabel,
  focusIncidentId,
  planPrimaryIncidentId,
  searchParams,
  hasIncidents,
  analyzeEnabled,
  approveEnabled,
  replanEnabled,
  newCycleEnabled,
  busy,
  error,
  onAnalyze,
  onApprove,
  onReplan,
  onNewCycle,
}) {
  const needsReplan = status === ORCHESTRATION_STATUS.REPLAN_REQUIRED
  const isVerifying = status === ORCHESTRATION_STATUS.VERIFYING
  const isRecovered = status === ORCHESTRATION_STATUS.RECOVERED

  let body = null
  if (selectedStepId === 'approval') {
    body = (
      <ApprovalDetailView
        approval={approval}
        approvalScope={approvalScope}
        pausedForApprovalReason={pausedForApprovalReason}
        approveEnabled={approveEnabled}
        busy={busy}
        onApprove={onApprove}
        planView={planView}
      />
    )
  } else if (selectedStepId === 'response') {
    body = (
      <ResponseTodoView
        todo={todo}
        ownership={ownership}
        liveProgress={primaryAction?.liveProgress === true}
        liveMessage={primaryAction?.liveMessage}
      />
    )
  } else if (selectedStepId === 'recovery') {
    body = (
      <RecoveryDetailView
        verifyView={verifyView}
        verification={verification}
        isVerifying={isVerifying}
        isRecovered={isRecovered}
      />
    )
      } else if (selectedStepId === 'complete') {
    body = (
      <RecoveredDetailView
        incidentId={planPrimaryIncidentId || focusIncidentId}
      />
    )
  } else if (selectedStepId === 'commander' && needsReplan) {
    body = (
      <div className="space-y-6">
        <ReplanDetailView
          handoff={handoff}
          evolution={evolution}
          replanEnabled={replanEnabled}
          busy={busy}
          onReplan={onReplan}
        />
        <CommanderDetailView
          status={status}
          planView={planView}
          actionDetails={actionDetails}
          whyFirst={whyFirst}
          focused={focused}
          correlation={correlation}
          handoff={handoff}
          needsReplan={needsReplan}
          primaryLabel={primaryLabel}
          analyzeEnabled={analyzeEnabled}
          replanEnabled={replanEnabled}
          busy={busy}
          hasIncidents={hasIncidents}
          searchParams={searchParams}
          plannerError={pausedForApprovalReason}
          onAnalyze={onAnalyze}
          onReplan={onReplan}
        />
      </div>
    )
  } else {
    body = (
      <CommanderDetailView
        status={status}
        planView={planView}
        actionDetails={actionDetails}
        whyFirst={whyFirst}
        focused={focused}
        correlation={correlation}
        handoff={handoff}
        needsReplan={needsReplan}
        primaryLabel={primaryLabel}
        analyzeEnabled={analyzeEnabled}
        replanEnabled={replanEnabled}
        busy={busy}
        hasIncidents={hasIncidents}
        searchParams={searchParams}
        plannerError={pausedForApprovalReason}
        onAnalyze={onAnalyze}
        onReplan={onReplan}
      />
    )
  }

  const isPlannerStep = selectedStepId === 'commander'
  const isRecoveredStep = selectedStepId === 'complete'
  const showPrimaryCta =
    primaryAction?.enabled &&
    primaryAction.actionId &&
    !(selectedStepId === 'approval' && primaryAction.actionId === 'approve') &&
    !isRecoveredStep &&
    !(isPlannerStep && primaryAction.actionId === 'replan') &&
    !(isPlannerStep && primaryAction.actionId === 'analyze')
  const showDebugChrome = !isPlannerStep && !isRecoveredStep

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--tn-line)] bg-[var(--tn-surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--tn-line)] px-3 py-2">
        <div className="tn-label">Step detail</div>
        {ownership?.headline && !isRecoveredStep ? (
          <StatusBadge tone="warn">{ownership.headline}</StatusBadge>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-4">
        {error ? (
          <p className="mb-3 text-sm text-[var(--tn-crit)]" role="alert">
            {error}
          </p>
        ) : null}

        {body}

        {primaryAction?.liveProgress && selectedStepId !== 'response' ? (
          <p className="tn-meta mt-4" aria-live="polite">
            {primaryAction.liveMessage}
          </p>
        ) : null}

        {showPrimaryCta ? (
          <div className="mt-4 border-t border-[var(--tn-line)] pt-3">
            <PrimaryCta
              action={primaryAction}
              busy={busy}
              onAnalyze={onAnalyze}
              onApprove={onApprove}
              onReplan={onReplan}
              onNewCycle={onNewCycle}
            />
          </div>
        ) : null}

        {showDebugChrome ? (
        <div className="mt-4">
          <AgentWorkflowTraceView
            trace={latestIterationTrace}
            workflowTrace={workflowTrace}
          />
        </div>
        ) : null}

        {showDebugChrome ? (
          <>
            <section
              className="mt-6 border-t border-[var(--tn-line)] pt-4"
              aria-labelledby="orch-registry"
            >
              <h4 id="orch-registry" className="tn-label">
                Response Action Repository
              </h4>
              <p className="tn-meta mt-1 mb-2">
                Commander chooses only from registered capabilities. Unsupported
                actions never execute.
              </p>
              <div className="space-y-3">
                {(registry?.groups || []).map((group) => (
                  <div key={group.category}>
                    <div className="text-[11px] font-medium text-[var(--tn-muted)]">
                      {group.categoryLabel || group.category}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {(group.items || []).map((item) => (
                        <li
                          key={item.capabilityId || item.actionId || item.label}
                          className="flex items-center justify-between gap-2 text-sm text-[var(--tn-text)]"
                        >
                          <span>
                            {item.supported ? '✓' : '○'} {item.label}
                            {item.mutation === false ? ' · read-only' : ''}
                          </span>
                          <StatusBadge tone={item.supported ? 'ok' : 'muted'}>
                            {item.availabilityLabel ||
                              (item.supported ? 'SUPPORTED' : 'UNSUPPORTED')}
                          </StatusBadge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {(focusIncidentId || planPrimaryIncidentId) && (
              <div className="mt-4 border-t border-[var(--tn-line)] pt-3">
                <Link
                  to={dashboardResponseIncidentHref(
                    searchParams,
                    focusIncidentId || planPrimaryIncidentId
                  )}
                  replace
                  className="tn-btn inline-flex"
                >
                  Open Response Console
                </Link>
                <p className="tn-meta mt-1 text-[11px]">
                  Direct-action surface — separate from orchestration workflow.
                </p>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

function PrimaryCta({ action, busy, onAnalyze, onApprove, onReplan, onNewCycle }) {
  if (!action?.actionId) return null
  const handlers = {
    analyze: onAnalyze,
    approve: onApprove,
    replan: onReplan,
    'new-cycle': onNewCycle,
  }
  const busyKey =
    action.actionId === 'new-cycle' ? 'new-cycle' : action.actionId
  return (
    <button
      type="button"
      className="tn-btn-primary"
      disabled={!action.enabled || Boolean(busy)}
      onClick={() => handlers[action.actionId]?.()}
    >
      {busy === busyKey ? 'Working…' : action.label}
    </button>
  )
}
