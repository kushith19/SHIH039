import { Link } from 'react-router-dom'
import StatusBadge from '../../../ui/StatusBadge'
import EmptyState from '../../../ui/EmptyState'
import { dashboardPanelHref } from '../../dashboard/dashboardPanels.js'
import { ORCHESTRATION_STATUS } from '../../../../shared/response/orchestration.js'

/**
 * Planner step detail — presentation only over plan / incident view helpers.
 * Does not execute actions.
 */

function looksLikeInternalId(value) {
  const s = String(value || '').trim()
  if (!s) return true
  return /^(ep-|inc-|node-)/i.test(s) || /[_:]/.test(s)
}

function humanizeAssetId(value) {
  return String(value || '')
    .replace(/^(ep-|inc-|node-)/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim()
}

function incidentTitle(primaryLabel, endpointId) {
  const label = String(primaryLabel || '').trim()
  if (label && !looksLikeInternalId(label)) return label
  const fromId = humanizeAssetId(label || endpointId)
  return fromId || 'Selected incident'
}

function displayTarget(value) {
  const s = String(value || '').trim()
  if (!s) return null
  if (!looksLikeInternalId(s)) return s
  return humanizeAssetId(s) || s
}

function whyHeadline(headline, title) {
  const raw = String(headline || '').trim()
  if (!raw || /^why resolve this first\??$/i.test(raw)) {
    return title ? `Resolve ${title} first` : null
  }
  if (/ep-|inc-|node-/i.test(raw) || looksLikeInternalId(raw)) {
    return title ? `Resolve ${title} first` : raw
  }
  return raw
}

function ReviewBlock({ title, children }) {
  if (!children) return null
  return (
    <section className="rounded-md border border-[var(--tn-line)] px-3 py-2.5">
      <h4 className="tn-label">{title}</h4>
      <p className="mt-1 text-sm leading-relaxed text-[var(--tn-text)]">{children}</p>
    </section>
  )
}

function ActionCard({ action }) {
  const target = displayTarget(action.target)
  const peer = displayTarget(action.targetPeer)
  return (
    <article className="rounded-md border border-[var(--tn-line)] bg-[var(--tn-elevated)]/25 px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--tn-text)]">{action.label}</p>
        {target ? (
          <p className="tn-meta mt-0.5">
            {target}
            {peer ? ` → ${peer}` : ''}
          </p>
        ) : null}
      </div>

      {action.reason ? (
        <div className="mt-3">
          <div className="tn-label">Why</div>
          <p className="mt-0.5 text-sm leading-relaxed text-[var(--tn-text)]">
            {action.reason}
          </p>
        </div>
      ) : null}

      {action.expectedImpact ? (
        <div className="mt-2">
          <div className="tn-label">Expected outcome</div>
          <p className="mt-0.5 text-sm leading-relaxed text-[var(--tn-text)]">
            {action.expectedImpact}
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <div className="tn-label">Risk</div>
          <p className="mt-0.5 text-sm text-[var(--tn-text)]">{action.risk || '—'}</p>
        </div>
        <div>
          <div className="tn-label">Reversible</div>
          <p className="mt-0.5 text-sm text-[var(--tn-text)]">
            {action.reversibleLabel || '—'}
          </p>
        </div>
        <div>
          <div className="tn-label">Policy</div>
          <div className="mt-0.5">
            {action.policyStatus ? (
              <StatusBadge
                tone={action.policyStatus === 'ALLOWED' ? 'ok' : 'warn'}
              >
                {action.policyStatus}
              </StatusBadge>
            ) : (
              <span className="text-sm text-[var(--tn-text)]">—</span>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

export default function CommanderDetailView({
  status,
  planView,
  actionDetails,
  whyFirst,
  focused,
  handoff = null,
  needsReplan = false,
  primaryLabel = '—',
  analyzeEnabled = false,
  replanEnabled = false,
  busy = null,
  hasIncidents = false,
  searchParams = null,
  plannerError = null,
  onAnalyze = null,
  onReplan = null,
}) {
  const showReplan = needsReplan || handoff?.active
  const analyzingNow =
    status === ORCHESTRATION_STATUS.ANALYZING || busy === 'analyze'
  const hasAuthoritativePlan = Boolean(planView?.plan?.planId) && !planView?.empty
  const llmSelectedPlan = planView?.plan?.planSource === 'llm'
  const planActions =
    analyzingNow || !llmSelectedPlan ? [] : actionDetails?.actions || []
  const title = incidentTitle(primaryLabel, focused?.primary?.endpointId)
  const whyTitle = whyHeadline(whyFirst?.headline, title)
  const whyBullets = (whyFirst?.bullets || []).filter(
    (b) => b.key === 'certain' || b.key === 'may'
  )
  const showPlanNumber =
    Number(actionDetails?.planNumber) > 1 || Boolean(actionDetails?.previousPlanId)
  const planHeading = showPlanNumber
    ? `Response plan · ${actionDetails.planNumber}`
    : 'Recommended response'

  return (
    <div className="space-y-4">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="tn-section-title tracking-wide">Planner</h3>
          <StatusBadge tone="muted">Analyzes · does not execute</StatusBadge>
        </div>
        <p className="tn-meta mt-1">
          Understands the selected incident, reviews evidence, and proposes a
          response plan. Does not execute actions.
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
          <button
            type="button"
            className="tn-btn-primary mt-3"
            disabled={!replanEnabled}
            onClick={() => onReplan?.()}
          >
            {busy === 'replan' ? 'Re-planning…' : 'Retry Planner'}
          </button>
        </div>
      ) : null}

      {status === ORCHESTRATION_STATUS.ANALYZING ? (
        <div
          className="rounded-md border border-[var(--tn-line)] px-3 py-3 text-sm text-[var(--tn-text)]"
          aria-live="polite"
        >
          <p className="font-medium">Analyzing selected incident...</p>
          <p className="tn-meta mt-1">Reviewing telemetry...</p>
          <p className="tn-meta">Building response plan...</p>
        </div>
      ) : null}

      {status === ORCHESTRATION_STATUS.LLM_ERROR ? (
        <div className="rounded-md border border-[var(--tn-crit)]/40 px-3 py-3" role="alert">
          <p className="text-sm font-medium text-[var(--tn-text)]">Planner error</p>
          <p className="tn-meta mt-1">
            {plannerError ||
              'A valid response plan could not be produced. Nothing was executed.'}
          </p>
          <button
            type="button"
            className="tn-btn-primary mt-3"
            disabled={!analyzeEnabled}
            onClick={() => onAnalyze?.()}
          >
            {busy === 'analyze' ? 'Analyzing…' : 'Retry Planner'}
          </button>
        </div>
      ) : null}

      {planView?.empty ? (
        <EmptyState
          title="No active plan"
          body="Press Response on an incident to review evidence and propose a response plan. Planner does not execute actions."
          action={
            hasIncidents ? (
              <button
                type="button"
                className="tn-btn-primary inline-flex"
                disabled={!analyzeEnabled}
                onClick={() => onAnalyze?.()}
              >
                {busy === 'analyze' ? 'Analyzing…' : 'Retry Planner'}
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
        <div className="space-y-3">
          <section className="rounded-md border border-[var(--tn-line)] px-3 py-2.5">
            <div className="tn-label">Primary incident</div>
            <p className="mt-1 text-sm font-medium text-[var(--tn-text)]">{title}</p>
            {focused?.primary?.criticality ? (
              <p className="tn-meta mt-0.5">
                Criticality {String(focused.primary.criticality)}
              </p>
            ) : null}
          </section>

          {!whyFirst?.empty && (whyTitle || whyBullets.length > 0) ? (
            <section className="rounded-md border border-[var(--tn-line)] px-3 py-2.5">
              <div className="tn-label">Why resolve this first?</div>
              {whyTitle ? (
                <p className="mt-1 text-sm font-medium text-[var(--tn-text)]">
                  {whyTitle}
                </p>
              ) : null}
              {whyBullets.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-[var(--tn-text)]">
                  {whyBullets.map((b) => (
                    <li key={b.key} className="flex gap-2">
                      <span className="text-[var(--tn-ok)]" aria-hidden>
                        {b.mark}
                      </span>
                      <span>{b.text}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {planView?.summary ||
          planView?.attackInterpretation ||
          planView?.review ||
          planView?.strategy ||
          planView?.riskAssessment ? (
            <div className="space-y-2">
              <ReviewBlock title="Planner assessment">{planView.summary}</ReviewBlock>
              <ReviewBlock title="What happened">
                {planView.attackInterpretation}
              </ReviewBlock>
              <ReviewBlock title="Evidence review">{planView.review}</ReviewBlock>
              <ReviewBlock title="Recommended approach">{planView.strategy}</ReviewBlock>
              <ReviewBlock title="Risk assessment">
                {planView.riskAssessment}
              </ReviewBlock>
            </div>
          ) : null}

          <section>
            <div className="tn-label">{planHeading}</div>
            <p className="tn-meta mt-1">
              Recommended for operator approval. Planner does not execute these
              actions.
            </p>
            {(planActions || []).length === 0 ? (
              <p className="tn-meta mt-2">
                {analyzingNow
                  ? 'Building recommended response…'
                  : hasAuthoritativePlan && !llmSelectedPlan
                    ? 'Response plan unavailable'
                    : 'No executable actions in this response plan'}
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {planActions.map((action) => (
                  <ActionCard key={action.actionId} action={action} />
                ))}
              </div>
            )}
          </section>

          <p className="tn-meta">
            Next step: Human approval. Nothing runs until an operator approves.
          </p>
        </div>
      )}
    </div>
  )
}
