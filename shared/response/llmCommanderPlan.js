/**
 * LLM Commander planning — parse / validate only.
 * Never executes actions or mutates infrastructure state.
 *
 * Policy/playbooks do not constrain which repository actions the LLM may select.
 * Server validation is registry + executability + target/incident existence only.
 */

import {
  affectedNodeIdFromContext,
  getResponseAction,
  isRegisteredResponseAction,
} from '../responseActions.js'
import {
  getRepositoryAction,
  listRepositoryActions,
} from './responseActionRepository.js'
import { getAttackPreset, resolvePresetStage } from '../attackPresets.js'
import { buildKnowledgeRetrievalQuery } from '../commanderKnowledgeQuery.js'

export const LLM_COMMANDER_RESPONSE_GOAL =
  'Analyze the incident and current evidence. Select the smallest ordered set of executable response actions that will contain and resolve the incident. Return only valid JSON.'

/** Shared system prompt for merged explain+plan JSON. */
export const LLM_COMMANDER_MERGED_SYSTEM_PROMPT = `You are the Commander Planner.
${LLM_COMMANDER_RESPONSE_GOAL}

Information hierarchy (strict):
- LEVEL 1 — OBSERVED / LIVE EVIDENCE: incident, telemetryEvidence, graphContext, cityModelContext, attackContext, policy/state fields. This is the source of truth for what is happening NOW.
- LEVEL 2 — DERIVED SYSTEM ANALYSIS: riskScore, trustScore, hopDistance, correlations. Derived from live evidence; not proof of a confirmed attack narrative beyond those numbers.
- LEVEL 3 — AUTHORITATIVE KNOWLEDGE: retrievedKnowledge (NIST, MITRE ICS ATT&CK, CERT-In, CISA, IoT/OT guidance). Supporting domain guidance only.

Use retrievedKnowledge to improve action selection, containment approach, rationale, and expectedImpact.
Do NOT invent incident facts from RAG. Do NOT claim a technique occurred merely because MITRE describes it.
Do NOT invent infrastructure. Do NOT invent actions missing from availableActions.
Do NOT bypass policy. Do NOT execute anything. Do NOT treat RAG text as observed telemetry.
availableActions is the ONLY source of executable actionIds. RAG may inform selection but cannot create actions.
If retrievedKnowledge.status is unavailable, plan from live evidence alone.

Return only valid JSON:
{
  "summary": "...",
  "attackInterpretation": "...",
  "review": "...",
  "strategy": "...",
  "actions": [
    {
      "actionId": "...",
      "target": "...",
      "rationale": "...",
      "expectedImpact": "..."
    }
  ]
}`

const PLANNER_RAG_NOTE_UNAVAILABLE =
  'No relevant authoritative knowledge was retrieved.'

function pushQueryPart(parts, value) {
  const s = String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return
  const lower = s.toLowerCase()
  if (parts.some((p) => p.toLowerCase() === lower)) return
  parts.push(s)
}

/**
 * Compact incident-specific RAG query for the Orchestrate Planner.
 * Reuses buildKnowledgeRetrievalQuery; adds attack/response focus from live fields only.
 */
export function buildPlannerRagQuery(context, { room = null } = {}) {
  const base = buildKnowledgeRetrievalQuery(context)
  const parts = []
  if (base.query) pushQueryPart(parts, base.query)

  const nodeId = affectedNodeIdFromContext(context)
  const attack = resolveAttackContext(room, nodeId)
  if (attack?.attackType) pushQueryPart(parts, attack.attackType)
  if (attack?.title) pushQueryPart(parts, attack.title)
  if (attack?.stage?.id) pushQueryPart(parts, attack.stage.id)

  const joined = parts.join(' ').toLowerCase()
  pushQueryPart(parts, 'incident response containment')
  if (/exfil|transfer|download|files downloaded|data/.test(joined)) {
    pushQueryPart(parts, 'data protection network segmentation')
  }
  if (/credential|login|auth|spray|session|password/.test(joined)) {
    pushQueryPart(parts, 'credential session security')
  }
  if (/power|substation|scada|plc|ot|ics|water|energy|traffic/.test(joined)) {
    pushQueryPart(parts, 'OT ICS operational constraints')
  }
  if (/http|api|packet|flood|ddos|traffic|request/.test(joined)) {
    pushQueryPart(parts, 'network rate limiting segmentation')
  }

  const query = parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 400)
  return {
    query: query || 'cybersecurity incident response anomaly containment',
    hints: {
      ...(base.hints || {}),
      plannerFocus: true,
      attackType: attack?.attackType ?? base.hints?.attackType ?? null,
      attackPreset: attack?.presetId ?? null,
    },
  }
}

