import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import StatusBadge from '../../ui/StatusBadge'
import EmptyState from '../../ui/EmptyState'
import {
  dashboardPanelHref,
  dashboardResponseIncidentHref,
} from '../dashboard/dashboardPanels.js'
import {
  actionRegistrySplitView,
  activeAgentOwnershipView,
  agentLaneView,
  approvalSpotlightView,
  canAnalyzeOrchestration,
  canApproveOrchestration,
  canExecuteOrchestration,
  canReplanOrchestration,
  canStartNewOrchestrationCycle,
  canVerifyOrchestration,
  correlatedGroupView,
  createEmptyOrchestrationState,
  executionProgressView,
  focusedIncidentsView,
  graphImpactView,
  planActionDetailsView,
  planEvolutionView,
  postOrchestrationAnalyze,
  postOrchestrationApprove,
  postOrchestrationExecute,
  postOrchestrationNewCycle,
  postOrchestrationReplan,
  postOrchestrationVerify,
  replanHandoffView,
  responsePlanView,
  verificationView,
  whyResolveFirstView,
} from './orchestrationView.js'
import { ORCHESTRATION_STATUS } from '../../../shared/response/orchestration.js'

/**
 * Response Orchestration panel (STEP 6 — demo-grade handoff UI).
 * Visualizes the closed-loop agent workflow from server orchestration state.
 * Does not invent progress, metrics, or execute from approval.
 */
