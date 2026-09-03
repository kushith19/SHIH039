import { useMemo } from 'react'
import StatusBadge from '../../ui/StatusBadge'
import { formatScoreOver100 } from '@shared/riskMomentum.js'
import { RESIDUAL_BAND, computeFinancialExposure } from '@shared/financialExposure.js'

function bandTone(band) {
  if (band === RESIDUAL_BAND.HIGH) return 'crit'
  if (band === RESIDUAL_BAND.ELEVATED) return 'warn'
  return 'muted'
}

function bandColor(band) {
  if (band === RESIDUAL_BAND.HIGH) return 'var(--tn-crit)'
  if (band === RESIDUAL_BAND.ELEVATED) return 'var(--tn-warn)'
  return 'var(--tn-text)'
}

function ResidualRing({ score, available, band }) {
  const r = 22
  const c = 2 * Math.PI * r
  const pct = available && score != null ? Math.max(0, Math.min(100, Number(score))) / 100 : 0
  const dash = c * pct
  const color = bandColor(band)

  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden className="shrink-0">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--tn-line)" strokeWidth="4" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 28 28)"
      />
    </svg>
  )
}

export default function FinancialExposureCard({ detection = null, nodes = [], edges = [] }) {
  const view = useMemo(
    () => computeFinancialExposure({ detection, nodes, edges }),
    [detection, nodes, edges]
  )
  const scoreText = view.cyberScoreAvailable ? formatScoreOver100(view.cyberScore) : '— / 100'
  const tone = bandTone(view.residualBand)

  return (
    <section className="tn-surface px-5 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="tn-section-title tracking-wide">Cyber-physical financial exposure</h2>
          <p className="tn-meta mt-1 max-w-xl">
            Business impact derived from cyber risk, infrastructure criticality, propagation and
            financial exposure.
          </p>
        </div>
        <StatusBadge tone="muted">Simulated exposure</StatusBadge>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="flex items-center gap-4">
          <ResidualRing
            score={view.cyberScore}
            available={view.cyberScoreAvailable}
            band={view.residualBand}
          />
          <div className="min-w-0">
            <div className="tn-label">Cyber risk</div>
            <div className="mt-1 font-mono text-[1.375rem] font-medium leading-7 tabular-nums">
              {scoreText}
            </div>
            <div className="mt-1">
              <StatusBadge tone={view.cyberScoreAvailable ? tone : 'muted'}>
                {view.cyberScoreAvailable ? view.residualBand : 'WAITING'}
              </StatusBadge>
            </div>
          </div>
        </div>
        <div>
          <div className="tn-label">Financial exposure</div>
          <div className="mt-1 font-mono text-[1.375rem] font-medium leading-7 tabular-nums">
            {view.exposureLabel}
          </div>
          <p className="tn-meta mt-1">Simulated exposure — not a loss forecast</p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-[var(--tn-line)] pt-5 sm:grid-cols-3">
        <div>
          <dt className="tn-label">Affected services</dt>
          <dd className="mt-1 font-mono text-lg font-medium tabular-nums">{view.affectedServices}</dd>
        </div>
        <div>
          <dt className="tn-label">Critical dependencies</dt>
          <dd className="mt-1 font-mono text-lg font-medium tabular-nums">{view.criticalDependencies}</dd>
        </div>
        <div>
          <dt className="tn-label">Est. blast radius</dt>
          <dd className="mt-1 font-mono text-lg font-medium tabular-nums">
            {view.blastRadius} {view.blastRadius === 1 ? 'node' : 'nodes'}
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        <div className="tn-label">Business impact</div>
        <p className="mt-1 text-sm leading-relaxed text-[var(--tn-text)]">{view.explanation}</p>
      </div>
    </section>
  )
}