/** Empty / soft-fail retrievedKnowledge for the Planner payload. */
export function emptyRetrievedKnowledge(reason = PLANNER_RAG_NOTE_UNAVAILABLE, query = null) {
  return {
    status: 'unavailable',
    note: String(reason || PLANNER_RAG_NOTE_UNAVAILABLE),
    query: query ? String(query) : null,
    items: [],
  }
}

/**
 * Map existing /commander/knowledge payload into Planner retrievedKnowledge.
 * Does not invent citations — only uses returned sources + excerpts.
 */
export function knowledgeContextToRetrievedKnowledge(kc, query = null) {
  if (!kc || kc.retrieved !== true) {
    return emptyRetrievedKnowledge(
      kc?.reason || PLANNER_RAG_NOTE_UNAVAILABLE,
      query
    )
  }

  const sources = Array.isArray(kc.sources) ? kc.sources : []
  const texts = Array.isArray(kc.relevantKnowledge) ? kc.relevantKnowledge : []
  const items = []
  const n = Math.min(5, Math.max(texts.length, sources.length))
  for (let i = 0; i < n; i += 1) {
    const src = sources[i] && typeof sources[i] === 'object' ? sources[i] : {}
    const textRaw = texts[i] ?? null
    const text = textRaw != null ? String(textRaw).trim().slice(0, 400) : null
    const documentName = src.document ?? src.document_name ?? src.documentName ?? null
    const source = src.source ?? null
    const category = src.category ?? null
    if (!text && !documentName && !source) continue
    items.push({
      source,
      documentName,
      category,
      section: src.section ?? null,
      page: src.page ?? src.page_number ?? null,
      score: src.score ?? null,
      text,
    })
  }

  if (items.length === 0) {
    return emptyRetrievedKnowledge(PLANNER_RAG_NOTE_UNAVAILABLE, query)
  }

  return {
    status: 'available',
    note: null,
    query: query ? String(query) : Array.isArray(kc.queries) ? kc.queries[0] ?? null : null,
    items,
    attackUnderstanding: Array.isArray(kc.attackUnderstanding)
      ? kc.attackUnderstanding.map(String).slice(0, 3)
      : [],
    preventionGuidance: Array.isArray(kc.preventionGuidance)
      ? kc.preventionGuidance.map(String).slice(0, 3)
      : [],
  }
}

export function summarizeRetrievedKnowledgeForDebug(retrievedKnowledge) {
  const rk =
    retrievedKnowledge && typeof retrievedKnowledge === 'object'
      ? retrievedKnowledge
      : emptyRetrievedKnowledge()
  const items = Array.isArray(rk.items) ? rk.items : []
  return {
    ragUsed: rk.status === 'available' && items.length > 0,
    ragChunkCount: items.length,
    ragQuery: rk.query ?? null,
    ragSources: items.map((item) => ({
      source: item?.source ?? null,
      documentName: item?.documentName ?? null,
      category: item?.category ?? null,
    })),
  }
}

