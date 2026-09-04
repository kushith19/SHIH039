/**
 * Response Orchestration — workflow + ResponsePlan contracts (STEP 1 foundation).
 *
 * This layer sits ABOVE detection, correlation, recovery-impact, and quarantine.
 * It does not execute actions. Commander never executes; Response Agent only
 * receives an approved plan (STEP 2+). Approval is first-class.
 *
 * Do not reuse campaign / history-correlation engines as this orchestrator.
 */

import {
  listRegisteredResponseActions,
  RESPONSE_ACTIONS,
} from '../responseActions.js'

/** Workflow phases for the multi-agent response loop (no auto-execute yet). */
export const ORCHESTRATION_STATUS = Object.freeze({
  IDLE: 'IDLE',
  ANALYZING: 'ANALYZING',
  PLAN_READY: 'PLAN_READY',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  APPROVED: 'APPROVED',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  RECOVERED: 'RECOVERED',
  REPLAN_REQUIRED: 'REPLAN_REQUIRED',
})

/** Allowed transitions for the orchestration state machine (authoritative). */
export const ORCHESTRATION_TRANSITIONS = Object.freeze({
  [ORCHESTRATION_STATUS.IDLE]: Object.freeze([ORCHESTRATION_STATUS.ANALYZING]),
  [ORCHESTRATION_STATUS.ANALYZING]: Object.freeze([
    ORCHESTRATION_STATUS.PLAN_READY,
    ORCHESTRATION_STATUS.AWAITING_APPROVAL,
    /** Scope-authorized auto-approve during multi-incident continuation */
    ORCHESTRATION_STATUS.APPROVED,
    ORCHESTRATION_STATUS.IDLE,
    ORCHESTRATION_STATUS.REPLAN_REQUIRED,
    ORCHESTRATION_STATUS.RECOVERED,
  ]),
  [ORCHESTRATION_STATUS.PLAN_READY]: Object.freeze([
    ORCHESTRATION_STATUS.AWAITING_APPROVAL,
    ORCHESTRATION_STATUS.ANALYZING,
    ORCHESTRATION_STATUS.IDLE,
    ORCHESTRATION_STATUS.REPLAN_REQUIRED,
  ]),
  [ORCHESTRATION_STATUS.AWAITING_APPROVAL]: Object.freeze([
    ORCHESTRATION_STATUS.APPROVED,
    ORCHESTRATION_STATUS.ANALYZING,
    ORCHESTRATION_STATUS.IDLE,
    ORCHESTRATION_STATUS.REPLAN_REQUIRED,
  ]),
  [ORCHESTRATION_STATUS.APPROVED]: Object.freeze([
    ORCHESTRATION_STATUS.EXECUTING,
    ORCHESTRATION_STATUS.IDLE,
    ORCHESTRATION_STATUS.REPLAN_REQUIRED,
  ]),
  [ORCHESTRATION_STATUS.EXECUTING]: Object.freeze([
    ORCHESTRATION_STATUS.VERIFYING,
    ORCHESTRATION_STATUS.REPLAN_REQUIRED,
  ]),
  [ORCHESTRATION_STATUS.VERIFYING]: Object.freeze([
    ORCHESTRATION_STATUS.RECOVERED,
    ORCHESTRATION_STATUS.REPLAN_REQUIRED,
    /** More active incidents remain — Commander continuation */
    ORCHESTRATION_STATUS.ANALYZING,
    /** Scope expansion / max iterations — pause for human */
    ORCHESTRATION_STATUS.AWAITING_APPROVAL,
  ]),
  /** New cycle only via intentional startNewOrchestrationCycle → IDLE */
  [ORCHESTRATION_STATUS.RECOVERED]: Object.freeze([ORCHESTRATION_STATUS.IDLE]),
  [ORCHESTRATION_STATUS.REPLAN_REQUIRED]: Object.freeze([
    ORCHESTRATION_STATUS.ANALYZING,
    ORCHESTRATION_STATUS.IDLE,
    ORCHESTRATION_STATUS.AWAITING_APPROVAL,
  ]),
})

