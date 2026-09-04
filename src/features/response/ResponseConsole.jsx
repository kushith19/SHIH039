import { useEffect, useMemo, useRef, useState } from 'react'
import StatusBadge from '../../ui/StatusBadge'
import {
  LLM_RESPONSE_UI_STATUS,
  RESPONSE_ACTION_UI_STATUS,
  actionStatusLabel,
  executeButtonLabel,
  exposureLabelFromContext,
  formatRiskDisplay,
  formatTrustDisplay,
  incidentIdForExecute,
  isExecuteDisabled,
  llmResponseBannerView,
  logResponseUiTransition,
  noExecutableActionsCopy,
  postCommanderExecute,
  responseActionRows,
  responseStatusCopy,
  severityTone,
  userSafeExecuteError,
} from './responseConsoleView.js'

/**
 * Response Console — displays incident context and wires EXECUTE to the
 * existing POST /rooms/:roomId/commander/execute endpoint.
 * Does not invent recovery or mutate risk/TGNN/finance in the frontend.
 */
export default function ResponseConsole({
  roomId = '',
  context = null,
  responsePlan = null,
  loading = false,
  error = null,
  analyzing = false,
  analyzeFailed = false,
  analyzeError = null,
  analyzeAttempted = false,
  socketPlan = null,
  debugLast = null,
  onRefreshContext = null,
}) {
  /** @type {Record<string, { uiStatus: string, result?: object, message?: string }>} */
  const [localByAction, setLocalByAction] = useState({})
  const actionListRef = useRef(null)
  const scrollToAvailableRef = useRef(false)
  const lastLogKeyRef = useRef('')

  const actions = useMemo(
    () =>
      analyzing || analyzeFailed
        ? []
        : responseActionRows(context, localByAction, responsePlan),
    [analyzing, analyzeFailed, context, localByAction, responsePlan]
  )

  const planId = responsePlan?.planId ?? null
  useEffect(() => {
    setLocalByAction({})
  }, [analyzing, planId])

  const banner = llmResponseBannerView({
    waiting: analyzing,
    failed: analyzeFailed,
    error: analyzeError,
    visiblePlan: analyzing || analyzeFailed ? null : responsePlan,
    socketPlan,
    analyzeAttempted,
    debugLast,
  })

  useEffect(() => {
    const key = analyzing
      ? `wait:${planId ?? 'none'}`
      : analyzeFailed
        ? `fail:${analyzeError ?? ''}`
        : actions.length > 0
          ? `recv:${planId}:${actions.length}`
          : `none:${banner.status}`
    if (lastLogKeyRef.current === key) return
    lastLogKeyRef.current = key
    if (analyzing) {
      logResponseUiTransition('WAITING_FOR_LLM')
      return
    }
    if (actions.length > 0) {
      logResponseUiTransition('LLM_RESPONSE_RECEIVED', {
        planSource: responsePlan?.planSource,
        actionCount: actions.length,
      })
      return
    }
    if (analyzeFailed || banner.status === LLM_RESPONSE_UI_STATUS.NO_LLM_RESPONSE) {
      logResponseUiTransition('NO_LLM_RESPONSE', {
        planSource: socketPlan?.planSource ?? responsePlan?.planSource ?? '',
      })
    }
  }, [
    analyzing,
    analyzeFailed,
    analyzeError,
    actions.length,
    banner.status,
    planId,
    responsePlan?.planSource,
    socketPlan?.planSource,
  ])

  useEffect(() => {
    if (!scrollToAvailableRef.current) return
    const available = actions.find(
      (action) => action.uiStatus === RESPONSE_ACTION_UI_STATUS.AVAILABLE
    )
    if (!available) return
    scrollToAvailableRef.current = false
    const id =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(available.actionId)
        : available.actionId
    const list = actionListRef.current
    const el = list?.querySelector(`[data-action-id="${id}"]`)
    if (!list || !el) return
    const top = el.offsetTop - list.offsetTop
    list.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' })
  }, [actions])

  const primaryExecution = useMemo(() => {
    for (const action of actions) {
      const local = localByAction[action.actionId]
      if (local?.uiStatus === RESPONSE_ACTION_UI_STATUS.EXECUTING) {
        return {
          status: RESPONSE_ACTION_UI_STATUS.EXECUTING,
          actionId: action.actionId,
        }
      }
      if (local?.result) {
        return {
          status: local.result.status,
          actionId: local.result.actionId || action.actionId,
          target: local.result.target,
          executedAtMs: local.result.executedAtMs,
          message: local.message,
        }
      }
      if (local?.uiStatus === RESPONSE_ACTION_UI_STATUS.FAILED) {
        return {
          status: RESPONSE_ACTION_UI_STATUS.FAILED,
          actionId: action.actionId,
          message: local.message,
        }
      }
      if (
        action.uiStatus === RESPONSE_ACTION_UI_STATUS.EXECUTED ||
        action.uiStatus === RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED
      ) {
        const taken = Array.isArray(context?.actionsAlreadyTaken)
          ? context.actionsAlreadyTaken
          : []
        const entry = [...taken]
          .reverse()
          .find((a) => a && typeof a === 'object' && a.actionId === action.actionId)
        return {
          status: action.uiStatus,
          actionId: action.actionId,
          target: entry?.targetNodeId
            ? { id: entry.targetNodeId, name: action.targetName }
            : { id: action.targetId, name: action.targetName },
          executedAtMs: entry?.executedAtMs,
        }
      }
    }
    return null
  }, [actions, localByAction, context])

  if (loading && !context && !analyzing) {
    return (
      <section className="soc-zone px-5 py-5">
        <div className="soc-zone-title">Response Console</div>
        <p className="mt-3 text-sm text-[var(--tn-muted)]">
          Loading incident context…
        </p>
      </section>
    )
  }

  if (error && !context) {
    return (
      <section className="soc-zone px-5 py-5">
        <div className="soc-zone-title">Response Console</div>
        <p className="mt-3 text-sm text-[var(--tn-crit)]">{error}</p>
      </section>
    )
  }

  if (!context) {
    return (
      <section className="soc-zone px-5 py-5">
        <div className="soc-zone-title">Response Console</div>
        <section
          className="mt-3 rounded-md border border-[var(--tn-line)] px-3 py-3"
          data-testid="llm-response-proof"
          aria-live="polite"
        >
          <div className="soc-zone-title">LLM RESPONSE</div>
          <p className="mt-1.5 text-sm font-medium">Status: {banner.status}</p>
          {banner.detail ? (
            <p className="tn-meta mt-1 text-[12px]">{banner.detail}</p>
          ) : null}
          {banner.error ? (
            <p className="mt-1 text-sm text-[var(--tn-crit)]">
              Error: {banner.error}
            </p>
          ) : null}
        </section>
      </section>
    )
  }

  const asset =
    context.affectedAsset?.summary ||
    context.affectedAsset?.id ||
    'Unknown asset'
  const status = context.status || context.currentStatus || 'open'
  const risk = formatRiskDisplay(context.riskScore)
  const trust = formatTrustDisplay(context.trustScore)
  const exposure = exposureLabelFromContext(context)
  const blast =
    context.blastRadius != null && Number.isFinite(Number(context.blastRadius))
      ? Number(context.blastRadius)
      : null
  const peerCount = Array.isArray(context.peerExposure) ? context.peerExposure.length : 0
  const propCount = Array.isArray(context.propagatedNodeIds)
    ? context.propagatedNodeIds.length
    : 0
  const statusCopy = responseStatusCopy({
    hasActions: actions.length > 0,
    actionCount: actions.length,
    execution: primaryExecution,
  })
  const emptyActions = noExecutableActionsCopy(context, responsePlan)

  async function handleExecute(action) {
    if (!action.canExecute || isExecuteDisabled(action.uiStatus)) return

    const incidentId = incidentIdForExecute(context)
    if (!incidentId || !roomId) {
      setLocalByAction((prev) => ({
        ...prev,
        [action.actionId]: {
          uiStatus: RESPONSE_ACTION_UI_STATUS.FAILED,
          message: 'Unable to execute this response action for the incident.',
        },
      }))
      return
    }

    setLocalByAction((prev) => ({
      ...prev,
      [action.actionId]: { uiStatus: RESPONSE_ACTION_UI_STATUS.EXECUTING },
    }))

    try {
      const result = await postCommanderExecute(roomId, {
        incidentId,
        actionId: action.actionId,
      })
      if (!result.ok) {
        setLocalByAction((prev) => ({
          ...prev,
          [action.actionId]: {
            uiStatus: RESPONSE_ACTION_UI_STATUS.FAILED,
            message: userSafeExecuteError(result.message),
          },
        }))
        return
      }
      const nextStatus =
        result.status === RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED
          ? RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED
          : RESPONSE_ACTION_UI_STATUS.EXECUTED
      setLocalByAction((prev) => ({
        ...prev,
        [action.actionId]: {
          uiStatus: nextStatus,
          result,
        },
      }))
      scrollToAvailableRef.current = true
      if (typeof onRefreshContext === 'function') {
        await onRefreshContext()
      }
    } catch (err) {
      setLocalByAction((prev) => ({
        ...prev,
        [action.actionId]: {
          uiStatus: RESPONSE_ACTION_UI_STATUS.FAILED,
          message: userSafeExecuteError(err?.message),
        },
      }))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="soc-role-chip soc-role-execution">Execution</span>
        <span className="tn-meta text-[12px]">
          Registered containment actions · not advisory recommendations
        </span>
      </div>

      <section className="soc-zone soc-zone-accent flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--tn-line)] px-5 py-3">
          <div>
            <div className="soc-zone-title">Response Console</div>
            <h2 className="mt-1 text-lg font-medium text-[var(--tn-text)]">{asset}</h2>
            <p className="tn-meta mt-0.5 text-[12px]">
              {context.severity || 'unknown'} severity
              {context.incidentId ? ` · ${context.incidentId}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={severityTone(context.severity)}>
              {context.severity || 'low'}
            </StatusBadge>
            <StatusBadge tone={status === 'open' ? 'warn' : 'muted'}>
              {status === 'open' ? 'INCIDENT ACTIVE' : status}
            </StatusBadge>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:overflow-hidden">
          <div className="min-h-0 border-b border-[var(--tn-line)] px-5 py-4 lg:overflow-y-auto lg:border-r lg:border-b-0">
            <h3 className="soc-zone-title">Current state</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3 font-mono tabular-nums sm:grid-cols-3 lg:grid-cols-2">
              <div>
                <dt className="tn-label">Risk</dt>
                <dd className="mt-0.5 text-base">{risk == null ? '—' : risk}</dd>
              </div>
              <div>
                <dt className="tn-label">Trust</dt>
                <dd className="mt-0.5 text-base">{trust == null ? '—' : trust}</dd>
              </div>
              <div>
                <dt className="tn-label">Blast radius</dt>
                <dd className="mt-0.5 text-base">{blast == null ? '—' : blast}</dd>
              </div>
              <div>
                <dt className="tn-label">Exposure</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-base">
                  <span>{exposure || '—'}</span>
                  {exposure ? (
                    <span className="soc-role-chip soc-role-simulated">Sim</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="tn-label">Peer exposed</dt>
                <dd className="mt-0.5 text-base">{peerCount}</dd>
              </div>
              <div>
                <dt className="tn-label">Propagated</dt>
                <dd className="mt-0.5 text-base">{propCount}</dd>
              </div>
            </dl>
            {exposure ? (
              <p className="tn-meta mt-2 text-[11px]">
                Simulated exposure from incident context — not a loss forecast.
              </p>
            ) : null}
            {context.incidentType ? (
              <p className="tn-meta mt-1 text-[11px]">Type · {context.incidentType}</p>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden px-5 py-4">
            <h3 className="soc-zone-title shrink-0">Response actions</h3>
            <section
              className="mt-3 shrink-0 rounded-md border border-[var(--tn-line)] px-3 py-3"
              data-testid="llm-response-proof"
              aria-live="polite"
            >
              <div className="soc-zone-title">LLM RESPONSE</div>
              <p className="mt-1.5 text-sm font-medium">
                Status: {banner.status}
              </p>
              {banner.detail ? (
                <p className="tn-meta mt-1 text-[12px]">{banner.detail}</p>
              ) : null}
              {banner.error ? (
                <p className="mt-1 text-sm text-[var(--tn-crit)]">
                  Error: {banner.error}
                </p>
              ) : null}
              {banner.fields.map((field) => (
                <p key={field.label} className="tn-meta mt-1 text-[12px]">
                  {field.label}: {field.value}
                </p>
              ))}
            </section>
            {analyzing ? (
              <p className="mt-3 text-sm text-[var(--tn-text)]" aria-live="polite">
                Generating response plan with Qwen…
              </p>
            ) : null}
            {!analyzing && analyzeFailed ? (
              <p className="mt-3 text-sm text-[var(--tn-crit)]" role="alert">
                LLM Response Plan unavailable
                {analyzeError ? `: ${analyzeError}` : ''}
              </p>
            ) : null}
            {!analyzing && !analyzeFailed && actions.length === 0 ? (
              <div className="mt-3">
                {emptyActions.title ? (
                  <div className="text-sm font-medium uppercase tracking-wide">
                    {emptyActions.title}
                  </div>
                ) : null}
                <p className={`tn-meta ${emptyActions.title ? 'mt-2' : 'mt-3'}`}>
                  {emptyActions.detail}
                </p>
              </div>
            ) : (
              <ul
                ref={actionListRef}
                className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
              >
                {actions.map((action) => {
                  const disabled =
                    !action.canExecute || isExecuteDisabled(action.uiStatus)
                  const badgeTone =
                    action.uiStatus === RESPONSE_ACTION_UI_STATUS.FAILED
                      ? 'crit'
                      : action.uiStatus === RESPONSE_ACTION_UI_STATUS.EXECUTED ||
                          action.uiStatus === RESPONSE_ACTION_UI_STATUS.ALREADY_EXECUTED
                        ? 'ok'
                        : action.uiStatus === RESPONSE_ACTION_UI_STATUS.EXECUTING
                          ? 'warn'
                          : 'muted'
                  return (
                    <li
                      key={action.actionId}
                      data-action-id={action.actionId}
                      data-testid="response-action-card"
                      data-action-available={
                        action.uiStatus === RESPONSE_ACTION_UI_STATUS.AVAILABLE
                          ? 'true'
                          : undefined
                      }
                      className="scroll-mt-3 rounded-md border border-[var(--tn-line)] px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="tn-label">
                              {action.category || action.responseProfile || 'Response'}
                            </span>
                            {action.aiRecommended ? (
                              <span className="soc-role-chip soc-role-commander">
                                AI Recommended
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-sm font-medium uppercase tracking-wide">
                            {action.label}
                          </div>
                          <p className="tn-meta mt-1 text-[12px]">
                            {action.description}
                          </p>
                          {action.aiRecommended && action.rationale ? (
                            <p className="mt-2 text-sm">
                              <span className="tn-label">Why:</span>{' '}
                              {action.rationale}
                            </p>
                          ) : null}
                          {action.expectedImpact ? (
                            <p className="tn-meta mt-1 text-[12px]">
                              <span className="tn-label">Expected impact:</span>{' '}
                              {action.expectedImpact}
                            </p>
                          ) : null}
                        </div>
                        <StatusBadge tone={badgeTone}>
                          {actionStatusLabel(action.uiStatus)}
                        </StatusBadge>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <dt className="tn-label">Target</dt>
                          <dd className="mt-0.5 font-medium">
                            {action.targetName || action.targetId || '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="tn-label">Action ID</dt>
                          <dd className="tn-meta mt-0.5 font-mono text-[11px]">
                            {action.actionId}
                          </dd>
                        </div>
                        <div>
                          <dt className="tn-label">Policy</dt>
                          <dd className="mt-0.5">{action.policyStatus}</dd>
                        </div>
                        <div>
                          <dt className="tn-label">Support</dt>
                          <dd className="mt-0.5">
                            {action.supported ? 'EXECUTABLE' : 'UNSUPPORTED'}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          className="tn-btn-primary"
                          disabled={disabled}
                          aria-busy={
                            action.uiStatus === RESPONSE_ACTION_UI_STATUS.EXECUTING
                          }
                          onClick={() => {
                            void handleExecute(action)
                          }}
                        >
                          {executeButtonLabel(action.uiStatus)}
                        </button>
                      </div>
                      {action.uiStatus === RESPONSE_ACTION_UI_STATUS.FAILED &&
                      localByAction[action.actionId]?.message ? (
                        <p className="mt-2 text-sm text-[var(--tn-crit)]">
                          {localByAction[action.actionId].message}
                        </p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="soc-zone shrink-0 px-5 py-3">
        <h3 className="soc-zone-title">Response status</h3>
        <p className="mt-1.5 text-sm font-medium">{statusCopy.title}</p>
        <p className="tn-meta mt-0.5 text-[12px]">{statusCopy.detail}</p>
      </section>
    </div>
  )
}