export const LLM_COMMANDER_ACTIONS_SCHEMA = Object.freeze({
  type: 'object',
  required: ['summary', 'attackInterpretation', 'strategy', 'actions'],
  properties: {
    summary: { type: 'string' },
    attackInterpretation: { type: 'string' },
    review: { type: 'string' },
    strategy: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['actionId', 'target', 'rationale', 'expectedImpact'],
        properties: {
          actionId: { type: 'string' },
          target: { type: 'string' },
          rationale: { type: 'string' },
          expectedImpact: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          dependencies: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    riskAssessment: { type: 'string' },
    uncertainty: { type: 'string' },
  },
})

/**
 * Feature flag: LLM-assisted Commander planning.
 * Default OFF so existing deterministic tests / demos stay unchanged.
 * Set LLM_RESPONSE_PLAN=1 (or RESPONSE_PLAN_MODE=llm) to enable.
 */
export function llmResponsePlanEnabled() {
  const mode = String(process.env.RESPONSE_PLAN_MODE ?? '')
    .trim()
    .toLowerCase()
  if (mode === 'deterministic' || mode === 'policy') return false
  if (mode === 'llm') return true
  const v = String(process.env.LLM_RESPONSE_PLAN ?? '0').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Strip markdown fences and extract a JSON object from model text.
 * @param {unknown} raw
 * @returns {{ ok: true, value: object, rawText: string } | { ok: false, error: string, rawText: string }}
 */
export function parseLlmCommanderActionsJson(raw) {
  let text = ''
  if (typeof raw === 'string') text = raw
  else if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.actions) || raw.actions !== undefined) {
      return { ok: true, value: raw, rawText: JSON.stringify(raw) }
    }
    text = JSON.stringify(raw)
  } else {
    return {
      ok: false,
      error: 'LLM response is empty',
      code: 'EMPTY_RESPONSE',
      rawText: '',
    }
  }

  let cleaned = text.trim()
  if (!cleaned) {
    return {
      ok: false,
      error: 'LLM response is empty',
      code: 'EMPTY_RESPONSE',
      rawText: text,
    }
  }

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '')
  }

  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first < 0) {
    return {
      ok: false,
      error: 'Malformed LLM JSON (no object)',
      code: 'MALFORMED_JSON',
      rawText: text,
    }
  }
  if (last <= first) {
    return {
      ok: false,
      error: 'LLM JSON truncated (unclosed object)',
      code: 'TRUNCATED_JSON',
      rawText: text,
    }
  }

  const slice = cleaned.slice(first, last + 1)
  let depth = 0
  for (const ch of slice) {
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
  }
  if (depth !== 0) {
    return {
      ok: false,
      error: 'LLM JSON truncated (unbalanced braces)',
      code: 'TRUNCATED_JSON',
      rawText: text,
    }
  }

  try {
    const value = JSON.parse(slice)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        ok: false,
        error: 'LLM JSON must be an object',
        code: 'MALFORMED_JSON',
        rawText: text,
      }
    }
    return { ok: true, value, rawText: text }
  } catch {
    return {
      ok: false,
      error: 'Malformed LLM JSON',
      code: 'MALFORMED_JSON',
      rawText: text,
    }
  }
}

/**
 * Print merged LLM Commander JSON to the match-server terminal.
 * @param {{ summary?: string|null, actions: string[], notes?: string[] }} parsed
 * @param {{ source?: string, raw?: string|null }} [meta]
 */
export function logLlmCommanderPlan(parsed, meta = {}) {
  const source = meta.source ? ` source=${meta.source}` : ''
  const actions = Array.isArray(parsed?.actions) ? parsed.actions : []
  console.log(`[LLM COMMANDER] PARSED:${source} ${JSON.stringify(actions)}`)
}

function graphNeighborIds(room, nodeId) {
  const id = String(nodeId ?? '')
  if (!id || !Array.isArray(room?.edges)) return []
  const ids = new Set()
  for (const edge of room.edges) {
    const source = String(edge?.source ?? '')
    const target = String(edge?.target ?? '')
    if (source === id && target) ids.add(target)
    if (target === id && source) ids.add(source)
  }
  return [...ids]
}

function roomNodeIdSet(room) {
  return new Set(
    (Array.isArray(room?.nodes) ? room.nodes : [])
      .map((node) => node?.id)
      .filter((id) => id != null)
      .map(String)
  )
}