export const PLAN_APPROVAL_STATUS = Object.freeze({
  NONE: 'none',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
})

export const PLAN_ACTION_STATUS = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
  BLOCKED: 'blocked',
  APPROVED: 'approved',
  EXECUTING: 'executing',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
})

/** Response Agent per-action execution result states (STEP 3). */
export const EXECUTION_STEP_STATUS = Object.freeze({
  PENDING: 'pending',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
})

export const AGENT_SLOT_STATUS = Object.freeze({
  IDLE: 'idle',
  ANALYZING: 'analyzing',
  READY: 'ready',
  AWAITING: 'awaiting',
  APPROVED: 'approved',
  WAITING: 'waiting',
  EXECUTING: 'executing',
  VERIFYING: 'verifying',
  LOCKED: 'locked',
  RECOVERED: 'recovered',
  COMPLETE: 'complete',
})

/**
 * Capability catalog for Action Registry UI — informational only.
 * Only entries with availability "available" map to RESPONSE_ACTIONS today.
 * Catalog-only entries must never be sent to executeResponseAction.
 */
export const CAPABILITY_AVAILABILITY = Object.freeze({
  AVAILABLE: 'available',
  CATALOG: 'catalog',
})

export const ACTION_CAPABILITY_CATEGORIES = Object.freeze({
  CONTAIN: 'CONTAIN',
  PROTECT: 'PROTECT',
  MONITOR: 'MONITOR',
  VERIFY: 'VERIFY',
  RECOVER: 'RECOVER',
})

/** @typedef {{ capabilityId: string, category: string, label: string, description: string, availability: string, actionId: string|null, reversible: boolean|null }} ActionCapability */

/** Informational catalog. Does not extend the executable registry. */
export const ACTION_CAPABILITY_CATALOG = Object.freeze([
  Object.freeze({
    capabilityId: 'contain.isolate-node',
    category: ACTION_CAPABILITY_CATEGORIES.CONTAIN,
    label: 'Isolate Node',
    description: 'Isolate the affected endpoint from active communication.',
    availability: CAPABILITY_AVAILABILITY.AVAILABLE,
    actionId: 'isolate-node',
    reversible: true,
  }),
  Object.freeze({
    capabilityId: 'contain.rate-limit-endpoint',
    category: ACTION_CAPABILITY_CATEGORIES.CONTAIN,
    label: 'Rate Limit Endpoint',
    description: 'Throttle suspicious traffic volume on a targeted endpoint.',
    availability: CAPABILITY_AVAILABILITY.CATALOG,
    actionId: null,
    reversible: null,
  }),
  Object.freeze({
    capabilityId: 'contain.block-peer',
    category: ACTION_CAPABILITY_CATEGORIES.CONTAIN,
    label: 'Block Peer',
    description: 'Block communication with a suspicious peer endpoint.',
    availability: CAPABILITY_AVAILABILITY.CATALOG,
    actionId: null,
    reversible: null,
  }),
  Object.freeze({
    capabilityId: 'protect.network-segment',
    category: ACTION_CAPABILITY_CATEGORIES.PROTECT,
    label: 'Network Segment',
    description: 'Segment the affected asset from broader city services.',
    availability: CAPABILITY_AVAILABILITY.CATALOG,
    actionId: null,
    reversible: null,
  }),
  Object.freeze({
    capabilityId: 'protect.reset-credentials',
    category: ACTION_CAPABILITY_CATEGORIES.PROTECT,
    label: 'Reset Credentials',
    description: 'Rotate credentials after suspected credential abuse.',
    availability: CAPABILITY_AVAILABILITY.CATALOG,
    actionId: null,
    reversible: null,
  }),
  Object.freeze({
    capabilityId: 'protect.disable-api-key',
    category: ACTION_CAPABILITY_CATEGORIES.PROTECT,
    label: 'Disable API Key',
    description: 'Disable a compromised API key without broader shutdown.',
    availability: CAPABILITY_AVAILABILITY.CATALOG,
    actionId: null,
    reversible: null,
  }),
  Object.freeze({
    capabilityId: 'monitor.increase-monitoring',
    category: ACTION_CAPABILITY_CATEGORIES.MONITOR,
    label: 'Increase Monitoring',
    description: 'Raise observation intensity on the affected subgraph.',
    availability: CAPABILITY_AVAILABILITY.CATALOG,
    actionId: null,
    reversible: null,
  }),
  Object.freeze({
    capabilityId: 'verify.verify-graph',
    category: ACTION_CAPABILITY_CATEGORIES.VERIFY,
    label: 'Verify Graph',
    description: 'Re-check graph residual and trust after containment.',
    availability: CAPABILITY_AVAILABILITY.CATALOG,
    actionId: null,
    reversible: null,
  }),
  Object.freeze({
    capabilityId: 'recover.restore-connectivity',
    category: ACTION_CAPABILITY_CATEGORIES.RECOVER,
    label: 'Restore Connectivity',
    description:
      'Restore connectivity to a previously contained endpoint after recovery conditions are satisfied.',
    availability: CAPABILITY_AVAILABILITY.AVAILABLE,
    actionId: 'restore-connectivity',
    reversible: false,
  }),
])

