import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ThreatSummary from './ThreatSummary'
import RiskBreakdown from './RiskBreakdown'
import EvidenceCards from './EvidenceCards'
import GraphImpactPanel from './GraphImpactPanel'
import MitreCandidateCard from './MitreCandidateCard'
import ResponsePlan from './ResponsePlan'
import KnowledgeCitation from './KnowledgeCitation'
import InvestigationQueue from './InvestigationQueue'
import CommanderInput from './CommanderInput'
import IncidentCommanderAgent from './IncidentCommanderAgent'
import CommanderKnowledgeDrawer from './CommanderKnowledgeDrawer'
import { FilterChip } from '../../ui/Toolbar'
import { normalizeBriefing } from './commanderBriefing.js'
import {
  COMMANDER_MODES,
  buildIncidentIntel,
} from '@shared/commanderIncidentIntel.js'
import { commanderIntelSyncKey } from './commanderIntelSyncKey.js'
import {
  intelRequestIdentity,
  mergeIntelKnowledge,
  shouldApplyIntelUpdate,
} from './commanderIntelApply.js'
import { dashboardResponseIncidentHref } from '../dashboard/dashboardPanels.js'

const SECTIONS = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'graph', label: 'Graph' },
  { id: 'response', label: 'Plan' },
  { id: 'sources', label: 'Sources' },
]