/**
 * Complete executable repository catalog for Commander planning.
 * Not filtered by policy playbooks or isolate-node injection.
 */
export function listExecutableRepositoryForPlanner(context, room = null) {
  const nodeId = affectedNodeIdFromContext(context)
  const neighbors = graphNeighborIds(room, nodeId)
  return listRepositoryActions({ supportedOnly: true })
    .filter((action) => action.executionTarget)
    .map((action) => ({
      actionId: action.actionId,
      name: action.label,
      description: action.description,
      capability: action.category,
      targetType: action.requiresPeer ? 'peer' : 'node',
      validTargets: action.requiresPeer
        ? neighbors
        : nodeId
          ? [String(nodeId)]
          : [],
    }))
}

function resolveAttackContext(room, nodeId) {
  if (!room || !nodeId) return null
  const sim = room.hackSimulator ?? null
  const seqs = Object.values(room.activeAttackSequences ?? {})
  const tipSeq = seqs.find(
    (s) =>
      s?.status === 'active' &&
      Array.isArray(s.nodePath) &&
      s.nodePath.includes(String(nodeId))
  )
  const seedPreset =
    sim?.nodePresetIds?.[nodeId] ??
    tipSeq?.events?.find((e) => e?.kind === 'seed')?.presetId ??
    tipSeq?.events?.[0]?.presetId ??
    null
  const stageIndex = Array.isArray(tipSeq?.nodePath)
    ? Math.max(0, tipSeq.nodePath.indexOf(String(nodeId)))
    : null
  const preset = seedPreset ? getAttackPreset(seedPreset) : null
  const resolvedStage =
    preset && stageIndex != null
      ? resolvePresetStage(seedPreset, stageIndex)
      : null
  const stage = resolvedStage
    ? {
        id: resolvedStage.stage.id,
        name: resolvedStage.stage.name,
        description: resolvedStage.stage.description ?? null,
      }
    : null
  return {
    presetId: seedPreset,
    attackType: preset?.attackType ?? null,
    title: preset?.title ?? null,
    description: preset?.description ?? null,
    stage,
    metricOverride: sim?.nodeOverrides?.[nodeId] ?? null,
  }
}

function compactTelemetry(evidence) {
  if (!Array.isArray(evidence)) return []
  return evidence.slice(0, 8).map((item) => ({
    code: item?.code ?? null,
    metric: item?.metric ?? null,
    observed: item?.observed ?? null,
    expected: item?.expected ?? null,
    deviationPct: item?.deviationPct ?? null,
  }))
}

export function estimateCommanderPromptTokens(systemPrompt, payload) {
  const chars =
    String(systemPrompt ?? '').length + JSON.stringify(payload ?? {}).length
  return Math.max(1, Math.ceil(chars / 4))
}

/**
 * Build compact, facts-only context for the LLM planner.
 * System instructions live in the chat system message only — not duplicated here.
 */