/**
 * Agent lane status derived from workflow phase (UI + future agents).
 * Human approval is a first-class lane between Commander and Response.
 */
export function agentSlotsForStatus(workflowStatus) {
  const status = normalizeOrchestrationStatus(workflowStatus)
  switch (status) {
    case ORCHESTRATION_STATUS.ANALYZING:
      return {
        commander: AGENT_SLOT_STATUS.ANALYZING,
        approval: AGENT_SLOT_STATUS.LOCKED,
        response: AGENT_SLOT_STATUS.WAITING,
        recovery: AGENT_SLOT_STATUS.LOCKED,
      }
    case ORCHESTRATION_STATUS.PLAN_READY:
      return {
        commander: AGENT_SLOT_STATUS.READY,
        approval: AGENT_SLOT_STATUS.LOCKED,
        response: AGENT_SLOT_STATUS.WAITING,
        recovery: AGENT_SLOT_STATUS.LOCKED,
      }
    case ORCHESTRATION_STATUS.AWAITING_APPROVAL:
      return {
        commander: AGENT_SLOT_STATUS.READY,
        approval: AGENT_SLOT_STATUS.AWAITING,
        response: AGENT_SLOT_STATUS.WAITING,
        recovery: AGENT_SLOT_STATUS.LOCKED,
      }
    case ORCHESTRATION_STATUS.APPROVED:
      return {
        commander: AGENT_SLOT_STATUS.READY,
        approval: AGENT_SLOT_STATUS.APPROVED,
        response: AGENT_SLOT_STATUS.READY,
        recovery: AGENT_SLOT_STATUS.LOCKED,
      }
    case ORCHESTRATION_STATUS.EXECUTING:
      return {
        commander: AGENT_SLOT_STATUS.READY,
        approval: AGENT_SLOT_STATUS.APPROVED,
        response: AGENT_SLOT_STATUS.EXECUTING,
        recovery: AGENT_SLOT_STATUS.LOCKED,
      }
    case ORCHESTRATION_STATUS.VERIFYING:
      return {
        commander: AGENT_SLOT_STATUS.READY,
        approval: AGENT_SLOT_STATUS.APPROVED,
        response: AGENT_SLOT_STATUS.COMPLETE,
        recovery: AGENT_SLOT_STATUS.READY,
      }
    case ORCHESTRATION_STATUS.RECOVERED:
      return {
        commander: AGENT_SLOT_STATUS.READY,
        approval: AGENT_SLOT_STATUS.APPROVED,
        response: AGENT_SLOT_STATUS.WAITING,
        recovery: AGENT_SLOT_STATUS.RECOVERED,
      }
    case ORCHESTRATION_STATUS.REPLAN_REQUIRED:
      return {
        commander: AGENT_SLOT_STATUS.IDLE,
        approval: AGENT_SLOT_STATUS.LOCKED,
        response: AGENT_SLOT_STATUS.WAITING,
        /** Recovery completed with failed verification — Commander may re-plan */
        recovery: AGENT_SLOT_STATUS.COMPLETE,
      }
    case ORCHESTRATION_STATUS.IDLE:
    default:
      return {
        commander: AGENT_SLOT_STATUS.IDLE,
        approval: AGENT_SLOT_STATUS.LOCKED,
        response: AGENT_SLOT_STATUS.WAITING,
        recovery: AGENT_SLOT_STATUS.LOCKED,
      }
  }
}

