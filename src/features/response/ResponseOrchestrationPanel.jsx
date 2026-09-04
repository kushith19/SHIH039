import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  actionRegistrySplitView,
  activeAgentOwnershipView,
  approvalSpotlightView,
  canAnalyzeOrchestration,
  canApproveOrchestration,
  canReplanOrchestration,
  canStartNewOrchestrationCycle,
  correlatedGroupView,
  createEmptyOrchestrationState,
  focusedIncidentsView,
  orchestrationFlowRailView,
  planActionDetailsView,
  planEvolutionView,
  postOrchestrationAnalyze,
  postOrchestrationApprove,
  postOrchestrationNewCycle,
  postOrchestrationReplan,
  primaryOrchestrationActionView,
  replanHandoffView,
  responsePlanView,
  responseTodoChecklistView,
  selectAuthoritativeOrchestrationState,
  verificationView,
  whyResolveFirstView,
} from './orchestrationView.js'
import { ORCHESTRATION_STATUS } from '../../../shared/response/orchestration.js'
import OrchestrationFlowRail from './orchestration/OrchestrationFlowRail.jsx'
import OrchestrationDetailPanel from './orchestration/OrchestrationDetailPanel.jsx'
import {
  notifyResponseAnalyzeFinished,
  notifyResponseAnalyzeStarted,
} from './responseAnalyzeUi.js'

/**
 * Response Orchestration panel (STEP 13 — compact flowchart + detail).
 * Presentation only over server orchestration state. Does not invent progress
 * or execute from approval in the UI layer.
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
  const [selectedStepId, setSelectedStepId] = useState('commander')

  useEffect(() => {
    // Drop localOverride once socket catches up to the same or newer revision
    if (!localOverride || !orchestrationState) return
    const localTs = Number(localOverride.updatedAtMs ?? localOverride.lastUpdatedAt) || 0
    const socketTs =
      Number(orchestrationState.updatedAtMs ?? orchestrationState.lastUpdatedAt) || 0
    if (socketTs >= localTs) setLocalOverride(null)
  }, [
    localOverride,
    orchestrationState?.lastUpdatedAt,
    orchestrationState?.updatedAtMs,
    orchestrationState?.status,
    orchestrationState?.workflowStatus,
    orchestrationState?.plan?.planId,
    orchestrationState?.plan?.approvalStatus,
    orchestrationState?.execution?.completedSteps,
    orchestrationState?.execution?.currentStep,
    orchestrationState?.verification?.verdict,
    orchestrationState?.replanCount,
    orchestrationState?.continuationReason,
    orchestrationState?.previousPlanId,
  ])

  const state = selectAuthoritativeOrchestrationState(
    localOverride,
    orchestrationState
  )
  const status = String(state.workflowStatus ?? state.status ?? 'IDLE').toUpperCase()
  const ownership = activeAgentOwnershipView(state)
  const rail = orchestrationFlowRailView(state)
  const planView = responsePlanView(state.plan)
  const registry = actionRegistrySplitView()
  const focused = focusedIncidentsView({
    detection,
    incidents,
    focusIncidentId: state.plan?.primaryIncidentId || focusIncidentId,
  })
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
  const todo = responseTodoChecklistView(state)

  const hasIncidents = Array.isArray(incidents) && incidents.length > 0
  const approveEnabled = canApproveOrchestration(state) && !busy
  const analyzeEnabled = canAnalyzeOrchestration(state, hasIncidents) && !busy
  const replanEnabled = canReplanOrchestration(state) && !busy
  const newCycleEnabled = canStartNewOrchestrationCycle(state) && !busy
  const primaryActionRaw = primaryOrchestrationActionView(state, { hasIncidents })
  const primaryAction = {
    ...primaryActionRaw,
    enabled: primaryActionRaw.enabled === true && !busy,
  }

  const primaryLabel =
    focused.primary?.endpointLabel ||
    focused.primary?.endpointId ||
    state.plan?.affectedNodeIds?.[0] ||
    state.plan?.primaryIncidentId ||
    '—'

  const suggestedStepId = rail.suggestedStepId

  // Follow live focus when workflow phase / ownership changes
  useEffect(() => {
    setSelectedStepId(suggestedStepId)
  }, [suggestedStepId])

  const onAnalyze = async () => {
    if (!roomId || !analyzeEnabled) return
    setBusy('analyze')
    setError(null)
    notifyResponseAnalyzeStarted(state.plan)
    setLocalOverride({
      ...state,
      workflowStatus: ORCHESTRATION_STATUS.ANALYZING,
      status: ORCHESTRATION_STATUS.ANALYZING,
      plan: null,
      execution: null,
      updatedAtMs: Date.now(),
    })
    const result = await postOrchestrationAnalyze(roomId, {
      incidentId: focusIncidentId,
    })
    setBusy(null)
    notifyResponseAnalyzeFinished({
      ok: result.ok,
      message: result.message,
      orchestration: result.orchestration,
    })
    if (!result.ok) {
      setError(result.message || 'Analyze failed')
      setLocalOverride({
        ...(result.orchestration || state),
        workflowStatus: ORCHESTRATION_STATUS.IDLE,
        status: ORCHESTRATION_STATUS.IDLE,
        plan: null,
        execution: null,
        updatedAtMs: Date.now(),
      })
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

  const showApprovalScope =
    Boolean(state.approvalScope) && status !== ORCHESTRATION_STATUS.RECOVERED

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {showApprovalScope ? (
        <p className="tn-meta shrink-0">
          {ownership?.headline?.includes('Continuing') ||
          Number(state.autoIteration) > 0
            ? ownership?.detail ||
              `Continuing approved response · iteration ${state.autoIteration}`
            : 'Approved strategy scope active'}
          {state.pausedForApprovalReason
            ? ` · Paused: ${state.pausedForApprovalReason}`
            : ''}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden md:flex-row md:gap-4">
        <div className="shrink-0 overflow-y-auto md:max-h-full">
          <OrchestrationFlowRail
            rail={rail}
            selectedStepId={selectedStepId}
            onSelectStep={setSelectedStepId}
          />
        </div>
        <OrchestrationDetailPanel
          selectedStepId={selectedStepId}
          status={status}
          ownership={ownership}
          planView={planView}
          actionDetails={actionDetails}
          whyFirst={whyFirst}
          focused={focused}
          correlation={correlation}
          approval={approval}
          approvalScope={state.approvalScope}
          pausedForApprovalReason={state.pausedForApprovalReason}
          todo={todo}
          verifyView={verifyView}
          verification={state.verification}
          handoff={handoff}
          evolution={evolution}
          registry={registry}
          workflowTrace={state.workflowTrace}
          latestIterationTrace={state.latestIterationTrace}
          primaryAction={primaryAction}
          primaryLabel={primaryLabel}
          focusIncidentId={focusIncidentId}
          planPrimaryIncidentId={state.plan?.primaryIncidentId}
          searchParams={searchParams}
          hasIncidents={hasIncidents}
          analyzeEnabled={analyzeEnabled}
          approveEnabled={approveEnabled}
          replanEnabled={replanEnabled}
          newCycleEnabled={newCycleEnabled}
          busy={busy}
          error={error}
          onAnalyze={() => void onAnalyze()}
          onApprove={() => void onApprove()}
          onReplan={() => void onReplan()}
          onNewCycle={() => void onNewCycle()}
        />
      </div>
    </div>
  )
}