export function buildLlmCommanderPromptPayload(
  context,
  {
    room = null,
    previousPlan = null,
    verification = null,
    retrievedKnowledge = null,
  } = {}
) {
  const nodeId = affectedNodeIdFromContext(context)
  const actionRepository = listExecutableRepositoryForPlanner(context, room)
  const attackContext = resolveAttackContext(room, nodeId)

  const related = Array.isArray(context?.relatedIncidents)
    ? context.relatedIncidents.slice(0, 8).map((r) => ({
        id: r?.id ?? r?.incidentId ?? null,
        severity: r?.severity ?? null,
        endpointId: r?.endpointId ?? r?.affectedAsset?.id ?? null,
      }))
    : []

  const roomNodes = Array.isArray(room?.nodes) ? room.nodes : []
  const roomEdges = Array.isArray(room?.edges) ? room.edges : []
  const affectedNode =
    roomNodes.find((node) => String(node?.id) === String(nodeId)) ?? null
  const peers = graphNeighborIds(room, nodeId)
  const graphRelationships = nodeId
    ? roomEdges
        .filter(
          (edge) =>
            String(edge?.source ?? '') === String(nodeId) ||
            String(edge?.target ?? '') === String(nodeId)
        )
        .map((edge) => ({
          source: edge?.source ?? null,
          target: edge?.target ?? null,
          type:
            edge?.data?.relationshipType ??
            edge?.data?.type ??
            edge?.type ??
            null,
        }))
    : []

  const telemetryEvidence = compactTelemetry(context?.anomalyEvidence)

  const knowledge =
    retrievedKnowledge && typeof retrievedKnowledge === 'object'
      ? retrievedKnowledge
      : emptyRetrievedKnowledge()

  return {
    incident: {
      incidentId: context?.incidentId ?? context?.liveIncidentId ?? null,
      incidentType: context?.incidentType ?? null,
      severity: context?.severity ?? null,
      status: context?.status ?? context?.currentStatus ?? null,
      riskScore: context?.riskScore ?? null,
      trustScore: context?.trustScore ?? null,
    },
    attackContext,
    affectedAsset: context?.affectedAsset
      ? {
          id: context.affectedAsset.id ?? nodeId,
          summary: context.affectedAsset.summary ?? null,
          type: context.affectedAsset.type ?? null,
          sector: context.affectedAsset.sector ?? null,
          criticality: context.affectedAsset.criticality ?? null,
          quarantined: context.affectedAsset.quarantined === true,
        }
      : nodeId
        ? { id: nodeId }
        : null,
    telemetryEvidence,
    graphContext: {
      peers,
      relationships: graphRelationships,
      primaryPath: context?.primaryPath ?? null,
      hopDistance: context?.hopDistance ?? null,
    },
    cityModelContext: room
      ? {
          cityContext:
            context?.cityContext ??
            room?.detection?.cityContext ??
            null,
          affectedNode: affectedNode
            ? {
                id: affectedNode.id,
                type: affectedNode.data?.type ?? affectedNode.type ?? null,
                sector: affectedNode.data?.sector ?? affectedNode.sector ?? null,
                criticality:
                  affectedNode.data?.criticality ??
                  affectedNode.criticality ??
                  null,
              }
            : null,
        }
      : null,
    relatedIncidents: related,
    availableActions: actionRepository,
    /** Level-3 authoritative knowledge only — never live evidence. */
    retrievedKnowledge: knowledge,
    responseGoal: LLM_COMMANDER_RESPONSE_GOAL,
    previousResponseContext: previousPlan
      ? {
          planId: previousPlan.planId ?? null,
          primaryIncidentId: previousPlan.primaryIncidentId ?? null,
          strategy: previousPlan.strategy ?? null,
          selectedActions: (previousPlan.recommendedActions ?? [])
            .slice(0, 8)
            .map((action) => ({
              actionId: action?.actionId ?? null,
              status: action?.status ?? null,
            })),
          verification: verification
            ? {
                verdict: verification.verdict ?? null,
                reasons: (
                  verification.failReasons ??
                  verification.reasons ??
                  []
                ).slice(0, 4),
              }
            : null,
        }
      : null,
    serverAuthoritativeTarget: nodeId,
  }
}

export function logCommanderPlanningInput(payload, extras = {}) {
  const contextTokens =
    extras.contextTokens ??
    estimateCommanderPromptTokens(LLM_COMMANDER_MERGED_SYSTEM_PROMPT, payload)
  console.log('[COMMANDER INPUT]')
  console.log('contextTokens:', contextTokens)
  console.log('requestedContext:', extras.requestedContext ?? 8192)
  console.log(
    'actual/configuredContext:',
    extras.configuredContext ?? extras.actualContext ?? 'unknown'
  )
  console.log('numPredict:', extras.numPredict ?? 2048)
  console.log('attack:', JSON.stringify(payload?.attackContext ?? null))
  console.log('incident:', JSON.stringify(payload?.incident ?? null))
  console.log('affectedAsset:', JSON.stringify(payload?.affectedAsset ?? null))
  console.log('telemetry:', JSON.stringify(payload?.telemetryEvidence ?? null))
  console.log('graph:', JSON.stringify(payload?.graphContext ?? null))
  console.log(
    'actions:',
    JSON.stringify((payload?.availableActions ?? []).map((a) => a.actionId ?? a))
  )
}

