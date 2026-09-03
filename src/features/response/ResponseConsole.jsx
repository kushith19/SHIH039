import { useMemo, useState } from 'react'
import StatusBadge from '../../ui/StatusBadge'
import {
  RESPONSE_ACTION_UI_STATUS,
  executeButtonLabel,
  exposureLabelFromContext,
  formatRiskDisplay,
  formatTrustDisplay,
  incidentIdForExecute,
  isExecuteDisabled,
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
  loading = false,
  error = null,
  onRefreshContext = null,
}) {
  /** @type {Record<string, { uiStatus: string, result?: object, message?: string }>} */
  const [localByAction, setLocalByAction] = useState({})

  const actions = useMemo(
    () => responseActionRows(context, localByAction),
    [context, localByAction]
  )

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

  if (loading) {
    return (
      <section className="tn-surface px-5 py-5">
        <div className="tn-label">Response Console</div>
        <p className="mt-3 text-sm text-[var(--tn-muted)]">Loading incident context…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="tn-surface px-5 py-5">
        <div className="tn-label">Response Console</div>
        <p className="mt-3 text-sm text-[var(--tn-crit)]">{error}</p>
      </section>
    )
  }

  if (!context) {
    return (
      <section className="tn-surface px-5 py-5">
        <div className="tn-label">Response Console</div>
        <p className="mt-3 text-sm text-[var(--tn-muted)]">
          Select an incident to open the operational response console.
        </p>
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
  const emptyActions = noExecutableActionsCopy(context)

  async function handleExecute(action) {
    if (isExecuteDisabled(action.uiStatus)) return

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
    <div className="space-y-4">
      <section className="tn-surface overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--tn-line)] px-5 py-4">
          <div>
            <div className="tn-label">Response Console</div>
            <h2 className="mt-1 text-lg font-medium text-[var(--tn-text)]">{asset}</h2>
            <p className="tn-meta mt-1">
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

        <div className="grid gap-0 lg:grid-cols-2">
          <div className="border-b border-[var(--tn-line)] px-5 py-5 lg:border-r lg:border-b-0">
            <h3 className="tn-section-title">Current state</h3>
            <dl className="mt-4 grid grid-cols-2 gap-4 font-mono tabular-nums sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="tn-label">Risk</dt>
                <dd className="mt-1 text-base">{risk == null ? '—' : risk}</dd>
              </div>
              <div>
                <dt className="tn-label">Trust</dt>
                <dd className="mt-1 text-base">{trust == null ? '—' : trust}</dd>
              </div>
              <div>
                <dt className="tn-label">Blast radius</dt>
                <dd className="mt-1 text-base">{blast == null ? '—' : blast}</dd>
              </div>
              <div>
                <dt className="tn-label">Exposure</dt>
                <dd className="mt-1 text-base">{exposure || '—'}</dd>
              </div>
              <div>
                <dt className="tn-label">Peer exposed</dt>
                <dd className="mt-1 text-base">{peerCount}</dd>
              </div>
              <div>
                <dt className="tn-label">Propagated</dt>
                <dd className="mt-1 text-base">{propCount}</dd>
              </div>
            </dl>
            {exposure ? (
              <p className="tn-meta mt-3">
                Simulated exposure from incident context — not a loss forecast.
              </p>
            ) : null}
            {context.incidentType ? (
              <p className="tn-meta mt-2">Type · {context.incidentType}</p>
            ) : null}
          </div>

          <div className="px-5 py-5">
            <h3 className="tn-section-title">Response actions</h3>
            {actions.length === 0 ? (
              <div className="mt-4">
                {emptyActions.title ? (
                  <div className="text-sm font-medium uppercase tracking-wide">
                    {emptyActions.title}
                  </div>
                ) : null}
                <p className={`tn-meta ${emptyActions.title ? 'mt-2' : 'mt-4'}`}>
                  {emptyActions.detail}
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-4">
                {actions.map((action) => {
                  const disabled = isExecuteDisabled(action.uiStatus)
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
                      className="rounded-md border border-[var(--tn-line)] px-4 py-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          {action.profileLabel ? (
                            <div className="tn-label">{action.profileLabel}</div>
                          ) : null}
                          <div
                            className={`text-sm font-medium uppercase tracking-wide ${
                              action.profileLabel ? 'mt-1' : ''
                            }`}
                          >
                            {action.label}
                          </div>
                          <p className="tn-meta mt-1">
                            {action.rationale || action.description}
                          </p>
                        </div>
                        <StatusBadge tone={badgeTone}>{action.uiStatus}</StatusBadge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                        <div className="text-sm">
                          <span className="tn-label">Target</span>
                          <div className="mt-0.5 font-medium">
                            {action.targetName || action.targetId || '—'}
                          </div>
                          {action.actionType ? (
                            <p className="tn-meta mt-1">{action.actionType}</p>
                          ) : null}
                        </div>
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

      <section className="tn-surface px-5 py-4">
        <h3 className="tn-section-title">Response status</h3>
        <p className="mt-2 text-sm font-medium">{statusCopy.title}</p>
        <p className="tn-meta mt-1">{statusCopy.detail}</p>
      </section>
    </div>
  )
}
