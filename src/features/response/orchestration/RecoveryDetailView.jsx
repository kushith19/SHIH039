import StatusBadge from '../../../ui/StatusBadge'
import { graphImpactFromVerification } from '../orchestrationView.js'

/**
 * Evidence / Verification detail — observational only (STEP 16).
 * Does not gate workflow continuation or write REPLAN_REQUIRED.
 */
export default function RecoveryDetailView({
  verifyView = null,
  verification = null,
  isVerifying = false,
  isRecovered = false,
}) {
  const impactRows =
    verification != null ? graphImpactFromVerification(verification) : []

  return (
    <div className="space-y-4">
      <header>
        <h3 className="tn-section-title tracking-wide">Evidence / Verification</h3>
        <p className="tn-meta mt-1">
          Observational post-response checks against the pre-response baseline.
          Read-only — does not control workflow, restore connectivity, or close
          incidents.
        </p>
      </header>

      {verifyView?.empty && isVerifying ? (
        <div>
          <StatusBadge tone="warn">Verifying</StatusBadge>
          <p className="tn-meta mt-2">
            Waiting for verification results from the server…
          </p>
        </div>
      ) : null}

      {!verifyView?.empty ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--tn-text)]">
              {verifyView.title}
            </span>
            <StatusBadge
              tone={
                verifyView.episodeRecovered || verifyView.stepVerified
                  ? 'ok'
                  : verifyView.stepFailed
                    ? 'crit'
                    : 'warn'
              }
            >
              {verifyView.episodeRecovered
                ? 'Episode Recovered'
                : verifyView.stepVerified
                  ? 'Step Verified'
                  : verifyView.stepFailed
                    ? 'Failed'
                    : verifyView.verdict || '—'}
            </StatusBadge>
          </div>

          {isRecovered ? (
            <p className="text-sm text-[var(--tn-text)]">
              ✓ Episode recovered — no active non-quarantined response work
              remains. Quarantine held ≠ auto-restored.
            </p>
          ) : verifyView.stepVerified ? (
            <p className="text-sm text-[var(--tn-text)]">
              ✓ Step verified — continuing to remaining approved-scope incidents
              when present. Quarantine held ≠ episode recovered.
            </p>
          ) : null}

          {verifyView.checkRows?.length > 0 ? (
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

          {(verifyView.failReasons || []).length > 0 ? (
            <div>
              <div className="tn-label">Fail reasons</div>
              <ul className="mt-1 space-y-1 text-sm text-[var(--tn-crit)]">
                {verifyView.failReasons.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {(verifyView.passNotes || []).length > 0 ? (
            <div>
              <div className="tn-label">Pass notes</div>
              <ul className="mt-1 space-y-1 text-sm text-[var(--tn-text)]">
                {verifyView.passNotes.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {(verifyView.reasons || []).length > 0 &&
          !(verifyView.failReasons || []).length ? (
            <ul className="space-y-1 text-sm text-[var(--tn-text)]">
              {verifyView.reasons.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          ) : null}

          {impactRows.length > 0 ? (
            <div>
              <div className="tn-label">Graph impact (before → after)</div>
              <p className="tn-meta mt-0.5 mb-2">
                From verification baseline vs current snapshot.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {impactRows.map((m) => (
                  <div key={m.key}>
                    <div className="tn-label">{m.label}</div>
                    <p className="text-sm text-[var(--tn-text)]">
                      {m.before} → {m.after}
                    </p>
                    {m.note ? (
                      <p className="tn-meta text-[11px]">{m.note}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {(verifyView.recommendedNextActions || []).length > 0 ? (
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
      ) : !isVerifying ? (
        <p className="text-sm text-[var(--tn-muted)]">
          No verification result yet. Recovery runs after Response Agent
          completes approved actions.
        </p>
      ) : null}
    </div>
  )
}