export function logCommanderRaw(raw) {
  console.log('[COMMANDER RAW]')
  console.log(typeof raw === 'string' ? raw : JSON.stringify(raw ?? null))
}

export function logCommanderParsed(parsed) {
  console.log('[COMMANDER PARSED]')
  console.log(JSON.stringify(parsed ?? null))
}

export function logCommanderFinalPlan(plan) {
  console.log('[COMMANDER FINAL]')
  if (plan && typeof plan === 'object' && !Array.isArray(plan)) {
    console.log(
      JSON.stringify({
        planId: plan.planId ?? null,
        strategy: plan.strategy ?? null,
        summary: plan.llmSummary ?? plan.summary ?? null,
        actions: (plan.recommendedActions ?? []).map((action) => ({
          actionId: action?.actionId ?? null,
          target: action?.target?.id ?? action?.target ?? null,
          rationale: action?.reason ?? action?.rationale ?? null,
        })),
      })
    )
    return
  }
  console.log('final actions:', JSON.stringify(plan ?? []))
}

/**
 * Validate LLM actions against the executable repository and graph targets.
 * Does not apply policy playbooks, allowlists, or isolate-node injection.
 *
 * @param {unknown} actionsRaw
 * @param {object} context
 * @returns {{ ok: true, actions: string[] } | { ok: false, error: string, code: string }}
 */