export default function CommanderPanel({
  roomId,
  briefing: briefingProp,
  posture,
  incidents = [],
  focusIncidentId = null,
  // Accepted for API compat; ticks must not drive RAG (see commanderIntelSyncKey).
  simulationTick: _simulationTick = null,
  detection = null,
}) {
  const [searchParams] = useSearchParams()
  const briefing = normalizeBriefing(briefingProp)
  const mitre = briefing?.mitreCandidates || []
  const plan = briefing?.responsePlan || []
  const citations = briefing?.citations?.length ? briefing.citations : briefing?.evidence || []
  const [section, setSection] = useState('evidence')
  const [isKnowledgeOpen, setIsKnowledgeOpen] = useState(false)
  const [incidentContext, setIncidentContext] = useState(null)
  const [mode, setMode] = useState(COMMANDER_MODES.INVESTIGATE)
  const [intel, setIntel] = useState(null)
  const requestSeqRef = useRef(0)
  const identityRef = useRef('')

  const intelSyncKey = commanderIntelSyncKey(detection)

  useEffect(() => {
    if (focusIncidentId) setMode(COMMANDER_MODES.INVESTIGATE)
  }, [focusIncidentId])

  useEffect(() => {
    if (!roomId || !focusIncidentId) {
      setIncidentContext(null)
      setIntel(null)
      identityRef.current = ''
      return undefined
    }

    const identity = intelRequestIdentity({
      roomId,
      incidentId: focusIncidentId,
      mode,
    })
    identityRef.current = identity
    const requestSeq = ++requestSeqRef.current
    let cancelled = false

    const apply = (context, nextIntel) => {
      if (cancelled) return
      if (
        !shouldApplyIntelUpdate({
          requestSeq,
          latestSeq: requestSeqRef.current,
          identity,
          latestIdentity: identityRef.current,
        })
      ) {
        return
      }
      if (context) setIncidentContext(context)
      setIntel((prev) => mergeIntelKnowledge(prev, nextIntel))
    }

    const load = async () => {
      try {
        const ctxRes = await fetch(
          `/rooms/${encodeURIComponent(roomId)}/incidents/${encodeURIComponent(focusIncidentId)}/commander-context`
        )
        const ctxJson = await ctxRes.json()
        if (cancelled) return
        if (ctxRes.ok && ctxJson.context) {
          apply(ctxJson.context, buildIncidentIntel(ctxJson.context, mode))
        }
      } catch {
        /* phase-2 may still succeed */
      }

      try {
        const res = await fetch(
          `/rooms/${encodeURIComponent(roomId)}/commander/incident-intel`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ incidentId: focusIncidentId, mode }),
          }
        )
        const json = await res.json()
        if (cancelled) return
        if (!res.ok || json.ok === false) {
          return
        }
        const nextIntel =
          json.intel ?? (json.context ? buildIncidentIntel(json.context, mode) : null)
        apply(json.context ?? null, nextIntel)
      } catch {
        /* keep phase-1 intel if present */
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [roomId, focusIncidentId, mode, intelSyncKey])

  if (focusIncidentId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="soc-role-chip soc-role-advisory">Advisory</span>
          <span className="tn-meta text-[12px]">
            Decision support only · does not execute infrastructure actions
          </span>
          <Link
            to={dashboardResponseIncidentHref(searchParams, focusIncidentId)}
            replace
            className="tn-btn-primary ml-auto"
          >
            Open Response →
          </Link>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {incidentContext ? (
            <IncidentCommanderAgent
              context={incidentContext}
              mode={mode}
              onModeChange={setMode}
              intel={intel}
              roomId={roomId}
              incidentId={focusIncidentId}
              responseHref={dashboardResponseIncidentHref(searchParams, focusIncidentId)}
            />
          ) : (
            <section className="soc-zone px-5 py-5">
              <div className="soc-zone-title">AI Commander</div>
              <p className="mt-3 text-sm">Loading structured incident context…</p>
            </section>
          )}
        </div>
      </div>
    )
  }

  const graphBlurb =
    briefing?.graphContext?.localSummary ||
    briefing?.graphContext?.summary ||
    briefing?.assessment?.graphNote ||
    null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="soc-role-chip soc-role-advisory">Advisory</span>
        <span className="tn-meta text-[12px]">
          Room briefing · select an incident for full investigate / respond
        </span>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-auto pr-12">
        <div className="soc-zone overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <ThreatSummary
              assessment={briefing?.assessment}
              knowledgeStatus={briefing?.knowledgeStatus}
              campaignId={briefing?.campaignId}
              embedded
            />
            {posture ? (
              <div className="grid grid-cols-2 border-t border-[var(--tn-line)] lg:border-t-0 lg:border-l">
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
              </div>
            ) : null}
          </div>
        </div>

        <RiskBreakdown risk={briefing?.risk || posture?.risk} compact />

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
          <div className="space-y-4">
            <EvidenceCards incidents={incidents} compact />
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
          <GraphImpactPanel localBlurb={graphBlurb} />
        ) : null}

        {section === 'response' ? (
          <div className="space-y-4">
            <ResponsePlan steps={plan} />
            <InvestigationQueue steps={briefing?.investigationSteps} />
            {briefing?.financialImpact ? (
              <section className="soc-zone px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="soc-zone-title">Financial / operational impact</h2>
                  <span className="soc-role-chip soc-role-simulated">Simulated</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed">{briefing.financialImpact}</p>
              </section>
            ) : null}
          </div>
        ) : null}

        {section === 'sources' ? (
          <div className="space-y-4">
            <details className="soc-zone px-5 py-4" open>
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
      <CommanderKnowledgeDrawer
        open={isKnowledgeOpen}
        onToggle={() => setIsKnowledgeOpen((open) => !open)}
        onClose={() => setIsKnowledgeOpen(false)}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
          <KnowledgeCitation citations={citations} knowledgeStatus={briefing?.knowledgeStatus} />
        </div>
        <div className="shrink-0 border-t border-[var(--tn-line)] bg-[var(--tn-canvas)] p-3">
          <CommanderInput roomId={roomId} />
        </div>
      </CommanderKnowledgeDrawer>
      </div>
    </div>
  )
}

function HeroStat({ label, value }) {
  return (
    <div className="border-t border-[var(--tn-line)] px-4 py-3 odd:border-r">
      <div className="tn-label">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium capitalize">{value}</div>
    </div>
  )
}