export function normalizeOrchestrationStatus(raw) {
  const key = String(raw ?? '').trim().toUpperCase()
  return ORCHESTRATION_STATUS[key] || ORCHESTRATION_STATUS.IDLE
}

export function canTransitionOrchestration(from, to) {
  const src = normalizeOrchestrationStatus(from)
  const dst = normalizeOrchestrationStatus(to)
  const allowed = ORCHESTRATION_TRANSITIONS[src] || []
  return allowed.includes(dst)
}

/**
 * Empty orchestration run — safe default when no plan exists.
 * Future: persist under room.responseOrchestration or incident-scoped store.
 * Must not live inside campaign engines.
 */
export function createEmptyOrchestrationState(overrides = {}) {
  const workflowStatus = normalizeOrchestrationStatus(
    overrides.workflowStatus ?? overrides.status
  )
  const agents = agentSlotsForStatus(workflowStatus)
  const updatedAtMs =
    Number.isFinite(Number(overrides.updatedAtMs ?? overrides.lastUpdatedAt)) &&
    Number(overrides.updatedAtMs ?? overrides.lastUpdatedAt) > 0
      ? Number(overrides.updatedAtMs ?? overrides.lastUpdatedAt)
      : null
  return {
    /** @deprecated prefer status — kept for STEP 1 callers */
    workflowStatus,
    status: workflowStatus,
    plan: overrides.plan === undefined ? null : overrides.plan,
    agents: {
      ...agents,
      ...(overrides.agents && typeof overrides.agents === 'object' ? overrides.agents : {}),
    },
    updatedAtMs,
    lastUpdatedAt: updatedAtMs,
    approvedAtMs:
      Number.isFinite(Number(overrides.approvedAtMs)) && Number(overrides.approvedAtMs) > 0
        ? Number(overrides.approvedAtMs)
        : null,
    fingerprint: overrides.fingerprint ?? null,
    stale: overrides.stale === true,
    staleReason: overrides.staleReason ?? null,
    execution: overrides.execution === undefined ? null : overrides.execution,
    verificationBaseline:
      overrides.verificationBaseline === undefined
        ? null
        : overrides.verificationBaseline,
    verification:
      overrides.verification === undefined ? null : overrides.verification,
    /** STEP 5 — adaptive re-plan lineage (in-memory, not campaigns). */
    previousPlanId: overrides.previousPlanId ?? null,
    replanCount: Number.isFinite(Number(overrides.replanCount))
      ? Math.max(0, Math.floor(Number(overrides.replanCount)))
      : 0,
    lastReplanReason: overrides.lastReplanReason ?? null,
    planHistory: Array.isArray(overrides.planHistory) ? overrides.planHistory : [],
    /** STEP 9 — human-approved strategy scope for automatic multi-incident continuation */
    approvalScope: overrides.approvalScope === undefined ? null : overrides.approvalScope,
    autoIteration: Number.isFinite(Number(overrides.autoIteration))
      ? Math.max(0, Math.floor(Number(overrides.autoIteration)))
      : 0,
    continuationReason: overrides.continuationReason ?? null,
    pausedForApprovalReason: overrides.pausedForApprovalReason ?? null,
  }
}

/**
 * Minimal ResponsePlan contract.
 *
 * recommendedActions[] items should eventually support:
 * actionType, target, reason, executionOrder, risk, reversibility, policyStatus, status
 *
 * Only actionIds present in RESPONSE_ACTIONS are executable today.
 * Catalog-only capabilities must use actionId: null and never reach execute.
 *
 * Human approval gates execution: approvalStatus must be "approved" before
 * any future Response Agent may call executeResponseAction.
 */