export function validateLlmCommanderActions(actionsRaw, context, { room = null } = {}) {
  if (!Array.isArray(actionsRaw)) {
    return { ok: false, error: 'actions must be an array', code: 'INVALID_SHAPE' }
  }
  if (actionsRaw.length === 0) {
    return { ok: false, error: 'actions array is empty', code: 'EMPTY_ACTIONS' }
  }

  const seen = new Set()
  const actions = []
  const actionIds = []
  const authoritativeNodeId = affectedNodeIdFromContext(context)
  const roomNodeIds = roomNodeIdSet(room)
  const neighborIds = new Set(graphNeighborIds(room, authoritativeNodeId))

  for (const item of actionsRaw) {
    const legacy = typeof item === 'string' || typeof item === 'number'
    if (!legacy && (!item || typeof item !== 'object' || Array.isArray(item))) {
      return {
        ok: false,
        error: 'Each action must be an action object or legacy actionId string',
        code: 'INVALID_ACTION_TYPE',
      }
    }
    const actionId = String(legacy ? item : item.actionId ?? '').trim()
    if (!actionId) {
      return { ok: false, error: 'Empty actionId', code: 'INVALID_ACTION_ID' }
    }
    if (seen.has(actionId)) {
      // Deduplicate while preserving first order
      continue
    }

    const repo = getRepositoryAction(actionId)
    if (repo && repo.supported !== true) {
      return {
        ok: false,
        error: `Catalog-only / unsupported action not executable: ${actionId}`,
        code: 'CATALOG_ONLY',
      }
    }
    if (!isRegisteredResponseAction(actionId)) {
      return {
        ok: false,
        error: `Unknown / hallucinated actionId: ${actionId}`,
        code: 'UNKNOWN_ACTION',
      }
    }
    const registered = getResponseAction(actionId)
    if (!registered || registered.supported !== true) {
      return {
        ok: false,
        error: `Action is not an executable registry entry: ${actionId}`,
        code: 'NOT_EXECUTABLE',
      }
    }
    if (!registered.executionTarget) {
      return {
        ok: false,
        error: `Action is not an executable registry entry: ${actionId}`,
        code: 'NOT_EXECUTABLE',
      }
    }

    if (registered.requiresNode && !authoritativeNodeId) {
      return {
        ok: false,
        error: `Action requires a target node: ${actionId}`,
        code: 'MISSING_TARGET',
      }
    }

    let target = legacy
      ? registered.requiresPeer
        ? null
        : authoritativeNodeId
      : String(item.target ?? '').trim() || null
    if (registered.requiresPeer) {
      if (!target) {
        return {
          ok: false,
          error: `Action requires a valid peer target: ${actionId}`,
          code: 'MISSING_TARGET',
        }
      }
      if (roomNodeIds.size > 0 && !roomNodeIds.has(target)) {
        return {
          ok: false,
          error: `Unknown / hallucinated target: ${target}`,
          code: 'INVALID_TARGET',
        }
      }
      if (neighborIds.size > 0 && !neighborIds.has(target)) {
        return {
          ok: false,
          error: `Target is not valid for action: ${actionId}`,
          code: 'INVALID_TARGET',
        }
      }
    } else if (registered.requiresNode) {
      if (!target) {
        return {
          ok: false,
          error: `Action requires an explicit target: ${actionId}`,
          code: 'MISSING_TARGET',
        }
      }
      if (roomNodeIds.size > 0 && !roomNodeIds.has(target)) {
        return {
          ok: false,
          error: `Unknown / hallucinated target: ${target}`,
          code: 'INVALID_TARGET',
        }
      }
      if (authoritativeNodeId && target !== String(authoritativeNodeId)) {
        return {
          ok: false,
          error: `Target does not belong to the selected incident: ${target}`,
          code: 'INVALID_TARGET',
        }
      }
      target = String(authoritativeNodeId)
    } else if (target && roomNodeIds.size > 0 && !roomNodeIds.has(target)) {
      return {
        ok: false,
        error: `Unknown / hallucinated target: ${target}`,
        code: 'INVALID_TARGET',
      }
    }
    const rationale = legacy
      ? null
      : typeof item.rationale === 'string' && item.rationale.trim()
        ? item.rationale.trim()
        : null
    const expectedImpact = legacy
      ? null
      : typeof item.expectedImpact === 'string' && item.expectedImpact.trim()
        ? item.expectedImpact.trim()
        : null
    const actionConfidence =
      legacy || item.confidence == null ? null : Number(item.confidence)
    if (
      actionConfidence != null &&
      (!Number.isFinite(actionConfidence) ||
        actionConfidence < 0 ||
        actionConfidence > 1)
    ) {
      return {
        ok: false,
        error: `Action confidence must be from 0 to 1: ${actionId}`,
        code: 'INVALID_ACTION_CONFIDENCE',
      }
    }
    const dependencies = legacy
      ? []
      : Array.isArray(item.dependencies)
        ? item.dependencies.map((value) => String(value ?? '').trim()).filter(Boolean)
        : []
    for (const dependency of dependencies) {
      if (dependency === actionId || !seen.has(dependency)) {
        return {
          ok: false,
          error: `Action dependency must reference an earlier selected action: ${actionId} -> ${dependency}`,
          code: 'INVALID_DEPENDENCY',
        }
      }
    }

    seen.add(actionId)
    actionIds.push(actionId)
    actions.push({
      actionId,
      target,
      rationale,
      expectedImpact,
      confidence: actionConfidence,
      dependencies,
    })
  }

  if (actions.length === 0) {
    return { ok: false, error: 'actions array is empty after validation', code: 'EMPTY_ACTIONS' }
  }

  return { ok: true, actions, actionIds }
}

/**
 * End-to-end: parse raw LLM text → log → validate against context.
 * @param {unknown} raw
 * @param {object} context
 * @param {{ source?: string }} [opts]
 */