export default function ResponseOrchestrationPanel({
  roomId = '',
  detection = null,
  nodes = [],
  edges = [],
  incidents = [],
  focusIncidentId = null,
  orchestrationState = null,
}) {
  const [searchParams] = useSearchParams()
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [localOverride, setLocalOverride] = useState(null)

  useEffect(() => {
    setLocalOverride(null)
  }, [
    orchestrationState?.lastUpdatedAt,
    orchestrationState?.updatedAtMs,
    orchestrationState?.status,
    orchestrationState?.plan?.planId,
    orchestrationState?.plan?.approvalStatus,
    orchestrationState?.execution?.completedSteps,
    orchestrationState?.execution?.currentStep,
    orchestrationState?.verification?.verdict,
    orchestrationState?.replanCount,
    orchestrationState?.previousPlanId,
  ])

  const state =
    localOverride ??
    orchestrationState ??
    createEmptyOrchestrationState()
  const status = String(state.workflowStatus ?? state.status ?? 'IDLE').toUpperCase()
  const lanes = agentLaneView(state)
  const ownership = activeAgentOwnershipView(state)
  const planView = responsePlanView(state.plan)
  const registry = actionRegistrySplitView()
  const focused = focusedIncidentsView({
    detection,
    incidents,
    focusIncidentId: state.plan?.primaryIncidentId || focusIncidentId,
  })
  const progress = executionProgressView(state)
  const verifyView = verificationView(state)
  const evolution = planEvolutionView(state)
  const approval = approvalSpotlightView(state)
  const handoff = replanHandoffView(state)
  const whyFirst = whyResolveFirstView(focused.primary, state.plan)
  const correlation = correlatedGroupView({
    detection,
    primaryIncidentId: state.plan?.primaryIncidentId || focused.primary?.id,
    nodes,
    incidents,
  })
  const actionDetails = planActionDetailsView(state.plan, state.execution)
  const impact = graphImpactView(state, { detection })

  const hasIncidents = Array.isArray(incidents) && incidents.length > 0
  const approveEnabled = canApproveOrchestration(state) && !busy
  const analyzeEnabled = canAnalyzeOrchestration(state, hasIncidents) && !busy
  const replanEnabled = canReplanOrchestration(state) && !busy
  const newCycleEnabled = canStartNewOrchestrationCycle(state) && !busy
  const executeEnabled = canExecuteOrchestration(state) && !busy
  const verifyEnabled = canVerifyOrchestration(state) && !busy
  const isApproved = status === ORCHESTRATION_STATUS.APPROVED
  const isExecuting = status === ORCHESTRATION_STATUS.EXECUTING
  const isVerifying = status === ORCHESTRATION_STATUS.VERIFYING
  const isRecovered = status === ORCHESTRATION_STATUS.RECOVERED
  const needsReplan = status === ORCHESTRATION_STATUS.REPLAN_REQUIRED
  const awaitingApproval =
    status === ORCHESTRATION_STATUS.AWAITING_APPROVAL ||
    status === ORCHESTRATION_STATUS.PLAN_READY

  const primaryLabel =
    focused.primary?.endpointLabel ||
    focused.primary?.endpointId ||
    state.plan?.affectedNodeIds?.[0] ||
    state.plan?.primaryIncidentId ||
    '—'

  const onAnalyze = async () => {
    if (!roomId || !analyzeEnabled) return
    setBusy('analyze')
    setError(null)
    const result = await postOrchestrationAnalyze(roomId, {
      incidentId: focusIncidentId,
    })
    setBusy(null)
    if (!result.ok) {
      setError(result.message || 'Analyze failed')
      if (result.orchestration) setLocalOverride(result.orchestration)
      return
    }
    setLocalOverride(result.orchestration)
  }

  const onNewCycle = async () => {
    if (!roomId || !newCycleEnabled) return
    setBusy('new-cycle')
    setError(null)
    const result = await postOrchestrationNewCycle(roomId)
    setBusy(null)
    if (!result.ok) {
      setError(result.message || 'New cycle failed')
      if (result.orchestration) setLocalOverride(result.orchestration)
      return
    }
    setLocalOverride(result.orchestration)
  }

  const onReplan = async () => {
    if (!roomId || !replanEnabled) return
    setBusy('replan')
    setError(null)
    const result = await postOrchestrationReplan(roomId)
    setBusy(null)
    if (!result.ok) {
      setError(result.message || 'Re-plan failed')
      if (result.orchestration) setLocalOverride(result.orchestration)
      return
    }
    setLocalOverride(result.orchestration)
  }

  const onApprove = async () => {
    if (!roomId || !approveEnabled) return
    setBusy('approve')
    setError(null)
    const result = await postOrchestrationApprove(roomId)
    setBusy(null)
    if (!result.ok) {
      setError(result.message || 'Approval failed')
      if (result.orchestration) setLocalOverride(result.orchestration)
      return
    }
    setLocalOverride(result.orchestration)
  }

  const onExecute = async () => {
    if (!roomId || !executeEnabled) return
    setBusy('execute')
    setError(null)
    const result = await postOrchestrationExecute(roomId)
    setBusy(null)
    if (!result.ok) {
      setError(result.message || 'Execution failed')
      if (result.orchestration) setLocalOverride(result.orchestration)
      return
    }
    setLocalOverride(result.orchestration)
  }

  const onVerify = async () => {
    if (!roomId || !verifyEnabled) return
    setBusy('verify')
    setError(null)
    const result = await postOrchestrationVerify(roomId)
    setBusy(null)
    if (!result.ok) {
      setError(result.message || 'Verification failed')
      if (result.orchestration) setLocalOverride(result.orchestration)
      return
    }
    setLocalOverride(result.orchestration)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {/* 1. Current workflow ownership */}
      <section className="space-y-3" aria-labelledby="orch-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="orch-title" className="tn-section-title tracking-wide">
              Response Orchestrator
            </h2>
            <p className="tn-meta mt-1">
              Commander plans; you approve the strategy once. Response and Recovery
              agents continue across remaining incidents within that approved scope.
              New targets, actions, or policy changes pause for re-approval.
            </p>
          </div>
          {needsReplan ? (
            <button
              type="button"
              className="tn-btn-primary"
              disabled={!replanEnabled}
              onClick={() => void onReplan()}
            >
              {busy === 'replan' ? 'Re-planning…' : 'Run Commander Re-analysis'}
            </button>
          ) : status === ORCHESTRATION_STATUS.IDLE ||
            status === ORCHESTRATION_STATUS.ANALYZING ||
            awaitingApproval ? (
            <button
              type="button"
              className="tn-btn"
              disabled={!analyzeEnabled}
              onClick={() => void onAnalyze()}
            >
              {busy === 'analyze' ? 'Analyzing…' : 'Run Commander Analysis'}
            </button>
          ) : null}
        </div>

        {error ? (
          <p className="text-sm text-[var(--tn-crit)]" role="alert">
            {error}
          </p>
        ) : null}

        <div
          className="rounded-md border border-[var(--tn-select)]/40 bg-[var(--tn-surface)] px-3 py-2.5"
          aria-live="polite"
        >
          <div className="tn-label">Current ownership</div>
          <p className="mt-1 text-sm font-medium text-[var(--tn-text)]">
            {ownership.headline}
          </p>
          <p className="tn-meta mt-0.5">{ownership.detail}</p>
        </div>

        {isRecovered ? (
          <div className="rounded-md border border-[var(--tn-ok)]/40 bg-[var(--tn-surface)] px-3 py-2.5">
            <p className="text-sm text-[var(--tn-text)]">
              ✓ Episode recovered — no active non-quarantined response incidents
              remain. Start a new cycle only for a completely new response episode.
            </p>
            <button
              type="button"
              className="tn-btn-primary mt-3"
              disabled={!newCycleEnabled}
              onClick={() => void onNewCycle()}
            >
              {busy === 'new-cycle' ? 'Starting…' : 'Start New Response Cycle'}
            </button>
          </div>
        ) : null}

        {state.approvalScope && !isRecovered ? (
          <div className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-surface)]/80 px-3 py-2">
            <div className="tn-label">Approved strategy scope</div>
            <p className="tn-meta mt-1">
              Human approval authorizes the response strategy. Agents continue
              within that approved scope; new authorization requirements pause
              the workflow.
            </p>
            {state.autoIteration > 0 ? (
              <p className="tn-meta mt-1">
                Auto iteration {state.autoIteration}
                {state.continuationReason
                  ? ` · ${String(state.continuationReason).replace(/_/g, ' ')}`
                  : ''}
              </p>
            ) : null}
            {state.pausedForApprovalReason ? (
              <p className="mt-1 text-sm text-[var(--tn-warn)]" role="status">
                Paused: {state.pausedForApprovalReason}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Agent handoff rail */}
        <ol className="space-y-0" aria-label="Agent workflow">
          {lanes.lanes.map((lane, index) => (
            <li key={lane.id} className="relative">
              {index > 0 ? (
                <div
                  className="mx-4 h-3 w-px bg-[var(--tn-line)]"
                  aria-hidden
                />
              ) : null}
              <div
                className={[
                  'flex items-start gap-3 rounded-md border px-3 py-2.5',
                  lane.ownsFocus
                    ? 'border-[var(--tn-select)] bg-[var(--tn-surface)]'
                    : 'border-[var(--tn-line)] bg-[var(--tn-surface)]/60',
                ].join(' ')}
              >
                <span
                  className={[
                    'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                    lane.ownsFocus
                      ? 'bg-[var(--tn-select)]'
                      : lane.tone === 'crit'
                        ? 'bg-[var(--tn-crit)]'
                        : lane.tone === 'ok'
                          ? 'bg-[var(--tn-ok)]'
                          : 'bg-[var(--tn-muted)] opacity-50',
                  ].join(' ')}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-[var(--tn-text)]">
                      {lane.label}
                    </span>
                    <StatusBadge tone={lane.tone}>{lane.slotLabel}</StatusBadge>
                    {lane.ownsFocus ? (
                      <StatusBadge tone="warn">Active</StatusBadge>
                    ) : null}
                  </div>

                  {lane.id === 'commander' && needsReplan ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="tn-btn-primary"
                        disabled={!replanEnabled}
                        onClick={() => void onReplan()}
                      >
                        {busy === 'replan'
                          ? 'Analyzing current graph state…'
                          : 'Re-plan with Commander'}
                      </button>
                    </div>
                  ) : null}

                  {lane.id === 'response' && isApproved ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="tn-btn-primary"
                        disabled={!executeEnabled}
                        onClick={() => void onExecute()}
                      >
                        {busy === 'execute' ? 'Executing…' : 'Execute Approved Plan'}
                      </button>
                    </div>
                  ) : null}

                  {lane.id === 'recovery' && isVerifying ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="tn-btn-primary"
                        disabled={!verifyEnabled}
                        onClick={() => void onVerify()}
                      >
                        {busy === 'verify' ? 'Verifying…' : 'Run Recovery Agent'}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 2. Human approval — strongest when required */}
      {approval.required ? (
        <section
          className="rounded-md border-2 border-[var(--tn-warn)] bg-[var(--tn-surface)] px-4 py-4"
          aria-labelledby="orch-approval"
        >
          <h3 id="orch-approval" className="tn-section-title tracking-wide">
            Human approval required
          </h3>
          <p className="tn-meta mt-1">
            Plan #{approval.planNumber}
            {approval.isReplan ? ' · response adaptation' : ''}
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[var(--tn-text)]">
            {approval.actionSummaries.map((a) => (
              <li key={a.actionId}>
                {a.label}
                {a.target ? ` · ${a.target}` : ''}
              </li>
            ))}
          </ul>
          {approval.expectedEffect ? (
            <p className="tn-meta mt-3">
              Expected effect: {approval.expectedEffect}
            </p>
          ) : null}
          <p className="tn-meta mt-1">
            Policy: {approval.policyStatus || '—'}
          </p>
          <button
            type="button"
            className="tn-btn-primary mt-4"
            disabled={!approveEnabled}
            onClick={() => void onApprove()}
          >
            {busy === 'approve' ? 'Approving…' : approval.buttonLabel}
          </button>
          <p className="tn-meta mt-2 text-[11px]">
            Approves only — does not execute actions.
          </p>
        </section>
      ) : null}

      {approval.approved && !approval.required ? (
        <p className="text-sm text-[var(--tn-text)]" aria-live="polite">
          ✓ Plan approved
          {isApproved ? ' — Response Agent ready' : null}
        </p>
      ) : null}

      {/* 3. Replan handoff */}
      {needsReplan || (handoff.active && verifyView.verdict === 'REPLAN_REQUIRED') ? (
        <section
          className="rounded-md border border-[var(--tn-crit)]/40 bg-[var(--tn-surface)] px-4 py-3"
          aria-labelledby="orch-handoff"
        >
          <h3 id="orch-handoff" className="tn-section-title tracking-wide">
            Verification failed
          </h3>
          <p className="mt-2 text-sm text-[var(--tn-text)]">
            Recovery Agent ✕
          </p>
          <p className="tn-meta mt-1">Reason: {handoff.failureReason}</p>
          <div className="my-3 ml-2 text-[var(--tn-muted)]" aria-hidden>
            ↓
          </div>
          <p className="text-sm font-medium text-[var(--tn-text)]">
            Commander Agent · re-analysis available
          </p>
          <p className="tn-meta mt-1">{handoff.commanderMessage}</p>
          {handoff.previousTargets?.length ? (
            <p className="tn-meta mt-2">
              Previous: {handoff.previousActions.join(', ') || 'contain'} ·{' '}
              {handoff.previousTargets.join(', ')}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* 4. Commander + why first + plan */}
      {!planView.empty || status === ORCHESTRATION_STATUS.ANALYZING ? (
        <section
          className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-surface)] px-4 py-3"
          aria-labelledby="orch-commander"
        >
          <h3 id="orch-commander" className="tn-section-title tracking-wide">
            Commander Agent
          </h3>
          {status === ORCHESTRATION_STATUS.ANALYZING ? (
            <p className="tn-meta mt-2">Analyzing current graph state…</p>
          ) : null}

          {!planView.empty ? (
            <div className="mt-3 space-y-4">
              <div>
                <div className="tn-label">Primary incident</div>
                <p className="mt-1 text-sm text-[var(--tn-text)]">{primaryLabel}</p>
                {whyFirst.prioritization ? (
                  <p className="tn-meta mt-0.5">
                    Reason for prioritization: {whyFirst.prioritization}
                  </p>
                ) : null}
              </div>

              {!whyFirst.empty ? (
                <div>
                  <div className="tn-label">Why resolve this first?</div>
                  {whyFirst.headline ? (
                    <p className="mt-1 text-sm text-[var(--tn-text)]">
                      {whyFirst.headline}
                    </p>
                  ) : null}
                  <ul className="mt-2 space-y-1 text-sm text-[var(--tn-text)]">
                    {whyFirst.bullets.map((b) => (
                      <li key={b.key}>
                        <span className="text-[var(--tn-muted)]">{b.mark}</span>{' '}
                        {b.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <div className="tn-label">
                  {state.plan?.previousPlanId
                    ? `New response plan #${actionDetails.planNumber}`
                    : `Response plan #${actionDetails.planNumber}`}
                </div>
                {state.plan?.previousPlanId ? (
                  <p className="tn-meta mt-1">
                    Previous plan: {state.plan.previousPlanId}
                  </p>
                ) : null}
                {state.plan?.replanContext?.verificationReasons?.[0] ? (
                  <p className="tn-meta mt-1">
                    Result: {state.plan.replanContext.verificationReasons[0]}
                  </p>
                ) : null}
                {actionDetails.actions.length === 0 ? (
                  <p className="tn-meta mt-2">
                    No executable actions under current policy
                  </p>
                ) : (
                  <ol className="mt-2 list-decimal space-y-3 pl-5">
                    {actionDetails.actions.map((action) => (
                      <li key={action.actionId} className="text-sm">
                        <div className="font-medium text-[var(--tn-text)]">
                          {action.label}
                          {action.target ? (
                            <span className="font-normal text-[var(--tn-muted)]">
                              {' '}
                              · {action.target}
                            </span>
                          ) : null}
                        </div>
                        <p className="tn-meta mt-0.5">
                          Reason: {action.reason || '—'}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <StatusBadge tone="muted">
                            Risk: {action.risk || '—'}
                          </StatusBadge>
                          <StatusBadge tone="muted">
                            Reversible: {action.reversibleLabel}
                          </StatusBadge>
                          <StatusBadge
                            tone={
                              action.policyStatus === 'ALLOWED' ? 'ok' : 'warn'
                            }
                          >
                            Policy: {action.policyStatus || '—'}
                          </StatusBadge>
                          <StatusBadge tone="muted">
                            Status: {action.status}
                          </StatusBadge>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No active plan"
              body="Run Commander analysis to build a policy-approved response plan."
              action={
                hasIncidents ? (
                  <button
                    type="button"
                    className="tn-btn-primary inline-flex"
                    disabled={!analyzeEnabled}
                    onClick={() => void onAnalyze()}
                  >
                    Run Commander Analysis
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
          )}
        </section>
      ) : (
        <section className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-surface)] px-4 py-3">
          <EmptyState
            title="No active plan"
            body="Run Commander analysis when open incidents are present."
            action={
              hasIncidents ? (
                <button
                  type="button"
                  className="tn-btn-primary inline-flex"
                  disabled={!analyzeEnabled}
                  onClick={() => void onAnalyze()}
                >
                  Run Commander Analysis
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
        </section>
      )}

      {/* 5. Response Agent execution */}
      {!progress.empty ? (
        <section
          className={[
            'rounded-md border bg-[var(--tn-surface)] px-4 py-3',
            ownership.focusId === 'response'
              ? 'border-[var(--tn-select)]'
              : 'border-[var(--tn-line)]',
          ].join(' ')}
          aria-labelledby="orch-exec"
        >
          <h3 id="orch-exec" className="tn-section-title tracking-wide">
            Response Agent
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge tone={isExecuting ? 'warn' : progress.failedSteps ? 'crit' : 'ok'}>
              {progress.title}
            </StatusBadge>
            <span className="tn-meta">
              Step {progress.currentStep} / {progress.totalSteps}
            </span>
          </div>
          {progress.complete ? (
            <p className="tn-meta mt-2">
              Actions completed: {progress.completedSteps} · failed:{' '}
              {progress.failedSteps}
            </p>
          ) : null}
          <ol className="mt-3 space-y-2">
            {progress.results.map((step, i) => (
              <li key={step.stepId || step.actionId || i} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden>{step.mark}</span>
                  <span className="text-[var(--tn-text)]">
                    {step.label || step.actionId}
                    {step.target?.id ? (
                      <span className="text-[var(--tn-muted)]">
                        {' '}
                        · {step.target.name || step.target.id}
                      </span>
                    ) : null}
                  </span>
                  <StatusBadge
                    tone={
                      step.status === 'completed'
                        ? 'ok'
                        : step.status === 'failed'
                          ? 'crit'
                          : step.status === 'executing'
                            ? 'warn'
                            : 'muted'
                    }
                  >
                    {String(step.status || 'pending')}
                  </StatusBadge>
                </div>
                {step.error ? (
                  <p className="tn-meta mt-0.5 text-[var(--tn-crit)]">
                    {step.error}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          {isApproved && !isExecuting ? (
            <button
              type="button"
              className="tn-btn-primary mt-3"
              disabled={!executeEnabled}
              onClick={() => void onExecute()}
            >
              {busy === 'execute' ? 'Executing…' : 'Execute Approved Plan'}
            </button>
          ) : null}
        </section>
      ) : null}

      {/* 6. Recovery / verification */}
      {!verifyView.empty || isVerifying || isRecovered || needsReplan ? (
        <section
          className={[
            'rounded-md border bg-[var(--tn-surface)] px-4 py-3',
            ownership.focusId === 'recovery' || isRecovered
              ? 'border-[var(--tn-select)]'
              : 'border-[var(--tn-line)]',
          ].join(' ')}
          aria-labelledby="orch-verify"
        >
          <h3 id="orch-verify" className="tn-section-title tracking-wide">
            Recovery Agent
          </h3>
          {verifyView.empty && isVerifying ? (
            <div className="mt-2">
              <StatusBadge tone="warn">Verifying</StatusBadge>
              <p className="tn-meta mt-2">
                Compare post-response graph to pre-response baseline.
              </p>
              <button
                type="button"
                className="tn-btn-primary mt-3"
                disabled={!verifyEnabled}
                onClick={() => void onVerify()}
              >
                {busy === 'verify' ? 'Verifying…' : 'Run Recovery Agent'}
              </button>
            </div>
          ) : null}
          {!verifyView.empty ? (
            <div className="mt-2 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--tn-text)]">
                  {verifyView.title}
                </span>
                <StatusBadge
                  tone={verifyView.verdict === 'RECOVERED' ? 'ok' : 'warn'}
                >
                  {verifyView.verdict || '—'}
                </StatusBadge>
              </div>
              {isRecovered ? (
                <p className="text-sm text-[var(--tn-text)]">
                  ✓ Response verified — incident conditions stabilized.
                </p>
              ) : null}
              {verifyView.checkRows.length > 0 ? (
                <ul className="space-y-1 text-sm text-[var(--tn-text)]">
                  {verifyView.checkRows.map((row) => (
                    <li key={row.key}>
                      <span aria-hidden>{row.mark}</span> {row.label}
                      <span className="tn-meta ml-2">
                        {row.state === 'pass'
                          ? 'pass'
                          : row.state === 'fail'
                            ? 'fail'
                            : row.state === 'unavailable'
                              ? 'unavailable'
                              : 'pending'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <ul className="space-y-1 text-sm text-[var(--tn-text)]">
                {verifyView.reasons.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
              {verifyView.recommendedNextActions.length > 0 ? (
                <div>
                  <div className="tn-label">Recommended next (not auto-run)</div>
                  <ul className="mt-1 space-y-1 text-sm">
                    {verifyView.recommendedNextActions.map((a, i) => (
                      <li key={`${a.actionId}-${i}`}>
                        {a.actionId}
                        {a.target?.id ? ` · ${a.target.id}` : ''}
                        <span className="tn-meta ml-2">manual only</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="tn-meta text-[11px]">
                Auto-restored: no · Incidents closed by agent: no · Quarantined ≠
                recovered
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 7. Graph impact */}
      {!impact.empty ? (
        <section
          className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-surface)] px-4 py-3"
          aria-labelledby="orch-impact"
        >
          <h3 id="orch-impact" className="tn-section-title tracking-wide">
            {impact.title}
          </h3>
          <p className="tn-meta mt-1 mb-3">{impact.disclaimer}</p>
          {impact.mode === 'before_after' ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {impact.metrics.map((m) => (
                <div key={m.key}>
                  <div className="tn-label">{m.label}</div>
                  <p className="mt-1 text-sm text-[var(--tn-text)]">
                    {m.before} → {m.after}
                  </p>
                  {m.note ? (
                    <p className="tn-meta text-[11px]">{m.note}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {impact.metrics.map((m) => (
                <div key={m.key}>
                  <div className="tn-label">{m.label}</div>
                  <p className="mt-1 text-sm text-[var(--tn-text)]">{m.value}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* 8. Correlation */}
      {!correlation.empty ? (
        <section
          className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-surface)] px-4 py-3"
          aria-labelledby="orch-corr"
        >
          <h3 id="orch-corr" className="tn-section-title tracking-wide">
            Correlated incident group
          </h3>
          <p className="tn-meta mt-1">
            {correlation.relatedCount} related incidents · {correlation.terminology}
          </p>
          <div className="mt-3">
            <div className="tn-label">Primary</div>
            <p className="mt-1 text-sm text-[var(--tn-text)]">
              {correlation.primary?.label || '—'}
            </p>
          </div>
          {correlation.related.length > 0 ? (
            <div className="mt-3">
              <div className="tn-label">Related</div>
              <ul className="mt-1 space-y-0.5 text-sm text-[var(--tn-text)]">
                {correlation.related.map((r) => (
                  <li key={r.id}>{r.label}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {correlation.reasons.length > 0 ? (
            <div className="mt-3">
              <div className="tn-label">Relationship reasons</div>
              <ul className="mt-1 space-y-0.5 text-sm text-[var(--tn-text)]">
                {correlation.reasons.map((r) => (
                  <li key={`${r.type}-${r.label}`}>
                    {r.label}
                    {r.detail ? (
                      <span className="tn-meta"> · {r.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 9. Plan journey */}
      {!evolution.empty ? (
        <section
          className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-surface)] px-4 py-3"
          aria-labelledby="orch-journey"
        >
          <h3 id="orch-journey" className="tn-section-title tracking-wide">
            Response journey
          </h3>
          <p className="tn-meta mt-1 mb-3">
            Adaptive plan history · re-plan count {evolution.replanCount}
          </p>
          <ol className="space-y-4">
            {evolution.entries.map((entry) => (
              <li key={`${entry.planId}-${entry.index}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--tn-text)]">
                    Plan #{entry.index}
                  </span>
                  {entry.isCurrent ? (
                    <StatusBadge tone="ok">Current</StatusBadge>
                  ) : null}
                </div>
                <ol className="mt-2 space-y-1 border-l border-[var(--tn-line)] pl-3">
                  {(entry.steps || []).map((step, si) => (
                    <li
                      key={`${entry.planId}-s-${si}`}
                      className="text-sm text-[var(--tn-text)]"
                    >
                      {step.failed ? '✕ ' : step.done ? '✓ ' : step.current ? '● ' : '○ '}
                      {step.label}
                    </li>
                  ))}
                </ol>
                <p className="tn-meta mt-1 text-[11px]">
                  {(entry.executableActionIds || []).join(', ') || '—'}
                  {entry.targets?.length ? ` · ${entry.targets.join(', ')}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* 10. Action registry — secondary */}
      <section
        className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-surface)] px-4 py-3"
        aria-labelledby="orch-registry"
      >
        <h3 id="orch-registry" className="tn-section-title tracking-wide">
          Action registry
        </h3>
        <p className="tn-meta mt-1 mb-3">
          Informational. Only executable actions may enter a response plan.
        </p>
        <div className="tn-label">Executable</div>
        <ul className="mt-1.5 space-y-1.5">
          {registry.executable.map((item) => (
            <li
              key={item.capabilityId}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--tn-line)] py-1.5"
            >
              <span className="text-sm text-[var(--tn-text)]">
                ✓ {item.label}
              </span>
              <StatusBadge tone="ok">Available</StatusBadge>
            </li>
          ))}
        </ul>
        <div className="tn-label mt-4">Capability catalog</div>
        <ul className="mt-1.5 space-y-1.5">
          {registry.catalog.map((item) => (
            <li
              key={item.capabilityId}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--tn-line)] py-1.5 last:border-0"
            >
              <span className="text-sm text-[var(--tn-muted)]">
                ○ {item.label}
              </span>
              <StatusBadge tone="muted">Not implemented</StatusBadge>
            </li>
          ))}
        </ul>
      </section>

      {(focusIncidentId || state.plan?.primaryIncidentId) && (
        <div>
          <Link
            to={dashboardResponseIncidentHref(
              searchParams,
              focusIncidentId || state.plan.primaryIncidentId
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
    </div>
  )
}