export function createEmptyResponsePlan(overrides = {}) {
  return {
    planId: overrides.planId ?? null,
    createdAt: overrides.createdAt ?? null,
    commanderStatus: overrides.commanderStatus ?? AGENT_SLOT_STATUS.IDLE,
    incidentIds: Array.isArray(overrides.incidentIds) ? [...overrides.incidentIds] : [],
    primaryIncidentId: overrides.primaryIncidentId ?? null,
    affectedNodeIds: Array.isArray(overrides.affectedNodeIds)
      ? [...overrides.affectedNodeIds]
      : [],
    recommendedActions: Array.isArray(overrides.recommendedActions)
      ? overrides.recommendedActions.map(normalizePlanAction)
      : [],
    executionOrder: Array.isArray(overrides.executionOrder)
      ? [...overrides.executionOrder]
      : [],
    expectedImpact: overrides.expectedImpact ?? null,
    policyStatus: overrides.policyStatus ?? null,
    reasoning: overrides.reasoning ?? null,
    approvalStatus: overrides.approvalStatus ?? PLAN_APPROVAL_STATUS.NONE,
    /** STEP 5 lineage — prior plan is context, not authority */
    previousPlanId: overrides.previousPlanId ?? null,
    replanCount: Number.isFinite(Number(overrides.replanCount))
      ? Math.max(0, Math.floor(Number(overrides.replanCount)))
      : 0,
    replanContext: overrides.replanContext ?? null,
    /**
     * Why this primary was chosen:
     * global_recovery_priority | explicit_focus_override | replan_adaptive_recovery_priority
     */
    primarySelectionReason: overrides.primarySelectionReason ?? null,
    focusOverride: overrides.focusOverride === true,
  }
}

export function normalizePlanAction(raw = {}) {
  const actionId =
    raw.actionId == null || raw.actionId === '' ? null : String(raw.actionId)
  const registered = actionId ? RESPONSE_ACTIONS[actionId] : null
  return {
    stepId: raw.stepId ?? null,
    actionId,
    actionType: raw.actionType ?? registered?.actionType ?? null,
    label: raw.label ?? registered?.label ?? null,
    target: raw.target ?? null,
    reason: raw.reason ?? raw.rationale ?? null,
    executionOrder:
      Number.isFinite(Number(raw.executionOrder)) ? Number(raw.executionOrder) : null,
    risk: raw.risk ?? null,
    reversibility:
      typeof raw.reversibility === 'boolean'
        ? raw.reversibility
        : registered
          ? actionId === 'restore-connectivity'
            ? false
            : true
          : null,
    policyStatus: raw.policyStatus ?? null,
    status: raw.status ?? PLAN_ACTION_STATUS.PENDING,
    /** true only when actionId is in the executable simulator registry */
    executable: Boolean(registered && registered.supported === true),
    availability: registered
      ? CAPABILITY_AVAILABILITY.AVAILABLE
      : CAPABILITY_AVAILABILITY.CATALOG,
  }
}

/** Catalog rows for Action Registry UI, grouped by category. */
export function listActionCapabilitiesByCategory() {
  const groups = []
  const order = Object.values(ACTION_CAPABILITY_CATEGORIES)
  for (const category of order) {
    const items = ACTION_CAPABILITY_CATALOG.filter((c) => c.category === category)
    if (items.length) groups.push({ category, items: [...items] })
  }
  return groups
}

/** Executable registry actions currently implemented in the simulator. */
export function listExecutableSimulatorActions() {
  return listRegisteredResponseActions().filter((a) => a.supported === true)
}

/**
 * Whether a plan is eligible for Response Agent handoff.
 * Commander must never bypass this gate.
 */
export function isPlanApprovedForExecution(plan) {
  if (!plan || typeof plan !== 'object') return false
  return plan.approvalStatus === PLAN_APPROVAL_STATUS.APPROVED
}