export function parseAndValidateLlmCommanderPlan(raw, context, opts = {}) {
  const source = opts.source || 'match-server'
  const parsed = parseLlmCommanderActionsJson(raw)
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      code: parsed.code || 'MALFORMED_JSON',
      rawText: parsed.rawText,
      parsedResponse: null,
      actions: [],
      actionIds: [],
    }
  }

  const actionsField = parsed.value.actions
  const summary =
    typeof parsed.value.summary === 'string' ? parsed.value.summary.trim() : ''
  const confidence =
    parsed.value.confidence == null ? null : Number(parsed.value.confidence)
  const attackInterpretation =
    typeof parsed.value.attackInterpretation === 'string'
      ? parsed.value.attackInterpretation.trim() || null
      : null
  const strategy =
    typeof parsed.value.strategy === 'string'
      ? parsed.value.strategy.trim() || null
      : null
  const riskAssessment =
    typeof parsed.value.riskAssessment === 'string'
      ? parsed.value.riskAssessment.trim() || null
      : null
  const uncertainty =
    typeof parsed.value.uncertainty === 'string'
      ? parsed.value.uncertainty.trim() || null
      : null
  const review =
    typeof parsed.value.review === 'string'
      ? parsed.value.review.trim() || null
      : null
  const requireRich =
    opts.requireRich === true ||
    source === 'ollama-direct' ||
    source === 'ai-com-v1'
  if (requireRich) {
    const missingTopLevel = [
      ['summary', summary || null],
      ['attackInterpretation', attackInterpretation],
      ['strategy', strategy],
    ].find(([, value]) => !value)
    if (missingTopLevel) {
      return {
        ok: false,
        error: `LLM JSON missing required field: ${missingTopLevel[0]}`,
        code: 'INVALID_RICH_PLAN',
        rawText: parsed.rawText,
        parsedResponse: parsed.value,
        actions: [],
        actionIds: [],
        summary: summary || null,
        attackInterpretation,
        strategy,
        riskAssessment,
        confidence,
        uncertainty,
      }
    }
    const invalidAction = Array.isArray(actionsField)
      ? actionsField.find(
          (action) =>
            !action ||
            typeof action !== 'object' ||
            Array.isArray(action) ||
            typeof action.rationale !== 'string' ||
            !action.rationale.trim() ||
            typeof action.expectedImpact !== 'string' ||
            !action.expectedImpact.trim()
        )
      : null
    if (invalidAction) {
      return {
        ok: false,
        error: 'LLM action missing actionId, target, rationale, or expectedImpact',
        code: 'INVALID_RICH_PLAN',
        rawText: parsed.rawText,
        parsedResponse: parsed.value,
        actions: [],
        actionIds: [],
        summary: summary || null,
        attackInterpretation,
        strategy,
        riskAssessment,
        confidence,
        uncertainty,
      }
    }
  }
  if (
    confidence != null &&
    (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
  ) {
    return {
      ok: false,
      error: 'confidence must be a number from 0 to 1',
      code: 'INVALID_SHAPE',
      rawText: parsed.rawText,
      parsedResponse: parsed.value,
      actions: [],
      actionIds: [],
      summary: summary || null,
      attackInterpretation,
      strategy,
      riskAssessment,
      confidence: null,
      uncertainty,
    }
  }

  logLlmCommanderPlan(
    {
      summary: summary || null,
      actions: Array.isArray(actionsField) ? actionsField : [],
      confidence,
      uncertainty,
    },
    { source }
  )

  if (!Object.prototype.hasOwnProperty.call(parsed.value, 'actions')) {
    return {
      ok: false,
      error: 'LLM JSON missing actions field',
      code: 'INVALID_SHAPE',
      rawText: parsed.rawText,
      parsedResponse: parsed.value,
      actions: [],
      actionIds: [],
      summary: summary || null,
      attackInterpretation,
      strategy,
      riskAssessment,
      confidence,
      uncertainty,
    }
  }

  const validated = validateLlmCommanderActions(actionsField, context, {
    room: opts.room ?? null,
  })
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.error,
      code: validated.code,
      rawText: parsed.rawText,
      parsedResponse: parsed.value,
      actions: [],
      actionIds: [],
      summary: summary || null,
      attackInterpretation,
      strategy,
      riskAssessment,
      confidence,
      uncertainty,
    }
  }

  return {
    ok: true,
    actions: validated.actions,
    actionIds: validated.actionIds,
    summary: summary || null,
    attackInterpretation,
    review,
    strategy,
    riskAssessment,
    confidence,
    uncertainty,
    rawText: parsed.rawText,
    parsedResponse: parsed.value,
    code: null,
    error: null,
  }
}
