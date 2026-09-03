import { useState } from 'react'
import ThreatSummary from './ThreatSummary'
import RiskBreakdown from './RiskBreakdown'
import EvidenceCards from './EvidenceCards'
import GraphImpactPanel from './GraphImpactPanel'
import MitreCandidateCard from './MitreCandidateCard'
import ResponsePlan from './ResponsePlan'
import KnowledgeCitation from './KnowledgeCitation'
import InvestigationQueue from './InvestigationQueue'
import CommanderInput from './CommanderInput'
import { FilterChip } from '../../ui/Toolbar'
import { normalizeBriefing } from './commanderBriefing.js'

const SECTIONS = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'graph', label: 'Graph' },
  { id: 'response', label: 'Response' },
  { id: 'sources', label: 'Sources' },
]

export default function CommanderPanel({
  roomId,
  briefing: briefingProp,
  posture,
  incidents = [],
  campaigns = [],
}) {
  const briefing = normalizeBriefing(briefingProp)
  const live = (campaigns ?? []).filter((c) => c.status && c.status !== 'expired')
  const mitre = briefing?.mitreCandidates || live[0]?.mitreCandidates || []
  const plan = briefing?.responsePlan || []
  const citations = briefing?.citations?.length ? briefing.citations : briefing?.evidence || []
  const [section, setSection] = useState('evidence')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-auto pr-1">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <ThreatSummary
            assessment={briefing?.assessment}
            knowledgeStatus={briefing?.knowledgeStatus}
            campaignId={briefing?.campaignId}
          />
          {posture ? (
            <section className="tn-surface grid grid-cols-2 px-1 py-1">
              <HeroStat label="City posture" value={posture.overallRisk} />
              <HeroStat label="Trend" value={posture.riskTrend} />
              <HeroStat label="Priority asset" value={posture.priorityAsset || '—'} />
              <HeroStat
                label="Finance"
                value={
                  posture.financeRelevant
                    ? 'Finance-tagged assets in set'
                    : 'No finance-tagged assets'
                }
              />
            </section>
          ) : null}
        </div>
        <RiskBreakdown risk={briefing?.risk || posture?.risk} />

        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <FilterChip
              key={s.id}
              active={section === s.id}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </FilterChip>
          ))}
        </div>

        {section === 'evidence' ? (
          <div className="space-y-6">
            <EvidenceCards incidents={incidents} />
            <MitreCandidateCard
              candidates={
                Array.isArray(mitre) && mitre.length && typeof mitre[0] === 'string'
                  ? mitre.map((id) => ({
                      techniqueId: id,
                      reason: 'Catalog candidate — requires verification',
                    }))
                  : mitre
              }
            />
          </div>
        ) : null}

        {section === 'graph' ? (
          <GraphImpactPanel graphContext={briefing?.graphContext} />
        ) : null}

        {section === 'response' ? (
          <div className="space-y-6">
            <ResponsePlan steps={plan} />
            <InvestigationQueue steps={briefing?.investigationSteps} />
            {briefing?.financialImpact ? (
              <section className="tn-surface px-5 py-5">
                <h2 className="tn-section-title">Financial / operational impact</h2>
                <p className="mt-3 text-sm leading-relaxed">{briefing.financialImpact}</p>
              </section>
            ) : null}
          </div>
        ) : null}

        {section === 'sources' ? (
          <div className="space-y-6">
            <details className="tn-surface px-5 py-5" open>
              <summary className="cursor-pointer text-sm font-medium">Rationale</summary>
              <p className="tn-meta mt-3 leading-relaxed">
                {briefing?.epistemic?.inference ||
                  briefing?.assessment?.summary ||
                  'Rationale appears when a briefing is composed from detections and catalog correlation.'}
              </p>
              {briefing?.uncertainties?.length ? (
                <ul className="tn-meta mt-3 list-disc pl-5">
                  {briefing.uncertainties.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              ) : null}
            </details>
            <KnowledgeCitation citations={citations} knowledgeStatus={briefing?.knowledgeStatus} />
          </div>
        ) : null}
      </div>
      <div className="sticky bottom-0 mt-4 shrink-0 border-t border-[var(--tn-line)] bg-[var(--tn-canvas)] pt-4">
        <CommanderInput roomId={roomId} />
      </div>
    </div>
  )
}

function HeroStat({ label, value }) {
  return (
    <div className="px-4 py-4">
      <div className="tn-label">{label}</div>
      <div className="mt-1 truncate text-sm font-medium capitalize">{value}</div>
    </div>
  )
}
